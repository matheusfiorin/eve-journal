package com.echelon.eve.fly.timers

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector2D
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.round
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SolarSystem
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.RollingText
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.clock
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.secColor
import com.echelon.eve.ui.format.secLabel
import com.echelon.eve.ui.format.secText
import com.echelon.eve.ui.motion.Springs
import com.echelon.eve.ui.motion.motionSpec
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

// The Timers screen's pictures: the horizon strip (every running timer on one time axis), the jump radar (the systems
// with timers around the one you are in, by jumps), the system cards with a ring per timer, and the motion they share
// (rings sweeping, cards sliding when the order changes, a burst when a timer ends). Reduced motion keeps the end states.

/**
 * Slides a child to its new place when the parent reorders (keyed children of a Column). The first placement is where
 * it lands, without travel; reduced motion and previews never move.
 */
fun Modifier.animatePlacement(): Modifier = composed {
    if (Echelon.reduceMotion || LocalInspectionMode.current) return@composed this
    val scope = rememberCoroutineScope()
    var target by remember { mutableStateOf<IntOffset?>(null) }
    var anim by remember { mutableStateOf<Animatable<IntOffset, AnimationVector2D>?>(null) }
    this.onPlaced { target = it.positionInParent().round() }.offset {
        val t = target ?: return@offset IntOffset.Zero
        val a = anim ?: Animatable(t, IntOffset.VectorConverter).also { anim = it }
        if (a.targetValue != t) scope.launch { a.animateTo(t, spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow)) }
        a.value - t
    }
}

/** The colour a timer wears: its owner's pilot colour. */
internal fun ownerColor(t: WingTimer): Color = PilotColors.of(t.owner).color

// ---- the horizon strip ----

/** Puts labels at [xs] (0–1, sorted or not) into lanes so none closer than [gap] share one; at most [lanes] lanes. */
fun labelLanes(xs: List<Float>, gap: Float, lanes: Int = 3): List<Int> {
    val last = FloatArray(lanes) { -1f }
    val out = IntArray(xs.size)
    xs.withIndex().sortedBy { it.value }.forEach { (i, x) ->
        val lane = (0 until lanes).firstOrNull { last[it] < 0f || x - last[it] >= gap } ?: (0 until lanes).minBy { last[it] }
        out[i] = lane; last[lane] = x
    }
    return out.toList()
}

/**
 * Every running timer on one axis from now to the horizon (square-root time, so a mining cycle and a despawn both
 * read), each a dot in its owner's colour with the system it is in. Dots slide toward now as time passes.
 */
