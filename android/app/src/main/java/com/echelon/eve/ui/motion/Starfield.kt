package com.echelon.eve.ui.motion

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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.drawscope.translate
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

private class Star(val x: Float, val y: Float, val depth: Float, val size: Float, val phase: Float, val tint: Color)

/**
 * The Formation backdrop for hero areas: three depths of stars drifting left, each twinkling on its own phase, over two
 * slow nebula glows (Ion and Flare) that breathe and wander, and now and then a pair of streaks crossing in echelon,
 * the brand's motif. Deterministic ([seed]) so screenshots are stable. A 20 fps ambient clock drives it all (rememberAmbientClock)
 * and draws ~100 circles a frame; with reduced motion, [animate] = false or in screenshots it is a still image that costs
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
    // The drift takes 90 s and a twinkle several seconds: 20 frames a second is indistinguishable from 120, and the
    // backdrop covers the screen, so drawing it at the display rate (120 Hz on an S25 Ultra) cost real frame time.
    val time: State<Float> = rememberAmbientClock(moving, periodMillis = 90_000, fps = 20)
    val ion = colors.accent.copy(alpha = .16f)
    val flare = colors.flare.copy(alpha = .08f)
    val streak = colors.accentStrong
    val phase = (seed % 5) / 5f
    Box(modifier) {
        Spacer(Modifier.matchParentSize().drawWithCache {
            // The nebula gradients are built once per size and moved with a translate, instead of rebuilt every frame.
            val r1 = size.maxDimension * .7f; val r2 = size.maxDimension * .5f
            val ionBrush = Brush.radialGradient(listOf(ion, Color.Transparent), center = Offset.Zero, radius = r1)
            val flareBrush = Brush.radialGradient(listOf(flare, Color.Transparent), center = Offset.Zero, radius = r2)
            onDrawBehind {
                val t = time.value
                val w = 2 * PI.toFloat() * t
                // Two nebulae on slow Lissajous paths: a few percent of the width over minutes, never distracting.
                val c1 = Offset(size.width * (.8f + .05f * sin(w * 3)), size.height * (.15f + .06f * cos(w * 2)))
                val c2 = Offset(size.width * (.12f + .05f * cos(w * 2)), size.height * (.95f + .05f * sin(w * 3)))
                translate(c1.x, c1.y) { drawRect(ionBrush, topLeft = Offset(-c1.x, -c1.y), size = size) }
                translate(c2.x, c2.y) { drawRect(flareBrush, topLeft = Offset(-c2.x, -c2.y), size = size) }
                drawStars(stars, t)
                if (moving) drawEchelonStreaks(t, phase, streak)
            }
        })
        content()
    }
}

/**
 * A 0–1 phase over [periodMillis] that advances only [fps] times a second, for ambient motion (backdrops, slow drifts)
 * that doesn't need the display's full refresh rate. Still at 0 when not [moving].
 */
@Composable
fun rememberAmbientClock(moving: Boolean, periodMillis: Int, fps: Int = 20): State<Float> {
    val phase = remember { mutableFloatStateOf(0f) }
    if (moving) LaunchedEffect(periodMillis, fps) {
        val step = (1000L / fps).coerceAtLeast(1)
        val start = withFrameMillis { it }
        while (true) {
            delay(step)
            withFrameMillis { now -> phase.floatValue = ((now - start) % periodMillis) / periodMillis.toFloat() }
        }
    }
    return phase
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
