package com.echelon.eve.ui.motion

import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

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

    // CONFIRM and REJECT arrived in API 30, the SEGMENT ticks in 34; older phones get the nearest classic constant.
    private fun perform(constant: Int, since: Int, fallback: Int) {
        view.performHapticFeedback(if (android.os.Build.VERSION.SDK_INT >= since) constant else fallback)
    }
}

@Composable
fun rememberHaptics(): Haptics { val view = LocalView.current; return remember(view) { Haptics(view) } }
