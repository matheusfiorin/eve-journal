package com.echelon.eve.plan.sell

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
import com.echelon.eve.core.esi.eveNames
import com.echelon.eve.core.model.Location
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.Ship
import com.echelon.eve.core.model.Skills
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.plan.PlanJson
import com.echelon.eve.plan.plan
import com.echelon.eve.plan.sendWaypoints
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.format.parseIsk
import com.echelon.eve.ui.format.plural
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Both pilots as sell.gather reads them, the flying pilot first: their own snapshot here, else what they share with the wing. */
internal fun AppContainer.sellPilots(flying: Pilot): JsonArray = buildJsonArray {
    for (p in listOf(flying, flying.wingmate)) {
        val state = pilots.state(p); val w = wing.of(p); val own = state.private
        add(buildJsonObject {
            put("id", p.id); put("name", p.displayName); put("connected", sessions.has(p.id)); put("own", own != null); put("shareLevel", w?.shareLevel ?: 0)
            (own?.op("ship")?.value ?: w?.ship?.let { PlanJson.encodeToJsonElement(Ship.serializer(), it) })?.let { put("ship", it) }
            (own?.op("location")?.value ?: w?.location?.let { PlanJson.encodeToJsonElement(Location.serializer(), it) })?.let { put("location", it) }
            (own?.op("fit")?.value ?: w?.fit)?.let { put("fit", it) }
            (own?.op("stacks")?.value ?: w?.stacks)?.let { put("stacks", it) }
            own?.sellStation?.let { put("sellStation", it) }
        })
    }
}

/** What gets sold, from the form: rows left in, with a quantity, on a ship that is in (or in a hangar), and with a known size. */
internal fun lotsOf(g: Gathered, f: SellForm, info: Map<Long, TypeInfo>): Pair<List<Pair<SellRow, Double>>, Int> {
    val live = g.ships.filter { it.pilot !in f.off }.map { it.pilot }.toSet()
    val rows = g.rows.filter { it.key !in f.skip && qtyOf(it, f) > 0 && (it.from.kind == "hangar" || it.from.pilot in live) }
    val sized = rows.mapNotNull { r -> info[r.type]?.let { r to it.volume } }
    return sized to (rows.size - sized.size)
}

