package com.echelon.eve.corp

import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.api.await
import com.echelon.eve.core.esi.EveNames
import com.echelon.eve.core.model.IndustryJob
import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import java.util.WeakHashMap

// GET /api/corp (worker/index.js, worker/corp.js): the corporation snapshot the Worker builds about once an hour with a
// member who allowed corporation access. Every section is {value, fetched, truncated, …}; a section the pilot's role
// can't read is in errors ("needs role Director"). Fuel hours and days are worked out by the Worker for the moment of
// the request. GET /api/assets: the caller's own assets as a tree by location.

@Serializable
data class Starbase(
    val id: Long, val type: Long, val size: String = "large", val system: Long, val moon: Long? = null, val state: String? = null,
    val onlined: String? = null, val reinforcedUntil: String? = null, val unanchorAt: String? = null, val fuelBlocks: Long = 0, val strontium: Long = 0,
    val fuelHours: Double? = null, val strontiumHours: Double = 0.0, val fuelEmptyAt: Long? = null, val fuelHoursLeft: Double? = null,
)
@Serializable data class Service(val name: String, val state: String)
@Serializable
data class Structure(
    val id: Long, val type: Long, val system: Long, val name: String? = null, val state: String? = null, val fuelExpires: String? = null,
    val stateTimerStart: String? = null, val stateTimerEnd: String? = null, val unanchorsAt: String? = null, val reinforceHour: Int? = null,
    val services: List<Service> = emptyList(), val fuelDaysLeft: Double? = null,
)
@Serializable data class WalletDivision(val division: Int, val balance: Double)
@Serializable data class DivisionName(val division: Int, val name: String = "")
@Serializable data class Divisions(val wallet: List<DivisionName> = emptyList(), val hangar: List<DivisionName> = emptyList())
@Serializable
data class CorpJob(
    @kotlinx.serialization.SerialName("job_id") val jobId: Long, @kotlinx.serialization.SerialName("installer_id") val installerId: Long? = null,
    @kotlinx.serialization.SerialName("activity_id") val activityId: Int, @kotlinx.serialization.SerialName("blueprint_type_id") val blueprintTypeId: Long,
    @kotlinx.serialization.SerialName("product_type_id") val productTypeId: Long? = null, val status: String = "active", val runs: Int = 1,
    @kotlinx.serialization.SerialName("start_date") val startDate: String, @kotlinx.serialization.SerialName("end_date") val endDate: String,
    @kotlinx.serialization.SerialName("location_id") val locationId: Long? = null,
)
@Serializable
data class CustomsOffice(
    @kotlinx.serialization.SerialName("office_id") val officeId: Long, @kotlinx.serialization.SerialName("system_id") val systemId: Long,
    @kotlinx.serialization.SerialName("reinforce_exit_start") val exitStart: Int? = null, @kotlinx.serialization.SerialName("reinforce_exit_end") val exitEnd: Int? = null,
    @kotlinx.serialization.SerialName("tax_rate_standing_good") val taxGood: Double? = null, @kotlinx.serialization.SerialName("tax_rate_neutral") val taxNeutral: Double? = null,
    @kotlinx.serialization.SerialName("tax_rate_bad") val taxBad: Double? = null, @kotlinx.serialization.SerialName("alliance_tax_rate") val taxAlliance: Double? = null,
    @kotlinx.serialization.SerialName("corporation_tax_rate") val taxCorp: Double? = null,
)
/** Corporation assets as the Worker sums them: items rolled up to the place that holds them, the 40 biggest types each. */
@Serializable data class CorpPlace(val id: Long, val items: Int = 0, val types: List<List<Long>> = emptyList())
@Serializable data class CorpAssets(val items: Int = 0, val locations: Int = 0, val places: List<CorpPlace> = emptyList())

/** One section of the snapshot: its value (null when never read), when it was read, and why it can't be shown. */
data class Section<T>(val value: T?, val fetched: String?, val truncated: Boolean, val error: String?)

