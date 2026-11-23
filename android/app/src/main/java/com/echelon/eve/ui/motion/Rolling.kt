package com.echelon.eve.ui.motion

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.LocalReduceMotion
import kotlinx.coroutines.delay

// Number choreography: every figure that is money or time moves the same way. One component, [RollingNumber]:
//  - when a screen first appears (its StaggerRoot's entrance window is open), the figure counts up from [from] in eight
//    quick odometer steps along an ease-out, the digits rolling as they spin;
//  - afterwards, a change rolls only the digits that changed: upward when the value grew, downward when it fell.
// Countdowns use [RollingText] directly (Countdown, the timer rings). Reduced motion swaps digits in place and never
// counts; screenshots show the end value.

/** Which way changed digits travel: [Up] for a growing figure (new digits rise from below), [Down] for a falling one. */
enum class Roll { Up, Down }

object NumberChoreo {
    const val COUNT_STEPS = 8
    const val STEP_MS = 70L
    const val ROLL_MS = 220

    /** The values a count-up shows, [from] to [to] along an ease-out cubic; the last is exactly [to]. Pure, for tests. */
    fun countUp(from: Double, to: Double, steps: Int = COUNT_STEPS): List<Double> =
        (1..steps).map { i -> if (i == steps) to else { val t = i.toDouble() / steps; from + (to - from) * (1 - (1 - t) * (1 - t) * (1 - t)) } }

    fun direction(old: Double, new: Double): Roll = if (new >= old) Roll.Up else Roll.Down
}

/**
 * Text whose characters roll vertically when they change; only the changed ones move (matched from the end, so a
 * figure that grows a digit keeps its units in place). [direction] picks the way they travel.
 */
@Composable
fun RollingText(text: String, style: TextStyle, modifier: Modifier = Modifier, direction: Roll = Roll.Down) {
    val reduced = Echelon.reduceMotion
    val sign = if (direction == Roll.Down) -1 else 1
    Row(modifier) {
        text.forEachIndexed { i, ch ->
            androidx.compose.runtime.key(text.length - i) {
                AnimatedContent(ch, transitionSpec = {
                    if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                    else (slideInVertically(tween(NumberChoreo.ROLL_MS)) { sign * it / 2 } + fadeIn(tween(NumberChoreo.ROLL_MS))) togetherWith
                        (slideOutVertically(tween(NumberChoreo.ROLL_MS)) { -sign * it / 2 } + fadeOut(tween(160)))
                }, label = "digit") { Text(it.toString(), style = style) }
            }
        }
    }
}

/**
 * A figure (ISK, a count, hours) that counts up once when its screen first appears and rolls its changed digits after
 * that. [text] turns the value into the label ([format] with [kind] by default); screen readers hear the end value.
 * [countUp] = false only rolls (a figure the user is scrubbing, like the refuel planner's days).
 */
@Composable
fun RollingNumber(
    value: Double?,
    modifier: Modifier = Modifier,
    kind: Kind = Kind.Count,
    from: Double = 0.0,
    style: TextStyle = Echelon.type.num,
    color: Color = Color.Unspecified,
    countUp: Boolean = true,
    text: (Double) -> String = { format(it, kind) },
) {
    if (value == null || !value.isFinite()) { Text("—", modifier, style = style, color = color); return }
    val still = LocalReduceMotion.current || LocalInspectionMode.current
    val stagger = LocalStagger.current
    // Count up only as the screen arrives: a row scrolled into view later, or a screen come back to, just shows its figure.
    val first = remember { booleanArrayOf(countUp && !still && (stagger?.open ?: true) && from != value) }
    var shown by remember { mutableDoubleStateOf(if (first[0]) from else value) }
    val previous = remember { doubleArrayOf(shown) }
    LaunchedEffect(value, still) {
        if (!still && first[0]) { first[0] = false; for (v in NumberChoreo.countUp(shown, value)) { shown = v; delay(NumberChoreo.STEP_MS) } }
        first[0] = false
        shown = value
    }
    val direction = NumberChoreo.direction(previous[0], shown)
    SideEffect { previous[0] = shown }
    val final = text(value)
    RollingText(text(shown), LocalTextStyle.current.merge(style).let { if (color != Color.Unspecified) it.copy(color = color) else it },
        modifier.semantics(mergeDescendants = true) { contentDescription = final }, direction)
}
