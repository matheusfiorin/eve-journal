package com.echelon.eve.plan.trade

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
import com.echelon.eve.core.esi.eveNames
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.Ship
import com.echelon.eve.core.model.Skills
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.plan.PlanEngine
import com.echelon.eve.plan.PlanJson
import com.echelon.eve.plan.build.BuildData
import com.echelon.eve.plan.locationOf
import com.echelon.eve.plan.plan
import com.echelon.eve.plan.sendWaypoints
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.format.parseIsk
import com.echelon.eve.ui.format.plural
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** The pilot's current ship's cargo capacity (ESI universe/types), the web's default for the cargo box. */
private suspend fun AppContainer.cargoOf(pilot: Pilot): Double? {
    val ship = pilots.state(pilot).private?.op("ship")?.value?.let { runCatching { EchelonJson.decodeFromJsonElement(Ship.serializer(), it) }.getOrNull() } ?: wing.of(pilot)?.ship ?: return null
    return eveNames.get("universe/types/${ship.shipTypeId}/")?.get("capacity")?.jsonPrimitive?.doubleOrNull?.takeIf { it > 0 }
}

suspend fun AppContainer.tradePlan(pilot: Pilot, s: TradeSettings): TradeResult? {
    val bridge = plan.ready() ?: return null
    runCatching { BuildData.ensure(this) }
    val state = pilots.state(pilot)
    val me = buildJsonObject {
        (state.private?.skills ?: state.public?.skills ?: wing.of(pilot)?.skills)?.let { put("skills", PlanJson.encodeToJsonElement(Skills.serializer(), it)) }
        (state.private?.op("standings")?.value as? JsonArray)?.let { put("standings", it as JsonElement) }
    }
    suspend fun call(owners: Map<Long, Pair<Long, Long>>) = EchelonJson.decodeFromJsonElement(TradeResult.serializer(), bridge.call("trade.plan", buildJsonObject {
        put("from", s.from); put("maxJumps", s.maxJumps); put("cargo", s.cargo.replace(",", "").toDoubleOrNull() ?: 5000.0)
        parseIsk(s.budget)?.let { put("budget", it) }
        put("me", me)
        put("owners", JsonObject(owners.entries.associate { (k, v) -> k.toString() to buildJsonArray { add(JsonPrimitive(v.first)); add(JsonPrimitive(v.second)) } }))
    }))
    var r = call(runCatching { BuildData.owners(this, emptyList()) }.getOrDefault(emptyMap()))
    if (r.needOwners.isNotEmpty()) runCatching { BuildData.owners(this, r.needOwners) }.getOrNull()?.let { r = call(it) }
    // Item names the meta does not carry come from ESI.
    runCatching { eveNames.resolve((r.hauls.filter { it.name == null }.map { it.type } + r.spreads.filter { it.name == null }.map { it.type } + r.builds.filter { it.name == null }.map { it.type })) }
    return r
}

/** The flying pilot's orders through orders.view (ui/ordersview.js), or why they can't be shown. */
suspend fun AppContainer.myOrders(pilot: Pilot): OrdersState {
    val own = pilots.state(pilot).private ?: return OrdersState(note = "${pilot.displayName}’s orders are private. Connect ${pilot.displayName} on this phone to see them.")
    val orders = own.op("orders") ?: return OrdersState(note = "Not synced yet. Pull down on the Plan hub to sync.")
    if (orders.permission == false) return OrdersState(note = "${pilot.displayName} has not allowed Echelon to read market orders. Reconnect them in Settings to grant it.")
    val live = orders.value as? JsonArray ?: return OrdersState(note = orders.error ?: "Not synced yet. Pull down on the Plan hub to sync.")
    val bridge = plan.ready() ?: return OrdersState(note = "The market has not loaded yet.")
    val history = own.op("orderHistory")?.takeIf { it.permission != false }?.value as? JsonArray
    val view = EchelonJson.decodeFromJsonElement(OrdersView.serializer(), bridge.call("orders.view", buildJsonObject {
        put("orders", live); history?.let { put("history", it) }; put("now", System.currentTimeMillis())
    }))
    runCatching { eveNames.resolve(view.live.filter { it.name == null }.map { it.type } + view.history?.rows.orEmpty().filter { it.name == null }.map { it.type }) }
    return OrdersState(view, error = orders.error)
}

@Composable
fun TradeRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val pilot = ctx.pilot
    if (pilot == null || c == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Swap); return }
    val market by c.market.state.collectAsStateWithLifecycle()
    val pilots by c.pilots.pilots.collectAsStateWithLifecycle()
    val names by c.eveNames.names.collectAsStateWithLifecycle()
    val here = locationOf(c.pilots.state(pilot), c.wing.of(pilot))?.solarSystemId
    val starts = remember(here, market.data) {
        val hereName = here?.let { market.data?.systems?.get(it)?.name }
        listOfNotNull(if (here != null && hereName != null) here to "$hereName · here" else null) + PlanEngine.HUBS.filter { it.first != here }
    }
    var settings by remember(pilot) { mutableStateOf<TradeSettings?>(null) }
    var result by remember(pilot) { mutableStateOf<TradeResult?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<Int?>(null) }
    var sent by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    var orders by remember(pilot) { mutableStateOf<OrdersState?>(null) }
    val scope = rememberCoroutineScope()
    // Cargo from the current ship and budget from the wallet, as the web fills them until someone types.
    LaunchedEffect(pilot) {
        if (settings != null) return@LaunchedEffect
        val wallet = c.pilots.state(pilot).private?.op("wallet")?.value?.let { (it as? JsonPrimitive)?.doubleOrNull } ?: c.wing.of(pilot)?.wallet
        val cargo = runCatching { c.cargoOf(pilot) }.getOrNull()
        settings = TradeSettings(from = starts.first().first, cargo = cargo?.let { Math.round(it).toString() } ?: "5000", budget = wallet?.let { Math.floor(it).toLong().toString() } ?: "")
    }
    val s = settings ?: TradeSettings(from = starts.first().first)
    // The list and sort only change how the answer is shown; everything else asks the planner again.
    val inputs = s.copy(list = "", sort = "")
    LaunchedEffect(pilot, inputs, settings != null, market.data, pilots, tries) {
        if (settings == null) return@LaunchedEffect
        problem = c.plan.notReady(market.data, market.universeJson)
        if (problem != null) return@LaunchedEffect
        runCatching { c.tradePlan(pilot, s) }.onSuccess { result = it; problem = if (it == null) "The map is still loading." else null }.onFailure { if (it is kotlin.coroutines.cancellation.CancellationException) throw it; problem = it.message ?: "The planner failed." }
    }
    LaunchedEffect(pilot, pilots, market.data) { orders = runCatching { c.myOrders(pilot) }.getOrElse { if (it is kotlin.coroutines.cancellation.CancellationException) throw it; OrdersState(note = it.message) } }
    TradeScreen(TradeUi(pilot.displayName, s, starts, result, problem, open, c.sessions.has(pilot.id), sent, names, market.data?.snapshot?.regions?.size ?: 0, orders), TradeActions(
        settings = { settings = it; sent = null },
        open = { open = it },
        send = { ids -> scope.launch { sent = "Sending…"; sent = c.sendWaypoints(pilot, ids).fold({ "Autopilot set: ${plural(it, "waypoint")}." }, { it.message ?: "EVE did not take the route." }) } },
        retry = { tries++ },
    ))
}