@Composable
fun HorizonStrip(timers: Collection<WingTimer>, now: Long, systems: Map<Long, SolarSystem>, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    val running = timers.filter { it.running(now) }.sortedBy { it.endsAt }
    val paused = timers.count { it.pausedAt != null }
    val span = horizonSpan(timers, now)
    val spanX by animateFloatAsState(span.toFloat(), motionSpec(Springs.value()), label = "span")
    val xs = running.map { t -> key(t.id) { animateFloatAsState(horizonX(t.remaining(now), spanX.toLong().coerceAtLeast(MIN)), motionSpec(Springs.value()), label = "horizon ${t.id}") } }
    val measurer = rememberTextMeasurer()
    val tickStyle = Echelon.type.numSmall.copy(color = c.textFaint)
    val labelStyle = Echelon.type.chip
    val places = running.map { t -> t.systemNameIn(systems) }
    val placeStyle = Echelon.type.chip.copy(color = c.textFaint)
    val lanes = labelLanes(running.map { horizonX(it.remaining(now), span) }, gap = .24f)
    val spoken = if (running.isEmpty()) "Nothing counting down" else running.joinToString("; ") { "${it.title(systems)} in ${duration(it.remaining(now) / 1000.0)}" }
    EchelonCard(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Horizon", style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f))
            Text("next ${short(span)}" + if (paused > 0) " · $paused paused" else "", style = Echelon.type.label, color = c.textMuted)
        }
        Canvas(Modifier.fillMaxWidth().height(118.dp).semantics { contentDescription = spoken }) {
            val left = 6.dp.toPx(); val right = size.width - 14.dp.toPx(); val w = right - left
            val axisY = size.height - 22.dp.toPx()
            drawLine(c.lineStrong, Offset(left, axisY), Offset(right, axisY), 1.dp.toPx())
            // now: a filled notch at the left end
            drawCircle(c.accent, 3.dp.toPx(), Offset(left, axisY))
            horizonTicks(span).forEach { tick ->
                val x = left + w * horizonX(tick, span)
                drawLine(c.tick, Offset(x, axisY - 4.dp.toPx()), Offset(x, axisY + 4.dp.toPx()), 1.dp.toPx())
                val text = measurer.measure(short(tick), tickStyle)
                drawText(text, topLeft = Offset((x - text.size.width / 2f).coerceIn(0f, size.width - text.size.width), axisY + 6.dp.toPx()))
            }
            running.forEachIndexed { i, t ->
                val x = left + w * xs[i].value
                val col = ownerColor(t)
                // Two lines per label (what, then where); lanes stack upward so neighbours don't collide.
                val laneY = axisY - 40.dp.toPx() - lanes[i] * 26.dp.toPx()
                drawLine(col.copy(alpha = .5f), Offset(x, laneY + 24.dp.toPx()), Offset(x, axisY), 1.dp.toPx())
                val r = (3.5f + 3f * urgency(t, now)).dp.toPx()
                drawCircle(col.copy(alpha = .25f), r * 1.9f, Offset(x, axisY))
                drawCircle(col, r, Offset(x, axisY))
                val max = androidx.compose.ui.unit.Constraints(maxWidth = (w * .3f).toInt())
                val text = measurer.measure(t.label, labelStyle.copy(color = col), maxLines = 1, overflow = TextOverflow.Ellipsis, constraints = max)
                drawText(text, topLeft = Offset((x - text.size.width / 2f).coerceIn(0f, size.width - text.size.width), laneY))
                places[i]?.let { where ->
                    val p = measurer.measure(where, placeStyle, maxLines = 1, overflow = TextOverflow.Ellipsis, constraints = max)
                    drawText(p, topLeft = Offset((x - p.size.width / 2f).coerceIn(0f, size.width - p.size.width), laneY + text.size.height))
                }
            }
        }
    }
}

// ---- the jump radar ----

/** A point on the radar: a system with timers (or a pilot) at [jumps] from the centre. */
data class RadarNode(val systemId: Long, val name: String, val sec: Double?, val jumps: Int, val timers: List<WingTimer>, val wingmate: Boolean)

/** The radar's points: every system on the board with a known distance (not your own: it is the centre), nearest first. */
fun radarNodes(groups: List<SystemGroup>, systems: Map<Long, SolarSystem>, wingmateAt: Long?, jumps: Map<Long, Int>): List<RadarNode> {
    val withTimers = groups.filter { it.systemId != null && !it.here && it.jumps != null }.map {
        RadarNode(it.systemId!!, it.name ?: "System ${it.systemId}", systems[it.systemId]?.sec, it.jumps!!, it.timers, it.wingmateHere)
    }
    val mate = wingmateAt?.takeIf { id -> withTimers.none { it.systemId == id } && jumps[id]?.let { it > 0 } == true }?.let { id ->
        RadarNode(id, systems[id]?.name ?: "System $id", systems[id]?.sec, jumps.getValue(id), emptyList(), wingmate = true)
    }
    return (withTimers + listOfNotNull(mate)).sortedWith(compareBy({ it.jumps }, { it.name }))
}

/** Where the radar puts node [i] of [n]: an angle (radians, 0 = up, clockwise), spread evenly from the top. */
fun radarAngle(i: Int, n: Int): Double = if (n <= 0) 0.0 else 2 * PI * i / n + if (n == 2) PI / 2 else 0.0

/**
 * The systems with timers around the one you are in: the centre is you, each ring a few jumps out, each system a dot in
 * its security colour wrapped in the ring of its next timer (owner's colour, sweeping as it counts down), larger the
 * sooner it ends. The wingmate's system carries their colour.
 */
