package com.echelon.eve.ui.motion

import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView
import kotlinx.coroutines.delay

/**
 * Semantic haptics. Screens say what happened (a tap that selects, a confirm, a warning) and this picks the platform
 * constant, so the feel stays consistent and respects the system's touch-feedback setting (View haptics do).
 */
class Haptics(private val view: View) {
    /** Selecting a tab, chip or pilot. */
    fun select() = perform(HapticFeedbackConstants.SEGMENT_TICK, 34, HapticFeedbackConstants.CLOCK_TICK)
    /** A light tick while scrubbing (a slider, a list snapping). */
    fun tick() = perform(HapticFeedbackConstants.SEGMENT_FREQUENT_TICK, 34, HapticFeedbackConstants.CLOCK_TICK)
    /** Something succeeded: a sign-in, a timer started, a refresh finished. */
    fun confirm() = perform(HapticFeedbackConstants.CONFIRM, 30, HapticFeedbackConstants.CONTEXT_CLICK)
    /** Something failed or needs attention (an expired sign-in, a timer ending). */
    fun reject() = perform(HapticFeedbackConstants.REJECT, 30, HapticFeedbackConstants.LONG_PRESS)
    /** A long press that opens a menu, or a pull-to-refresh crossing its threshold. */
    fun heavy() = perform(HapticFeedbackConstants.LONG_PRESS, 1, HapticFeedbackConstants.LONG_PRESS)
    /** The predictive back gesture committing. */
    fun gestureEnd() = perform(HapticFeedbackConstants.GESTURE_END, 30, HapticFeedbackConstants.CONTEXT_CLICK)

    /** Plays a choreographed [moment] (several pulses in time; see [HapticChoreo]). Suspends for its length. */
    suspend fun play(moment: HapticMoment) {
        for (p in HapticChoreo.pattern(moment)) {
            if (p.afterMs > 0) delay(p.afterMs)
            when (p.kind) {
                Pulse.Kind.Select -> select(); Pulse.Kind.Tick -> tick(); Pulse.Kind.Confirm -> confirm()
                Pulse.Kind.Reject -> reject(); Pulse.Kind.Heavy -> heavy()
            }
        }
    }

    // CONFIRM and REJECT arrived in API 30, the SEGMENT ticks in 34; older phones get the nearest classic constant.
    private fun perform(constant: Int, since: Int, fallback: Int) {
        view.performHapticFeedback(if (android.os.Build.VERSION.SDK_INT >= since) constant else fallback)
    }
}

@Composable
fun rememberHaptics(): Haptics { val view = LocalView.current; return remember(view) { Haptics(view) } }

/** The moments that have a feel of their own, each matched to the motion it comes with. */
enum class HapticMoment {
    /** A timer started (the cockpit's quick timers, the board's Start): one firm confirm. */
    Start,
    /** A warning point passed (the ring's amber pulse and breathing): two light ticks, close together. */
    Warning,
    /** A Sleeper timer ran out (the ring's red flare, "Warp out"): a reject and two heavy knocks. Get out. */
    WarpOut,
    /** The wingmate answered your call, or you acknowledged theirs (the ping ripple): a select then a confirm. */
    Ack,
    /** A call arrived from the wingmate (the ping ripple on their mark): a heavy then a tick. */
    Ping,
    /** A sync you asked for finished (the sync beacon's settle ring): one soft tick. */
    SyncDone,
}

/** One pulse of a pattern: what, and how long after the previous pulse. */
data class Pulse(val kind: Kind, val afterMs: Long = 0) { enum class Kind { Select, Tick, Confirm, Reject, Heavy } }

object HapticChoreo {
    /** Each moment's pulses: all under half a second and told apart by rhythm, so they read without looking. */
    fun pattern(moment: HapticMoment): List<Pulse> = when (moment) {
        HapticMoment.Start -> listOf(Pulse(Pulse.Kind.Confirm))
        HapticMoment.Warning -> listOf(Pulse(Pulse.Kind.Tick), Pulse(Pulse.Kind.Tick, 140))
        HapticMoment.WarpOut -> listOf(Pulse(Pulse.Kind.Reject), Pulse(Pulse.Kind.Heavy, 110), Pulse(Pulse.Kind.Heavy, 110))
        HapticMoment.Ack -> listOf(Pulse(Pulse.Kind.Select), Pulse(Pulse.Kind.Confirm, 80))
        HapticMoment.Ping -> listOf(Pulse(Pulse.Kind.Heavy), Pulse(Pulse.Kind.Tick, 160))
        HapticMoment.SyncDone -> listOf(Pulse(Pulse.Kind.Tick))
    }

    /** How long a moment's pattern lasts (ms). */
    fun length(moment: HapticMoment): Long = pattern(moment).sumOf { it.afterMs }
}
