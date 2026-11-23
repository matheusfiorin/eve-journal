package com.echelon.eve.fly.wing

import com.echelon.eve.ui.motion.RollingNumber
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.Presence
import com.echelon.eve.core.wing.SharedPlan
import com.echelon.eve.core.wing.WingAck
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingEvent
import com.echelon.eve.core.wing.WingPing
import com.echelon.eve.core.wing.WingSession
import com.echelon.eve.core.wing.WingStatus
import com.echelon.eve.core.wing.ackWord
import com.echelon.eve.core.wing.activityLabel
import com.echelon.eve.core.wing.aOrAn
import com.echelon.eve.core.wing.activityWord
import com.echelon.eve.fly.FlyPage
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.ProgressBar
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.motion.cometTrail
import com.echelon.eve.ui.motion.pingRipple
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.WingChip
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.ago
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing

/** One line of the wing feed: a ping or a shared plan, newest first, with the answers it got. */
sealed interface FeedItem {
    val from: Pilot?
    val at: Long
    val id: String
    val acks: Map<Long, WingAck>
    data class Ping(override val from: Pilot?, override val at: Long, override val id: String, val ping: WingPing, override val acks: Map<Long, WingAck> = emptyMap()) : FeedItem
    data class Plan(override val from: Pilot?, override val at: Long, override val id: String, val plan: SharedPlan, override val acks: Map<Long, WingAck> = emptyMap()) : FeedItem
}

fun feed(pings: List<WingEvent<WingPing>>, plans: List<WingEvent<SharedPlan>>): List<FeedItem> =
    (pings.map { FeedItem.Ping(it.from, it.at, it.id, it.value, it.acks) } + plans.map { FeedItem.Plan(it.from, it.at, it.id, it.value, it.acks) }).sortedByDescending { it.at }

/** The quick calls the room knows (worker/wingroom.js), in the words the notification uses. */
val PINGS = listOf(WingPing.UNDOCK to "Undocking", WingPing.OMW to "On my way", WingPing.HELP to "Need help", WingPing.DOCKED to "Docked up")
fun pingText(p: WingPing): String = when (p.kind) { WingPing.CUSTOM -> p.text.orEmpty(); else -> PINGS.firstOrNull { it.first == p.kind }?.second ?: p.kind }

/** "12,400 units · 3 timers · 1 system" (units only when something was mined). */
fun tally(units: Long, timers: Int, systems: Int): String =
    listOfNotNull("${format(units.toDouble())} units".takeIf { units > 0 }, plural(timers, "timer"), plural(systems, "system")).joinToString(" · ")

/** A status in words: "Mining in Jita · undocked · Retriever". */
fun statusLine(s: WingStatus, systemName: (Long) -> String?): String = buildList {
    add(activityLabel(s.activity) + (s.system?.let { " in ${systemName(it) ?: "system $it"}" } ?: ""))
    s.docked?.let { add(if (it) "docked" else "in space") }
    s.ship?.let { add(it) }
}.joinToString(" · ")

data class WingUi(
    val pilot: Pilot?, val status: WingChannel.Status, val presence: Map<Long, Presence>, val feed: List<FeedItem>,
    val custom: String = "", val shareSystem: Boolean = false, val here: String? = null, val systemName: (Long) -> String? = { null },
    val canSend: Boolean = false, val sent: String? = null,
    /** Live statuses by pilot id: the wingmate's (shown) and this pilot's own (what this phone shares). */
    val statuses: Map<Long, WingStatus> = emptyMap(),
    /** Gate jumps between the two pilots (0: same system), and from this pilot to the end of the wingmate's route. */
    val jumps: Int? = null, val jumpsToMateDestination: Int? = null,
    /** This phone's choices: share the live status (opt-in), the activity, and the followed route. */
    val sharing: Boolean = false, val activity: String = WingStatus.IDLE, val myRoute: List<Long> = emptyList(),
    val session: WingSession? = null, val history: List<WingSession> = emptyList(), val goal: String = "",
    /** Android 13+ without the notification permission: calls can't reach the pilot in the background. */
    val notificationsOff: Boolean = false,
)

