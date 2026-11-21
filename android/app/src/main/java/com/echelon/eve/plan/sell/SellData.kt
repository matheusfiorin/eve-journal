package com.echelon.eve.plan.sell

import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.api.await
import com.echelon.eve.core.esi.EveNames
import com.echelon.eve.core.esi.eveNames
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.ConcurrentHashMap

/** An item type's packaged size and, for a hull, its cargo hold (ESI universe/types), as ui/sellquotes.js typeInfo reads them. */
data class TypeInfo(val name: String?, val volume: Double, val capacity: Double)

/** How a load of buy orders went: when they were read, how many calls it took, and what is missing. */
data class Loaded(val quotes: Map<Long, List<JsonObject>>, val at: Long?, val calls: Int, val cached: Int, val capped: Boolean, val failed: Int)

/**
 * Live buy orders for the Sell plan, the web's ui/sellquotes.js: public ESI orders per (region, type), every page,
 * at most 6 calls at once and 150 per plan, cached five minutes (an incomplete book is never cached).
 */
object SellData {
    const val CONCURRENCY = 6
    const val CALL_CAP = 150
    const val TTL = 5 * 60_000L
    private const val MAX_PAGES = 30
    private const val PAGE_ROWS = 1000
    private val cache = ConcurrentHashMap<String, Pair<Long, List<JsonObject>>>()
    private val types = ConcurrentHashMap<Long, TypeInfo>()

    private fun url(path: String, vararg query: Pair<String, String>) = EveNames.ESI.toHttpUrl().newBuilder().addPathSegments(path.trimEnd('/')).addPathSegment("").apply {
        query.forEach { (k, v) -> addQueryParameter(k, v) }
        addQueryParameter("compatibility_date", EveNames.COMPAT)
    }.build()

    /** One ESI order → the planner's quote (ui/sellquotes.js toQuote). */
    internal fun quote(o: JsonObject, region: Long): JsonObject = buildJsonObject {
        put("order", o["order_id"]!!); put("loc", o["location_id"]!!); put("system", o["system_id"]!!); put("region", region)
        put("price", o["price"]!!); put("volume", o["volume_remain"]!!); put("minVolume", o["min_volume"] ?: JsonPrimitive(1))
        val r = o["range"]?.jsonPrimitive?.contentOrNull
        put("range", r?.toLongOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(r ?: "station"))
    }

    suspend fun load(c: AppContainer, typeIds: List<Long>, regions: List<Long>, now: () -> Long = System::currentTimeMillis): Loaded = coroutineScope {
        val gate = Semaphore(CONCURRENCY)
        var calls = 0; var cached = 0; var capped = false; var failed = 0
        val lock = Any()
        val take = { synchronized(lock) { if (calls >= CALL_CAP) { capped = true; false } else { calls++; true } } }
        val out = typeIds.associateWith { mutableListOf<JsonObject>() }
        var oldest: Long? = null
        // Regions in order of relevance, so a cap drops the least useful ones.
        regions.flatMap { r -> typeIds.map { t -> r to t } }.map { (region, type) ->
            async {
                val key = "$region:$type"
                cache[key]?.takeIf { now() - it.first < TTL }?.let { hit -> synchronized(lock) { cached++; out.getValue(type) += hit.second; oldest = minOf(oldest ?: hit.first, hit.first) }; return@async }
                gate.withPermit {
                    val rows = mutableListOf<JsonObject>()
                    var pages: Int? = null; var page = 1; var partial = false
                    try {
                        while (pages == null || page <= pages) {
                            if (page > MAX_PAGES || !take()) { partial = true; break }
                            val (list, xPages) = c.http.newCall(Request.Builder().url(url("markets/$region/orders", "type_id" to "$type", "order_type" to "buy", "page" to "$page")).build()).await().use { r ->
                                if (!r.isSuccessful) throw IllegalStateException("ESI ${r.code}")
                                (EchelonJson.parseToJsonElement(r.body.string()) as? JsonArray ?: JsonArray(emptyList())) to r.header("x-pages")?.toIntOrNull()
                            }
                            rows += list.mapNotNull { (it as? JsonObject)?.let { o -> runCatching { quote(o, region) }.getOrNull() } }
                            pages = pages ?: xPages ?: if (list.size < PAGE_ROWS) page else Int.MAX_VALUE
                            if (xPages == null && list.size < PAGE_ROWS) break
                            page++
                        }
                    } catch (e: Exception) { synchronized(lock) { failed++ }; return@withPermit }
                    val at = now()
                    if (!partial) cache[key] = at to rows
                    synchronized(lock) { out.getValue(type) += rows; oldest = minOf(oldest ?: at, at) }
                }
            }
        }.awaitAll()
        // Best price first, as the planner expects.
        val sorted = out.mapValues { (_, list) -> list.sortedWith(compareByDescending<JsonObject> { it["price"]!!.jsonPrimitive.doubleOrNull ?: 0.0 }.thenBy { it["order"]!!.jsonPrimitive.longOrNull ?: 0 }) }
        Loaded(sorted, oldest, calls, cached, capped, failed)
    }

    /** Sizes and names of item types (ESI universe/types), kept for the process; a type ESI won't describe is left out. */
    suspend fun typeInfo(c: AppContainer, ids: Collection<Long>): Map<Long, TypeInfo> = coroutineScope {
        val gate = Semaphore(4)
        ids.distinct().filter { !types.containsKey(it) }.map { id ->
            async { gate.withPermit {
                val t = c.eveNames.get("universe/types/$id/") ?: return@withPermit
                types[id] = TypeInfo(t["name"]?.jsonPrimitive?.contentOrNull, (t["packaged_volume"] ?: t["volume"])?.jsonPrimitive?.doubleOrNull ?: 0.0, t["capacity"]?.jsonPrimitive?.doubleOrNull ?: 0.0)
            } }
        }.awaitAll()
        ids.mapNotNull { id -> types[id]?.let { id to it } }.toMap()
    }

    /** Names → type ids (ESI universe/ids, inventory types only), for a pasted list. */
    suspend fun typeIds(c: AppContainer, names: List<String>): Map<String, Long> {
        if (names.isEmpty()) return emptyMap()
        val body = JsonArray(names.map { JsonPrimitive(it) }).toString().toRequestBody("application/json".toMediaType())
        val text = c.http.newCall(Request.Builder().url(url("universe/ids")).post(body).build()).await().use { r -> if (!r.isSuccessful) throw IllegalStateException("ESI ${r.code}"); r.body.string() }
        val found = (EchelonJson.parseToJsonElement(text) as? JsonObject)?.get("inventory_types") as? JsonArray ?: return emptyMap()
        return found.mapNotNull { (it as? JsonObject)?.let { o -> (o["name"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null).lowercase() to (o["id"]?.jsonPrimitive?.longOrNull ?: return@mapNotNull null) } }.toMap()
    }

    /** POST /api/sell-station: sets (or with null clears) the pilot's pickup station. */
    suspend fun setPickup(c: AppContainer, token: String, station: Long?) {
        c.api.post<JsonObject>("/api/sell-station", token, buildJsonObject { if (station != null) put("station", station) else put("station", kotlinx.serialization.json.JsonNull) })
    }
}
