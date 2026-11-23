package com.echelon.eve.fly.cockpit

import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import com.echelon.eve.R
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.timers.MIN
import com.echelon.eve.fly.timers.TimerBoard
import com.echelon.eve.fly.timers.TimerService
import com.echelon.eve.fly.timers.ownedBy
import com.echelon.eve.fly.timers.running

// Picture-in-picture for the cockpit: leave the cockpit (home, or switch to EVE on a tablet) while a timer runs and it
// shrinks into a small window over everything: the next timer's ring and countdown, its system, and the wingmate's
// dot. Its two buttons act on the timer through the timer service (pause or resume, and +1 min). The pure part, what
// the window shows and which buttons it has, is [pipSpec], pinned by CockpitPipTest; [pipParams] turns it into the
// platform's PictureInPictureParams.

/** What a PiP button does. [action] is the TimerService intent action; [request] keeps the PendingIntents apart. */
enum class PipAction(val action: String, val title: String, val description: String, val request: Int) {
    Pause(TimerService.ACTION_PAUSE, "Pause", "Pause the timer", 31),
    Resume(TimerService.ACTION_RESUME, "Resume", "Resume the timer", 32),
    AddMinute(TimerService.ACTION_EXTEND, "+1 min", "Add a minute to the timer", 33),
}

/** The window as data: whether leaving auto-enters it, its shape, the timer it follows and its buttons. */
data class PipSpec(val autoEnter: Boolean, val aspect: Pair<Int, Int>, val timerId: String?, val actions: List<PipAction>) {
    companion object {
        /** 16:9: the ring on the left, the words on the right. Within Android's 1:2.39 to 2.39:1. */
        val ASPECT = 16 to 9
        const val EXTEND_MS = MIN
    }
}

/**
 * The timer the window follows: the flying pilot's own soonest-ending running timer, else their own paused one (so
 * Resume stays in reach), else the board's next (the wingmate's, shown without buttons).
 */
fun pipTarget(timers: Collection<WingTimer>, pilot: Pilot?, now: Long): WingTimer? {
    val board = TimerBoard.of(timers, now)
    val mine = board.active.filter { it.ownedBy(pilot) }
    return mine.firstOrNull { it.running(now) } ?: mine.firstOrNull { it.pausedAt != null } ?: board.next
}

/**
 * The window for [timers] at [now]: it auto-enters only while something counts down (leaving the cockpit with nothing
 * running just leaves); the buttons are for the pilot's own timer: Pause or Resume, and +1 min.
 */
fun pipSpec(timers: Collection<WingTimer>, pilot: Pilot?, now: Long): PipSpec {
    val target = pipTarget(timers, pilot, now)
    val running = TimerBoard.of(timers, now).next != null
    val actions = when {
        target == null || !target.ownedBy(pilot) || target.done(now) -> emptyList()
        target.pausedAt != null -> listOf(PipAction.Resume, PipAction.AddMinute)
        else -> listOf(PipAction.Pause, PipAction.AddMinute)
    }
    return PipSpec(autoEnter = running, aspect = PipSpec.ASPECT, timerId = target?.id, actions = actions)
}

/** The service intent behind a PiP button. */
fun pipIntent(context: Context, action: PipAction, timerId: String): Intent = TimerService.actionIntent(context, action.action, timerId)

private fun icon(action: PipAction) = when (action) {
    PipAction.Pause -> R.drawable.ic_pip_pause; PipAction.Resume -> R.drawable.ic_pip_play; PipAction.AddMinute -> R.drawable.ic_pip_plus_minute
}

/** [spec] as the platform's params; [sourceRect] (window px) is where the next-timer card sits, for the enter animation. */
fun pipParams(context: Context, spec: PipSpec, sourceRect: android.graphics.Rect?): PictureInPictureParams {
    val actions = spec.timerId?.let { id ->
        spec.actions.map { a ->
            val pending = PendingIntent.getForegroundService(context, a.request, pipIntent(context, a, id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            RemoteAction(Icon.createWithResource(context, icon(a)), a.title, a.description, pending)
        }
    }.orEmpty()
    return PictureInPictureParams.Builder().apply {
        setAspectRatio(Rational(spec.aspect.first, spec.aspect.second))
        setActions(actions)
        if (sourceRect != null && !sourceRect.isEmpty) setSourceRectHint(sourceRect)
        if (Build.VERSION.SDK_INT >= 31) {
            setAutoEnterEnabled(spec.autoEnter)
            // Text and a ring, not video: a crossfade reads better than a seamless stretch.
            setSeamlessResizeEnabled(false)
        }
    }.build()
}

/** Where the next-timer card is on screen, reported to the PiP params (CockpitActivity provides it; elsewhere null). */
val LocalPipAnchor = androidx.compose.runtime.staticCompositionLocalOf<((android.graphics.Rect) -> Unit)?> { null }

/** Reports this element's window bounds to [LocalPipAnchor]: the source-rect hint PiP animates from. */
fun Modifier.pipAnchor(): Modifier = composed {
    val report = LocalPipAnchor.current ?: return@composed this
    onGloballyPositioned { coords ->
        val r = coords.boundsInWindow()
        report(android.graphics.Rect(r.left.toInt(), r.top.toInt(), r.right.toInt(), r.bottom.toInt()))
    }
}
