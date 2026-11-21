package com.echelon.eve.plan.haul

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.api.await
import com.echelon.eve.core.esi.eveNames
import com.echelon.eve.core.model.MarketData
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.plan.locationOf
import com.echelon.eve.plan.plan
import com.echelon.eve.plan.sendWaypoints
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.rememberNow
import com.echelon.eve.ui.format.parseIsk
import com.echelon.eve.ui.format.plural
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.Request

/** The last hour of kills per region from zKillboard (ui/killfeed.js regionKills), cached five minutes per region. */
internal object LiveKills {
    private val cache = mutableMapOf<Long, Pair<Long, JsonArray>>()
    private val gates = mutableMapOf<Long, Long?>()

    suspend fun region(c: AppContainer, id: Long): JsonArray {
        synchronized(cache) { cache[id]?.takeIf { System.currentTimeMillis() - it.first < 300_000 }?.let { return it.second } }
        val text = c.http.newCall(Request.Builder().url("https://zkillboard.com/api/regionID/$id/pastSeconds/3600/").header("Accept", "application/json").build()).await().use { r ->
            if (!r.isSuccessful) throw IllegalStateException("zKillboard answered ${r.code}")
            r.body.string()
        }
        val list = EchelonJson.parseToJsonElement(text) as? JsonArray ?: JsonArray(emptyList())
        synchronized(cache) { cache[id] = System.currentTimeMillis() to list }
        return list
    }

    /** Stargate → the system it leads to (ESI universe/stargates), so a camp is pinned to the gate it sits on. */
    suspend fun gateTargets(c: AppContainer, ids: List<Long>): Map<Long, Long> = coroutineScope {
        ids.distinct().filter { synchronized(gates) { it !in gates } }.take(60).map { id ->
            async { val to = c.eveNames.get("universe/stargates/$id/")?.get("destination")?.let { (it as? JsonObject)?.get("system_id")?.jsonPrimitive?.longOrNull }; synchronized(gates) { gates[id] = to } }
        }.awaitAll()
        synchronized(gates) { gates.filterValues { it != null }.mapValues { it.value!! } }
    }
}

/** Turns names into system ids on the market's gate map; unknown names come back separately. */
internal fun resolve(data: MarketData, names: List<String>): Pair<List<Long>, List<String>> {
    val byName = data.systems.values.associateBy { it.name.lowercase() }
    val ids = mutableListOf<Long>(); val unknown = mutableListOf<String>()
    names.map { it.trim() }.filter { it.isNotEmpty() }.forEach { n -> byName[n.lowercase()]?.let { ids += it.id } ?: run { unknown += n } }
    return ids to unknown
}

suspend fun AppContainer.haulPlan(f: HaulForm, stops: List<Long>, avoid: List<Long>, kills: JsonArray?, gateTo: Map<Long, Long>): HaulResult {
    val bridge = plan.ready() ?: return HaulResult(error = "not-ready")
    val args = buildJsonObject {
        put("stops", buildJsonArray { stops.forEach { add(JsonPrimitive(it)) } })
        put("value", (parseIsk(f.value) ?: 0L).toDouble()); put("volume", f.volume.replace(",", "").toDoubleOrNull() ?: 0.0)
        f.hull?.let { put("hull", it) }
        put("lowsec", f.lowsec); put("optimize", f.optimize); put("end", if (f.roundTrip) "return" else "fixed")
        put("avoid", buildJsonArray { avoid.forEach { add(JsonPrimitive(it)) } })
        kills?.let { put("kills", it as JsonElement) }
        put("gateTo", JsonObject(gateTo.entries.associate { it.key.toString() to JsonPrimitive(it.value) }))
        put("now", System.currentTimeMillis())
    }
    return EchelonJson.decodeFromJsonElement(HaulResult.serializer(), bridge.call("haul.plan", args))
}

