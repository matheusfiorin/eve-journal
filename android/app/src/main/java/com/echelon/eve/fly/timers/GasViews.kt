package com.echelon.eve.fly.timers

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.clock
import com.echelon.eve.ui.format.iskShort
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.motion.HapticMoment
import com.echelon.eve.ui.motion.Roll
import com.echelon.eve.ui.motion.RollingText
import com.echelon.eve.ui.motion.Springs
import com.echelon.eve.ui.motion.motionSpec
import com.echelon.eve.ui.motion.rememberAmbientClock
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.PI
import kotlin.math.sin

// The hero of a gas run: what the flying pilot's hold has in it right now, in units and ISK, ticking up per cycle, with a stream of
// particles flowing into the hold gauge and the time to whichever comes first, a full hold or the Sleepers. Everything that moves is
// drawn in the draw phase from one 24 fps clock (rememberAmbientClock) and a handful of Animatables, so a counting timer costs the
// composition nothing between cycles; the digits roll through RollingText when the number changes.

/** What the hero shows for a running gas timer: the estimate, the timer's name, and what EVE's ledger confirms (null: nothing yet). */
data class GasLive(val estimate: GasEstimate, val label: String = "Gas site", val confirmed: Long? = null, val owner: Pilot? = null, val timerId: String = "")

private fun units(n: Long): String = NumberFormat.getIntegerInstance(Locale.US).format(n)

/** "+410 units". */
fun unitsText(n: Long): String = "+${units(n)}"

/** "≈14.8M" for the value; "no price" when there is none. */
fun valueText(e: GasEstimate): String = if (e.price == null) "no price" else "≈${iskShort(e.value.toDouble())}"

/** "Hold full in 53 min", "Sleepers in 9:12": the first thing to happen, in words. */
fun nextText(e: GasEstimate): String? = e.next?.let { (hold, ms) -> if (hold) "Hold full in ${holdText(ms)}" else "Sleepers in ${clock(ms)}" }

private const val PARTICLES = 14

/**
 * The hold gauge: a bar that fills with [fill] on a spring, brand gradient from Ion to Flare, quarter ticks, and (while [live]) a
 * stream of small particles drifting into the head of the fill. A batch completing ([batch] changes) flashes the head. Nothing
 * allocates per frame: the particle constants are arrays made once, the brush once per size.
 */
@Composable
fun HoldGauge(fill: Float, live: Boolean, batch: Long, modifier: Modifier = Modifier, height: Dp = 18.dp) {
    val c = Echelon.colors
    val reduced = Echelon.reduceMotion
    val still = LocalInspectionMode.current
    val moving = live && !reduced && !still
    val shown = animateFloatAsState(fill.coerceIn(0f, 1f), motionSpec(Springs.value()), label = "hold fill")
    val time = rememberAmbientClock(moving, periodMillis = 2400, fps = 24)
    val flash = remember { Animatable(0f) }
    val first = remember { booleanArrayOf(true) }
    LaunchedEffect(batch) {
        if (first[0]) { first[0] = false; return@LaunchedEffect }
        if (moving) { flash.snapTo(1f); flash.animateTo(0f, tween(650)) }
    }
    // Fixed, tiny particle set: where each starts (0..1 along the stream), its lane, and whether it runs once or twice a loop.
    val seeds = remember { FloatArray(PARTICLES) { (it * 0.6180339f) % 1f } }
    val lanes = remember { FloatArray(PARTICLES) { ((it * 0.3819660f) + 0.17f) % 1f } }
    val track = c.surface3; val a = c.accent; val b = c.flare; val warn = c.warn; val bright = c.accentStrong
    Box(
        modifier.fillMaxWidth().height(height).semantics { contentDescription = "Hold ${(fill * 100).toInt()} percent full" }
            .drawWithCache {
                val corner = CornerRadius(size.height / 2)
                val brush = Brush.horizontalGradient(listOf(a, b), 0f, size.width)
                val hot = Brush.horizontalGradient(listOf(a, warn), 0f, size.width)
                val dot = size.height * .13f
                onDrawBehind {
                    drawRoundRect(track, cornerRadius = corner)
                    val p = shown.value
                    val w = size.width * p
                    if (w > 0f) {
                        val glow = a.copy(alpha = .22f)
                        drawRoundRect(glow, topLeft = Offset(0f, -2f), size = Size(w, size.height + 4f), cornerRadius = CornerRadius(size.height))
                        drawRoundRect(if (p > .85f) hot else brush, size = Size(w, size.height), cornerRadius = corner)
                        // The stream: particles start at the left edge of the fill and fall into its head.
                        val t = time.value
                        val head = w.coerceAtLeast(size.height)
                        for (i in 0 until PARTICLES) {
                            val u = (t * (1 + i % 2) + seeds[i]) % 1f
                            val y = size.height * (.22f + .56f * lanes[i])
                            val alpha = sin(PI.toFloat() * u) * .85f
                            drawCircle(Color.White.copy(alpha = alpha), dot * (.6f + .5f * lanes[i]), Offset(head * u, y))
                        }
                        val f = flash.value
                        if (f > 0f) drawCircle(bright.copy(alpha = .55f * f), size.height * (.7f + .9f * f), Offset(w - size.height / 2, size.height / 2))
                    }
                    // Quarter ticks, so the fill reads at a glance.
                    for (q in 1..3) drawRect(Color.Black.copy(alpha = .22f), Offset(size.width * q / 4f - .5f, size.height * .2f), Size(1f, size.height * .6f))
                }
            },
    )
}

