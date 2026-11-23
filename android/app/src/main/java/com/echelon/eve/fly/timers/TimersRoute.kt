package com.echelon.eve.fly.timers

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.echelon.eve.fly.cockpit.CockpitControl
import com.echelon.eve.fly.cockpit.worthShowing
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.model.Location
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SolarSystem
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.fly
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.Countdown
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.ProgressRing
import com.echelon.eve.ui.components.rememberNow
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing

/**
 * Where a pilot is, as this phone knows without asking EVE: their own synced snapshot's location, else the wing
 * summary's (the same rule as the planners' locationOf).
 */
internal class TimerLocator(private val c: AppContainer) {
    fun systemIdOf(p: Pilot): Long? = runCatching {
        c.pilots.state(p).private?.op("location")?.value?.let { EchelonJson.decodeFromJsonElement(Location.serializer(), it) }?.solarSystemId
    }.getOrNull() ?: c.wing.of(p)?.location?.solarSystemId

    fun systemOf(p: Pilot): TimerSystem? = systemIdOf(p)?.let { TimerSystem(it, c.market.state.value.data?.systems?.get(it)?.name.orEmpty()) }
}

/**
 * The Timers screen's places and actions in the app: the gate map, where both pilots are (a live read of the flying
 * pilot's system when the screen opens, else the synced one), and [base] with starting in a picked system and moving
 * added when the route didn't wire them. Tells the store where the pilot is, so a start from anywhere lands there.
 */
@Composable
internal fun rememberAppTimers(container: AppContainer, pilot: Pilot, base: TimerActions): Pair<TimerMap, TimerActions> {
    val store = container.fly.timers
    val market by container.market.state.collectAsStateWithLifecycle()
    // Read so a refresh of either moves the pilots on the board.
    val pilots by container.pilots.pilots.collectAsStateWithLifecycle()
    val wing by container.wing.wing.collectAsStateWithLifecycle()
    val data = market.data
    val systems = data?.systems.orEmpty()
    val locator = remember(container) { TimerLocator(container) }
    var live by remember(pilot) { mutableStateOf<Long?>(null) }
    LaunchedEffect(Unit) { if (market.data == null && !market.loading) runCatching { container.market.refresh() } }
    LaunchedEffect(pilot) {
        val token = container.sessions.token(pilot.id) ?: return@LaunchedEffect
        live = runCatching { container.api.live(token).system }.getOrNull()
    }
    val synced = remember(pilot, pilots, wing) { locator.systemIdOf(pilot) }
    val here = live ?: synced
    val mate = remember(pilot, pilots, wing) { locator.systemIdOf(pilot.wingmate) }
    LaunchedEffect(pilot, here, systems.size) { store.noteLocation(pilot, here?.let { TimerSystem(it, systems[it]?.name.orEmpty()) }) }
    val context = LocalContext.current
    // What the fit and skills say about a cycle, read again when the pilots refresh.
    val mining by produceState<MiningUi?>(null, pilot, pilots, wing) { value = runCatching { container.fly.mining.load(pilot) }.getOrNull() }
    val feed = container.fly.cockpit
    val offered by feed.suggestion.collectAsStateWithLifecycle()
    val all by store.timers.collectAsStateWithLifecycle()
    val suggestion = offered?.takeIf { it.worthShowing(all.values, pilot, System.currentTimeMillis()) }
    // The exact-alarm switch is Android's, so look again whenever the screen comes back from Settings.
    var exactOk by remember { mutableStateOf(ExactAlarms.allowed(context)) }
    var exactHidden by rememberSaveable { mutableStateOf(false) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { exactOk = ExactAlarms.allowed(context); runCatching { resyncAlarms(context) } }
    val map = remember(systems, here, mate, data, mining, suggestion, exactOk, exactHidden) {
        TimerMap(systems, here, mate, regionName = { id -> data?.regionName(id) }, mining = mining, suggestion = suggestion, exactRationale = !exactOk && !exactHidden)
    }
    // Android 13+: the ongoing countdown and the alert at zero need the notification permission; ask on the first start.
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) Toast.makeText(context, "Timers still run, but without notifications you won’t hear when one ends.", Toast.LENGTH_LONG).show()
    }
    val actions = remember(store, pilot, base, suggestion, mining) {
        TimerActions(
            start = base.start, pause = base.pause, resume = base.resume, restart = base.restart, share = base.share, remove = base.remove, clearFinished = base.clearFinished,
            startIn = base.startIn ?: { draft ->
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
                store.start(pilot, draft); Unit
            },
            place = { id, system -> store.place(id, system); base.place(id, system) },
            warn = store::setWarnings,
            startSuggestion = {
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
                suggestion?.let { CockpitControl.startSuggestion(store, pilot, it, mining?.profile) }
                feed.dismissSuggestion()
            },
            dismissSuggestion = feed::dismissSuggestion,
            openExactSettings = { runCatching { context.startActivity(ExactAlarms.settingsIntent(context)) } },
            dismissExactRationale = { exactHidden = true },
        )
    }
    return map to actions
}

/** The Timers screen wired to the store (the sub-screen's content; the screen adds the places itself). */
@Composable
fun TimersRoute(ctx: ScreenContext) {
    val container = LocalAppContainer.current
    val now = rememberNow()
    if (container == null) { TimersScreen(ctx.pilot, emptyList(), now, TimerActions()); return }
    val store = container.fly.timers
    val timers by store.timers.collectAsStateWithLifecycle()
    val actions = remember(store, ctx.pilot) {
        TimerActions(
            start = { kind, length, label, shared -> ctx.pilot?.let { store.start(it, kind, length, label, shared) } },
            pause = store::pause, resume = store::resume, restart = store::restart, share = store::setShared, remove = store::remove,
            clearFinished = { ctx.pilot?.let(store::clearFinished) }, warn = store::setWarnings,
        )
    }
    // A read of where you are about once a minute, so entering a wormhole offers the Sleeper timer here too.
    com.echelon.eve.fly.cockpit.PollLive(container.fly.cockpit, ctx.pilot)
    TimersScreen(ctx.pilot, timers.values, now, actions)
}


/** The hub card wired to the app: the next timer and its system, counting down. */
@Composable
fun TimersHubCard(ctx: ScreenContext, onOpen: () -> Unit) {
    val container = LocalAppContainer.current
    val now = rememberNow()
    val timers = container?.fly?.timers?.timers?.collectAsStateWithLifecycle()?.value?.values.orEmpty()
    val systems = container?.market?.state?.collectAsStateWithLifecycle()?.value?.data?.systems.orEmpty()
    TimersCard(timers, now, systems, onOpen)
}

/**
 * The hub card: "Gas site in Tama · 3 running" with a ring sweeping down around the next end's countdown, or how to
 * start one. Stateless, for the hub and its goldens.
 */
@Composable
fun TimersCard(timers: Collection<WingTimer>, now: Long, systems: Map<Long, SolarSystem>, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val board = TimerBoard.of(timers, now)
    val next = board.next
    val c = Echelon.colors
    // The hub's own card (nav.HubCard: formation corner, press feedback, entrance), with the next end as its trailing figure.
    com.echelon.eve.nav.HubCard(
        "Timers", next?.let { "${it.title(systems)} · ${board.runningCount} running" } ?: "Gas sites, mining cycles, despawn and cyno", EchelonIcons.Timer, onOpen, modifier,
        trailing = if (next == null) null else ({
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Countdown(next.endsAt, now = now, style = Echelon.type.num)
                ProgressRing(1f - next.progress(now), size = 22.dp, stroke = 3.dp, color = ownerColor(next))
            }
        }),
    )
}