@Composable
fun SellRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val pilot = ctx.pilot
    if (pilot == null || c == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Route); return }
    val market by c.market.state.collectAsStateWithLifecycle()
    val pilots by c.pilots.pilots.collectAsStateWithLifecycle()
    val wing by c.wing.wing.collectAsStateWithLifecycle()
    val names by c.eveNames.names.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var ui by remember(pilot) { mutableStateOf(SellUi(SellForm())) }
    var tries by remember { mutableStateOf(0) }

    // What there is to sell, whenever the pilots' data or the pasted list changes.
    LaunchedEffect(pilot, market.data, pilots, wing, ui.form.pasted, tries) {
        val notReady = c.plan.notReady(market.data, market.universeJson)
        if (notReady != null) { ui = ui.copy(problem = notReady); return@LaunchedEffect }
        val bridge = c.plan.ready() ?: return@LaunchedEffect
        val g = runCatching { EchelonJson.decodeFromJsonElement(Gathered.serializer(), bridge.call("sell.gather", buildJsonObject {
            put("pilots", c.sellPilots(pilot))
            put("pasted", buildJsonArray { ui.form.pasted.forEach { (t, q) -> add(buildJsonArray { add(JsonPrimitive(t)); add(JsonPrimitive(q)) }) } })
        })) }.getOrElse { ui = ui.copy(problem = it.message ?: "Couldn’t read what the pilots carry."); return@LaunchedEffect }
        val info = runCatching { SellData.typeInfo(c, g.rows.map { it.type } + g.ships.map { it.shipType }) }.getOrDefault(emptyMap())
        ui = ui.copy(gathered = g, info = ui.info + info, problem = null)
    }

    // The plan, half a second after the last change to the form.
    val inputs = ui.form.copy(pasted = emptyMap())
    LaunchedEffect(ui.gathered, ui.info, inputs) {
        val g = ui.gathered ?: return@LaunchedEffect
        delay(500)
        val f = ui.form
        val ships = g.ships.filter { it.pilot !in f.off }
        val (lots, unsized) = lotsOf(g, f, ui.info)
        if (ships.isEmpty() || lots.isEmpty()) { ui = ui.copy(result = null, status = if (ships.isEmpty()) "Tick at least one ship." else "Nothing to sell yet.", unsized = unsized); return@LaunchedEffect }
        ui = ui.copy(planning = true, status = "Planning…", unsized = unsized)
        val bridge = c.plan.ready() ?: return@LaunchedEffect
        try {
            val maxJumps = f.maxJumps
            val pickups = lots.mapNotNull { it.first.from.station }.distinct()
            val regions = EchelonJson.decodeFromJsonElement(ListSerializer(kotlinx.serialization.serializer<Long>()), bridge.call("sell.regions", buildJsonObject {
                put("starts", buildJsonArray { ships.mapNotNull { it.system }.forEach { add(JsonPrimitive(it)) } })
                put("pickups", buildJsonArray { pickups.forEach { add(JsonPrimitive(it)) } }); put("maxJumps", maxJumps)
            }))
            val loaded = SellData.load(c, lots.map { it.first.type }.distinct(), regions)
            val skills = (c.pilots.state(pilot).private?.skills ?: c.pilots.state(pilot).public?.skills)
            val result = EchelonJson.decodeFromJsonElement(SellResult.serializer(), bridge.call("sell.plan", buildJsonObject {
                put("lots", buildJsonArray { lots.forEach { (r, m3) -> add(buildJsonObject {
                    put("type", r.type); put("qty", qtyOf(r, f)); put("m3", m3)
                    put("from", buildJsonObject { put("kind", r.from.kind); r.from.pilot?.let { put("pilot", it) }; r.from.station?.let { put("station", it) } })
                }) } })
                put("ships", buildJsonArray { ships.forEach { s -> add(buildJsonObject {
                    put("pilot", s.pilot); put("name", s.name); put("shipType", s.shipType)
                    put("capacity", f.caps[s.pilot]?.replace(",", "")?.toDoubleOrNull() ?: ui.info[s.shipType]?.capacity ?: 0.0)
                    s.system?.let { put("system", it) }; s.station?.let { put("station", it) }
                }) } })
                put("quotes", JsonObject(loaded.quotes.entries.associate { (t, list) -> t.toString() to JsonArray(list) }))
                skills?.let { put("skills", PlanJson.encodeToJsonElement(Skills.serializer(), it)) }
                put("options", buildJsonObject {
                    put("perJump", parseIsk(f.perJump)?.toDouble() ?: 1e6); put("maxJumps", maxJumps)
                    put("lowsec", f.lowsec); put("together", f.together); put("returnHome", f.returnHome)
                })
                put("now", System.currentTimeMillis())
            }))
            // The best plan is shown until someone picks another card, and for as long as that card still exists.
            val mode = ui.mode?.takeIf { m -> result.plans.any { it.key == m } } ?: (result.plans.firstOrNull { it.key == "best" } ?: result.plans.firstOrNull { "best" in it.also } ?: result.plans.firstOrNull())?.key
            c.eveNames.resolve(result.plans.flatMap { p -> p.unsold.map { it.type } }.filter { it !in ui.info })
            val age = loaded.at?.let { maxOf(0, (System.currentTimeMillis() - it) / 60_000) }
            ui = ui.copy(result = result, loaded = loaded, mode = mode, planning = false, problem = null,
                status = "${plural(result.plans.size, "plan")} · ${age?.let { if (it < 1) "buy orders as of just now" else "buy orders as of ${plural(it.toInt(), "minute")} ago" } ?: "no buy orders loaded"} · ${plural(loaded.calls, "request")} to EVE${if (loaded.cached > 0) ", ${loaded.cached} from the last 5 minutes" else ""}.")
        } catch (e: Exception) {
            ui = ui.copy(planning = false, result = null, status = "Couldn’t plan the sale: ${e.message}")
        }
    }

    // Station search for the pickup picker.
    LaunchedEffect(ui.pickupQuery) {
        val q = ui.pickupQuery ?: return@LaunchedEffect
        val bridge = c.plan.ready() ?: return@LaunchedEffect
        val hits = runCatching { EchelonJson.decodeFromJsonElement(ListSerializer(StationHit.serializer()), bridge.call("sell.stations", buildJsonObject { put("query", q) })) }.getOrDefault(emptyList())
        ui = ui.copy(pickupHits = hits)
    }

    SellScreen(ui.copy(names = names, canSend = c.pilots.pilots.value.filter { c.sessions.has(it.id) }.map { it.id }.toSet()), SellActions(
        form = { ui = ui.copy(form = it) },
        mode = { ui = ui.copy(mode = it) },
        paste = { ui = ui.copy(pasteText = it) },
        addPaste = {
            scope.launch {
                val bridge = c.plan.ready() ?: return@launch
                val parsed = bridge.call("sell.parse", buildJsonObject { put("text", ui.pasteText) }) as JsonObject
                val rows = (parsed["rows"] as JsonArray).map { it as JsonObject }.map { (it["name"] as JsonPrimitive).content to (it["qty"] as JsonPrimitive).content.toLong() }
                val bad = (parsed["bad"] as JsonArray).size
                if (rows.isEmpty()) { ui = ui.copy(pasteNote = if (bad > 0) "Couldn’t read ${plural(bad, "line")}. Use “Name, tab, quantity” or “5 x Name”." else "Paste some items first."); return@launch }
                ui = ui.copy(pasteNote = "Looking up names…")
                val ids = runCatching { SellData.typeIds(c, rows.map { it.first }) }.getOrElse { ui = ui.copy(pasteNote = "Couldn’t look the names up: ${it.message}"); return@launch }
                var pasted = ui.form.pasted; val unknown = mutableListOf<String>()
                rows.forEach { (n, q) -> ids[n.lowercase()]?.let { id -> pasted = pasted + (id to ((pasted[id] ?: 0) + q)) } ?: run { unknown += n } }
                val added = rows.size - unknown.size
                ui = ui.copy(form = ui.form.copy(pasted = pasted), pasteText = if (added > 0) "" else ui.pasteText,
                    pasteNote = listOfNotNull(if (added > 0) "Added ${plural(added, "item")}." else null, if (unknown.isNotEmpty()) "Not found: ${unknown.joinToString()}." else null, if (bad > 0) "Skipped ${plural(bad, "line")} it couldn’t read." else null).joinToString(" "))
            }
        },
        pickupQuery = { ui = ui.copy(pickupQuery = it, pickupHits = if (it == null) emptyList() else ui.pickupHits) },
        savePickup = { station ->
            scope.launch {
                val token = c.sessions.token(pilot.id) ?: return@launch
                ui = ui.copy(pickupNote = "Saving…")
                runCatching { SellData.setPickup(c, token, station) }
                    .onSuccess { ui = ui.copy(pickupQuery = null, pickupHits = emptyList(), pickupNote = if (station != null) "Hangar contents there arrive with the next sync (up to 10 minutes)." else null); c.sync.refresh(force = false) }
                    .onFailure { ui = ui.copy(pickupNote = "Couldn’t save the station: ${it.message}") }
            }
        },
        send = { s ->
            val who = Pilot.of(s.pilot) ?: return@SellActions
            // routes.js sendable: the whole route up to 40 jumps, else the stops.
            val ids = if (s.route.size - 1 <= 40) s.route.drop(1) else s.stops.map { it.systemId }
            scope.launch {
                ui = ui.copy(sent = ui.sent + (s.pilot to "Sending…"))
                ui = ui.copy(sent = ui.sent + (s.pilot to c.sendWaypoints(who, ids).fold({ "Autopilot set: ${plural(it, "waypoint")}." }, { it.message ?: "EVE did not take the route." })))
            }
        },
        retry = { tries++ },
    ))
}