class WingActions(val ping: (String) -> Unit = {}, val custom: (String) -> Unit = {}, val sendCustom: () -> Unit = {}, val shareSystem: (Boolean) -> Unit = {},
    val autopilot: (SharedPlan) -> Unit = {}, val reconnect: () -> Unit = {},
    val share: (Boolean) -> Unit = {}, val activity: (String) -> Unit = {}, val stopRoute: () -> Unit = {}, val follow: (List<Long>) -> Unit = {},
    val ack: (FeedItem, String) -> Unit = { _, _ -> }, val goal: (String) -> Unit = {}, val startSession: () -> Unit = {}, val endSession: () -> Unit = {},
    val allowNotifications: () -> Unit = {})

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WingScreen(ui: WingUi, now: Long, actions: WingActions, modifier: Modifier = Modifier, scroll: Boolean = true) = FlyPage(modifier, scroll) {
    val c = Echelon.colors
    val pilot = ui.pilot
    if (pilot == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Wing); return@FlyPage }
    val mate = pilot.wingmate
    val p = ui.presence[mate.id]
    val theirs = ui.statuses[mate.id]
    PrimaryPanel {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            // Their mark trails a comet when their status changes, and ripples when their latest call lands.
            val mateColor = com.echelon.eve.ui.theme.PilotColors.of(mate.id).color
            StatusDot(if (p?.online == true) Tone.Ok else Tone.Neutral, Modifier.cometTrail(p?.online to theirs?.let { statusLine(it, ui.systemName) }, mateColor)
                .pingRipple(ui.feed.firstOrNull { it.from == mate }?.id, mateColor), live = p?.online == true)
            Text(if (p?.online == true) "${mate.displayName} has the app open" else "${mate.displayName} is away", style = Echelon.type.screenTitle, color = c.text)
        }
        if (theirs != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(statusLine(theirs, ui.systemName), style = MaterialTheme.typography.bodyMedium, color = c.text, modifier = Modifier.weight(1f))
                ui.jumps?.let { j -> if (j == 0) Tag("Same system", tone = Tone.Ok) else Tag(plural(j, "jump") + " apart", tone = Tone.Info) }
            }
            if (theirs.destination != null && theirs.destination != theirs.system) {
                Text("Heading to ${ui.systemName(theirs.destination) ?: "system ${theirs.destination}"}" + (if (theirs.route.size > 1) " · ${plural(theirs.route.size - 1, "jump")} to go" else "") +
                    (ui.jumpsToMateDestination?.let { " · ${plural(it, "jump")} from you" } ?: ""), style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                if (ui.canSend) LinkButton("Follow: set my autopilot to ${ui.systemName(theirs.destination) ?: "their destination"}", { actions.follow(listOf(theirs.destination)) })
            }
            Text("Updated ${ago(theirs.at, now)}", style = Echelon.type.label, color = c.textFaint)
        }
        Text(when {
            p?.online == true -> if (p.timers > 0) "${plural(p.timers, "timer")} running." else "No timers running."
            else -> "Pings still reach their phone as a notification when the room can push to it."
        }, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        when (val s = ui.status) {
            WingChannel.Status.Connected -> {}
            is WingChannel.Status.Retrying -> Text("Reconnecting to the wing room (${s.reason})…", style = MaterialTheme.typography.bodySmall, color = c.warn)
            WingChannel.Status.Unauthorized -> Text("${pilot.displayName}’s sign-in was refused by the wing room. Connect again in Settings.", style = MaterialTheme.typography.bodySmall, color = c.danger)
            else -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text("Not connected to the wing room.", style = MaterialTheme.typography.bodySmall, color = c.textMuted, modifier = Modifier.weight(1f))
                LinkButton("Connect", actions.reconnect)
            }
        }
    }
    if (ui.jumps == 0 && theirs != null) EchelonCard(Modifier.fillMaxWidth(), tone = Tone.Ok) {
        Text("You are both in ${theirs.system?.let(ui.systemName) ?: "the same system"}", style = MaterialTheme.typography.titleSmall, color = c.text)
        Text("Fleet up, or call them over.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
    }
    if (ui.notificationsOff) EchelonCard(Modifier.fillMaxWidth(), tone = Tone.Warn) {
        Text("Notifications are off", style = MaterialTheme.typography.titleSmall, color = c.text)
        Text("${mate.displayName}’s calls and answers can’t reach you while the app is in the background.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        LinkButton("Allow notifications", actions.allowNotifications)
    }
    SectionHeader("My status", subtitle = "What ${mate.displayName} sees of you")
    EchelonCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Share where I am", style = MaterialTheme.typography.titleSmall, color = c.text)
                Text(ui.statuses[pilot.id]?.takeIf { ui.sharing }?.let { statusLine(it, ui.systemName) }
                    ?: "System, ship, docked and activity, every minute while the app or a timer runs", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            }
            Switch(ui.sharing, actions.share, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
        }
        FlowRow(Modifier.padding(top = Spacing.sm), horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            WingStatus.ACTIVITIES.forEach { a -> ChoiceChip(activityLabel(a), ui.activity == a, { actions.activity(a) }) }
        }
        if (ui.myRoute.size > 1) Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Sharing my route to ${ui.systemName(ui.myRoute.last()) ?: "system ${ui.myRoute.last()}"}", style = MaterialTheme.typography.bodySmall, color = c.textMuted, modifier = Modifier.weight(1f))
            LinkButton("Stop", actions.stopRoute)
        }
    }
    SessionSection(ui, now, actions)
    SectionHeader("Call ${mate.displayName}")
    EchelonCard {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PINGS.forEach { (k, label) -> SecondaryButton(label, { actions.ping(k) }) }
        }
        OutlinedTextField(ui.custom, { actions.custom(it.take(140)) }, Modifier.fillMaxWidth().padding(top = Spacing.sm), singleLine = true, label = { Text("Or say something") },
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Say where I am", style = MaterialTheme.typography.titleSmall, color = c.text)
                Text(ui.here?.let { "Adds $it to the call" } ?: "Your location isn’t known yet", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            }
            Switch(ui.shareSystem, actions.shareSystem, enabled = ui.here != null, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
        }
        LinkButton("Send", actions.sendCustom)
    }
    SectionHeader("Recent", subtitle = "Calls and plans the two of you shared, newest first")
    if (ui.feed.isEmpty()) EmptyState("Calls and plans shared from Explore, Haul routes or Sell show here.", title = "Nothing shared yet", icon = EchelonIcons.Wing)
    ui.feed.forEach { item ->
        val who = item.from
        EchelonCard(Modifier.fillMaxWidth()) {
            when (item) {
                is FeedItem.Ping -> {
                    Text(pingText(item.ping), style = MaterialTheme.typography.titleSmall, color = c.text)
                    item.ping.text?.takeIf { item.ping.kind != WingPing.CUSTOM && it.isNotBlank() }?.let { Text("“$it”", style = MaterialTheme.typography.bodyMedium, color = c.text) }
                    item.ping.system?.let { s -> Text("In ${ui.systemName(s) ?: "system $s"}", style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
                }
                is FeedItem.Plan -> {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        Tag(when (item.plan.kind) { "haul" -> "Haul"; "explore" -> "Explore"; "sell" -> "Sell"; else -> item.plan.kind.replaceFirstChar { it.uppercase() } })
                        Text(item.plan.title, style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f))
                    }
                    if (item.plan.summary.isNotBlank()) Text(item.plan.summary, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                    if (item.plan.route.size > 1) {
                        Text("${if (item.plan.route.size >= 60) "At least " else ""}${plural(item.plan.route.size - 1, "jump")}: ${item.plan.route.take(6).mapNotNull { ui.systemName(it) }.joinToString(" → ")}${if (item.plan.route.size > 6) " …" else ""}",
                            style = Echelon.type.label, color = c.textFaint)
                        if (ui.canSend) LinkButton("Set my autopilot on this route", { actions.autopilot(item.plan) })
                    }
                }
            }
            if (who != null) WingChip(if (who == pilot) "You" else who.displayName, PilotColors.of(who.id), if (item is FeedItem.Plan) "shared it" else "called", item.at, now, Modifier.padding(top = Spacing.xs))
            else Text(ago(item.at, now), style = Echelon.type.label, color = c.textFaint)
            Answers(item, pilot, now, actions)
        }
    }
    ui.sent?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
}

