package com.echelon.eve.ui.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.LocalInspectionMode
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.LocalReduceMotion
import com.echelon.eve.ui.theme.PilotColors
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

// Celebratory micro-moments and live pulses. Both draw over (or behind) the element they modify, so they never move
// layout, and both are off in screenshots. Reduced motion turns the burst into a single soft flash with no travel.

private class Spark(val angle: Float, val speed: Float, val spin: Float, val size: Float, val color: Color, val dart: Boolean)

/**
 * A one-shot burst when [fire] turns true (a timer reaching zero, a goal completed): the formation's darts and sparks
 * in both pilots' colours and the brand gradient fly out from the centre and fall away, with a ring and a confirm
 * haptic. It does not play when the element first appears already done. [key] restarts it (a new timer, a new goal).
 */
fun Modifier.celebrate(fire: Boolean, key: Any? = null, haptic: Boolean = true): Modifier = composed {
    val still = LocalInspectionMode.current
    val reduced = LocalReduceMotion.current
    val c = Echelon.colors
    val haptics = rememberHaptics()
    val progress = remember(key) { Animatable(1f) }
    val wasFired = remember(key) { booleanArrayOf(fire) }
    val sparks = remember(key) {
        val r = Random(key?.hashCode() ?: 3)
        val palette = listOf(PilotColors.Fiofka.color, PilotColors.Decxus.color, c.accent, c.flare, c.ok)
        List(26) { i -> Spark((i / 26f) * 2 * PI.toFloat() + r.nextFloat() * .3f, .55f + r.nextFloat() * .65f, r.nextFloat() * 720f - 360f, 3f + r.nextFloat() * 3f, palette[i % palette.size], i % 3 == 0) }
    }
    LaunchedEffect(fire, key) {
        val rising = fire && !wasFired[0]
        wasFired[0] = fire
        if (!rising || still) return@LaunchedEffect
        if (haptic) haptics.confirm()
        progress.snapTo(0f)
        progress.animateTo(1f, tween(if (reduced) Durations.medium else Durations.celebrate, easing = LinearEasing))
    }
    drawWithContent {
        drawContent()
        val t = progress.value
        if (t >= 1f) return@drawWithContent
        if (reduced) { drawCircle(c.accent.copy(alpha = .35f * (1f - t)), radius = size.minDimension * .6f); return@drawWithContent }
        drawBurst(t, sparks, c.accent)
    }
}

private val dartPath = Path().apply { moveTo(0f, -1f); lineTo(.8f, .8f); lineTo(0f, .35f); lineTo(-.8f, .8f); close() }

private fun DrawScope.drawBurst(t: Float, sparks: List<Spark>, ring: Color) {
    val centre = center
    val reach = size.minDimension * .5f + 48f * density
    val ease = Easings.out.transform(t)
    // The ring: expands fast, fades as it goes.
    drawCircle(ring.copy(alpha = .5f * (1f - t)), radius = reach * ease * .9f, center = centre, style = Stroke(2f * density * (1f - t) + .5f))
    val fade = if (t < .6f) 1f else 1f - (t - .6f) / .4f
    for (s in sparks) {
        val d = reach * s.speed * ease
        val fall = 60f * density * t * t // a little gravity
        val p = Offset(centre.x + cos(s.angle) * d, centre.y + sin(s.angle) * d + fall)
        val col = s.color.copy(alpha = fade.coerceIn(0f, 1f))
        if (s.dart) translate(p.x, p.y) {
            rotate(s.spin * t + s.angle * 57.3f + 90f, pivot = Offset.Zero) {
                val k = s.size * density * 1.4f
                scale(k, k, pivot = Offset.Zero) { drawPath(dartPath, col) }
            }
        } else drawCircle(col, radius = s.size * density * .5f * (1f - t * .5f), center = p)
    }
}

/** The burst frozen at [progress] (0–1), for the design catalog and docs: what [celebrate] looks like mid-flight. */
@androidx.compose.runtime.Composable
fun CelebrationFrame(progress: Float, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    val sparks = remember {
        val r = Random(3)
        val palette = listOf(PilotColors.Fiofka.color, PilotColors.Decxus.color, c.accent, c.flare, c.ok)
        List(26) { i -> Spark((i / 26f) * 2 * PI.toFloat() + r.nextFloat() * .3f, .55f + r.nextFloat() * .65f, r.nextFloat() * 720f - 360f, 3f + r.nextFloat() * 3f, palette[i % palette.size], i % 3 == 0) }
    }
    androidx.compose.foundation.Canvas(modifier) { drawBurst(progress, sparks, c.accent) }
}

/**
 * A soft halo that breathes around something live (the sync beacon, a timer about to end). [color] is the halo; the
 * halo reaches [spread] × the element's size. Off when not [active], with reduced motion and in screenshots, where it
 * draws a still glow instead so the live thing still reads as live.
 */
fun Modifier.pulse(active: Boolean, color: Color, spread: Float = 1.9f, periodMillis: Int = 1800): Modifier = composed {
    if (!active) return@composed this
    val moving = !LocalReduceMotion.current && !LocalInspectionMode.current
    val t: State<Float> = if (moving) rememberInfiniteTransition(label = "pulse").animateFloat(0f, 1f, infiniteRepeatable(tween(periodMillis, easing = LinearEasing), RepeatMode.Restart), label = "halo")
    else remember { mutableFloatStateOf(.35f) }
    drawWithContent {
        val p = t.value
        val r = size.minDimension / 2
        drawCircle(color.copy(alpha = .45f * (1f - p)), radius = r + r * (spread - 1f) * p)
        drawContent()
    }
}