@Composable
fun JumpRadar(here: SystemGroup?, nodes: List<RadarNode>, now: Long, wingmate: Pilot?, modifier: Modifier = Modifier, onPick: (Long) -> Unit = {}) {
    val c = Echelon.colors
    val measurer = rememberTextMeasurer()
    val maxJumps = max(3, nodes.maxOfOrNull { it.jumps } ?: 3)
    val reach by animateFloatAsState(maxJumps.toFloat(), motionSpec(Springs.value()), label = "radar reach")
    val nameStyle = Echelon.type.chip.copy(color = c.text)
    val jumpStyle = Echelon.type.numSmall.copy(color = c.textFaint)
    val sweeps = nodes.map { n -> key(n.systemId) { animateFloatAsState(n.timers.firstOrNull { it.running(now) }?.let { 1f - it.progress(now) } ?: 0f, motionSpec(Springs.value()), label = "radar ${n.systemId}") } }
    val mateColor = wingmate?.let { PilotColors.of(it.id).color } ?: c.accent
    val spoken = nodes.joinToString("; ") { "${it.name}, ${jumpsText(it.jumps)}, ${it.timers.size} timers" }
    EchelonCard(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Jump radar", style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f))
            Text("rings every ${ringStep(maxJumps)} j", style = Echelon.type.label, color = c.textMuted)
        }
        BoxWithConstraints(Modifier.fillMaxWidth().height(232.dp)) {
            val wPx = constraints.maxWidth.toFloat()
            Canvas(Modifier.fillMaxWidth().height(232.dp).semantics { contentDescription = "Jump radar: $spoken" }) {
                val centre = Offset(size.width / 2, size.height / 2)
                val radius = min(size.width, size.height) / 2 - 22.dp.toPx()
                val step = ringStep(maxJumps)
                var j = step
                while (j <= reach + .01f) {
                    val r = radarRadius(j.toFloat(), reach, 30.dp.toPx(), radius)
                    drawCircle(c.line, r, centre, style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx()))))
                    val label = measurer.measure("${j}j", jumpStyle)
                    // the ring's figure up and to the left, between the points (they spread from the top, clockwise)
                    drawText(label, topLeft = Offset(centre.x - r * .7071f - label.size.width, centre.y - r * .7071f - label.size.height * .8f))
                    j += step
                }
                nodes.forEachIndexed { i, n ->
                    val a = radarAngle(i, nodes.size)
                    val r = radarRadius(n.jumps.coerceAtMost(maxJumps).toFloat(), reach, 30.dp.toPx(), radius)
                    val p = Offset(centre.x + (r * sin(a)).toFloat(), centre.y - (r * cos(a)).toFloat())
                    drawLine(c.lineStrong.copy(alpha = .6f), centre, p, 1.dp.toPx())
                    val next = n.timers.firstOrNull { it.running(now) }
                    val u = next?.let { urgency(it, now) } ?: 0f
                    val dot = (5f + 5f * u).dp.toPx()
                    if (n.wingmate) drawCircle(mateColor.copy(alpha = .22f), dot + 9.dp.toPx(), p)
                    drawCircle(n.sec?.let(::secColor) ?: c.textFaint, dot, p)
                    val ringR = dot + 4.dp.toPx()
                    drawCircle(c.surface3, ringR, p, style = Stroke(2.5.dp.toPx()))
                    if (next != null) drawArc(ownerColor(next), -90f, 360f * sweeps[i].value, false, Offset(p.x - ringR, p.y - ringR), Size(ringR * 2, ringR * 2), style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round))
                    else if (n.timers.any { it.done(now) }) drawCircle(c.ok, ringR, p, style = Stroke(2.5.dp.toPx()))
                    val text = measurer.measure(n.name, nameStyle.copy(color = if (n.wingmate) mateColor else c.text), maxLines = 1)
                    val below = p.y + ringR + 2.dp.toPx()
                    drawText(text, topLeft = Offset((p.x - text.size.width / 2f).coerceIn(0f, wPx - text.size.width), if (below + text.size.height > size.height) p.y - ringR - text.size.height - 2.dp.toPx() else below))
                }
                // you, at the centre
                drawCircle(c.accent.copy(alpha = .18f), 16.dp.toPx(), centre)
                drawCircle(c.accent, 6.dp.toPx(), centre)
                val you = measurer.measure(here?.name ?: "You", nameStyle.copy(color = c.accentStrong), maxLines = 1)
                drawText(you, topLeft = Offset(centre.x - you.size.width / 2f, centre.y + 18.dp.toPx()))
            }
            // Tap targets over the dots: open that system's card.
            val d = LocalDensity.current
            val hPx = with(d) { 232.dp.toPx() }
            val radius = min(wPx, hPx) / 2 - with(d) { 22.dp.toPx() }
            nodes.forEachIndexed { i, n ->
                val a = radarAngle(i, nodes.size)
                val r = radarRadius(n.jumps.coerceAtMost(maxJumps).toFloat(), maxJumps.toFloat(), with(d) { 30.dp.toPx() }, radius)
                val x = wPx / 2 + (r * sin(a)).toFloat(); val y = hPx / 2 - (r * cos(a)).toFloat()
                Box(Modifier.offset { IntOffset((x - 22.dp.toPx()).toInt(), (y - 22.dp.toPx()).toInt()) }.size(44.dp).clip(CircleShape).clickable(onClickLabel = "Show ${n.name}") { onPick(n.systemId) })
            }
        }
    }
}

