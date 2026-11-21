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
    override fun install(registry: FeatureRegistry) {
        registry.register(destination, SubScreen("timers", "Timers", "Gas sites, mining cycles, despawn and cyno", EchelonIcons.Timer, 10, card = { ctx, onOpen -> TimersCard(ctx, onOpen) }) { TimersRoute(it) })
        registry.register(destination, SubScreen("live", "Where I am", "Live location and ship from EVE", EchelonIcons.Route, 20) { LiveRoute(it) })
        registry.register(destination, SubScreen("fit", "Current fit", "Copy as EFT", EchelonIcons.Fly, 30) { FitRoute(it) })
        registry.register(destination, SubScreen("skills", "Skill queue", "What is training and when it ends", EchelonIcons.Pilot, 40) { SkillsRoute(it) })
        registry.register(destination, SubScreen("jobs", "Jobs ready", "Industry jobs to deliver", EchelonIcons.Check, 50) { JobsRoute(it) })
    }
}

@Composable
private fun TimersRoute(ctx: ScreenContext) {
    val container = LocalAppContainer.current
    val now = rememberNow()
    if (container == null) { TimersScreen(ctx.pilot, emptyList(), now, TimerActions()); return }
    val store = container.fly.timers
    val timers by store.timers.collectAsStateWithLifecycle()
    val context = LocalContext.current
    // Android 13+: the ongoing countdown and the alert at zero need the notification permission; ask on the first start.
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) Toast.makeText(context, "Timers still run, but without notifications you won’t hear when one ends.", Toast.LENGTH_LONG).show()
    }
    val actions = remember(store, ctx.pilot) {
        TimerActions(
            start = { kind, length, label, shared ->
                val pilot = ctx.pilot ?: return@TimerActions
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
                store.start(pilot, kind, length, label, shared)
            },
            pause = store::pause, resume = store::resume, restart = store::restart, share = store::setShared, remove = store::remove,
            clearFinished = { ctx.pilot?.let(store::clearFinished) },
        )
    }
    TimersScreen(ctx.pilot, timers.values, now, actions)
}

/** The hub card: the next timer counting down, or how to start one. */
@Composable
private fun TimersCard(ctx: ScreenContext, onOpen: () -> Unit) {
    val container = LocalAppContainer.current
    val now = rememberNow()
    val timers = container?.fly?.timers?.timers?.collectAsStateWithLifecycle()?.value?.values.orEmpty()
    val board = TimerBoard.of(timers, now)
    val c = Echelon.colors
    // The hub's default card (nav.HubCard), with the next timer counting down in place of the chevron while one runs.
    EchelonCard(Modifier.fillMaxWidth(), onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Icon(EchelonIcons.Timer, null, Modifier.size(24.dp), tint = c.accent)
            Column(Modifier.weight(1f)) {
                Text("Timers", style = MaterialTheme.typography.titleSmall, color = c.text)
                Text(board.next?.let { "${it.label} · ${board.runningCount} running" } ?: "Gas sites, mining cycles, despawn and cyno",
                    style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 1)
            }
            val next = board.next
            if (next != null) Countdown(next.endsAt, now = now, style = Echelon.type.num)
            else Icon(EchelonIcons.Chevron, null, Modifier.size(18.dp), tint = c.textFaint)
        }
    }
}

@Composable
private fun LiveRoute(ctx: ScreenContext) {
    val container = LocalAppContainer.current
    val now = rememberNow(periodMillis = 30_000)
    var ui by remember(ctx.pilot) { mutableStateOf(LiveUi(loading = container != null)) }
    var reads by remember { mutableStateOf(0) }
    LaunchedEffect(ctx.pilot, reads) {
        val pilot = ctx.pilot ?: return@LaunchedEffect
        container ?: return@LaunchedEffect
        ui = ui.copy(loading = true)
        val got = FlyLoader(container).live(pilot)
        // A failed read keeps the last place on screen, with the problem under it.
        ui = if (got.me == null && ui.me != null) got.copy(me = ui.me) else got
    }
    LiveScreen(ctx.pilot, ui, now, onRefresh = { reads++ })
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
