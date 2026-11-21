package com.echelon.eve.fly.wing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.Presence
import com.echelon.eve.core.wing.SharedPlan
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingEvent
import com.echelon.eve.core.wing.WingPing
import com.echelon.eve.fly.FlyPage
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.WingChip
import com.echelon.eve.ui.format.ago
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing

/** One line of the wing feed: a ping or a shared plan, newest first. */
sealed interface FeedItem {
    val from: Pilot?
    val at: Long
    val id: String
    data class Ping(override val from: Pilot?, override val at: Long, override val id: String, val ping: WingPing) : FeedItem
    data class Plan(override val from: Pilot?, override val at: Long, override val id: String, val plan: SharedPlan) : FeedItem
}

fun feed(pings: List<WingEvent<WingPing>>, plans: List<WingEvent<SharedPlan>>): List<FeedItem> =
    (pings.map { FeedItem.Ping(it.from, it.at, it.id, it.value) } + plans.map { FeedItem.Plan(it.from, it.at, it.id, it.value) }).sortedByDescending { it.at }

/** The quick calls the room knows (worker/wingroom.js), in the words the notification uses. */
val PINGS = listOf(WingPing.UNDOCK to "Undocking", WingPing.OMW to "On my way", WingPing.HELP to "Need help", WingPing.DOCKED to "Docked up")
fun pingText(p: WingPing): String = when (p.kind) { WingPing.CUSTOM -> p.text.orEmpty(); else -> PINGS.firstOrNull { it.first == p.kind }?.second ?: p.kind }

data class WingUi(
    val pilot: Pilot?, val status: WingChannel.Status, val presence: Map<Long, Presence>, val feed: List<FeedItem>,
    val custom: String = "", val shareSystem: Boolean = false, val here: String? = null, val systemName: (Long) -> String? = { null },
    val canSend: Boolean = false, val sent: String? = null,
)

class WingActions(val ping: (String) -> Unit = {}, val custom: (String) -> Unit = {}, val sendCustom: () -> Unit = {}, val shareSystem: (Boolean) -> Unit = {},
    val autopilot: (SharedPlan) -> Unit = {}, val reconnect: () -> Unit = {})

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WingScreen(ui: WingUi, now: Long, actions: WingActions, modifier: Modifier = Modifier, scroll: Boolean = true) = FlyPage(modifier, scroll) {
    val c = Echelon.colors
    val pilot = ui.pilot
    if (pilot == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Wing); return@FlyPage }
    val mate = pilot.wingmate
    val p = ui.presence[mate.id]
    PrimaryPanel {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatusDot(if (p?.online == true) Tone.Ok else Tone.Neutral, live = p?.online == true)
            Text(if (p?.online == true) "${mate.displayName} has the app open" else "${mate.displayName} is away", style = Echelon.type.screenTitle, color = c.text)
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
        }
    }
    ui.sent?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
}