/** How far out [jumps] sits on a radar of [reach] jumps: from [inner] (clear of the centre's mark) to [outer]. */
internal fun radarRadius(jumps: Float, reach: Float, inner: Float, outer: Float): Float = inner + (outer - inner) * (jumps / reach.coerceAtLeast(1f)).coerceIn(0f, 1f)

/** Rings every 1, 2, 5 or 10 jumps, so there are at most five. */
internal fun ringStep(maxJumps: Int): Int = listOf(1, 2, 5, 10, 20).first { maxJumps / it <= 5 }

// ---- the system board ----

/**
 * One system's card: its security, name, region and distance, who is there, and a ring per timer. Tapping a ring opens
 * its controls (yours) or who started it (the wingmate's); the plus starts a timer in this system.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SystemCard(
    g: SystemGroup,
    pilot: Pilot,
    now: Long,
    sec: Double?,
    region: String?,
    actions: TimerActions,
    onAdd: (() -> Unit)?,
    onMove: (WingTimer) -> Unit,
    modifier: Modifier = Modifier,
    selected: String? = null,
    onSelect: (String?) -> Unit = {},
    systems: Map<Long, SolarSystem> = emptyMap(),
) {
    val c = Echelon.colors
    val edge by animateColorAsState(if (g.here) c.accentLine else c.line, motionSpec(Springs.select()), label = "here edge")
    EchelonCard(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SecLight(sec, if (g.here) c.accent else edge)
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text(g.name ?: if (g.systemId == null) "No system" else "System ${g.systemId}", style = MaterialTheme.typography.titleMedium, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (sec != null) Text(secLabel(sec), style = Echelon.type.num, color = secText(sec))
                }
                val sub = when {
                    g.systemId == null -> "Timers started before they had a system"
                    else -> listOfNotNull(region, if (g.here) "you are here" else jumpsText(g.jumps)).joinToString(" · ").ifEmpty { null }
                }
                if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = if (g.here) c.accentStrong else c.textMuted, maxLines = 1)
            }
            if (g.wingmateHere) MateHere(pilot.wingmate)
            if (onAdd != null) IconButton(onAdd, Modifier.semantics { contentDescription = "Start a timer in ${g.name ?: "this system"}" }) { Icon(EchelonIcons.Plus, null, tint = c.accentStrong) }
        }
        if (g.timers.isEmpty()) {
            Text(if (g.here) "Nothing counting down here. Tap + to start a timer in ${g.name ?: "this system"}." else "No timers.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
        } else {
            FlowRow(Modifier.fillMaxWidth().padding(top = Spacing.xs), horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                g.timers.forEach { t -> key(t.id) { TimerRing(t, pilot, now, selected == t.id, onClick = { onSelect(if (selected == t.id) null else t.id) }) } }
            }
            val open = g.timers.firstOrNull { it.id == selected }
            AnimatedVisibility(open != null, enter = fadeIn(tween(160)) + expandVertically(motionSpec(spring(stiffness = Spring.StiffnessMediumLow))), exit = fadeOut(tween(120)) + shrinkVertically(motionSpec(spring(stiffness = Spring.StiffnessMedium)))) {
                val shown = remember(open?.id) { open } ?: open
                if (shown != null) TimerControls(g.timers.firstOrNull { it.id == shown.id } ?: shown, pilot, now, actions, onMove, systems)
            }
        }
    }
}

/** The security light at a card's left edge: a dot in EVE's hue with a soft halo, or a hollow ring when unknown. */
@Composable
private fun SecLight(sec: Double?, edge: Color) {
    val c = Echelon.colors
    Canvas(Modifier.size(22.dp)) {
        val centre = Offset(size.width / 2, size.height / 2)
        if (sec == null) { drawCircle(c.lineStrong, 6.dp.toPx(), centre, style = Stroke(1.5.dp.toPx())); return@Canvas }
        val col = secColor(sec)
        drawCircle(col.copy(alpha = .22f), 10.dp.toPx(), centre)
        drawCircle(col, 5.5.dp.toPx(), centre)
        drawCircle(edge, 10.dp.toPx(), centre, style = Stroke(1.dp.toPx()))
    }
}

