package com.echelon.eve.fly

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import android.content.ClipData
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import kotlinx.coroutines.launch
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.fly.cockpit.CockpitHubCard
import com.echelon.eve.fly.cockpit.CockpitRoute
import com.echelon.eve.fly.cockpit.PollLive
import com.echelon.eve.fly.fit.FitScreen
import com.echelon.eve.fly.fit.FitUi
import com.echelon.eve.fly.jobs.JobsScreen
import com.echelon.eve.fly.jobs.JobsUi
import com.echelon.eve.fly.live.LiveScreen
import com.echelon.eve.fly.live.LiveUi
import com.echelon.eve.fly.skills.SkillQueueScreen
import com.echelon.eve.fly.skills.SkillsUi
import com.echelon.eve.fly.timers.TimerActions
import com.echelon.eve.fly.timers.TimerBoard
import com.echelon.eve.fly.timers.TimersScreen
import com.echelon.eve.nav.Destination
import com.echelon.eve.nav.Feature
import com.echelon.eve.nav.FeatureRegistry
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.nav.SubScreen
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.Countdown
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.rememberNow
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing

/** FLY: help during play. Timers (shared with the wingmate), where you are, your fit, the skill queue and jobs. */
object FlyFeature : Feature {
    override val destination = Destination.Fly
    /** Timers outlive the process: the store reads them back and restarts the service while one still counts down. */
    override fun start(container: com.echelon.eve.AppContainer) {
        container.fly.timers
        // The home-screen widget follows the timers and the last place for the life of the process.
        com.echelon.eve.fly.cockpit.CockpitWidget.watch(container.app, container.scope)
    }
    override fun install(registry: FeatureRegistry) {
        registry.register(destination, SubScreen("cockpit", "Cockpit", "Where you are, the next timer and one-tap calls", EchelonIcons.Fly, 1, card = { ctx, onOpen -> CockpitCard(ctx, onOpen) }) { CockpitRoute(it) })
        registry.register(destination, SubScreen("wing", "Wing", "Calls, shared plans and who is online", EchelonIcons.Wing, 5) { com.echelon.eve.fly.wing.WingRoute(it) })
        registry.register(destination, SubScreen("timers", "Timers", "Gas sites, mining cycles, despawn and cyno", EchelonIcons.Timer, 10, card = { ctx, onOpen -> com.echelon.eve.fly.timers.TimersHubCard(ctx, onOpen) }) { com.echelon.eve.fly.timers.TimersRoute(it) })
        registry.register(destination, SubScreen("live", "Where I am", "Live location and ship from EVE", EchelonIcons.Route, 20) { LiveRoute(it) })
        registry.register(destination, SubScreen("fit", "Current fit", "Copy as EFT", EchelonIcons.Fly, 30) { FitRoute(it) })
        registry.register(destination, SubScreen("skills", "Skill queue", "What is training and when it ends", EchelonIcons.Pilot, 40) { SkillsRoute(it) })
        registry.register(destination, SubScreen("jobs", "Jobs ready", "Industry jobs to deliver", EchelonIcons.Check, 35) { JobsRoute(it) })
    }
}


/** The cockpit's hub card: where the flying pilot was last read and the next timer, large enough to read at a glance. */
@Composable
private fun CockpitCard(ctx: ScreenContext, onOpen: () -> Unit) {
    val container = LocalAppContainer.current
    val now = rememberNow()
    val timers = container?.fly?.timers?.timers?.collectAsStateWithLifecycle()?.value?.values.orEmpty()
    val live = container?.fly?.cockpit?.state?.collectAsStateWithLifecycle()?.value
    val me = live?.ui?.me?.takeIf { live.pilot == ctx.pilot }
    CockpitHubCard(me, TimerBoard.of(timers, now).next, now, onOpen)
}


@Composable
private fun LiveRoute(ctx: ScreenContext) {
    val container = LocalAppContainer.current
    val now = rememberNow(periodMillis = 1_000)
    if (container == null) { LiveScreen(ctx.pilot, LiveUi(), now, onRefresh = {}); return }
    // The cockpit's schedule: one read a minute or so while this is open, shared with the cockpit (no double reads).
    val live = container.fly.cockpit
    PollLive(live, ctx.pilot)
    val state by live.state.collectAsStateWithLifecycle()
    val ui = if (state.pilot == ctx.pilot) state.ui.copy(loading = state.reading && state.ui.me == null) else LiveUi(loading = true)
    LiveScreen(ctx.pilot, ui, now, onRefresh = live::refresh, nextAt = state.nextAt.takeIf { state.pilot == ctx.pilot && !state.reading })
}

@Composable
private fun FitRoute(ctx: ScreenContext) {
    val container = LocalAppContainer.current
    var picked by rememberSaveable(ctx.pilot) { mutableStateOf(ctx.pilot?.name) }
    val pilot = picked?.let { runCatching { Pilot.valueOf(it) }.getOrNull() }
    val pilots = container?.pilots?.pilots?.collectAsStateWithLifecycle()?.value
    val wing = container?.wing?.wing?.collectAsStateWithLifecycle()?.value
    var ui by remember(pilot) { mutableStateOf(pilot?.let { FitUi(it, loading = true) }) }
    LaunchedEffect(pilot, pilots, wing) {
        if (pilot == null || container == null) return@LaunchedEffect
        ui = runCatching { FlyLoader(container).fit(pilot) }.getOrElse { FitUi(pilot, note = "The fit could not be read: ${it.message}") }
    }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    FitScreen(ui, ctx.pilot, onPick = { picked = it.name }, onCopy = { text ->
        scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("EFT fit", text))) }
        Toast.makeText(context, "Fit copied. Paste it into EVE’s fitting window (Import from clipboard).", Toast.LENGTH_SHORT).show()
    })
}

@Composable
private fun SkillsRoute(ctx: ScreenContext) {
    val container = LocalAppContainer.current
    val now = rememberNow()
    var picked by rememberSaveable(ctx.pilot) { mutableStateOf(ctx.pilot?.name) }
    val pilot = picked?.let { runCatching { Pilot.valueOf(it) }.getOrNull() }
    val pilots = container?.pilots?.pilots?.collectAsStateWithLifecycle()?.value
    var ui by remember(pilot) { mutableStateOf<SkillsUi?>(pilot?.let { SkillsUi(it) }) }
    // The queue is re-read when the pilots refresh, and every minute so a finished skill moves off the top.
    val minute = now / 60_000
    LaunchedEffect(pilot, pilots, minute) {
        if (pilot == null || container == null) return@LaunchedEffect
        ui = FlyLoader(container).skills(pilot, System.currentTimeMillis())
    }
    SkillQueueScreen(ui, now, onPick = { picked = it.name })
}

@Composable
private fun JobsRoute(ctx: ScreenContext) {
    val container = LocalAppContainer.current
    val now = rememberNow()
    val pilots = container?.pilots?.pilots?.collectAsStateWithLifecycle()?.value
    val wing = container?.wing?.wing?.collectAsStateWithLifecycle()?.value
    var ui by remember { mutableStateOf(JobsUi(loading = container != null)) }
    LaunchedEffect(pilots, wing) {
        container ?: return@LaunchedEffect
        ui = runCatching { FlyLoader(container).jobs(System.currentTimeMillis()) }.getOrElse { JobsUi(notes = listOf("Jobs could not be read: ${it.message}")) }
    }
    JobsScreen(ui, now)
}