data class CorpSnapshot(
    val corporationId: Long, val updatedAt: Long, val age: Long, val partial: Boolean, val source: String?, val error: String?,
    val starbases: Section<List<Starbase>>, val structures: Section<List<Structure>>, val wallets: Section<List<WalletDivision>>, val divisions: Section<Divisions>,
    val members: Section<List<Pair<Long, String?>>>, val memberCount: Int, val jobs: Section<List<CorpJob>>, val customs: Section<List<CustomsOffice>>, val assets: Section<CorpAssets>,
) {
    companion object {
        private inline fun <reified T> section(o: JsonObject, errors: JsonObject?, key: String, read: (JsonElement) -> T): Section<T> {
            val s = o[key] as? JsonObject
            val v = s?.get("value")?.let { runCatching { read(it) }.getOrNull() }
            return Section(v, (s?.get("fetched") as? JsonPrimitive)?.content, (s?.get("truncated") as? JsonPrimitive)?.content == "true", (errors?.get(key) as? JsonPrimitive)?.content)
        }
        private fun long(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.longOrNull

        fun of(o: JsonObject): CorpSnapshot {
            val e = o["errors"] as? JsonObject
            val j = EchelonJson
            val members = section(o, e, "members") { v -> ((v as JsonObject)["members"] as JsonArray).map { m -> val a = m as JsonArray; a[0].jsonPrimitive.longOrNull!! to (a[1] as? JsonPrimitive)?.takeIf { it.isString }?.content } }
            val count = ((o["members"] as? JsonObject)?.get("value") as? JsonObject)?.get("count")?.jsonPrimitive?.longOrNull?.toInt() ?: members.value?.size ?: 0
            return CorpSnapshot(
                long(o, "corporationId") ?: 0, long(o, "updatedAt") ?: 0, long(o, "age") ?: 0, (o["partial"] as? JsonPrimitive)?.content == "true",
                (o["source"] as? JsonPrimitive)?.takeIf { it.isString }?.content, (o["error"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
                section(o, e, "starbases") { j.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(Starbase.serializer()), it) },
                section(o, e, "structures") { j.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(Structure.serializer()), it) },
                section(o, e, "wallets") { j.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(WalletDivision.serializer()), it) },
                section(o, e, "divisions") { j.decodeFromJsonElement(Divisions.serializer(), it) },
                members, count,
                section(o, e, "jobs") { j.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(CorpJob.serializer()), it) },
                section(o, e, "customs") { j.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(CustomsOffice.serializer()), it) },
                section(o, e, "assets") { j.decodeFromJsonElement(CorpAssets.serializer(), it) },
            )
        }
    }
}

/** GET /api/assets: one place (station, structure, solar system) with its items, containers holding theirs. */
@Serializable
data class AssetItem(@kotlinx.serialization.SerialName("item_id") val itemId: Long, @kotlinx.serialization.SerialName("type_id") val typeId: Long,
    val quantity: Long = 1, val flag: String? = null, val singleton: Boolean = false, val contents: List<AssetItem>? = null)
@Serializable data class AssetPlace(val id: Long, val kind: String = "other", val name: String? = null, val count: Int = 0, val items: List<AssetItem> = emptyList())
@Serializable data class MyAssets(val fetchedAt: String? = null, val cached: Boolean = false, val truncated: Boolean = false, val items: Int = 0, val locations: List<AssetPlace> = emptyList())

/** Every item in a place, containers' contents included, as (type, quantity). */
fun AssetPlace.flatten(): List<Pair<Long, Long>> {
    fun walk(list: List<AssetItem>): List<Pair<Long, Long>> = list.flatMap { listOf(it.typeId to it.quantity) + walk(it.contents.orEmpty()) }
    return walk(items)
}

sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ready<T>(val value: T) : Load<T>
    data class Failed(val message: String, val missing: Boolean = false) : Load<Nothing>
}

/**
 * The Corp tab's data: the corporation snapshot and the flying pilot's assets, read with a connected pilot's session
 * (the flying one first), plus ESI's average prices for asset values (hourly). Pull-to-refresh reloads both.
 */
