package com.echelon.eve.plan.mine

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.Ship
import com.echelon.eve.core.model.Skills
import com.echelon.eve.core.model.WingPilot
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.plan.PlanEngine
import com.echelon.eve.plan.PlanJson
import com.echelon.eve.plan.locationOf
import com.echelon.eve.plan.plan
import com.echelon.eve.plan.sendWaypoints
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.format.plural
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A pilot as mine.plan reads them: skills, location, current ship and the 30-day mining ledger (own or shared). */
internal fun minerJson(p: Pilot, state: PilotState?, wing: WingPilot?): JsonObject = buildJsonObject {
    put("name", p.displayName)
    val skills: Skills? = state?.private?.skills ?: state?.public?.skills ?: wing?.skills
    skills?.let { put("skills", PlanJson.encodeToJsonElement(Skills.serializer(), it)) }
    locationOf(state, wing)?.solarSystemId?.let { put("location", it) }
    val ship = state?.private?.op("ship")?.value?.let { runCatching { EchelonJson.decodeFromJsonElement(Ship.serializer(), it) }.getOrNull() } ?: wing?.ship
    ship?.let { put("ship", it.shipTypeId) }
    val own = state?.private?.op("mining")
    when {
        own != null -> put("ledger", buildJsonObject { own.permission?.let { put("permission", it) }; put("value", own.value ?: JsonNull) })
        wing?.mining != null -> put("ledger", buildJsonObject { put("permission", true); put("value", wing.mining) })
    }
}

suspend fun AppContainer.minePlan(pilot: Pilot, s: MineSettings): MineResult? {
    val bridge = plan.ready() ?: return null
    val args = buildJsonObject {
        put("from", s.from); put("maxJumps", s.maxJumps); put("lowsec", s.lowsec); s.ship?.let { put("ship", it) }
        put("me", minerJson(pilot, pilots.state(pilot), wing.of(pilot)))
        val mate = pilot.wingmate
        val mateState = pilots.state(mate)
        if (mateState.private != null || mateState.public != null || wing.of(mate) != null) put("mate", minerJson(mate, mateState, wing.of(mate)))
    }
    return EchelonJson.decodeFromJsonElement(MineResult.serializer(), bridge.call("mine.plan", args))
}

@Composable
fun MineRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val pilot = ctx.pilot
    if (pilot == null || c == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Search); return }
    val market by c.market.state.collectAsStateWithLifecycle()
    val pilots by c.pilots.pilots.collectAsStateWithLifecycle()
    val wing by c.wing.wing.collectAsStateWithLifecycle()
    val here = locationOf(c.pilots.state(pilot), c.wing.of(pilot))?.solarSystemId
    val starts = remember(here, market.data) {
        val hereName = here?.let { market.data?.systems?.get(it)?.name }
        listOfNotNull(if (here != null && hereName != null) here to "$hereName · here" else null) + PlanEngine.HUBS.filter { it.first != here }
    }
    var settings by remember(pilot) { mutableStateOf(MineSettings(from = starts.first().first)) }
    var result by remember(pilot) { mutableStateOf<MineResult?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<Long?>(null) }
    var sent by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(pilot, settings, market.data, pilots, wing, tries) {
        problem = c.plan.notReady(market.data, market.universeJson)
        if (problem != null) return@LaunchedEffect
        runCatching { c.minePlan(pilot, settings) }.onSuccess { result = it; problem = if (it == null) "The map is still loading." else null }.onFailure { problem = it.message ?: "The planner failed." }
    }
    MineScreen(MineUi(pilot, settings, starts, result, problem, open, c.sessions.has(pilot.id), sent), MineActions(
        settings = { settings = it; sent = null },
        open = { open = it },
        sendTo = { id -> scope.launch { sent = "Sending…"; sent = c.sendWaypoints(pilot, listOf(id)).fold({ "Autopilot set: ${plural(it, "waypoint")}." }, { it.message ?: "EVE did not take the route." }) } },
        retry = { tries++ },
    ))
}
