package com.echelon.eve.plan.explore

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
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.Skills
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.plan.PlanEngine
import com.echelon.eve.plan.locationOf
import com.echelon.eve.plan.pairs
import com.echelon.eve.plan.plan
import com.echelon.eve.plan.sendWaypoints
import com.echelon.eve.plan.trailOf
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.rememberNow
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.EchelonIcons
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request

/** Reads the inputs explore.rank needs and runs it (android/js/plan/explore.js). */
suspend fun AppContainer.exploreRank(pilot: Pilot, s: ExploreSettings, now: Long): ExploreResult {
    val bridge = plan.ready() ?: return ExploreResult(error = "not-ready")
    val me = pilots.state(pilot); val mate = pilots.state(pilot.wingmate)
    val skills = me.private?.skills ?: me.public?.skills ?: wing.of(pilot)?.skills
    val marks = plan.marks.read(pilot)
    val args = buildJsonObject {
        put("from", s.from); put("maxJumps", s.maxJumps); put("tolerance", s.tolerance); put("loop", s.loop); put("now", now)
        put("bands", buildJsonArray { s.bands.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
        skills?.let { put("skills", com.echelon.eve.plan.PlanJson.encodeToJsonElement(Skills.serializer(), it)) }
        put("trails", buildJsonArray { add(trailOf(me, wing.of(pilot))); add(trailOf(mate, wing.of(pilot.wingmate))) })
        put("marks", pairs(marks))
    }
    return EchelonJson.decodeFromJsonElement(ExploreResult.serializer(), bridge.call("explore.rank", args))
}

/** EVE-Scout's public signatures (Thera and Turnur connections), cached for five minutes like the web. */
private object EveScout {
    private var cached: Pair<Long, String>? = null
    suspend fun signatures(c: AppContainer): String {
        cached?.takeIf { System.currentTimeMillis() - it.first < 300_000 }?.let { return it.second }
        val text = c.http.newCall(Request.Builder().url("https://api.eve-scout.com/v2/public/signatures").header("Accept", "application/json").build()).await().use { r ->
            if (!r.isSuccessful) throw IllegalStateException("EVE-Scout answered ${r.code}")
            r.body.string()
        }
        return text.also { cached = System.currentTimeMillis() to it }
    }
}

@Composable
fun ExploreRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val pilot = ctx.pilot
    if (pilot == null || c == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Search); return }
    val now = rememberNow(periodMillis = 60_000)
    val market by c.market.state.collectAsStateWithLifecycle()
    val pilots by c.pilots.pilots.collectAsStateWithLifecycle()
    val marks by c.plan.marks.marks.collectAsStateWithLifecycle()
    val here = locationOf(c.pilots.state(pilot), c.wing.of(pilot))?.solarSystemId
    val starts = remember(here, market.data) {
        val hereName = here?.let { market.data?.systems?.get(it)?.name }
        listOfNotNull(if (here != null && hereName != null) here to "$hereName · here" else null) + PlanEngine.HUBS.filter { it.first != here }
    }
    var settings by remember(pilot) { mutableStateOf(ExploreSettings(from = starts.first().first)) }
    var result by remember(pilot) { mutableStateOf<ExploreResult?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var shortcuts by remember { mutableStateOf<List<Shortcut>?>(null) }
    var shortcutsProblem by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<Long?>(null) }
    var sent by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    // Marks sync with the website when the screen opens.
    LaunchedEffect(pilot) { c.plan.marks.sync(pilot) }
    LaunchedEffect(pilot, settings, market.data, pilots, marks, tries) {
        problem = c.plan.notReady(market.data, market.universeJson)
        if (problem != null || settings.bands.isEmpty()) return@LaunchedEffect
        val r = runCatching { c.exploreRank(pilot, settings, System.currentTimeMillis()) }
        r.onSuccess { if (it.error == null) { result = it; problem = null } else problem = if (it.error == "unknown-system") "That start system is not on the map." else "The map is still loading." }
            .onFailure { if (it is kotlin.coroutines.cancellation.CancellationException) throw it; problem = it.message ?: "The planner failed." }
    }
    LaunchedEffect(settings.from, market.data) {
        val bridge = c.plan.ready() ?: return@LaunchedEffect
        runCatching {
            val text = EveScout.signatures(c)
            val args = "{\"from\":${settings.from},\"signatures\":$text}"
            EchelonJson.decodeFromString(ListSerializer(Shortcut.serializer()), bridge.callRaw("explore.shortcuts", args))
        }.onSuccess { shortcuts = it; shortcutsProblem = null }.onFailure { shortcutsProblem = it.message ?: "no answer" }
    }

    val regionName = { id: Long -> market.data?.regionName(id) ?: "" }
    val canSend = c.sessions.has(pilot.id)
    val send = { ids: List<Long> ->
        scope.launch {
            sent = "Sending…"
            sent = c.sendWaypoints(pilot, ids).fold({ "Autopilot set: ${plural(it, "waypoint")}." }, { it.message ?: "EVE did not take the route." })
        }
    }
    ExploreScreen(
        ExploreUi(pilot, settings, starts, result, problem = problem, shortcuts = shortcuts, shortcutsProblem = shortcutsProblem, regionName = regionName, open = open, sent = sent),
        now,
        ExploreActions(
            settings = { settings = it; sent = null },
            open = { open = it },
            mark = { id -> scope.launch { c.plan.marks.mark(pilot, id) } },
            // Like the web (routes.js sendable): every system of a short loop, its stops when the route is over 40 jumps.
            sendLoop = { result?.loop?.let { l -> send(if (l.route.size - 1 <= 40) l.route.drop(1) else l.stops.map { it.id } + settings.from) } },
            sendTo = { id -> send(listOf(id)) },
            retry = { tries++ },
            share = {
                result?.loop?.let { l ->
                    c.wingChannel.sharePlan(pilot, com.echelon.eve.core.wing.SharedPlan("explore", "Exploration loop from ${result?.start?.name ?: "here"}".take(80),
                        "${l.stops.size} systems, ${l.jumps} jumps, about ${l.minutes} min: ${l.stops.joinToString { it.name }}", l.route))
                    sent = "Shared with ${pilot.wingmate.displayName}."
                }
            },
        ),
        canSend = canSend,
    )
}
