package com.echelon.eve.fly.cockpit

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingPing
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.fly.timers.MiningProfile
import com.echelon.eve.fly.timers.MiningUi
import com.echelon.eve.fly.timers.SuggestionCard
import com.echelon.eve.fly.timers.TimerBoard
import com.echelon.eve.fly.timers.fitLine
import com.echelon.eve.fly.timers.ringHeat
import androidx.compose.ui.graphics.lerp
import com.echelon.eve.fly.timers.miningLine
import com.echelon.eve.fly.timers.progress
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.Countdown
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.ProgressBar
import com.echelon.eve.ui.components.SecurityBadge
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.TypeIcon
import com.echelon.eve.ui.components.color
import com.echelon.eve.ui.components.soft
import com.echelon.eve.ui.format.SecBand
import com.echelon.eve.ui.format.ago
import com.echelon.eve.ui.format.clock
import com.echelon.eve.ui.format.secBand
import com.echelon.eve.ui.format.secColor
import com.echelon.eve.ui.format.secLabel
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing

// The cockpit: one screen for the phone next to the keyboard while undocked. What matters at a glance on top (where
// you are, the next timer, the wingmate), the one-tap actions pinned at the bottom under the thumb. Wide screens
// (landscape) put the two side by side. Stateless; CockpitRoute feeds it.

/** The wingmate as the cockpit shows them: is their app open (wing room presence), where they are, their last call. */
data class MateUi(val pilot: Pilot, val appOpen: Boolean? = null, val place: Whereabouts? = null, val note: String? = null, val lastPing: PingLine? = null)

/** A call in the wing feed: what was said, where (if shared), when. */
data class PingLine(val text: String, val system: String?, val at: Long)

/** A route the wing shared (Haul, Explore): the cockpit offers it to EVE's autopilot. */
data class PlanLine(val title: String, val route: List<Long>)

data class CockpitUi(
    val pilot: Pilot?,
    val me: Whereabouts? = null,
    val reading: Boolean = false,
    val problem: String? = null,
    /** The last good read and the next scheduled one (epoch ms). */
    val readAt: Long = 0,
    val nextAt: Long = 0,
    /** The latest change worth a moment on screen (a jump, a dock), while it is fresh. */
    val banner: CockpitEvent? = null,
    val timers: List<WingTimer> = emptyList(),
    val quick: List<QuickTimer> = emptyList(),
    val mate: MateUi? = null,
    val plan: PlanLine? = null,
    /** The last action's answer ("Sent to Decxus.", "Autopilot set: 4 waypoints."). */
    val status: String? = null,
    val sound: Boolean = true,
    /** A timer worth offering now, and what the fit says about mining (for the line under the next timer). */
    val suggestion: Suggestion? = null,
    val mining: MiningUi? = null,
)

class CockpitActions(
    val refresh: () -> Unit = {},
    val quick: (QuickTimer) -> Unit = {},
    val ping: (kind: String) -> Unit = {},
    val routeToMate: () -> Unit = {},
    val autopilot: (PlanLine) -> Unit = {},
    val openTimers: () -> Unit = {},
    val openWing: () -> Unit = {},
    val sound: (Boolean) -> Unit = {},
    val startSuggestion: () -> Unit = {},
    val dismissSuggestion: () -> Unit = {},
)

/** The calls the cockpit offers, in the wing feed's words. */
fun pingLabel(kind: String): String = when (kind) {
    WingPing.OMW -> "On my way"; WingPing.HELP -> "Need help"; WingPing.UNDOCK -> "Undocking"; WingPing.DOCKED -> "Docked up"; else -> "Call"
}

@Composable
fun CockpitScreen(ui: CockpitUi, now: Long, actions: CockpitActions, modifier: Modifier = Modifier) {
    if (ui.pilot == null) {
        Box(modifier.fillMaxSize().padding(Spacing.gutter)) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Fly) }
        return
    }
    BoxWithConstraints(modifier.fillMaxSize()) {
        val wide = maxWidth > maxHeight && maxWidth >= 560.dp
        if (wide) Row(Modifier.fillMaxSize().padding(horizontal = Spacing.gutter).navigationBarsPadding(), horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()).padding(vertical = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Info(ui, now, actions, withMate = false, compact = true)
            }
            Column(Modifier.weight(1f).fillMaxHeight().padding(vertical = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                ui.mate?.let { Mate(it, now, actions.openWing) }
                Box(Modifier.weight(1f))
                Actions(ui, actions, buttonHeight = 60.dp)
            }
        } else Column(Modifier.fillMaxSize().navigationBarsPadding()) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = Spacing.gutter, vertical = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Info(ui, now, actions, withMate = true)
            }
            // Pinned under the thumb: the buttons never scroll away.
            Column(Modifier.background(Echelon.colors.bg.copy(alpha = .92f)).padding(horizontal = Spacing.gutter, vertical = Spacing.md)) { Actions(ui, actions) }
        }
    }
}

