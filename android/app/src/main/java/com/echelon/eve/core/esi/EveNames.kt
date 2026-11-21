package com.echelon.eve.core.esi

import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.await
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.WeakHashMap

/**
 * Public ESI lookups the Fly screens need and the Worker does not send: type, station and skill names
 * (POST universe/names/) and whether a type is a Charge (types → groups → category 8), so a loaded charge hangs on its
 * module instead of taking a slot. No token: these are public routes, pinned to the web's compatibility date
 * (ui/esi.js ESI_COMPAT). Results live for the process; names never change and the misses are retried next time.
 */
class EveNames(private val http: OkHttpClient, private val base: HttpUrl = ESI.toHttpUrl()) {
    private val _names = MutableStateFlow<Map<Long, String>>(emptyMap())
    /** Every name resolved so far; screens collect it so a row fills in when its name arrives. */
    val names: StateFlow<Map<Long, String>> = _names.asStateFlow()
    private val categories = mutableMapOf<Long, Int>()
    private val groupCategory = mutableMapOf<Int, Int>()
    private val mutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }

    fun name(id: Long): String? = _names.value[id]

    /** Resolves the ids not known yet (up to 1000 per call, as ESI allows); a failure leaves them unnamed. */
    suspend fun resolve(ids: Collection<Long>) = mutex.withLock {
        val missing = ids.filter { it in 1..2_147_483_646 && it !in _names.value }.distinct()
        for (chunk in missing.chunked(1000)) {
            val body = buildJsonArray { chunk.forEach { add(it) } }.toString().toRequestBody(JSON)
            val got = runCatching { http.newCall(Request.Builder().url(url("universe/names/")).post(body).build()).await().use { r -> if (r.isSuccessful) r.body.string() else null } }.getOrNull() ?: continue
            val rows = runCatching { json.parseToJsonElement(got) as JsonArray }.getOrNull() ?: continue
            val found = rows.mapNotNull { (it as? JsonObject)?.let { o -> o["id"]?.jsonPrimitive?.longOrNull?.let { id -> id to (o["name"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null) } } }
            _names.update { it + found }
        }
    }

    /** The ids among [types] whose category is Charge (8). Types ESI would not describe count as not charges. */
    suspend fun charges(types: Collection<Long>): Set<Long> = mutex.withLock {
        for (type in types.distinct().filter { it !in categories }) {
            val group = getJson("universe/types/$type/")?.get("group_id")?.jsonPrimitive?.intOrNull ?: continue
            val category = groupCategory[group] ?: getJson("universe/groups/$group/")?.get("category_id")?.jsonPrimitive?.int?.also { groupCategory[group] = it } ?: continue
            categories[type] = category
        }
        types.filter { categories[it] == CHARGE }.toSet()
    }

    private suspend fun getJson(path: String): JsonObject? = runCatching {
        http.newCall(Request.Builder().url(url(path)).build()).await().use { r -> if (r.isSuccessful) json.parseToJsonElement(r.body.string()) as JsonObject else null }
    }.getOrNull()

    private fun url(path: String) = base.newBuilder().addPathSegments(path.trimEnd('/')).addPathSegment("")
        .addQueryParameter("compatibility_date", COMPAT).addQueryParameter("user_agent", "Echelon/1.0 (EVE wing console for Android)").build()

    /** GET on a public ESI path (pinned like the rest), or null when ESI didn't answer with JSON. */
    suspend fun get(path: String): JsonObject? = getJson(path)

    companion object {
        const val ESI = "https://esi.evetech.net/"
        /** The same pin as the web (ui/esi.js ESI_COMPAT); see the note there before moving it. */
        const val COMPAT = "2025-09-26"
        const val CHARGE = 8
        private val JSON = "application/json".toMediaType()
    }
}


private val shared = WeakHashMap<AppContainer, EveNames>()
/** One EveNames per app, shared by the feature packages (names resolved once serve every screen). */
val AppContainer.eveNames: EveNames get() = synchronized(shared) { shared.getOrPut(this) { EveNames(http) } }
