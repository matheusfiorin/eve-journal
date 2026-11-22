package com.echelon.eve.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.motion.Springs
import com.echelon.eve.ui.motion.motionSpec
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.LocalReduceMotion

/** A one-shot sheen (0 → 1) that plays when [complete] turns true while on screen; 1 means "not playing". */
@Composable
private fun rememberCompletionSheen(complete: Boolean): Float {
    val sheen = remember { Animatable(1f) }
    val was = remember { booleanArrayOf(complete) }
    val still = LocalReduceMotion.current || LocalInspectionMode.current
    LaunchedEffect(complete) {
        val rising = complete && !was[0]; was[0] = complete
        if (rising && !still) { sheen.snapTo(0f); sheen.animateTo(1f, tween(Durations.long + 200, delayMillis = 250, easing = Easings.inOut)) }
    }
    return sheen.value
}

/**
 * A 6 dp bar on surface-3: animates to [progress] (0–1) on a spring, with a soft glow under the fill. The default
 * accent fill warms from Ion toward Flare along its length (the brand gradient); a given [color] is used flat. When it
 * reaches 1 while on screen, a sheen runs along it once (a goal met, a job delivered).
 */
@Composable
fun ProgressBar(progress: Float, modifier: Modifier = Modifier, color: Color = Echelon.colors.accent, track: Color = Echelon.colors.surface3, height: Dp = 6.dp) {
    val c = Echelon.colors
    val target = progress.coerceIn(0f, 1f)
    val p by animateFloatAsState(target, motionSpec(Springs.value()), label = "progress")
    val sheen = rememberCompletionSheen(target >= 1f)
    val brand = color == c.accent
    Canvas(modifier.fillMaxWidth().height(height).semantics { progressBarRangeInfo = ProgressBarRangeInfo(target, 0f..1f) }) {
        val r = CornerRadius(size.height / 2)
        drawRoundRect(track, cornerRadius = r)
        if (p > 0f) {
            val w = size.width * p
            val fill = if (brand) Brush.horizontalGradient(listOf(color, lerp(color, c.flare, .55f * p)), 0f, w) else Brush.horizontalGradient(listOf(color, color))
            drawRoundRect(color.copy(alpha = .22f), topLeft = Offset(0f, -2f), size = Size(w, size.height + 4f), cornerRadius = CornerRadius(size.height))
            drawRoundRect(fill, size = Size(w, size.height), cornerRadius = r)
            if (sheen < 1f) {
                val x = -w * .3f + sheen * w * 1.6f
                drawRoundRect(Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = .7f), Color.Transparent), x - w * .15f, x + w * .15f), size = Size(w, size.height), cornerRadius = r)
            }
        }
    }
}

/**
 * A ring (skill training, fuel left, cycle progress): [progress] 0–1 drawn clockwise from the top, with [content] in the
 * middle (a figure or a countdown). The arc's head carries a small bright cap, like a plotted position.
 */
@Composable
fun ProgressRing(progress: Float, modifier: Modifier = Modifier, size: Dp = 64.dp, stroke: Dp = 5.dp, color: Color = Echelon.colors.accent, track: Color = Echelon.colors.surface3, content: @Composable BoxScope.() -> Unit = {}) {
    val p by animateFloatAsState(progress.coerceIn(0f, 1f), motionSpec(Springs.value()), label = "ring")
    Box(modifier.size(size).semantics { progressBarRangeInfo = ProgressBarRangeInfo(progress.coerceIn(0f, 1f), 0f..1f) }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val w = stroke.toPx(); val inset = w / 2; val arc = Size(this.size.width - w, this.size.height - w)
            drawArc(track, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
            if (p > 0f) {
                drawArc(color.copy(alpha = .18f), -90f, 360f * p, false, Offset(inset, inset), arc, style = Stroke(w * 2.2f, cap = StrokeCap.Round))
                drawArc(color, -90f, 360f * p, false, Offset(inset, inset), arc, style = Stroke(w, cap = StrokeCap.Round))
                if (p < 1f) {
                    val a = Math.toRadians((-90.0 + 360.0 * p)); val rad = arc.width / 2
                    drawCircle(Color.White.copy(alpha = .85f), radius = w * .32f, center = Offset(center.x + (rad * kotlin.math.cos(a)).toFloat(), center.y + (rad * kotlin.math.sin(a)).toFloat()))
                }
            }
        }
        content()
    }
}
