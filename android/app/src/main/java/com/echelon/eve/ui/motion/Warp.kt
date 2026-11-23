package com.echelon.eve.ui.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalInspectionMode
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.LocalReduceMotion
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

// The warp: Echelon's signature move between destinations. The old destination rushes past (scales up and fades), the
// new one decelerates into place (from 92 %), and for 460 ms a burst of radial streaks flies outward from the centre,
// as the starfield does when a ship drops out of warp. The streaks are precomputed (one seed, fixed arrays) and drawn as
// plain lines over the content: no allocation per frame, one draw pass, nothing at all once it has played.
// Reduced motion keeps only a short cross-fade (NavMotion.tabEnter/tabExit) and never draws streaks.

/** The streak field: angle, where each streak starts (0–1 of the reach), its length, width and tint, fixed by [seed]. */
class WarpField(seed: Int = 11, val count: Int = 44) {
    val angle = FloatArray(count); val start = FloatArray(count); val length = FloatArray(count); val width = FloatArray(count); val tint = IntArray(count)

    init {
        val r = Random(seed)
        for (i in 0 until count) {
            angle[i] = (i.toFloat() / count) * 2f * PI.toFloat() + r.nextFloat() * .12f
            start[i] = .08f + r.nextFloat() * .32f
            length[i] = .18f + r.nextFloat() * .34f
            width[i] = .8f + r.nextFloat() * 1.4f
            tint[i] = if (i % 7 == 0) 2 else if (i % 3 == 0) 1 else 0
        }
    }

    companion object {
        /** How bright the streaks are at [p] (0–1): up fast, down slow, zero at both ends. Pure, for tests. */
        fun envelope(p: Float): Float = if (p <= 0f || p >= 1f) 0f else if (p < .22f) p / .22f else ((1f - p) / .78f).let { it * it }
    }
}

/**
 * Draws one frame of the warp at [p] (0–1) over this scope: streaks radiate from a point a little above the centre,
 * their heads racing out with [Easings.out], their tails stretching then shrinking. [colors] are the streaks' three
 * tints (text, the flying pilot's colour, Flare).
 */
fun DrawScope.drawWarp(p: Float, field: WarpField, c0: Color, c1: Color, c2: Color) {
    val a = WarpField.envelope(p)
    if (a <= 0f) return
    val origin = Offset(size.width / 2, size.height * .42f)
    val reach = size.maxDimension * .78f
    val head = Easings.out.transform(p)
    // A soft flash at the origin as the ship drops out.
    drawCircle(c1.copy(alpha = .10f * a), radius = reach * .22f * (.4f + head), center = origin)
    for (i in 0 until field.count) {
        val d = reach * (field.start[i] + head * (1f - field.start[i]))
        val tail = (d - reach * field.length[i] * a).coerceAtLeast(reach * field.start[i] * .6f)
        val dx = cos(field.angle[i]); val dy = sin(field.angle[i])
        val col = when (field.tint[i]) { 1 -> c1; 2 -> c2; else -> c0 }
        drawLine(col.copy(alpha = .55f * a), Offset(origin.x + dx * tail, origin.y + dy * tail), Offset(origin.x + dx * d, origin.y + dy * d), field.width[i] * density, cap = StrokeCap.Round)
    }
}

/**
 * Plays the warp's streaks over this element whenever [key] changes (not on the first composition): give it the
 * destination being shown, and every change of destination warps. Still with reduced motion and in screenshots.
 * [onWarp] runs as each warp starts (a haptic, say).
 */
fun Modifier.warp(key: Any?, onWarp: () -> Unit = {}): Modifier = composed {
    val still = LocalReduceMotion.current || LocalInspectionMode.current
    val c = Echelon.colors
    val pilot = Echelon.pilot.color
    val field = remember { WarpField() }
    val progress = remember { Animatable(1f) }
    val last = remember { arrayOf(key) }
    LaunchedEffect(key) {
        if (last[0] == key) return@LaunchedEffect
        last[0] = key
        if (still) return@LaunchedEffect
        onWarp()
        progress.snapTo(0f)
        progress.animateTo(1f, tween(Durations.warp, easing = LinearEasing))
    }
    drawWithContent {
        drawContent()
        val p = progress.value
        if (p < 1f) drawWarp(p, field, c.text, pilot, c.flare)
    }
}

/** The warp frozen at [progress], for the design catalog and MOTION.md: what [warp] looks like mid-flight. */
@Composable
fun WarpFrame(progress: Float, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    val pilot = Echelon.pilot.color
    val field = remember { WarpField() }
    Canvas(modifier) { drawWarp(progress, field, c.text, pilot, c.flare) }
}