@Composable
private fun ColumnScope.Info(ui: CockpitUi, now: Long, actions: CockpitActions, withMate: Boolean, compact: Boolean = false) {
    ui.banner?.let { Banner(it) }
    SuggestionCard(ui.suggestion, ui.mining, actions.startSuggestion, actions.dismissSuggestion)
    Place(ui, now, actions, compact)
    NextTimer(ui.timers, ui.pilot, now, actions.openTimers, compact, ui.mining?.profile)
    if (withMate) ui.mate?.let { Mate(it, now, actions.openWing) }
}

/** "Jumped to Tama", amber for low-sec, red for null-sec. */
@Composable
private fun Banner(e: CockpitEvent) {
    val tone = when ((e as? CockpitEvent.Jumped)?.warning) { SecBand.Null -> Tone.Danger; SecBand.Low -> Tone.Warn; else -> Tone.Accent }
    val c = Echelon.colors
    Row(
        Modifier.fillMaxWidth().background(tone.soft(), RoundedCornerShape(Radii.control)).padding(horizontal = Spacing.lg, vertical = Spacing.md)
            .semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Icon(if (tone == Tone.Accent) EchelonIcons.Route else EchelonIcons.Alert, null, Modifier.size(28.dp), tint = tone.color())
        Column(Modifier.weight(1f)) {
            Text(e.headline(), style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold), color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (e is CockpitEvent.Jumped) {
                val sub = listOfNotNull(e.sec?.let { "${secLabel(it)} ${secBand(it).label}" }, e.from?.let { "from $it" }).joinToString(" · ")
                if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodyMedium, color = c.textMuted, maxLines = 1)
            }
        }
    }
}