class CorpRepository(private val c: AppContainer) {
    private val mutex = Mutex()
    private val _corp = MutableStateFlow<Load<CorpSnapshot>>(Load.Loading)
    val corp: StateFlow<Load<CorpSnapshot>> = _corp.asStateFlow()
    private val _assets = MutableStateFlow<Map<Pilot, Load<MyAssets>>>(emptyMap())
    val assets: StateFlow<Map<Pilot, Load<MyAssets>>> = _assets.asStateFlow()
    private val _prices = MutableStateFlow<Map<Long, Double>>(emptyMap())
    val prices: StateFlow<Map<Long, Double>> = _prices.asStateFlow()
    private var pricesAt = 0L

    private fun token(prefer: Pilot?): String? = (listOfNotNull(prefer) + Pilot.entries).firstNotNullOfOrNull { c.sessions.token(it.id) }

    suspend fun refreshCorp(prefer: Pilot?) = mutex.withLock {
        val token = token(prefer) ?: run { _corp.value = Load.Failed("Connect a pilot in Settings to see the corporation."); return@withLock }
        _corp.value = try { Load.Ready(CorpSnapshot.of(c.api.get<JsonObject>("/api/corp", token))) } catch (e: ApiError) {
            if (e is ApiError.Http && e.status == 404) Load.Failed(e.message ?: "No corporation data yet.", missing = true) else Load.Failed(e.message ?: "The backend did not answer.")
        }
    }

    /** The pilot's own assets (each pilot reads only their own; a pilot not connected here has none to show). */
    suspend fun refreshAssets(pilot: Pilot) {
        val token = c.sessions.token(pilot.id) ?: run { _assets.value = _assets.value + (pilot to Load.Failed("Connect ${pilot.displayName} in Settings to see their assets.")); return }
        if (_assets.value[pilot] !is Load.Ready) _assets.value = _assets.value + (pilot to Load.Loading)
        val got = try { Load.Ready(c.api.get<MyAssets>("/api/assets?location=all", token)) } catch (e: ApiError) { Load.Failed(e.message ?: "The backend did not answer.") }
        _assets.value = _assets.value + (pilot to got)
    }

    /** ESI average prices (markets/prices), at most hourly, as the website values assets (ui/esi.js loadPrices). */
    suspend fun refreshPrices() {
        if (System.currentTimeMillis() - pricesAt < 3_600_000 && _prices.value.isNotEmpty()) return
        val url = EveNames.ESI.toHttpUrl().newBuilder().addPathSegments("markets/prices/").addQueryParameter("compatibility_date", EveNames.COMPAT).build()
        val text = runCatching { c.http.newCall(Request.Builder().url(url).build()).await().use { r -> if (r.isSuccessful) r.body.string() else null } }.getOrNull() ?: return
        val rows = runCatching { EchelonJson.parseToJsonElement(text) as JsonArray }.getOrNull() ?: return
        _prices.value = rows.mapNotNull { r -> val o = r as? JsonObject ?: return@mapNotNull null
            val id = o["type_id"]?.jsonPrimitive?.longOrNull ?: return@mapNotNull null
            id to ((o["average_price"] ?: o["adjusted_price"])?.jsonPrimitive?.doubleOrNull ?: 0.0) }.toMap()
        pricesAt = System.currentTimeMillis()
    }

    companion object {
        private val all = WeakHashMap<AppContainer, CorpRepository>()
        fun of(c: AppContainer): CorpRepository = synchronized(all) {
            all.getOrPut(c) { CorpRepository(c).also { r -> c.sync.addRefresher { r.refreshCorp(c.selectedPilot.value) } } }
        }
    }
}

val AppContainer.corp: CorpRepository get() = CorpRepository.of(this)

/** A corp job as the Fly jobs list reads one (the same ESI fields), for jobs.js through the bridge. */
fun CorpJob.asIndustryJob() = IndustryJob(jobId, activityId, blueprintTypeId, productTypeId, runs, null, status, startDate, endDate, locationId)
