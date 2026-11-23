package com.echelon.eve.plan.mine

import com.echelon.eve.ui.motion.RollingNumber
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.plan.PlanPage
import com.echelon.eve.plan.Sys
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.KeyValueRow
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.ListRow
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SecurityBadge
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.Developed
import com.echelon.eve.ui.components.rememberWasLoading
import com.echelon.eve.ui.components.StatRow
import com.echelon.eve.ui.components.StatTile
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.compactNumber
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import kotlinx.serialization.Serializable

// The bridge's mine.plan answer (android/js/plan/mine.js).

@Serializable data class OreAt(val name: String, val perM3: Double, val how: String, val at: String? = null)
@Serializable
data class Belt(
    val system: Sys, val jumps: Int, val belts: Int = 0, val iskHour: Double, val kills: Int = 0, val traffic: Int = 0, val crowd: Boolean = false,
    val lowsecRoute: Boolean = false, val lowsec: Boolean = false, val ores: List<OreAt> = emptyList(),
)
@Serializable data class MineShip(val id: Long, val name: String, val current: Boolean = false, val flyable: Boolean = true, val rate: Double, val hold: Double, val needs: String? = null, val iskHour: Double? = null)
@Serializable data class MinerPlan(val name: String, val known: Boolean = false, val ship: MineShip, val start: Sys? = null, val sites: List<Belt> = emptyList(), val usesYourStart: Boolean = false)
@Serializable data class Together(val kind: String, val system: Sys? = null, val jumps: Int? = null)
@Serializable data class MineTrain(val name: String, val level: Int, val from: Int, val why: String)
@Serializable data class OreValue(val name: String, val perM3: Double, val how: String, val raw: Double, val compressed: Double, val refined: Double)
@Serializable data class LedgerSystem(val name: String, val m3: Double, val isk: Double, val days: Int)
@Serializable data class Ledger(val state: String, val m3: Double = 0.0, val isk: Double = 0.0, val days: Int = 0, val systems: List<LedgerSystem> = emptyList())
@Serializable data class Ledgers(val me: Ledger? = null, val mate: Ledger? = null)
@Serializable
data class MineResult(
    val ready: Boolean = false, val me: MinerPlan? = null, val mate: MinerPlan? = null, val together: Together? = null,
    val ships: List<MineShip> = emptyList(), val train: List<MineTrain> = emptyList(), val ores: List<OreValue> = emptyList(), val ledgers: Ledgers = Ledgers(),
)

data class MineSettings(val from: Long = 30000142, val maxJumps: Int = 5, val lowsec: Boolean = false, val ship: Long? = null)

data class MineUi(
    val pilot: Pilot, val settings: MineSettings, val starts: List<Pair<Long, String>>, val result: MineResult? = null, val problem: String? = null,
    val open: Long? = null, val canSend: Boolean = false, val sent: String? = null,
)

class MineActions(val settings: (MineSettings) -> Unit = {}, val open: (Long?) -> Unit = {}, val sendTo: (Long) -> Unit = {}, val retry: () -> Unit = {})