/** Where the flying pilot is: the system huge with its security, docked or in space, the ship, and the read's age. */
@Composable
private fun Place(ui: CockpitUi, now: Long, actions: CockpitActions, compact: Boolean) {
    val c = Echelon.colors
    val me = ui.me
    PrimaryPanel(Modifier.fillMaxWidth()) {
        when {
            me != null -> {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    me.sec?.let { SecBlock(it) }
                    Column(Modifier.weight(1f)) {
                        Text(me.systemName ?: "Unknown system", style = Echelon.type.screenTitle.copy(fontSize = 28.sp, lineHeight = 34.sp), color = c.text,
                            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                        val where = listOfNotNull(me.sec?.let { secBand(it).label }, me.region).joinToString(" · ")
                        if (where.isNotEmpty()) Text(where, style = MaterialTheme.typography.bodyLarge, color = bandColor(me.sec), maxLines = 1)
                    }
                }
                val docked = me.dockedAt?.let { "Docked at $it" } ?: "In space"
                // Short screens (landscape) say where and in what on one line.
                if (compact) Text(listOfNotNull(docked, me.shipName?.takeIf { it.isNotBlank() } ?: me.shipTypeName).joinToString(" · "), style = MaterialTheme.typography.titleMedium, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                else Text(docked, style = MaterialTheme.typography.titleMedium, color = if (me.dockedAt == null) c.text else c.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (!compact && (me.shipType != null || !me.shipName.isNullOrBlank())) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    me.shipType?.let { TypeIcon(it, size = 36.dp, contentDescription = me.shipTypeName) }
                    Column(Modifier.weight(1f)) {
                        Text(me.shipName?.takeIf { it.isNotBlank() } ?: me.shipTypeName ?: "Ship", style = MaterialTheme.typography.titleMedium, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (me.shipTypeName != null && !me.shipName.isNullOrBlank()) Text(me.shipTypeName, style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 1)
                    }
                }
            }
            ui.reading -> SkeletonRows(rows = 2, label = "Asking EVE where ${ui.pilot?.displayName} is…")
            else -> Text(ui.problem ?: "Where you are has not been read yet.", style = MaterialTheme.typography.bodyLarge, color = c.textMuted)
        }
        if (me != null && ui.problem != null) Text(ui.problem, style = MaterialTheme.typography.bodySmall, color = c.warn)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            val online = me?.online
            StatusDot(if (online == true) Tone.Ok else Tone.Neutral, live = online == true)
            Text(readLine(ui, now), style = MaterialTheme.typography.bodySmall, color = c.textMuted, modifier = Modifier.weight(1f), maxLines = 1)
            ChoiceChip("Sound", selected = ui.sound, onClick = { actions.sound(!ui.sound) })
            IconButton(actions.refresh, enabled = !ui.reading, modifier = Modifier.size(48.dp)) { Icon(EchelonIcons.Refresh, "Read location now", Modifier.size(22.dp), tint = c.accent) }
        }
    }
}

@Composable
private fun bandColor(sec: Double?): Color = when (sec?.let(::secBand)) { SecBand.Low -> Echelon.colors.warn; SecBand.Null -> Echelon.colors.danger; else -> Echelon.colors.textMuted }

/** "Online · read 20 s ago · next in 40 s" */
internal fun readLine(ui: CockpitUi, now: Long): String {
    val parts = mutableListOf<String>()
    when (ui.me?.online) { true -> parts += "Online"; false -> parts += "Offline"; null -> {} }
    when {
        ui.reading -> parts += "reading…"
        ui.readAt > 0 -> parts += "read ${ago(ui.readAt, now)}"
    }
    if (!ui.reading && ui.nextAt > now) parts += "next in ${clock(ui.nextAt - now)}"
    return parts.joinToString(" · ").replaceFirstChar { it.uppercase() }.ifEmpty { "Not read yet" }
}

/** EVE's security figure as a block of its own colour: readable from across the desk. */
@Composable
private fun SecBlock(sec: Double) {
    val hue = secColor(sec)
    Box(Modifier.sizeIn(minWidth = 64.dp, minHeight = 56.dp).background(hue.copy(alpha = .18f), RoundedCornerShape(Radii.control)).padding(horizontal = 10.dp)
        .semantics(mergeDescendants = true) { contentDescription = "Security ${secLabel(sec)}" }, contentAlignment = Alignment.Center) {
        Text(secLabel(sec), style = Echelon.type.numLarge.copy(fontSize = 26.sp, lineHeight = 30.sp), color = hue)
    }
}

/** The next timer to end, large, with its progress; tap for the timer board. */
@Composable
private fun NextTimer(timers: List<WingTimer>, pilot: Pilot?, now: Long, onOpen: () -> Unit, compact: Boolean = false, mining: MiningProfile? = null) {
    val c = Echelon.colors
    val board = TimerBoard.of(timers, now)
    val next = board.next
    EchelonCard(Modifier.fillMaxWidth(), onClick = onOpen) {
        // Short screens drop the header: the label and the countdown say enough.
        if (!compact || next == null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(EchelonIcons.Timer, null, Modifier.size(20.dp), tint = c.accent)
            Text("Next timer", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.weight(1f))
            if (board.runningCount > 1) Text("${board.runningCount} running", style = Echelon.type.label, color = c.textMuted)
        }
        if (next == null) {
            Text("Nothing counting down", style = MaterialTheme.typography.titleLarge, color = c.textMuted)
            return@EchelonCard
        }
        val owner = Pilot.of(next.owner)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Column(Modifier.weight(1f)) {
                Text(next.label, style = MaterialTheme.typography.titleLarge, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val whose = listOfNotNull(owner?.takeIf { it != pilot }?.let { "${it.displayName}’s" }, if (compact && board.runningCount > 1) "${board.runningCount} running" else null).joinToString(" · ")
                if (whose.isNotEmpty()) Text(whose, style = MaterialTheme.typography.bodyMedium, color = owner?.takeIf { it != pilot }?.let { PilotColors.of(it.id).color } ?: c.textMuted)
            }
            Countdown(next.endsAt, now = now, style = Echelon.type.numLarge.copy(fontSize = 40.sp, lineHeight = 44.sp))
        }
        // The bar warms towards amber as the closest warning nears and goes red at the end, like the rings on the board.
        val heat = ringHeat(next, now)
        val base = if (owner != null && owner != pilot) PilotColors.of(owner.id).color else c.accent
        ProgressBar(next.progress(now), Modifier.fillMaxWidth(), color = lerp(lerp(base, c.warn, heat.warn), c.danger, heat.last), height = 8.dp)
        // What the fit says: "Cycle 1:38 · hold full in 14 min" (the timer's own figures, else the flying pilot's fit now).
        (next.fitLine() ?: mining?.let(::miningLine))?.let { Text(it, style = Echelon.type.num.copy(fontSize = 15.sp), color = c.textMuted, maxLines = 2) }
    }
}

/** The wingmate: app open or not, where they were at the wing's last sync, and their last call. Tap for the wing. */
@Composable
private fun Mate(m: MateUi, now: Long, onOpen: () -> Unit) {
    val c = Echelon.colors
    val colors = PilotColors.of(m.pilot.id)
    EchelonCard(Modifier.fillMaxWidth(), onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Box(Modifier.size(10.dp).background(colors.color, RoundedCornerShape(2.dp)))
            Text(m.pilot.displayName, style = MaterialTheme.typography.titleLarge, color = colors.color, modifier = Modifier.weight(1f), maxLines = 1)
            when (m.appOpen) { true -> Tag("App open", tone = Tone.Ok); false -> Tag("App closed"); null -> {} }
        }
        val p = m.place
        if (p != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            p.sec?.let { SecurityBadge(it) }
            Text(p.systemName ?: "Unknown system", style = MaterialTheme.typography.titleMedium, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Text(listOfNotNull(if (p.dockedAt != null) "docked" else "in space", p.at?.let { ago(it, now) }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 1)
        } else Text(m.note ?: "${m.pilot.displayName} does not share where they are.", style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
        m.lastPing?.let { ping ->
            Text(listOfNotNull("“${ping.text}”", ping.system, ago(ping.at, now)).joinToString(" · "), style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The one-tap buttons: two quick timers, two calls, and a route. Every one at least 72 dp tall. */
/** One button of the grid. */
private class Spec(val title: String, val detail: String, val icon: ImageVector, val tone: Tone, val enabled: Boolean = true, val onClick: () -> Unit)

@Composable
private fun Actions(ui: CockpitUi, actions: CockpitActions, columns: Int = 2, buttonHeight: Dp = 72.dp) {
    val c = Echelon.colors
    val mate = ui.mate?.pilot?.displayName ?: "wingmate"
    val here = ui.me?.systemName
    val target = ui.mate?.place?.takeIf { it.systemId != null }
    val plan = ui.plan
    val specs = ui.quick.map { q -> Spec(q.kind.title, "${clock(q.durationMs)} · ${if (q.reuse != null) "restart" else "start"}", EchelonIcons.Timer, Tone.Accent) { actions.quick(q) } } +
        Spec(pingLabel(WingPing.OMW), here?.let { "to $mate, from $it" } ?: "to $mate", EchelonIcons.Wing, Tone.Neutral) { actions.ping(WingPing.OMW) } +
        Spec(pingLabel(WingPing.HELP), here?.let { "in $it" } ?: "call $mate", EchelonIcons.Alert, Tone.Danger) { actions.ping(WingPing.HELP) } +
        Spec("Route to $mate", target?.systemName ?: "location unknown", EchelonIcons.Route, Tone.Neutral, enabled = target != null && target.systemId != ui.me?.systemId) { actions.routeToMate() } +
        (if (plan != null) Spec("Autopilot", plan.title, EchelonIcons.Route, Tone.Neutral) { actions.autopilot(plan) }
        else Spec(pingLabel(WingPing.DOCKED), "tell $mate", EchelonIcons.Check, Tone.Neutral) { actions.ping(WingPing.DOCKED) })
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        ui.status?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = c.textMuted, maxLines = 2) }
        specs.chunked(columns).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                row.forEach { BigAction(it.title, it.detail, it.icon, it.tone, Modifier.weight(1f).heightIn(min = buttonHeight), it.enabled, it.onClick) }
                repeat(columns - row.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}

/** A big, thumb-sized button: an icon and a title, with a line of detail under it. */
@Composable
private fun BigAction(title: String, detail: String, icon: ImageVector, tone: Tone, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Echelon.colors
    val hue = if (tone == Tone.Neutral) c.text else tone.color()
    val fill = if (tone == Tone.Neutral) c.surface2 else tone.soft()
    Surface(
        onClick = onClick, enabled = enabled, modifier = modifier, shape = RoundedCornerShape(Radii.control),
        color = if (enabled) fill else c.surface1, border = BorderStroke(1.dp, if (enabled) (if (tone == Tone.Neutral) c.lineStrong else hue.copy(alpha = .5f)) else c.line),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(icon, null, Modifier.size(22.dp), tint = if (enabled) hue else c.textFaint)
                Text(title, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), color = if (enabled) c.text else c.textFaint, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(detail, style = MaterialTheme.typography.bodySmall, color = if (enabled) c.textMuted else c.textFaint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
