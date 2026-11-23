package com.echelon.eve.corp

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.motion.dangerShimmer
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.LocalReduceMotion
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

// The pieces that make the Corp tab a station's operations console: liquid fuel gauges, the segmented health rings and
// the red pulse of a reinforced item. All of them stand still with reduced motion and in screenshots.

/** The colour of a health state: green, amber, red. */
@Composable
fun Health.color(): Color = Echelon.colors.let { when (this) { Health.Ok -> it.ok; Health.Low -> it.warn; Health.Reinforced -> it.danger } }

@Composable
private fun rememberStill() = LocalReduceMotion.current || LocalInspectionMode.current

/**
 * A fuel gauge as a tank of liquid lying on its side: the fill reaches [fraction] of the track along a surface that
 * ripples gently, and when [fraction] changes (a refuel, a new reading) the liquid sloshes past its level and settles.
 * [mark] draws a notch where the alert line is (24 h of 30 days is .033, 3 of 30 days is .1). A reinforced or empty
 * gauge simply sits at its level.
 */
@Composable
fun LiquidGauge(fraction: Float, color: Color, modifier: Modifier = Modifier, height: Dp = 22.dp, mark: Float? = null, label: String? = null) {
    val c = Echelon.colors
    val still = rememberStill()
    val target = fraction.coerceIn(0f, 1f)
    val level = remember { Animatable(if (still) target else 0f) }
    val slosh = remember { Animatable(0f) }
    val seen = remember { floatArrayOf(Float.NaN) }
    LaunchedEffect(target, still) {
        val first = seen[0].isNaN()
        val before = if (first) 0f else seen[0]
        seen[0] = target
        if (still) { level.snapTo(target); return@LaunchedEffect }
        // Level rises on a soft spring; the surface then keeps moving as a damped oscillation sized by how far it travelled.
        level.animateTo(target, spring(dampingRatio = .8f, stiffness = Spring.StiffnessLow))
        if (!first) { slosh.snapTo(((target - before) * 2.5f).coerceIn(-1f, 1f)); slosh.animateTo(0f, spring(dampingRatio = .22f, stiffness = Spring.StiffnessVeryLow)) }
    }
    // The surface's idle drift, at 30 fps and read only while drawing: one gauge per tower recomposing at 120 Hz was jank.
    val tide = com.echelon.eve.ui.motion.rememberAmbientClock(!still, periodMillis = 3200, fps = 30)
    Canvas(modifier.fillMaxWidth().height(height).semantics { contentDescription = label ?: "Fuel ${(target * 100).toInt()} percent" }) {
        val r = CornerRadius(size.height / 2)
        val track = Path().apply { addRoundRect(androidx.compose.ui.geometry.RoundRect(0f, 0f, size.width, size.height, r)) }
        drawPath(track, c.surfaceSunk)
        clipPath(track) {
            // Gauge ticks on the sunk track, every tenth.
            for (i in 1..9) { val x = size.width * i / 10; drawLine(c.line, Offset(x, size.height * .62f), Offset(x, size.height), 1f) }
            val w = size.width
            val x0 = (w * level.value + slosh.value * w * .035f).coerceIn(0f, w)
            if (level.value > .002f) {
                val amp = (1.4.dp.toPx() + abs(slosh.value) * 3.5.dp.toPx())
                val fill = Path().apply {
                    moveTo(0f, 0f); lineTo(x0, 0f)
                    // The leading surface: a vertical wave, so the tank reads as liquid pushed to one side.
                    val steps = 14
                    for (i in 0..steps) { val y = size.height * i / steps; lineTo(x0 + amp * sin(i * .9f + tide.value * 2f * PI.toFloat() + slosh.value * 3f), y) }
                    lineTo(0f, size.height); close()
                }
                drawPath(fill, Brush.horizontalGradient(listOf(color.copy(alpha = .75f), color), 0f, x0.coerceAtLeast(1f)))
                // A meniscus line and a faint sheen along the top: light on the surface.
                drawRect(Color.White.copy(alpha = .18f), Offset(0f, size.height * .12f), Size(x0, size.height * .16f))
                drawRect(lerp(color, Color.White, .55f).copy(alpha = .5f), Offset((x0 - 2.dp.toPx()).coerceAtLeast(0f), 0f), Size(2.dp.toPx(), size.height))
            }
        }
        if (mark != null) drawLine(c.text.copy(alpha = .8f), Offset(size.width * mark, -1f), Offset(size.width * mark, size.height * .45f), 1.5.dp.toPx(), cap = StrokeCap.Round)
        drawRoundRect(c.line, cornerRadius = r, style = Stroke(1.dp.toPx()))
    }
}

/**
 * A ring of the corporation's towers or structures: arcs for OK, low and reinforced in proportion, drawn clockwise
 * from the top. The arcs sweep in after [delayMillis] (give the second ring a later one for a stagger), and the red arc
 * breathes while anything is reinforced. The count sits in the middle.
 */
