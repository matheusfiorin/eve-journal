package com.echelon.eve.ui.motion

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloat
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
import androidx.compose.ui.graphics.drawscope.DrawScope
import com.echelon.eve.ui.theme.Echelon
import kotlin.math.PI
import kotlin.math.sin
import kotlin.random.Random

private class Star(val x: Float, val y: Float, val depth: Float, val size: Float, val phase: Float, val tint: Color)

/**
 * A slow parallax starfield for hero areas: three depths drifting left at different speeds, each star twinkling on its
 * own phase, over a faint accent nebula. Deterministic ([seed]) so screenshots are stable. With reduced motion (or
 * [animate] = false) it is a still image: nothing ticks, so it costs nothing per frame.
 */
@Composable
fun Starfield(modifier: Modifier = Modifier, seed: Int = 7, count: Int = 90, animate: Boolean = true, content: @Composable BoxScope.() -> Unit = {}) {
    val colors = Echelon.colors
    val stars = remember(seed, count) {
        val r = Random(seed)
        val tints = listOf(colors.text, colors.accentStrong, colors.info, Color(0xFFF0BB5C), Color(0xFF5CD3DE))
        List(count) { Star(r.nextFloat(), r.nextFloat(), listOf(.25f, .5f, 1f)[r.nextInt(3)], .6f + r.nextFloat() * 1.4f, r.nextFloat() * 2 * PI.toFloat(), if (r.nextInt(6) == 0) tints[r.nextInt(tints.size)] else colors.text) }
    }
    val moving = animate && !Echelon.reduceMotion && !androidx.compose.ui.platform.LocalInspectionMode.current
    val time: State<Float> = if (moving) {
        rememberInfiniteTransition(label = "starfield").animateFloat(0f, 1f, infiniteRepeatable(tween(90_000, easing = LinearEasing), RepeatMode.Restart), label = "drift")
    } else remember { mutableFloatStateOf(0f) }
    val nebula = colors.accent.copy(alpha = .10f)
    Box(modifier) {
        Canvas(Modifier.matchParentSize()) {
            drawRect(Brush.radialGradient(listOf(nebula, Color.Transparent), center = Offset(size.width * .78f, size.height * .2f), radius = size.maxDimension * .7f))
            drawStars(stars, time.value)
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
