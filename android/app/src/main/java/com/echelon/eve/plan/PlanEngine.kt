package com.echelon.eve.plan

import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.core.model.Location
import com.echelon.eve.core.model.MarketData
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.WingPilot
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.WeakHashMap

/**
 * What every Plan screen needs before it calls a planner: the gate map and region 0's meta loaded into the bridge
 * (once per version; the planners keep them), plus a few readers over the core's pilot data.
 */
class PlanEngine(private val c: AppContainer) {
    /** Systems each pilot marked scanned, synced with the website (Explore). */
    val marks = com.echelon.eve.plan.explore.ScanMarks(c.api, c.sessions, java.io.File(c.app.filesDir, "plan"))
    /** Each pilot's Haul plan, synced with the website (Haul routes). */
    val haul = com.echelon.eve.plan.haul.HaulPrefs(c.api, c.sessions, java.io.File(c.app.filesDir, "plan"))
    private val mutex = Mutex()
    private var universeVersion: String? = null
    private var metaStamp: String? = null

    /** Why the planners can't run yet, in the web's words, or null when they can. */
    fun notReady(data: MarketData?, universeJson: String?): String? = when {
        data == null -> "The market has not loaded yet. Pull down on the Plan hub to load it."
        universeJson == null || data.systems.isEmpty() -> "The map appears after the next pipeline run."
        else -> null
    }

    /** Loads the map and meta into the bridge when they changed; returns the bridge ready to call. */
    suspend fun ready(): PlannerBridge? = mutex.withLock {
        val state = c.market.state.value
        val data = state.data ?: return null
        val text = state.universeJson ?: return null
        val version = data.universe?.version ?: data.snapshot.universeVersion ?: "inline"
        if (version != universeVersion) { c.planners.loadUniverse(text); universeVersion = version; metaStamp = null }
        val stamp = "$version:${data.snapshot.meta?.updatedAt ?: 0}"
        if (stamp != metaStamp) {
            c.planners.callRaw("market.meta", "{\"meta\":${data.metaData},\"stamp\":${JsonPrimitive(stamp)}}")
            // The scanned regions' order book (prices for Mine, Build, Trade and Sell), rebuilt with the same stamp.
            val regions = PlanJson.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(com.echelon.eve.core.model.MarketRegion.serializer()), data.snapshot.regions)
            c.planners.callRaw("market.book", "{\"regions\":$regions}")
            metaStamp = stamp
        }
        c.planners
    }

    companion object {
        private val all = WeakHashMap<AppContainer, PlanEngine>()
        fun of(c: AppContainer): PlanEngine = synchronized(all) { all.getOrPut(c) { PlanEngine(c) } }

        /** The trade hubs every start-system picker offers (ui/state.js HUB_SYSTEMS). */
        val HUBS = listOf(30000142L to "Jita", 30002187L to "Amarr", 30002659L to "Dodixie", 30002510L to "Rens", 30002053L to "Hek")
    }
}

val AppContainer.plan: PlanEngine get() = PlanEngine.of(this)

/** The pilot's last known location: their own snapshot, or the wing's shared one. */
fun locationOf(state: PilotState?, wing: WingPilot?): Location? =
    state?.private?.op("location")?.value?.let { runCatching { EchelonJson.decodeFromJsonElement(Location.serializer(), it) }.getOrNull() } ?: wing?.location

/** A pilot's trail ([[systemId, at]…]) from their own snapshot or the wing summary; empty when unknown. */
fun trailOf(state: PilotState?, wing: WingPilot?): JsonArray = (state?.private?.op("trail")?.value as? JsonArray) ?: (wing?.trail as? JsonArray) ?: JsonArray(emptyList())

/** POST /api/waypoints: sets [pilot]'s in-game autopilot to [systems]. Returns how many waypoints EVE took. */
suspend fun AppContainer.sendWaypoints(pilot: Pilot, systems: List<Long>): Result<Int> {
    val token = sessions.token(pilot.id) ?: return Result.failure(IllegalStateException("${pilot.displayName} is not connected on this phone."))
    return try {
        val r = api.post<JsonObject>("/api/waypoints", token, buildJsonObject { put("systems", buildJsonArray { systems.forEach { add(JsonPrimitive(it)) } }) })
        Result.success(r["waypoints"]?.jsonPrimitive?.int ?: systems.size)
    } catch (e: ApiError) { Result.failure(e) }
}

/** Encodes ESI records for the planners with every field (EchelonJson leaves defaults out; the planners read them). */
val PlanJson = kotlinx.serialization.json.Json(EchelonJson) { encodeDefaults = true }

/** A JSON array of [id, at] pairs from a map. */
fun pairs(marks: Map<Long, Long>): JsonArray = buildJsonArray { marks.forEach { (id, at) -> add(buildJsonArray { add(JsonPrimitive(id)); add(JsonPrimitive(at)) }) } }

internal fun JsonElement?.long(): Long? = (this as? JsonPrimitive)?.longOrNull
