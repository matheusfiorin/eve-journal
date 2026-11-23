package com.echelon.eve.ui.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.LocalReduceMotion
import kotlin.math.cos
import kotlin.math.sin

// The scan sweep: results arrive the way a probe scan resolves them. A radar beam turns once and each result fades in
// as the beam passes it: a row of Explore's "Where to scan" list, a system on the Jump radar. The beam is a line and
// three stacked wedges of falling alpha (a cheap trailing glow: no gradient brush, nothing allocated per frame). It
// plays when the results' [key] changes, not when a screen comes back. Reduced motion and screenshots show every
// result at once and draw no beam.

/** One sweep's clock: [progress] runs 0 → 1 over a turn; 1 (finished, or still) shows everything. */
@Stable
class ScanSweep internal constructor(private val anim: Animatable<Float, *>?) {
    val progress: Float get() = anim?.value ?: 1f
    val active: Boolean get() = progress < 1f

    /** How revealed (0–1) a result at [at] (0–1 along the sweep) is now. */
    fun reveal(at: Float): Float = revealAt(progress, at)

    companion object {
        /** The beam reaches [at] at progress [at] × 0.85; the result then takes 12 % of the turn to fade in. Pure, for tests. */
        fun revealAt(progress: Float, at: Float): Float = if (progress >= 1f) 1f else ((progress - at.coerceIn(0f, 1f) * .85f) / .12f).coerceIn(0f, 1f)
        /** Where result [i] of [n] sits along a sweep that reveals a list top to bottom. */
        fun listAt(i: Int, n: Int): Float = if (n <= 1) 0f else i.toFloat() / n
    }
}

/**
 * A sweep that plays once each time [key] changes (new results). The first composition plays too when [onFirst] is
 * true (a screen that opens on fresh results); otherwise only later changes do.
 */
@Composable
fun rememberScanSweep(key: Any?, onFirst: Boolean = true, durationMillis: Int = Durations.scan, onSweep: () -> Unit = {}): ScanSweep {
    val still = LocalReduceMotion.current || LocalInspectionMode.current
    val anim = remember { Animatable(if (still || !onFirst) 1f else 0f) }
    val last = remember { arrayOf<Any?>(Unit) }
    LaunchedEffect(key, still) {
        val first = last[0] === Unit
        if (!first && last[0] == key) return@LaunchedEffect
        last[0] = key
        if (still || (first && !onFirst) || key == null) { anim.snapTo(1f); return@LaunchedEffect }
        onSweep()
        anim.snapTo(0f)
        anim.animateTo(1f, tween(durationMillis, easing = Easings.inOut))
    }
    return remember(anim) { ScanSweep(anim) }
}

/**
 * Draws the beam at the sweep's [progress]: pivoting on [pivot] (px), turning from [startDeg] through [arcDeg]
 * (Compose angles: 0 is 3 o'clock, clockwise), reaching [radius]. Fades out over the last 15 % of the turn.
 */
fun DrawScope.drawScanBeam(progress: Float, pivot: Offset, radius: Float, color: Color, startDeg: Float = -90f, arcDeg: Float = 360f) {
    if (progress >= 1f || progress <= 0f) return
    val fade = if (progress > .85f) (1f - progress) / .15f else 1f
    val angle = startDeg + arcDeg * progress
    val tl = Offset(pivot.x - radius, pivot.y - radius)
    val box = Size(radius * 2, radius * 2)
    // Trailing glow: three wedges behind the beam, each shorter and brighter.
    val trail = (arcDeg * .16f).coerceAtMost(48f)
    drawArc(color.copy(alpha = .05f * fade), angle - trail, trail, true, tl, box)
    drawArc(color.copy(alpha = .07f * fade), angle - trail * .55f, trail * .55f, true, tl, box)
    drawArc(color.copy(alpha = .10f * fade), angle - trail * .2f, trail * .2f, true, tl, box)
    val rad = Math.toRadians(angle.toDouble())
    val end = Offset(pivot.x + radius * cos(rad).toFloat(), pivot.y + radius * sin(rad).toFloat())
    drawLine(color.copy(alpha = .65f * fade), pivot, end, 1.5f * density, cap = StrokeCap.Round)
}

/**
 * The beam over a block of results: a quarter turn pivoting on the block's top-start corner, sweeping from along the
 * top edge down to the start edge, long enough to reach the far corner. Pair it with [scanReveal] on each result.
 */
fun Modifier.scanSweep(sweep: ScanSweep, color: Color? = null): Modifier = composed {
    val tint = color ?: Echelon.colors.accent
    drawWithContent {
        drawContent()
        if (sweep.active) {
            val r = kotlin.math.hypot(size.width, size.height)
            val rtl = layoutDirection == androidx.compose.ui.unit.LayoutDirection.Rtl
            clipRect {
                if (rtl) drawScanBeam(sweep.progress, Offset(size.width, 0f), r, tint, startDeg = 180f, arcDeg = -90f)
                else drawScanBeam(sweep.progress, Offset.Zero, r, tint, startDeg = 0f, arcDeg = 90f)
            }
        }
    }
}

/** Fades this result in (and lifts it 2 % into scale) as the sweep reaches [at] (0–1 along it). One graphics layer. */
fun Modifier.scanReveal(sweep: ScanSweep, at: Float): Modifier = graphicsLayer {
    val v = sweep.reveal(at)
    alpha = v
    val s = .97f + .03f * v
    scaleX = s; scaleY = s
}