/** Under a feed item: on the wingmate's, buttons to answer it (and the answer given); on your own, their answer. */
@Composable
private fun Answers(item: FeedItem, pilot: Pilot, now: Long, actions: WingActions) {
    val c = Echelon.colors
    val mine = item.from == pilot
    val answer = item.acks[if (mine) pilot.wingmate.id else pilot.id]
    if (mine) {
        // Their answer arrives with a ripple off its dot (and the Ack haptic, from the route).
        answer?.let { a ->
            val tone = if (a.kind == WingAck.CANT) c.warn else if (a.kind == WingAck.ONIT) c.ok else c.textMuted
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                androidx.compose.foundation.layout.Box(Modifier.size(6.dp).pingRipple(a.kind to a.at, tone).background(tone, androidx.compose.foundation.shape.CircleShape))
                Text("${pilot.wingmate.displayName}: ${ackWord(a.kind)} · ${ago(a.at, now)}", style = Echelon.type.label, color = tone)
            }
        }
        return
    }
    if (item.from == null) return
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (answer != null && answer.kind != WingAck.SEEN) Text("You: ${ackWord(answer.kind)}", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.weight(1f))
        else Text(if (answer?.kind == WingAck.SEEN) "Seen · answer" else "Answer", style = Echelon.type.label, color = c.textFaint, modifier = Modifier.weight(1f))
        if (answer?.kind != WingAck.ONIT) LinkButton("On it", { actions.ack(item, WingAck.ONIT) })
        if (answer?.kind != WingAck.CANT) LinkButton("Can’t", { actions.ack(item, WingAck.CANT) }, tone = Tone.Warn)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ColumnScope.SessionSection(ui: WingUi, now: Long, actions: WingActions) {
    val c = Echelon.colors
    val pilot = ui.pilot ?: return
    val s = ui.session
    SectionHeader("Session", subtitle = if (s == null) "Fly together and see what each of you brought" else "Started ${ago(s.startedAt, now)} by ${Pilot.of(s.startedBy)?.let { if (it == pilot) "you" else it.displayName } ?: "the wing"}")
    if (s != null) EchelonCard(Modifier.fillMaxWidth(), tone = Tone.Accent) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Tag(activityLabel(s.activity), tone = Tone.Accent)
            Text(s.title ?: (activityLabel(s.activity) + (s.where?.let { " in ${ui.systemName(it) ?: "system $it"}" } ?: "")), style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f))
            Text(duration((now - s.startedAt).coerceAtLeast(0) / 1000.0), style = Echelon.type.num, color = c.textMuted)
        }
        val sum = s.sum
        s.goal?.takeIf { it > 0 }?.let { goal ->
            ProgressBar((sum.isk.toFloat() / goal).coerceIn(0f, 1f), Modifier.fillMaxWidth().padding(top = Spacing.sm))
            Text("${format(sum.isk.toDouble(), Kind.Isk)} of ${format(goal.toDouble(), Kind.Isk)}", style = Echelon.type.label, color = c.textMuted)
        }
        listOf(pilot, pilot.wingmate).forEach { who ->
            val part = s.of(who.id)
            Row(Modifier.fillMaxWidth().padding(top = Spacing.sm), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                StatusDot(if (part.timers + part.systems.size > 0 || part.isk != 0L || part.units > 0) Tone.Accent else Tone.Neutral)
                Column(Modifier.weight(1f)) {
                    Text(if (who == pilot) "You" else who.displayName, style = MaterialTheme.typography.titleSmall, color = PilotColors.of(who.id).color)
                    Text(tally(part.units, part.timers, part.systems.size), style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                }
                RollingNumber(part.isk.toDouble(), kind = Kind.Isk, style = Echelon.type.num, color = c.text)
            }
        }
        SecondaryButton("End session", actions.endSession, Modifier.padding(top = Spacing.sm), enabled = ui.canSend)
    } else EchelonCard(Modifier.fillMaxWidth()) {
        Text(if (ui.activity == WingStatus.IDLE) "Pick what you are doing above, then start a session together." else "${aOrAn(activityWord(ui.activity)).replaceFirstChar { it.uppercase() }} session counts both pilots’ timers, systems, ISK and units.",
            style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        OutlinedTextField(ui.goal, { actions.goal(it.take(20)) }, Modifier.fillMaxWidth().padding(top = Spacing.sm), singleLine = true, label = { Text("ISK goal (optional), e.g. 500m") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text))
        PrimaryButton("Start ${if (ui.activity == WingStatus.IDLE) "a" else activityWord(ui.activity)} session", actions.startSession, Modifier.padding(top = Spacing.sm), enabled = ui.canSend && ui.activity != WingStatus.IDLE)
    }
    ui.history.take(3).forEach { h ->
        val t = h.sum
        EchelonCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(h.title ?: activityLabel(h.activity), style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f))
                Text(h.endedAt?.let { "${duration((it - h.startedAt).coerceAtLeast(0) / 1000.0)} · ${ago(it, now)}" } ?: "", style = Echelon.type.label, color = c.textFaint)
            }
            Text(format(t.isk.toDouble(), Kind.Isk) + " · " + tally(t.units, t.timers, t.systems),
                style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
    }
}
