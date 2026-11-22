package com.echelon.eve.ui.motion

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalInspectionMode
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

private class Star(val x: Float, val y: Float, val depth: Float, val size: Float, val phase: Float, val tint: Color)

/**
 * The Formation backdrop for hero areas: three depths of stars drifting left, each twinkling on its own phase, over two
 * slow nebula glows (Ion and Flare) that breathe and wander, and now and then a pair of streaks crossing in echelon,
 * the brand's motif. Deterministic ([seed]) so screenshots are stable. One infinite transition drives it all and
 * draws ~100 circles a frame; with reduced motion, [animate] = false or in screenshots it is a still image that costs
 * nothing per frame.
 */
@Composable
fun Starfield(modifier: Modifier = Modifier, seed: Int = 7, count: Int = 90, animate: Boolean = true, content: @Composable BoxScope.() -> Unit = {}) {
    val colors = Echelon.colors
    val stars = remember(seed, count) {
        val r = Random(seed)
        val tints = listOf(colors.text, colors.accentStrong, colors.info, PilotColors.Fiofka.color, PilotColors.Decxus.color)
        List(count) { Star(r.nextFloat(), r.nextFloat(), listOf(.25f, .5f, 1f)[r.nextInt(3)], .6f + r.nextFloat() * 1.4f, r.nextFloat() * 2 * PI.toFloat(), if (r.nextInt(6) == 0) tints[r.nextInt(tints.size)] else colors.text) }
    }
    val moving = animate && !Echelon.reduceMotion && !LocalInspectionMode.current
    val time: State<Float> = if (moving) {
        rememberInfiniteTransition(label = "starfield").animateFloat(0f, 1f, infiniteRepeatable(tween(90_000, easing = LinearEasing), RepeatMode.Restart), label = "drift")
    } else remember { mutableFloatStateOf(0f) }
    val ion = colors.accent.copy(alpha = .16f)
    val flare = colors.flare.copy(alpha = .08f)
    val streak = colors.accentStrong
    val phase = (seed % 5) / 5f
    Box(modifier) {
        Canvas(Modifier.matchParentSize()) {
            val t = time.value
            val w = 2 * PI.toFloat() * t
            // Two nebulae on slow Lissajous paths: a few percent of the width over minutes, never distracting.
            drawRect(Brush.radialGradient(listOf(ion, Color.Transparent), center = Offset(size.width * (.8f + .05f * sin(w * 3)), size.height * (.15f + .06f * cos(w * 2))), radius = size.maxDimension * .7f))
            drawRect(Brush.radialGradient(listOf(flare, Color.Transparent), center = Offset(size.width * (.12f + .05f * cos(w * 2)), size.height * (.95f + .05f * sin(w * 3))), radius = size.maxDimension * .5f))
            drawStars(stars, t)
            if (moving) drawEchelonStreaks(t, phase, streak)
        }
        content()
    }
}

private fun DrawScope.drawStars(stars: List<Star>, t: Float) {
    for (s in stars) {
        // Drift: the nearest layer crosses the width once per cycle, the farthest a quarter of it.
        val x = ((s.x - t * s.depth) % 1f + 1f) % 1f
        val twinkle = .55f + .45f * sin(s.phase + t * 2 * PI.toFloat() * 24 * s.depth)
        drawCircle(s.tint.copy(alpha = (.25f + .6f * s.depth) * twinkle), radius = s.size * density * (.5f + s.depth * .5f), center = Offset(x * size.width, s.y * size.height))
    }
}

/** Twice per cycle (every 45 s), two streaks cross the hero in echelon: lead and wingman, stepped back and down. */
private fun DrawScope.drawEchelonStreaks(t: Float, phase: Float, color: Color) {
    val local = ((t + phase) * 2f) % 1f
    val window = .035f // ~1.6 s of the 45 s period
    if (local > window) return
    val p = local / window
    val len = size.width * .18f
    for (i in 0..1) {
        val headX = -len + (size.width + 2 * len) * p - i * 28f * density
        val headY = size.height * (.22f + i * .1f) + (headX * .18f)
        val tail = Offset(headX - len, headY - len * .18f)
        val a = (1f - kotlin.math.abs(p * 2 - 1)) * (if (i == 0) .7f else .5f)
        drawLine(Brush.linearGradient(listOf(Color.Transparent, color.copy(alpha = a)), tail, Offset(headX, headY)), tail, Offset(headX, headY), strokeWidth = 1.5f * density, cap = StrokeCap.Round)
    }
}
