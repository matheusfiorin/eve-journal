package com.echelon.eve.plan.build

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.api.await
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.esi.EveNames
import com.echelon.eve.core.esi.eveNames
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.Skills
import com.echelon.eve.core.model.WingPilot
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.plan.PlanEngine
import com.echelon.eve.plan.PlanJson
import com.echelon.eve.plan.locationOf
import com.echelon.eve.plan.plan
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.format.parseIsk
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request

/**
 * ESI's public lists the Build planner needs (markets/prices for adjusted prices, industry/systems for cost indices),
 * read at most once an hour and handed to the bridge as text; and station owners for standings-based broker fees.
 */
internal object BuildData {
    private val mutex = Mutex()
    private var loadedAt = 0L
    private val owners = mutableMapOf<Long, Pair<Long, Long>>()
    private val corpFaction = mutableMapOf<Long, Long>()

    private suspend fun esiText(c: AppContainer, path: String): String {
        val url = EveNames.ESI.toHttpUrl().newBuilder().addPathSegments(path).addPathSegment("").addQueryParameter("compatibility_date", EveNames.COMPAT).build()
        return c.http.newCall(Request.Builder().url(url).build()).await().use { r -> if (!r.isSuccessful) throw IllegalStateException("ESI answered ${r.code} for $path"); r.body.string() }
    }

    /** Loads both lists into the bridge when they are over an hour old (or were never loaded). */
    suspend fun ensure(c: AppContainer) = mutex.withLock {
        if (System.currentTimeMillis() - loadedAt < 3_600_000) return@withLock
        val (prices, systems) = coroutineScope { listOf(async { esiText(c, "markets/prices") }, async { esiText(c, "industry/systems") }).awaitAll() }
        c.planners.callRaw("build.esi", "{\"prices\":$prices,\"systems\":$systems}")
        loadedAt = System.currentTimeMillis()
    }

    /** Looks up the owner corporation and its faction of each NPC station (universe/stations, corporations); kept for the process. */
    suspend fun owners(c: AppContainer, locs: List<Long>): Map<Long, Pair<Long, Long>> = coroutineScope {
        locs.distinct().filter { it !in owners }.take(40).chunked(4).forEach { batch ->
            batch.map { loc -> async {
                val corp = c.eveNames.get("universe/stations/$loc/")?.get("owner")?.jsonPrimitive?.longOrNull ?: return@async
                val faction = corpFaction[corp] ?: (c.eveNames.get("corporations/$corp/")?.get("faction_id")?.jsonPrimitive?.longOrNull ?: 0L).also { corpFaction[corp] = it }
                synchronized(owners) { owners[loc] = corp to faction }
            } }.awaitAll()
        }
        synchronized(owners) { owners.toMap() }
    }
}

/** A pilot as build.plan reads them: skills, wallet, blueprints ([type, originals, copies, ME, TE, runs, loc] rows) and standings. */
internal fun builderJson(p: Pilot, state: PilotState?, wing: WingPilot?): JsonObject = buildJsonObject {
    put("name", p.displayName)
    val skills: Skills? = state?.private?.skills ?: state?.public?.skills ?: wing?.skills
    skills?.let { put("skills", PlanJson.encodeToJsonElement(Skills.serializer(), it)) }
    val wallet = state?.private?.op("wallet")?.value?.let { (it as? JsonPrimitive)?.doubleOrNull } ?: wing?.wallet
    wallet?.let { put("wallet", it) }
    val bps = state?.private?.op("blueprints")?.value ?: wing?.blueprints
    ((bps as? JsonObject)?.get("types") ?: bps as? JsonArray)?.let { put("blueprints", it) }
    (state?.private?.op("standings")?.value as? JsonArray)?.let { put("standings", it as JsonElement) }
}

suspend fun AppContainer.buildPlan(pilot: Pilot, s: BuildSettings): BuildResult? {
    val bridge = plan.ready() ?: return null
    runCatching { BuildData.ensure(this) } // Without ESI's lists the planner still runs, with zero indices and no adjusted prices.
    val me = builderJson(pilot, pilots.state(pilot), wing.of(pilot))
    val mateState = pilots.state(pilot.wingmate)
    val mate = if (mateState.private != null || wing.of(pilot.wingmate) != null) builderJson(pilot.wingmate, mateState, wing.of(pilot.wingmate)) else null
    suspend fun call(owners: Map<Long, Pair<Long, Long>>) = EchelonJson.decodeFromJsonElement(BuildResult.serializer(), bridge.call("build.plan", buildJsonObject {
        put("system", s.system); parseIsk(s.budget)?.let { put("budget", it) } ?: (me["wallet"] as? JsonPrimitive)?.let { put("budget", it) }
        put("category", s.category); put("sort", s.sort); put("showAll", s.showAll); put("me", me); mate?.let { put("mate", it) }
        put("owners", JsonObject(owners.entries.associate { (k, v) -> k.toString() to buildJsonArray { add(JsonPrimitive(v.first)); add(JsonPrimitive(v.second)) } }))
    }))
    var r = call(runCatching { BuildData.owners(this, emptyList()) }.getOrDefault(emptyMap()))
    if (r.needOwners.isNotEmpty()) runCatching { BuildData.owners(this, r.needOwners) }.getOrNull()?.let { r = call(it) }
    // Names for "My blueprints": the blueprint types and the stations they sit in.
    runCatching { eveNames.resolve(listOfNotNull(r.library.me, r.library.mate).flatten().flatMap { listOfNotNull(it.type, it.loc?.takeIf { l -> l in 60_000_000..63_999_999 }) }) }
    return r
}

@Composable
fun BuildRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val pilot = ctx.pilot
    if (pilot == null || c == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Plan); return }
    val market by c.market.state.collectAsStateWithLifecycle()
    val pilots by c.pilots.pilots.collectAsStateWithLifecycle()
    val wing by c.wing.wing.collectAsStateWithLifecycle()
    val names by c.eveNames.names.collectAsStateWithLifecycle()
    val here = locationOf(c.pilots.state(pilot), c.wing.of(pilot))?.solarSystemId
    val starts = remember(here, market.data) {
        val hereName = here?.let { market.data?.systems?.get(it)?.name }
        listOfNotNull(if (here != null && hereName != null) here to "$hereName · here" else null) + PlanEngine.HUBS.filter { it.first != here }
    }
    var settings by remember(pilot) { mutableStateOf(BuildSettings(system = starts.first().first)) }
    var result by remember(pilot) { mutableStateOf<BuildResult?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<Long?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    LaunchedEffect(pilot, settings, market.data, pilots, wing, tries) {
        problem = c.plan.notReady(market.data, market.universeJson)
        if (problem != null) return@LaunchedEffect
        runCatching { c.buildPlan(pilot, settings) }.onSuccess { result = it; problem = if (it == null) "The map is still loading." else null }.onFailure { if (it is kotlin.coroutines.cancellation.CancellationException) throw it; problem = it.message ?: "The planner failed." }
    }
    BuildScreen(BuildUi(pilot.displayName, settings, starts, result, problem, open, names, pilot.wingmate.displayName), BuildActions(
        settings = { settings = it }, open = { open = it }, retry = { tries++ },
    ))
}