@Composable
fun HealthRing(count: HealthCount, label: String, modifier: Modifier = Modifier, size: Dp = 112.dp, stroke: Dp = 10.dp, delayMillis: Int = 0) {
    val c = Echelon.colors
    val still = rememberStill()
    val sweep = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(count, still) {
        if (still) sweep.snapTo(1f) else { if (sweep.value >= 1f) sweep.snapTo(0f); sweep.animateTo(1f, tween(Durations.boot - 100, delayMillis, Easings.emphasized)) }
    }
    val beat = if (still || count.reinforced == 0) null else rememberInfiniteTransition(label = "alarm").animateFloat(.45f, 1f, infiniteRepeatable(tween(780), RepeatMode.Reverse), label = "alpha")
    val parts = listOf(Health.Ok to count.ok, Health.Low to count.low, Health.Reinforced to count.reinforced)
    val words = parts.filter { it.second > 0 }.joinToString(", ") { (h, n) -> "$n ${h.name.lowercase()}" }.ifBlank { "none" }
    Box(modifier.size(size).semantics { contentDescription = "$label: $words" }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val w = stroke.toPx(); val inset = w / 2 + 2.dp.toPx()
            val arc = Size(this.size.width - inset * 2, this.size.height - inset * 2)
            drawArc(c.surface3, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
            // Tick marks around the dial: the instrument's bezel.
            for (i in 0 until 60) {
                val a = Math.toRadians(i * 6.0); val rad = this.size.width / 2; val len = if (i % 5 == 0) 5.dp.toPx() else 2.5.dp.toPx()
                val s = Offset(center.x + (rad - 1.dp.toPx()) * kotlin.math.cos(a).toFloat(), center.y + (rad - 1.dp.toPx()) * sin(a).toFloat())
                val e = Offset(center.x + (rad - 1.dp.toPx() - len) * kotlin.math.cos(a).toFloat(), center.y + (rad - 1.dp.toPx() - len) * sin(a).toFloat())
                drawLine(c.line, s, e, 1f)
            }
            if (count.total > 0) {
                val gap = if (parts.count { it.second > 0 } > 1) 5f else 0f
                val usable = 360f - gap * parts.count { it.second > 0 }
                var start = -90f
                val limit = -90f + 360f * sweep.value
                for ((h, n) in parts) {
                    if (n == 0) continue
                    val len = usable * n / count.total
                    val shown = (limit - start).coerceIn(0f, len)
                    if (shown > 0f) {
                        val col = when (h) { Health.Ok -> c.ok; Health.Low -> c.warn; Health.Reinforced -> c.danger.copy(alpha = beat?.value ?: 1f) }
                        drawArc(col.copy(alpha = col.alpha * .2f), start, shown, false, Offset(inset, inset), arc, style = Stroke(w * 2f, cap = StrokeCap.Butt))
                        drawArc(col, start, shown, false, Offset(inset, inset), arc, style = Stroke(w, cap = StrokeCap.Butt))
                    }
                    start += len + gap
                }
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            val small = size < 84.dp
            com.echelon.eve.ui.motion.AnimatedNumber(count.total.toDouble(), style = if (small) Echelon.type.num else Echelon.type.numLarge, color = c.text)
            if (!small) Text(label, style = Echelon.type.overline.copy(fontSize = 9.sp, letterSpacing = .08.em), color = c.textMuted)
        }
    }
}

/**
 * A reinforced item's alarm: a red wash and border that breathe (static when motion is reduced or [active] is false).
 * Draw-phase only, so a list of them costs no recomposition.
 */
@Composable
fun Modifier.reinforcedPulse(active: Boolean): Modifier {
    if (!active) return this
    val still = rememberStill()
    val beat = if (still) null else rememberInfiniteTransition(label = "pulse").animateFloat(.35f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "alpha")
    val red = Echelon.colors.danger
    // The wash breathes and, every few seconds, the shared danger sheen crosses the row (ui.motion.dangerShimmer).
    return dangerShimmer(true, red).drawBehind {
        val alpha = beat?.value ?: .85f // read while drawing: the pulse never recomposes
        drawRect(red.copy(alpha = .10f * alpha))
        drawRect(red.copy(alpha = alpha), Offset.Zero, Size(3.dp.toPx(), size.height))
    }
}

/** A tone for a health state, for tags and cards. */
fun Health.tone() = when (this) { Health.Ok -> Tone.Ok; Health.Low -> Tone.Warn; Health.Reinforced -> Tone.Danger }

/**
 * A deep link's landing: scrolls this item into view and lights its outline for a couple of seconds, so a tap on a
 * notification shows which tower or structure it meant. Draws the outline while [active]; reduced motion keeps it lit.
 */
@Composable
fun Modifier.deepLinkFocus(active: Boolean): Modifier {
    if (!active) return this
    val still = rememberStill()
    val request = remember { androidx.compose.foundation.relocation.BringIntoViewRequester() }
    val glow = remember { Animatable(1f) }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(350) // after the screen's entrance, so the scroll lands where the card ends up
        request.bringIntoView()
        if (!still) glow.animateTo(0f, tween(2400, 700, LinearEasing)) else glow.snapTo(.9f)
    }
    val accent = Echelon.colors.accent
    return this.bringIntoViewRequester(request).drawBehind {
        if (glow.value > 0f) drawRoundRect(accent.copy(alpha = glow.value), cornerRadius = CornerRadius(14.dp.toPx()), style = Stroke(2.dp.toPx()))
    }
}
