package com.echelon.eve.fly.cockpit

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.echelon.eve.AppContainer
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingMessage
import com.echelon.eve.core.wing.WingPing
import com.echelon.eve.fly.fly
import com.echelon.eve.fly.timers.TimerBoard
import com.echelon.eve.nav.Destination
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.ui.components.rememberNow
import com.echelon.eve.ui.motion.rememberHaptics
import kotlinx.coroutines.launch

/** Keeps the display on while composed: the phone lies next to the keyboard for the whole session. */
@Composable
fun KeepScreenOn() {
    val view = LocalView.current
    DisposableEffect(view) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }
}

/** The cockpit's own small settings (sound cues), on this phone only. */
internal fun cockpitPrefs(context: Context) = context.getSharedPreferences("cockpit", Context.MODE_PRIVATE)

/** Polls /api/live for [pilot] while the screen is at least started (not while the phone is locked or the app hidden). */
@Composable
fun PollLive(live: CockpitLive, pilot: Pilot?) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(live, pilot, lifecycle) {
        if (pilot == null) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { live.run(pilot) }
    }
}

@Composable
fun CockpitRoute(ctx: ScreenContext) {
    val container = LocalAppContainer.current
    val now = rememberNow()
    if (container == null) { CockpitScreen(CockpitUi(ctx.pilot), now, CockpitActions()); return }
    KeepScreenOn()
    CockpitWired(container, ctx, now)
}

@Composable
private fun CockpitWired(c: AppContainer, ctx: ScreenContext, now: Long) {
    val pilot = ctx.pilot
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val live = c.fly.cockpit
    PollLive(live, pilot)
    val state by live.state.collectAsStateWithLifecycle()
    val timers by c.fly.timers.timers.collectAsStateWithLifecycle()
    val presence by c.wingChannel.presence.collectAsStateWithLifecycle()
    val pings by c.wingChannel.pings.collectAsStateWithLifecycle()
    val plans by c.wingChannel.plans.collectAsStateWithLifecycle()
    val market by c.market.state.collectAsStateWithLifecycle()
    val prefs = remember { cockpitPrefs(context) }
    var sound by remember { mutableStateOf(prefs.getBoolean("sound", true)) }
    var status by remember { mutableStateOf<String?>(null) }
    var banner by remember { mutableStateOf<Pair<CockpitEvent, Long>?>(null) }
    val soundOn by rememberUpdatedState(sound)

    // A short beep for a security drop, from the notification stream so the phone's volume and silent mode apply.
    val tones = remember { runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80) }.getOrNull() }
    DisposableEffect(tones) { onDispose { tones?.release() } }

    // What changed between two reads: a moment on screen and a cue you can feel (and hear, for low and null).
    LaunchedEffect(live) {
        live.events.collect { e ->
            // A jump keeps the banner over an undock read at the same time, until it has been shown.
            val t = System.currentTimeMillis()
            val held = banner?.takeIf { (b, at) -> b is CockpitEvent.Jumped && t - at < b.shownFor() }
            if (held == null || e is CockpitEvent.Jumped) banner = e to t
            when {
                e is CockpitEvent.Jumped && e.warning != null -> { haptics.reject(); if (soundOn) tones?.startTone(ToneGenerator.TONE_PROP_BEEP2, 300) }
                e is CockpitEvent.Jumped -> haptics.confirm()
                else -> haptics.tick()
            }
        }
    }
    // A call from the wingmate while the cockpit is open.
    LaunchedEffect(pilot) {
        c.wingChannel.incoming.collect { m ->
            if (m is WingMessage.Ping && m.pilot != pilot) { haptics.heavy(); if (soundOn) tones?.startTone(ToneGenerator.TONE_PROP_ACK, 200) }
        }
    }
    // A timer reaching zero on screen: a firm tap (the timer service rings in the background).
    val board = TimerBoard.of(timers.values, now)
    var lastNext by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(board.next?.id) {
        val was = lastNext
        lastNext = board.next?.id
        if (was != null && timers[was]?.done(System.currentTimeMillis()) == true) haptics.heavy()
    }

    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val mate = pilot?.wingmate
    val systemName = { id: Long -> market.data?.systems?.get(id)?.name }
    val here = state.ui.me?.systemId?.takeIf { state.pilot == pilot }
    val ui = CockpitUi(
        pilot = pilot,
        me = state.ui.me.takeIf { state.pilot == pilot },
        reading = state.reading,
        problem = state.ui.problem.takeIf { state.pilot == pilot },
        readAt = state.readAt, nextAt = state.nextAt,
        banner = banner?.takeIf { (e, at) -> now - at < e.shownFor() }?.first,
        timers = timers.values.toList(),
        quick = pilot?.let { p -> QUICK_KINDS.map { QuickTimer.of(timers.values, p, it) } }.orEmpty(),
        mate = mate?.let { m ->
            MateUi(m, presence[m.id]?.online, state.ui.wingmate.takeIf { state.pilot == pilot }, state.ui.wingmateNote,
                pings.firstOrNull { it.from == m }?.let { e -> PingLine(e.value.text?.takeIf { e.value.kind == WingPing.CUSTOM } ?: pingLabel(e.value.kind), e.value.system?.let(systemName), e.at) })
        },
        plan = plans.firstOrNull { it.value.route.size > 1 && now - it.at < PLAN_FRESH }?.let { PlanLine(it.value.title, it.value.route) },
        status = status,
        sound = sound,
    )
    val actions = CockpitActions(
        refresh = { live.refresh(); haptics.select() },
        quick = { q ->
            val p = pilot ?: return@CockpitActions
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
            val t = CockpitControl.cycle(c.fly.timers, p, q.kind)
            haptics.confirm()
            status = t?.let { "${it.label} ${if (q.reuse != null) "restarted" else "started"}." }
            CockpitWidget.refresh(context)
        },
        ping = { kind ->
            val p = pilot
            if (p != null) {
                val ok = c.wingChannel.ping(p, WingPing(kind, system = here.takeIf { kind == WingPing.OMW || kind == WingPing.HELP }))
                haptics.confirm()
                status = if (ok) "“${pingLabel(kind)}” sent to ${p.wingmate.displayName}." else "Queued: it goes out when the wing room reconnects."
            }
        },
        routeToMate = {
            val p = pilot; val target = ui.mate?.place?.systemId
            if (p != null && target != null) scope.launch { status = "Sending…"; status = CockpitControl.autopilot(c, p, listOf(target)); haptics.confirm() }
        },
        autopilot = { plan -> val p = pilot; if (p != null) scope.launch { status = "Sending…"; status = CockpitControl.autopilot(c, p, plan.route.drop(1)); haptics.confirm() } },
        openTimers = { ctx.open(Destination.Fly, "timers", null) },
        openWing = { ctx.open(Destination.Fly, "wing", null) },
        sound = { sound = it; prefs.edit().putBoolean("sound", it).apply(); haptics.select() },
    )
    CockpitScreen(ui, now, actions)
}

/** A shared route older than this is stale for the autopilot button (the wing has moved on). */
private const val PLAN_FRESH = 6 * 3_600_000L
