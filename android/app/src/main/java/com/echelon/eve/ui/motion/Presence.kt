package com.echelon.eve.ui.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.LayoutDirection
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.LocalReduceMotion

// Wingmate presence. The other pilot is a moving thing on the board, so their marks move when they do:
//  - cometTrail: when their status changes (undocked, jumped, came online), the avatar or chip slides the last few dp
//    into place trailing a short comet of fading dots in their colour, so the eye catches what changed.
//  - pingRipple: when they call or acknowledge, two soft rings spread from the mark and fade.
// Both are one Animatable each, drawn behind the element with plain circles. Neither plays on the first composition
// (a screen that opens on a known status is not news). Reduced motion turns the trail into a still glow that fades,
// and the ripple into one fading ring with no travel; screenshots draw nothing.

/** A one-shot 0 → 1 clock that starts whenever [key] changes after the first composition. 1 means idle. */
@androidx.compose.runtime.Composable
internal fun rememberOneShot(key: Any?, durationMillis: Int, onStart: () -> Unit = {}): Animatable<Float, *> {
    val anim = remember { Animatable(1f) }
    val last = remember { arrayOf(key) }
    val still = LocalInspectionMode.current
    LaunchedEffect(key) {
        if (last[0] == key) return@LaunchedEffect
        last[0] = key
        if (still) return@LaunchedEffect
        onStart()
        anim.snapTo(0f)
        anim.animateTo(1f, tween(durationMillis, easing = LinearEasing))
    }
    return anim
}

/** The trail's dots at [p] (0–1): how far behind the head dot [k] of [n] sits, as a fraction of the trail. Pure, for tests. */
fun trailOffset(k: Int, n: Int, p: Float): Float = (k.toFloat() / n) * (1f - Easings.out.transform(p))

/**
 * A comet trail when [key] (the wingmate's status, say "in space · Tama") changes: the element slides the last 14 dp in
 * from the start side and a tail of six dots in [color] fades behind it over [Durations.trail].
 */
fun Modifier.cometTrail(key: Any?, color: Color, onTrail: () -> Unit = {}): Modifier = composed {
    val reduced = LocalReduceMotion.current
    val anim = rememberOneShot(key, Durations.trail, onTrail)
    val dir = if (androidx.compose.ui.platform.LocalLayoutDirection.current == LayoutDirection.Rtl) -1f else 1f
    this.graphicsLayer {
        val p = anim.value
        if (p < 1f && !reduced) {
            translationX = -dir * 14 * density * (1f - Easings.out.transform(p))
        }
    }.drawBehind {
        val p = anim.value
        if (p >= 1f) return@drawBehind
        if (reduced) { drawCircle(color.copy(alpha = .3f * (1f - p)), radius = size.minDimension * .9f); return@drawBehind }
        drawComet(p, color)
    }
}

private fun DrawScope.drawComet(p: Float, color: Color) {
    val dir = if (layoutDirection == LayoutDirection.Rtl) -1f else 1f
    val n = 6
    val r = size.height * .32f
    val length = size.height * 2.6f
    val cy = size.height / 2
    val headX = if (dir > 0) r else size.width - r
    val fade = 1f - p
    for (k in 1..n) {
        val x = headX - dir * length * trailOffset(k, n, p) - dir * k * r * .5f
        val shrink = 1f - k / (n + 1f)
        drawCircle(color.copy(alpha = .42f * fade * shrink), radius = r * shrink, center = Offset(x, cy))
    }
}

/** Two rings spreading from the element when [key] (the latest call or acknowledgement) changes. */
fun Modifier.pingRipple(key: Any?, color: Color, onPing: () -> Unit = {}): Modifier = composed {
    val reduced = LocalReduceMotion.current
    val anim = rememberOneShot(key, Durations.ripple, onPing)
    drawBehind {
        val p = anim.value
        if (p >= 1f) return@drawBehind
        val base = size.minDimension / 2
        if (reduced) { drawCircle(color.copy(alpha = .35f * (1f - p)), radius = base * 1.6f, style = Stroke(2f * density)); return@drawBehind }
        for (ring in 0..1) {
            val q = ((p - ring * .22f) / .78f).coerceIn(0f, 1f)
            if (q <= 0f || q >= 1f) continue
            val e = Easings.out.transform(q)
            drawCircle(color.copy(alpha = .55f * (1f - q)), radius = base * (1f + 2.2f * e), style = Stroke((2.5f - 1.5f * q) * density))
        }
    }
}
