package com.echelon.eve.fly.cockpit

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.fly
import com.echelon.eve.fly.timers.TimerKind
import com.echelon.eve.fly.timers.ringHeat
import com.echelon.eve.fly.timers.systemId
import com.echelon.eve.fly.timers.systemNameIn
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.ui.components.SecurityBadge
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.rememberNow
import com.echelon.eve.ui.format.clock
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.motion.RollingText
import com.echelon.eve.ui.motion.breathAt
import com.echelon.eve.ui.motion.rememberBreath
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors

/** What the picture-in-picture window shows: the timer it follows, where, and the wingmate's dot. */
data class PipUi(
    val pilot: Pilot?,
    val timer: WingTimer?,
    val systemName: String? = null,
    val sec: Double? = null,
    val mate: Pilot? = null,
    val mateOnline: Boolean? = null,
    /** "in space · Tama", from the wingmate's shared status. */
    val mateWhere: String? = null,
)

/** The PiP window wired to the container: the timer pipTarget picks, its system, and the wingmate. */
@Composable
fun CockpitPipRoute(pilot: Pilot?) {
    val c = LocalAppContainer.current ?: return
    val now = rememberNow()
    val timers by c.fly.timers.timers.collectAsStateWithLifecycle()
    val presence by c.wingChannel.presence.collectAsStateWithLifecycle()
    val statuses by c.wingChannel.statuses.collectAsStateWithLifecycle()
    val market by c.market.state.collectAsStateWithLifecycle()
    val systems = market.data?.systems.orEmpty()
    val t = pipTarget(timers.values, pilot, now)
    val mate = pilot?.wingmate
    val st = mate?.let { statuses[it.id] }
    val where = st?.let { s -> listOfNotNull(if (s.docked == true) "docked" else if (s.system != null) "in space" else null, s.system?.let { systems[it]?.name }).joinToString(" · ").ifEmpty { null } }
    CockpitPipScreen(PipUi(pilot, t, t?.systemNameIn(systems), t?.systemId?.let { systems[it]?.sec }, mate, mate?.let { presence[it.id]?.online }, where), now)
}

/**
 * The cockpit at picture-in-picture size (about 240 × 135 dp): the timer's ring with its countdown on the left, the
 * timer's name, its system and the wingmate's dot on the right. The ring keeps ringHeat's colours (amber towards a
 * warning, red at the end) and breathes while it heats, like the board's rings. No buttons in the layout: PiP's own
 * actions (pause or resume, +1 min) do that.
 */
@Composable
fun CockpitPipScreen(ui: PipUi, now: Long, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    BoxWithConstraints(modifier.fillMaxSize().background(c.bg).padding(horizontal = 10.dp, vertical = 8.dp)) {
        val ring = min(maxHeight, maxWidth * .46f)
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PipRing(ui.timer, now, Modifier.size(ring))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                val t = ui.timer
                Text(t?.label ?: "No timer running", style = Echelon.type.label.copy(fontSize = 14.sp, lineHeight = 17.sp), color = if (t == null) c.textMuted else c.text, maxLines = if (t == null) 2 else 1, overflow = TextOverflow.Ellipsis)
                if (t != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    ui.sec?.let { SecurityBadge(it) }
                    Text(ui.systemName ?: "No system", style = Echelon.type.label, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                val owner = t?.let { Pilot.of(it.owner) }
                if (owner != null && owner != ui.pilot) Text("${owner.displayName}’s", style = Echelon.type.chip, color = PilotColors.of(owner.id).color, maxLines = 1)
                if (ui.mate != null) Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    StatusDot(if (ui.mateOnline == true) Tone.Ok else Tone.Neutral, live = ui.mateOnline == true)
                    Text(ui.mate.displayName, style = Echelon.type.chip, color = PilotColors.of(ui.mate.id).color, maxLines = 1)
                    // The window is tiny: "in space · Tama" reads as just "Tama" here (the dot already says they are online).
                    Text(ui.mateWhere?.substringAfterLast("· ")?.trim() ?: if (ui.mateOnline == true) "online" else "away", style = Echelon.type.chip, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun PipRing(t: WingTimer?, now: Long, modifier: Modifier) {
    val c = Echelon.colors
    val done = t?.done(now) == true
    val paused = t?.pausedAt != null
    val left = if (t == null || t.durationMs <= 0) 0f else (t.remaining(now).toFloat() / t.durationMs).coerceIn(0f, 1f)
    val heat = t?.let { ringHeat(it, now) }
    val owner = t?.let { PilotColors.of(it.owner).color } ?: c.accent
    val sleeper = t != null && TimerKind.of(t.kind) == TimerKind.Sleeper
    val col = when {
        t == null -> c.textFaint; done -> if (sleeper) c.danger else c.ok; paused -> c.textFaint
        else -> lerp(lerp(owner, c.warn, heat!!.warn), c.danger, maxOf(heat.last, heat.warn * .6f))
    }
    val nearing = heat != null && !done && !paused && (heat.warn > 0f || heat.last > 0f)
    val breath = rememberBreath(nearing)
    val text = when { t == null -> "—"; done -> if (sleeper) "OUT" else "Done"; else -> clock(t.remaining(now)) }
    val spoken = when { t == null -> "No timer"; done -> "${t.label} done"; else -> "${t.label}, ${duration(t.remaining(now) / 1000.0)} left" + if (paused) ", paused" else "" }
    Box(modifier.semantics(mergeDescendants = true) { contentDescription = spoken }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val w = (size.minDimension * .075f).coerceAtLeast(3.dp.toPx())
            val inset = w / 2 + w
            val arc = Size(size.width - inset * 2, size.height - inset * 2)
            if (nearing) drawCircle(col.copy(alpha = .10f + .18f * breathAt(breath.value, if (heat!!.last > .5f) 2 else 1)), radius = size.minDimension / 2, center = center)
            drawArc(c.surface3, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
            if (done) drawArc(col, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
            else if (left > 0f) drawArc(col, -90f, -360f * left, false, Offset(inset, inset), arc, style = Stroke(w, cap = StrokeCap.Round))
        }
        val big = if (text.length > 5) 15.sp else 20.sp
        RollingText(text, Echelon.type.numLarge.copy(fontSize = big, lineHeight = big * 1.15f, color = if (paused) c.textMuted else if (done) col else c.text))
    }
}