/**
 * The hero card of a gas operation: the gas and where its price came from, "+410 units" and "≈14.8M" in large rolling digits,
 * the hold gauge, the time to the hold being full and to the Sleepers (the sooner one first), and EVE's confirmation when the mining
 * ledger has the gas. [onPick] (when given) opens the gas chips so the pilot can say which cloud this is.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GasHero(g: GasLive, modifier: Modifier = Modifier, running: Boolean = true, onPick: ((Fullerite) -> Unit)? = null) {
    val c = Echelon.colors
    val e = g.estimate
    var picking by rememberSaveable { mutableStateOf(false) }
    val sooner = e.next
    val hurry = sooner != null && !sooner.first && sooner.second < 2 * MIN
    EchelonCard(modifier.animateContentSize(), tone = if (hurry) Tone.Warn else Tone.Accent) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(EchelonIcons.Gauge, null, Modifier.size(18.dp), tint = c.accentStrong)
            Row(Modifier.weight(1f).then(if (onPick != null) Modifier.clickable { picking = !picking } else Modifier), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(e.gas.title, style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1)
                if (onPick != null) Text(if (picking) "▴" else "▾", style = Echelon.type.label, color = c.textMuted)
            }
            Tag(e.price?.source?.label ?: "No price yet", tone = if (e.price == null) Tone.Warn else Tone.Info)
        }
        AnimatedVisibility(picking && onPick != null) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Fullerite.entries.forEach { f -> ChoiceChip(f.short, selected = f == e.gas, onClick = { onPick?.invoke(f); picking = false }) }
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.Bottom) {
                RollingText(unitsText(e.units), Echelon.type.numLarge.copy(fontSize = 34.sp, lineHeight = 38.sp, color = c.text), direction = Roll.Up)
                Text(" units", style = MaterialTheme.typography.bodyMedium, color = c.textMuted, modifier = Modifier.padding(bottom = 4.dp))
            }
            RollingText(valueText(e), Echelon.type.numLarge.copy(fontSize = 26.sp, lineHeight = 32.sp, color = c.accentStrong), direction = Roll.Up)
        }
        HoldGauge(e.fill, live = running && !e.holdFull, batch = e.batches)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Hold ${(e.fill * 100).toInt()}% · ${units((e.m3 + .5).toLong())} of ${units((e.holdM3 + .5).toLong())} m³", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            nextText(e)?.let { Text(it, style = Echelon.type.num.copy(fontSize = 14.sp), color = if (hurry) c.warn else c.accentStrong, maxLines = 1) }
                ?: Text(if (e.holdFull) "Hold full" else "Done", style = Echelon.type.num.copy(fontSize = 14.sp), color = c.textMuted)
        }
        // The other clock too, so both are in view: whichever is sooner is the one above.
        if (e.holdFullInMs != null && e.timerEndInMs != null) {
            val other = if (sooner?.first == true) "Sleepers in ${clock(e.timerEndInMs)}" else "Hold full in ${holdText(e.holdFullInMs)}"
            Text(other, style = Echelon.type.label, color = c.textFaint)
        }
        g.confirmed?.let { n ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(EchelonIcons.Check, null, Modifier.size(14.dp), tint = c.ok)
                Text("EVE confirms ${units(n)} units", style = Echelon.type.label, color = c.ok)
            }
        }
    }
}

/** A one-line version for tight places (the timer board, the picture-in-picture): "Fullerite-C320 · +410 units · ≈14.8M". */
fun gasLine(e: GasEstimate): String = "${e.gas.title} · ${unitsText(e.units)} units · ${valueText(e)}"

/** The gas chips of the start form: which cloud the site has, the last one used first selected. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GasChips(selected: Fullerite, onPick: (Fullerite) -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text("Which gas is in the site? ${selected.title}, ${units(selected.volume.toLong())} m³ a unit", style = MaterialTheme.typography.titleSmall, color = c.text)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Fullerite.entries.forEach { f -> ChoiceChip(f.short, selected = f == selected, onClick = { onPick(f) }) }
        }
    }
}

/** Plays a soft confirm when the hold fills or the gas run ends, so a glance away from the screen still knows. */
@Composable
fun GasHaptics(e: GasEstimate?) {
    val haptics = rememberHaptics()
    val full = e?.holdFull == true
    val first = remember { booleanArrayOf(true) }
    LaunchedEffect(full) { if (first[0]) first[0] = false else if (full) haptics.play(HapticMoment.Warning) }
}

/** The lower-corner dot of a pilot's colour that breathes while live: used by the operation rows. */
@Composable
fun LiveDot(color: Color, live: Boolean, modifier: Modifier = Modifier, size: Dp = 10.dp) {
    val moving = live && !Echelon.reduceMotion && !LocalInspectionMode.current
    val t = rememberAmbientClock(moving, periodMillis = 1600, fps = 20)
    Box(modifier.size(size * 2).drawBehind {
        val r = this.size.minDimension / 4
        val p = t.value
        if (live) drawCircle(color.copy(alpha = (if (moving) .5f * (1f - p) else .28f)), r + r * 1.4f * (if (moving) p else .6f))
        drawCircle(color, r)
    })
}

/** A pilot's mark colour. */
fun pilotColor(id: Long): Color = PilotColors.of(id).color