private val ROMAN = listOf("0", "I", "II", "III", "IV", "V")
private val SHIPS = listOf(32880L to "Venture", 17480L to "Procurer", 17478L to "Retriever", 17476L to "Covetor")
private fun short(isk: Double) = compactNumber(isk)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MineScreen(ui: MineUi, actions: MineActions, modifier: Modifier = Modifier, scroll: Boolean = true) = PlanPage(modifier, scroll) {
    val c = Echelon.colors
    val s = ui.settings
    EchelonCard {
        Text("From", style = Echelon.type.label, color = c.textMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ui.starts.forEach { (id, label) -> ChoiceChip(label, selected = id == s.from, onClick = { actions.settings(s.copy(from = id)) }) }
        }
        Text("Within", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            listOf(0, 2, 5, 10).forEach { j -> ChoiceChip(if (j == 0) "Here" else "$j jumps", selected = j == s.maxJumps, onClick = { actions.settings(s.copy(maxJumps = j)) }) }
        }
        Text("Ship", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ChoiceChip("Mine", selected = s.ship == null, onClick = { actions.settings(s.copy(ship = null)) })
            SHIPS.forEach { (id, n) -> ChoiceChip(n, selected = s.ship == id, onClick = { actions.settings(s.copy(ship = id)) }) }
        }
        Row(Modifier.padding(top = Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Include low-sec", style = MaterialTheme.typography.titleSmall, color = c.text)
                Text("Richer ore, no CONCORD", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            }
            Switch(s.lowsec, { actions.settings(s.copy(lowsec = it)) }, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
        }
    }
    val r = ui.result
    val developing = rememberWasLoading(r == null)
    when {
        ui.problem != null -> ErrorState("Couldn’t rank belts", ui.problem, action = { SecondaryButton("Try again", actions.retry) })
        r == null -> SkeletonRows(rows = 5, label = "Pricing ore…")
        !r.ready || r.me == null -> EmptyState("The hourly pipeline prices ore on its next run.", title = "No ore prices yet", icon = EchelonIcons.Search)
        else -> Developed(developing) { Results(ui, r, r.me, actions) }
    }
}

@Composable
private fun Results(ui: MineUi, r: MineResult, me: MinerPlan, actions: MineActions) {
    val c = Echelon.colors
    val best = me.sites.firstOrNull()
    PrimaryPanel {
        StatRow {
            StatTile("m³/min", Math.round(me.ship.rate).toDouble(), Modifier.weight(1f), note = me.ship.name)
            StatTile("Best ISK/h", null, Modifier.weight(1f), display = best?.let { short(it.iskHour) } ?: "—", note = best?.system?.name, tone = Tone.Ok)
            StatTile("Belts", me.sites.size.toDouble(), Modifier.weight(1f), note = "within ${ui.settings.maxJumps} jumps")
        }
        Text(buildString {
            append("${me.ship.name}${if (me.ship.current) " (current ship)" else if (!me.ship.flyable) " (not trained yet)" else ""} · ${Math.round(me.ship.rate)} m³/min · ${"%,d".format(Math.round(me.ship.hold))} m³ hold. ")
            if (!me.known) append("Connect ${me.name} to use real skills, ship and location. ")
            append("Ranked by ISK per hour at the belt, lowered by recent kills, heavy traffic and travel over a 2-hour session.")
        }, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        r.together?.let { t ->
            val mate = r.mate?.name ?: ui.pilot.wingmate.displayName
            Text(when (t.kind) {
                "same" -> "You and $mate both do best at ${t.system?.name}. Mine together and share one hauler trip."
                "apart" -> "$mate does best at ${t.system?.name}${t.jumps?.let { if (it == 0) " (right here)" else " (${plural(it, "jump")} from you)" } ?: ""}."
                else -> "$mate has no belts in range right now."
            }, style = MaterialTheme.typography.bodyMedium, color = c.text)
        }
    }
    SectionHeader("Belts for ${me.name}", subtitle = "Best first. Tap a belt for its ores, risk and route.")
    if (me.sites.isEmpty()) EmptyState("Widen the range or include low-sec.", title = "No ${if (ui.settings.lowsec) "" else "high-sec "}belts with known ore within ${ui.settings.maxJumps} jumps", icon = EchelonIcons.Search,
        action = if (ui.settings.maxJumps < 10) ({ SecondaryButton("Search 10 jumps", { actions.settings(ui.settings.copy(maxJumps = 10)) }) }) else null)
    else EchelonCard(padding = false) {
        me.sites.forEachIndexed { i, b ->
            if (i > 0) Hairline()
            val open = ui.open == b.system.id
            ListRow(
                title = b.system.name,
                supporting = "${if (b.jumps > 0) plural(b.jumps, "jump") else "you are here"} · ${b.ores.firstOrNull()?.name ?: ""} · ${if (b.kills > 0) "${b.kills} killed last hour" else "no kills"}",
                meta = listOfNotNull(if (b.lowsec) "Low-sec" else null, if (b.lowsecRoute) "Low-sec route" else null, if (b.crowd) "Busy" else null).joinToString(" · ").ifEmpty { null },
                leading = { SecurityBadge(b.system.sec) },
                trailing = { Text(short(b.iskHour), style = Echelon.type.num, color = c.ok) },
                onClick = { actions.open(if (open) null else b.system.id) },
            )
            AnimatedVisibility(open) {
                Column(Modifier.padding(start = Spacing.md, end = Spacing.md, bottom = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    b.ores.firstOrNull()?.let { o -> Text("Mine ${o.name}: ${format(o.perM3, Kind.Isk)}/m³, best sold ${o.how}${o.at?.let { " at $it" } ?: if (o.how == "reprocessed") " as minerals" else ""}.", style = MaterialTheme.typography.bodyMedium, color = c.text) }
                    KeyValueRow("Hold fills in", duration(me.ship.hold / (me.ship.rate / 60)))
                    KeyValueRow("Belts", plural(b.belts, "belt"))
                    KeyValueRow("Last hour", if (b.kills > 0) plural(b.kills, "ship") + " killed" else "No kills")
                    KeyValueRow("Traffic", "${"%,d".format(b.traffic)} jumps/h${if (b.crowd) " · busy, belts may be stripped" else ""}")
                    b.ores.forEach { o -> KeyValueRow(o.name, "${format(o.perM3, Kind.Isk)}/m³ · ${o.how}") }
                    if (ui.canSend && b.jumps > 0) LinkButton("Set autopilot here", { actions.sendTo(b.system.id) })
                }
            }
        }
    }
    ui.sent?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
    // Ships, ore values, ledger, the wingmate's spots.
    SectionHeader("Compare ships", subtitle = "Two Miner I/II on the Venture, two Strip Miner I on barges, with ${me.name}’s skills${best?.let { "; ISK/h at ${it.system.name}" } ?: ""}")
    EchelonCard(padding = false) {
        r.ships.forEachIndexed { i, sh ->
            if (i > 0) Hairline()
            ListRow(sh.name + if (sh.current) " · current" else "", supporting = "${Math.round(sh.rate)} m³/min · ${"%,d".format(Math.round(sh.hold))} m³ hold",
                meta = sh.needs?.let { "Train $it" }, trailing = { Text(sh.iskHour?.let { short(it) } ?: "—", style = Echelon.type.num, color = if (sh.flyable) c.text else c.textFaint) })
        }
    }
    if (r.train.isNotEmpty()) EchelonCard {
        Text("Train next", style = Echelon.type.label, color = c.textMuted)
        r.train.forEach { t -> KeyValueRow("${t.name} ${ROMAN.getOrElse(t.level) { "${t.level}" }}", if (t.from > 0) "from ${ROMAN.getOrElse(t.from) { "${t.from}" }}" else "new"); Text(t.why, style = MaterialTheme.typography.bodySmall, color = c.textFaint) }
    }
    SectionHeader("What ore is worth", subtitle = "ISK per m³ after sales tax, into the best hub buy order")
    EchelonCard(padding = false) {
        r.ores.forEachIndexed { i, o ->
            if (i > 0) Hairline()
            ListRow(o.name, supporting = "Raw ${format(o.raw, Kind.Isk)} · compressed ${format(o.compressed, Kind.Isk)} · minerals ${format(o.refined, Kind.Isk)} per unit",
                trailing = { Column(horizontalAlignment = Alignment.End) { RollingNumber(o.perM3, kind = Kind.Isk, style = Echelon.type.num, color = c.text); Text(o.how, style = Echelon.type.label, color = c.textMuted) } })
        }
    }
    SectionHeader("Last 30 days")
    EchelonCard {
        LedgerBlock(me.name, r.ledgers.me)
        r.mate?.let { Hairline(Modifier.padding(vertical = Spacing.sm)); LedgerBlock(it.name, r.ledgers.mate) }
    }
    r.mate?.let { m ->
        SectionHeader("${m.name}’s best spots", subtitle = "${m.ship.name} · from ${m.start?.name ?: "?"}${if (m.usesYourStart) " (their location isn’t shared, so this uses yours)" else ""}")
        EchelonCard(padding = m.sites.isEmpty()) {
            if (m.sites.isEmpty()) Text("No belts in range.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            m.sites.forEachIndexed { i, b ->
                if (i > 0) Hairline()
                ListRow(b.system.name, supporting = "${if (b.jumps > 0) plural(b.jumps, "jump") else "here"} · ${b.ores.firstOrNull()?.name ?: ""}${if (b.kills > 0) " · ${b.kills} killed last hour" else ""}",
                    leading = { SecurityBadge(b.system.sec) }, trailing = { Text(short(b.iskHour), style = Echelon.type.num, color = c.text) })
            }
        }
    }
}

@Composable
private fun LedgerBlock(name: String, l: Ledger?) {
    val c = Echelon.colors
    Text(name, style = MaterialTheme.typography.titleSmall, color = c.text)
    when (l?.state) {
        "ok" -> {
            KeyValueRow("Mined", "${"%,d".format(Math.round(l.m3))} m³ · ${plural(l.days, "day")} in the last 30")
            KeyValueRow("Worth today", format(l.isk, Kind.Isk))
            KeyValueRow("Per mining day", format(l.isk / maxOf(1, l.days), Kind.Isk))
            l.systems.forEach { s -> Text("${s.name}: ${"%,d".format(Math.round(s.m3))} m³ over ${plural(s.days, "day")} · ${format(s.isk, Kind.Isk)}", style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
        }
        "no-permission" -> Text("Permission not granted. Reconnect in Settings to allow the mining ledger.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        "none" -> Text("No mining in the last 30 days.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        else -> Text("Not shared yet.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
    }
}