@Composable
private fun MateHere(mate: Pilot) {
    val col = PilotColors.of(mate.id)
    Row(Modifier.clip(RoundedCornerShape(10.dp)).background(col.soft).padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(col.color))
        Text("${mate.displayName} here", style = Echelon.type.chip, color = col.color, maxLines = 1)
    }
}

/**
 * A timer as a ring: the arc is the time left, in its owner's colour, sweeping down to zero; the countdown sits inside,
 * the label under it. Paused rings are dashed and still; a finished ring turns ok-green with a burst at the moment it
 * ends. The ring's glow grows as the end gets close.
 */
@Composable
fun TimerRing(t: WingTimer, pilot: Pilot, now: Long, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, size: Dp = 76.dp) {
    val c = Echelon.colors
    val reduced = Echelon.reduceMotion
    val done = t.done(now)
    val paused = t.pausedAt != null
    val left = if (t.durationMs <= 0) 0f else (t.remaining(now).toFloat() / t.durationMs).coerceIn(0f, 1f)
    val sweep by animateFloatAsState(left, motionSpec(Springs.value()), label = "ring sweep")
    val heat by animateFloatAsState(urgency(t, now), motionSpec(Springs.value()), label = "ring heat")
    val owner = ownerColor(t)
    val col by animateColorAsState(when { done -> c.ok; paused -> c.textFaint; else -> owner }, motionSpec(tween(300)), label = "ring colour")
    val select by animateFloatAsState(if (selected) 1f else 0f, motionSpec(Springs.select()), label = "ring select")
    // The burst: only when this ring sees the timer reach zero (not when it is first drawn already finished).
    val burst = remember(t.id) { Animatable(1f) }
    var seenRunning by remember(t.id, t.endsAt) { mutableStateOf(!done) }
    LaunchedEffect(done) {
        if (!done) { seenRunning = true; return@LaunchedEffect }
        if (seenRunning && !reduced) { burst.snapTo(0f); burst.animateTo(1f, tween(900)) }
        seenRunning = false
    }
    val mine = t.ownedBy(pilot)
    val text = when { done -> "Done"; paused -> clock(t.remaining(now)); else -> clock(t.remaining(now)) }
    val spoken = "${t.label}, ${when { done -> "done"; paused -> "paused, ${duration(t.remaining(now) / 1000.0)} left"; else -> "${duration(t.remaining(now) / 1000.0)} left" }}" +
        if (!mine) ", ${Pilot.of(t.owner)?.displayName ?: "wingmate"}’s" else ""
    Column(
        modifier.width(size + 22.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).semantics(mergeDescendants = true) { contentDescription = spoken }.padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(size)) {
                val w = 5.dp.toPx(); val inset = w / 2 + 5.dp.toPx(); val arc = Size(this.size.width - inset * 2, this.size.height - inset * 2)
                val centre = Offset(this.size.width / 2, this.size.height / 2)
                val r = arc.width / 2
                if (heat > 0f) drawCircle(owner.copy(alpha = .10f + .22f * heat), r + w / 2 + 4.dp.toPx() * heat, centre)
                if (select > 0f) drawCircle(c.accent.copy(alpha = .9f * select), r + w + 1.5.dp.toPx(), centre, style = Stroke(1.5.dp.toPx()))
                val track = if (paused) Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx()))) else Stroke(w)
                drawArc(c.surface3, 0f, 360f, false, Offset(inset, inset), arc, style = track)
                when {
                    done -> drawArc(col, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
                    sweep > 0f -> drawArc(col, -90f, -360f * sweep, false, Offset(inset, inset), arc, style = Stroke(w, cap = StrokeCap.Round))
                }
                if (burst.value < 1f) drawBurst(centre, r, burst.value, c.ok)
            }
            if (done) Icon(EchelonIcons.Check, null, Modifier.size(26.dp), tint = c.ok)
            else RollingText(text, Echelon.type.num.copy(fontSize = if (text.length > 5) Echelon.type.numSmall.fontSize else Echelon.type.num.fontSize, color = if (paused) c.textMuted else if (t.remaining(now) <= MIN) c.warn else c.text))
        }
        Text(t.label, style = Echelon.type.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        val note = when { paused -> "Paused"; !mine -> Pilot.of(t.owner)?.displayName; !t.shared -> "Private"; else -> TimerKind.of(t.kind).title.takeIf { it != t.label } }
        if (note != null) Text(note, style = Echelon.type.chip, color = if (!mine && !paused) owner else c.textFaint, maxLines = 1, textAlign = TextAlign.Center)
    }
}

