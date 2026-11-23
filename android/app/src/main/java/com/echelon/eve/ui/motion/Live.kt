package com.echelon.eve.ui.motion

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.LocalInspectionMode
import com.echelon.eve.ui.theme.LocalReduceMotion
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

// Live-state micro-animations: the only things that move without being touched, and only while what they mark is live.
//  - heartbeat: the sync beacon's lub-dub while a sync runs (two quick halos, a rest), then a settle ring when it ends.
//  - breath: a slow sine for glows that "breathe" (a timer ring nearing a warning breathes faster as the end closes).
//  - dangerShimmer: a red sheen crossing a reinforced or failing row every few seconds.
// The online pulse is Modifier.pulse (Celebration.kt). Each runs on one infinite transition and draws with plain shapes
// or a brush cached per size; reduced motion and screenshots hold a still frame that still reads as live.

/** The heartbeat's halo strength at [t] (0–1 of a beat): two peaks, at 0.06 and 0.28 (the second softer), then a rest. Pure, for tests. */
fun heartbeatAt(t: Float): Float {
    fun peak(x: Float, at: Float) = exp(-((x - at) * (x - at)) / .0024f)
    return (peak(t, .06f) + .7f * peak(t, .28f)).coerceIn(0f, 1f)
}

/** A lub-dub halo behind the element while [active] (a sync running). One beat per [periodMillis]. */
fun Modifier.heartbeat(active: Boolean, color: Color, periodMillis: Int = 1100): Modifier = composed {
    if (!active) return@composed this
    val moving = !LocalReduceMotion.current && !LocalInspectionMode.current
    val t: State<Float> = if (moving) rememberInfiniteTransition(label = "heartbeat").animateFloat(0f, 1f, infiniteRepeatable(tween(periodMillis, easing = LinearEasing), RepeatMode.Restart), label = "beat")
    else remember { mutableFloatStateOf(.06f) }
    drawWithContent {
        val b = heartbeatAt(t.value)
        val r = size.minDimension / 2
        drawCircle(color.copy(alpha = .5f * b), radius = r * (1f + .9f * b))
        drawContent()
    }
}

/**
 * A breathing value 0–1 (a sine) for glows, [speed] breaths per [periodMillis]: pass a whole number so the cycle
 * joins up. Still (0.5) with reduced motion and in screenshots.
 */
@Composable
fun rememberBreath(active: Boolean, periodMillis: Int = 1600): State<Float> {
    val moving = active && !LocalReduceMotion.current && !LocalInspectionMode.current
    return if (moving) rememberInfiniteTransition(label = "breath").animateFloat(0f, 1f, infiniteRepeatable(tween(periodMillis, easing = LinearEasing), RepeatMode.Restart), label = "phase")
    else remember { mutableFloatStateOf(-1f) }
}

/** The breath's level at [phase] (0–1) for [speed] whole breaths a cycle; a negative phase (still) is the midpoint. */
fun breathAt(phase: Float, speed: Int = 1): Float = if (phase < 0f) .5f else .5f + .5f * sin(phase * 2f * PI.toFloat() * speed - PI.toFloat() / 2)

/**
 * A sheen in [color] that crosses the element on a diagonal every [periodMillis] while [active]: a reinforced tower,
 * a structure going dark. The band's brush is built once per size; each frame only translates it. Reduced motion and
 * screenshots draw a still edge glow instead.
 */
fun Modifier.dangerShimmer(active: Boolean, color: Color, periodMillis: Int = 2600): Modifier = composed {
    if (!active) return@composed this
    val moving = !LocalReduceMotion.current && !LocalInspectionMode.current
    val t: State<Float> = if (moving) rememberInfiniteTransition(label = "danger").animateFloat(0f, 1f, infiniteRepeatable(tween(periodMillis, easing = LinearEasing), RepeatMode.Restart), label = "sheen")
    else remember { mutableFloatStateOf(-1f) }
    drawWithCache {
        val band = size.width * .35f
        val brush = Brush.linearGradient(listOf(Color.Transparent, color.copy(alpha = .16f), Color.Transparent), start = Offset(0f, 0f), end = Offset(band, size.height * .5f))
        val edge = color.copy(alpha = .35f)
        onDrawWithContent {
            drawContent()
            val p = t.value
            if (p < 0f) { drawRect(edge, size = size.copy(width = 3f * density)); return@onDrawWithContent }
            // The sheen crosses in the first 45 % of the period and rests for the rest.
            val q = p / .45f
            if (q <= 1f) translate(left = -band + (size.width + band) * q) { drawRect(brush, size = size.copy(width = band)) }
        }
    }
}

/** A thin ring that widens and fades once, for "it settled" moments (a sync finishing). Use with [rememberOneShot]. */
internal fun androidx.compose.ui.graphics.drawscope.DrawScope.settleRing(p: Float, color: Color) {
    if (p >= 1f) return
    val r = size.minDimension / 2
    drawCircle(color.copy(alpha = .6f * (1f - p)), radius = r * (1f + 1.6f * p), style = Stroke(1.5f * density))
}

/** One ring settling out from the element when [key] changes (the sync line reaching "Synced"). */
fun Modifier.settle(key: Any?, color: Color, onSettle: () -> Unit = {}): Modifier = composed {
    val reduced = LocalReduceMotion.current
    val anim = rememberOneShot(key, 700, onSettle)
    drawWithContent {
        drawContent()
        val p = anim.value
        // Reduced motion: the ring fades where it is instead of widening.
        if (reduced) { if (p < 1f) drawCircle(color.copy(alpha = .5f * (1f - p)), radius = size.minDimension, style = Stroke(1.5f * density)) } else settleRing(p, color)
    }
}