@Composable
fun HaulRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val pilot = ctx.pilot
    if (pilot == null || c == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Route); return }
    val now = rememberNow(periodMillis = 30_000)
    val market by c.market.state.collectAsStateWithLifecycle()
    val names by c.eveNames.names.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var form by remember(pilot) { mutableStateOf<HaulForm?>(null) }
    var touched by remember { mutableStateOf(false) }
    var ui by remember(pilot) { mutableStateOf<HaulUi?>(null) }
    var planTick by remember { mutableIntStateOf(0) }

    // The saved plan (synced with the website), or here → Amarr the first time.
    LaunchedEffect(pilot, market.data != null) {
        if (form != null || market.data == null) return@LaunchedEffect
        val saved = c.plan.haul.sync(pilot) ?: c.plan.haul.read(pilot)
        val here = locationOf(c.pilots.state(pilot), c.wing.of(pilot))?.solarSystemId?.let { market.data?.systems?.get(it)?.name }
        form = HaulForm(stops = if (saved.stops.size >= 2) saved.stops else listOf(here ?: "Jita", "Amarr"), value = saved.value, volume = saved.volume, avoid = saved.avoid)
        planTick++
    }
    val f = form ?: return
    val systemNames = remember(market.data) { market.data?.systems?.values?.map { it.name }?.sorted().orEmpty() }
    val base = (ui ?: HaulUi(f)).copy(form = f, names = names, systemNames = systemNames, canSend = c.sessions.has(pilot.id), pilotName = pilot.displayName)

    LaunchedEffect(planTick) {
        if (planTick == 0) return@LaunchedEffect
        val data = market.data
        val notReady = c.plan.notReady(data, market.universeJson)
        if (notReady != null || data == null) { ui = base.copy(problem = notReady, result = null); return@LaunchedEffect }
        // The web reads value and volume with Number(): save plain numbers ("1.5b" goes as 1500000000), at most 30 characters.
        c.plan.haul.save(pilot, HaulPlan(f.stops.take(50).map { it.take(100) }, plainNumber(parseIsk(f.value)?.toDouble()), plainNumber(f.volume.replace(",", "").toDoubleOrNull()), f.avoid.take(2000)), touched)
        val (stops, unknown) = resolve(data, f.stops)
        val (avoid, _) = resolve(data, f.avoid.split(','))
        if (unknown.isNotEmpty() || stops.size < 2) { ui = base.copy(problem = if (unknown.isNotEmpty()) "Unknown system: ${unknown.joinToString()}" else "Add at least two stops.", result = null); return@LaunchedEffect }
        ui = base.copy(planning = true, problem = null, liveNote = "Loading live gate kills…")
        val first = runCatching { c.haulPlan(f, stops, avoid, null, emptyMap()) }.getOrElse { ui = base.copy(problem = it.message ?: "The planner failed."); return@LaunchedEffect }
        ui = (ui ?: base).copy(result = first, planning = false)
        // Live kills for every region the candidate routes cross, then the plan again with the camps priced in.
        val live = runCatching { coroutineScope { first.regions.map { r -> async { runCatching { LiveKills.region(c, r) }.getOrDefault(JsonArray(emptyList())) } }.awaitAll() } }
        val kills = JsonArray(live.getOrDefault(emptyList()).flatten())
        val again = runCatching { c.haulPlan(f, stops, avoid, kills, emptyMap()) }.getOrNull() ?: return@LaunchedEffect
        val gateTo = runCatching { LiveKills.gateTargets(c, again.gates) }.getOrDefault(emptyMap())
        val final = if (gateTo.isEmpty()) again else runCatching { c.haulPlan(f, stops, avoid, kills, gateTo) }.getOrDefault(again)
        c.eveNames.resolve(final.modes.values.flatMap { m -> m.steps.flatMap { it.live?.ships.orEmpty() } })
        ui = (ui ?: base).copy(result = final, liveNote = "Live: ${final.live?.kills ?: 0} kills in the last hour across ${plural(first.regions.size, "region")} from zKillboard.")
    }

    HaulScreen(base, now, HaulActions(
        share = {
            val m = base.result?.modes?.get(base.mode)
            if (m != null && m.unreachable == null) {
                c.wingChannel.sharePlan(pilot, com.echelon.eve.core.wing.SharedPlan("haul", m.stops.joinToString(" → ") { it.name }.take(80),
                    "${m.jumps} jumps, ${risk(1 - m.survival)} risk, ${base.result.hull?.name ?: ""}".trim().trimEnd(','), m.route))
                ui = base.copy(sent = "Shared with ${pilot.wingmate.displayName}.")
            }
        },
        form = { form = it; touched = true },
        plan = { planTick++ },
        mode = { m -> ui = base.copy(mode = m) },
        send = {
            val m = base.result?.modes?.get(base.mode) ?: return@HaulActions
            // routes.js sendable: every system of a route up to 40 jumps, otherwise just the stops.
            val ids = if (m.route.size - 1 <= 40) m.route.drop(1) else m.stops.map { it.id }.drop(1)
            scope.launch {
                ui = base.copy(sent = "Sending…")
                ui = base.copy(sent = c.sendWaypoints(pilot, ids).fold({ "Autopilot set: ${plural(it, "waypoint")}." }, { it.message ?: "EVE did not take the route." }))
            }
        },
    ))
}

/** A number as the web's Number() reads it back, or "" for none. */
internal fun plainNumber(v: Double?): String = when {
    v == null || !v.isFinite() || v < 0 -> ""
    v == Math.floor(v) && v < 1e15 -> v.toLong().toString()
    else -> v.toBigDecimal().stripTrailingZeros().toPlainString().take(30)
}