/** The moment a timer ends: a ring flying outward and fading, with sparks. [p] runs 0 to 1. */
private fun DrawScope.drawBurst(centre: Offset, r: Float, p: Float, color: Color) {
    val out = r * (1f + .7f * p)
    drawCircle(color.copy(alpha = (1f - p) * .8f), out, centre, style = Stroke((1f - p) * 6.dp.toPx() + 1f))
    for (k in 0 until 10) {
        val a = 2 * PI * k / 10
        val from = r * (1f + .3f * p); val to = r * (1.15f + .75f * p)
        drawLine(color.copy(alpha = 1f - p), Offset(centre.x + (from * sin(a)).toFloat(), centre.y - (from * cos(a)).toFloat()), Offset(centre.x + (to * sin(a)).toFloat(), centre.y - (to * cos(a)).toFloat()), 2.dp.toPx(), cap = StrokeCap.Round)
    }
}

/** The opened ring's controls: the full title, and for your own timers pause/resume, restart, move, share and remove. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TimerControls(t: WingTimer, pilot: Pilot, now: Long, actions: TimerActions, onMove: (WingTimer) -> Unit, systems: Map<Long, SolarSystem>) {
    val c = Echelon.colors
    val mine = t.ownedBy(pilot)
    val done = t.done(now)
    Column(Modifier.fillMaxWidth().padding(top = Spacing.sm).clip(RoundedCornerShape(6.dp)).background(c.surface2).padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(ownerColor(t)))
            Text(t.title(systems), style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Tag(TimerKind.of(t.kind).title)
        }
        val who = Pilot.of(t.owner)?.displayName ?: "Someone"
        Text(
            (if (mine) "" else "$who started it · ") + when { done -> "ran ${clock(t.durationMs)}"; t.pausedAt != null -> "paused with ${clock(t.remaining(now))} left of ${clock(t.durationMs)}"; else -> "${clock(t.durationMs)} long" } +
                if (mine && !t.shared) " · only on your devices" else "",
            style = MaterialTheme.typography.bodySmall, color = c.textMuted,
        )
        if (mine) FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            when {
                done -> LinkButton("Again", { actions.restart(t.id) })
                t.pausedAt != null -> LinkButton("Resume", { actions.resume(t.id) })
                else -> LinkButton("Pause", { actions.pause(t.id) })
            }
            if (!done) LinkButton("Restart", { actions.restart(t.id) })
            LinkButton("Move", { onMove(t) }, tone = Tone.Neutral)
            LinkButton(if (t.shared) "Unshare" else "Share", { actions.share(t.id, !t.shared) }, tone = Tone.Neutral)
            LinkButton("Remove", { actions.remove(t.id) }, tone = Tone.Danger)
        }
    }
}
