package com.echelon.eve.plan.build

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.unit.dp
import com.echelon.eve.plan.Fact
import com.echelon.eve.plan.PlanPage
import com.echelon.eve.plan.Sys
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.KeyValueRow
import com.echelon.eve.ui.components.ListRow
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.ProgressBar
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SecurityBadge
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.StatRow
import com.echelon.eve.ui.components.StatTile
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.compactNumber
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.format.parseIsk
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import kotlinx.serialization.Serializable

// The bridge's build.plan answer (android/js/plan/build.js).

@Serializable data class Cheaper(val system: String, val jumps: Int, val index: Double, val here: Double)
@Serializable
data class BuildSummary(
    val fit: Int = 0, val of: Int = 0, val best: Double? = null, val buildIn: String? = null, val buildIndex: Double = 0.0, val known: Boolean = false, val alpha: Boolean = false,
    val build: Int = 1, val science: Int = 1, val jobTax: Double = 0.0, val salesTax: Double = 0.0, val brokerFee: Double = 0.0, val cheaper: Cheaper? = null, val overBudget: Int = 0,
)
@Serializable data class Chosen(val name: String, val owned: Boolean = false)
@Serializable data class CrewPlan(val name: String, val chosen: List<Chosen> = emptyList(), val profitDay: Double = 0.0, val spent: Double = 0.0, val slots: Int = 0, val wallet: Double? = null)
@Serializable data class Missing(val name: String, val level: Int)
@Serializable data class Flag(val key: String, val label: String, val why: String)
@Serializable data class Research(val from: Int = 0, val me: Int = 0, val seconds: Double = 0.0, val cost: Double = 0.0)
@Serializable data class Broker(val fee: Double, val applied: Boolean = false, val at: String = "")
@Serializable data class BillRow(val type: Long, val name: String? = null, val qty: Long, val price: Double, val at: String = "")
@Serializable data class Leg(val label: String, val place: String? = null, val jumps: Int? = null, val risky: Int = 0, val note: String? = null)
@Serializable
data class Pick(
    val bp: Long, val type: Long, val name: String, val cat: String = "", val rank: Int = 1, val affordable: Boolean = true, val plan: String? = null,
    val owned: String? = null, val ownedKind: String? = null, val ownedTe: Int? = null, val ownedRuns: Int? = null, val mateOwns: String? = null,
    val missing: List<Missing> = emptyList(), val flags: List<Flag> = emptyList(),
    val profitDay: Double, val payback: Double, val invest: Double, val margin: Double, val me: Int = 0, val runs: Int = 1,
    val price: Double = 0.0, val sellers: Int = 0, val sellerJumps: Int? = null, val research: Research = Research(),
    val unitsPerDay: Double = 0.0, val sellPrice: Double = 0.0, val profitAtZero: Double = 0.0, val broker: Broker? = null,
    val daily: Double = 0.0, val listings: Int = 0, val trend: Double? = null, val materialsRegion: String = "", val bill: List<BillRow> = emptyList(), val legs: List<Leg> = emptyList(),
)
@Serializable data class Facility(val station: String, val system: Sys, val jumps: Int, val index: Double, val tax: Double)
@Serializable data class Facilities(val build: List<Facility> = emptyList(), val research: List<Facility> = emptyList())
@Serializable data class TrainSkill(val key: String, val name: String, val from: Int, val level: Int, val omega: Boolean = false, val why: String)
@Serializable data class Scc(val manufacturing: Double, val research: Double)
@Serializable
data class Guide(val stage: String, val goal: Double, val steps: List<String>, val wallet: Double? = null, val train: List<TrainSkill> = emptyList(), val alpha: Boolean = false,
    val fees: Double = 0.0, val science: Int = 1, val scc: Scc? = null, val npcTax: Double = 0.0)
@Serializable data class OwnedBp(val type: Long, val kind: String, val label: String, val me: Int = 0, val te: Int = 0, val copies: Int = 0, val loc: Long? = null)
@Serializable data class Library(val me: List<OwnedBp>? = null, val mate: List<OwnedBp>? = null)
@Serializable data class Survey(val regions: Int, val of: Int)
@Serializable
data class BuildResult(
    val ready: Boolean = false, val categories: List<String> = emptyList(), val summary: BuildSummary = BuildSummary(), val wing: List<CrewPlan> = emptyList(),
    val picks: List<Pick> = emptyList(), val facilities: Facilities = Facilities(), val guide: Guide? = null, val library: Library = Library(),
    val needOwners: List<Long> = emptyList(), val survey: Survey? = null, val catalog: Int = 0,
)

data class BuildSettings(val system: Long = 30000142, val budget: String = "", val category: String = "", val sort: String = "profit", val showAll: Boolean = false)

data class BuildUi(
    val pilotName: String, val settings: BuildSettings, val starts: List<Pair<Long, String>>, val result: BuildResult? = null, val problem: String? = null,
    val open: Long? = null, val names: Map<Long, String> = emptyMap(), val mateName: String = "",
)

class BuildActions(val settings: (BuildSettings) -> Unit = {}, val open: (Long?) -> Unit = {}, val retry: () -> Unit = {})

private val ROMAN = listOf("0", "I", "II", "III", "IV", "V")
private val SORTS = listOf("profit" to "Profit/day", "payback" to "Payback", "margin" to "Margin", "invest" to "Cheapest start", "near" to "Nearest seller")
private fun short(v: Double) = compactNumber(v)
private fun pct(x: Double) = "${"%.1f".format(java.util.Locale.US, x * 100)}%"
private fun payback(days: Double) = if (days < 1) "under a day" else "${"%.1f".format(java.util.Locale.US, days)} days"

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BuildScreen(ui: BuildUi, actions: BuildActions, modifier: Modifier = Modifier, scroll: Boolean = true) = PlanPage(modifier, scroll) {
    val c = Echelon.colors
    val s = ui.settings
    EchelonCard {
        Text("From", style = Echelon.type.label, color = c.textMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ui.starts.forEach { (id, label) -> ChoiceChip(label, selected = id == s.system, onClick = { actions.settings(s.copy(system = id)) }) }
        }
        OutlinedTextField(s.budget, { actions.settings(s.copy(budget = it)) }, Modifier.fillMaxWidth().padding(top = Spacing.sm), singleLine = true, label = { Text("Budget (ISK)") },
            supportingText = parseIsk(s.budget)?.let { { Text(format(it.toDouble(), Kind.Isk)) } }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text))
        ui.result?.categories?.takeIf { it.isNotEmpty() }?.let { cats ->
            Text("Category", style = Echelon.type.label, color = c.textMuted)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                ChoiceChip("All", selected = s.category.isEmpty(), onClick = { actions.settings(s.copy(category = "")) })
                cats.forEach { cat -> ChoiceChip(cat, selected = s.category == cat, onClick = { actions.settings(s.copy(category = cat)) }) }
            }
        }
        Text("Sort", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SORTS.forEach { (k, label) -> ChoiceChip(label, selected = s.sort == k, onClick = { actions.settings(s.copy(sort = k)) }) }
        }
        Row(Modifier.padding(top = Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Text("Show picks over budget", style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f))
            Switch(s.showAll, { actions.settings(s.copy(showAll = it)) }, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
        }
    }
    val r = ui.result
    when {
        ui.problem != null -> ErrorState("Couldn’t price blueprints", ui.problem, action = { SecondaryButton("Try again", actions.retry) })
        r == null -> SkeletonRows(rows = 5, label = "Pricing starter blueprints…")
        !r.ready -> EmptyState("The hourly pipeline prices starter blueprints on its next run.", title = "No blueprint prices yet", icon = EchelonIcons.Plan)
        else -> Results(ui, r, actions)
    }
}

@Composable
private fun Results(ui: BuildUi, r: BuildResult, actions: BuildActions) {
    val c = Echelon.colors
    val sm = r.summary
    PrimaryPanel {
        StatRow {
            StatTile("Fit your budget", sm.fit.toDouble(), Modifier.weight(1f), note = "of ${plural(sm.of, "blueprint")}")
            StatTile("Best profit", null, Modifier.weight(1f), display = sm.best?.let { "+${short(it)}" } ?: "—", note = "ISK/day", tone = Tone.Ok)
            StatTile("Build index", null, Modifier.weight(1f), display = pct(sm.buildIndex), note = sm.buildIn?.let { "at $it" })
        }
        Text((if (sm.known) "${if (sm.alpha) "Alpha" else "Omega"} clone with ${plural(sm.build, "build slot")} and ${plural(sm.science, "research slot")}." else "Connect ${ui.pilotName} to plan with real skills, slots and wallet.") +
            " Jobs cost ${pct(sm.jobTax)} in tax, selling ${pct(sm.salesTax + sm.brokerFee)} in fees.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        sm.cheaper?.let { ch -> Text("Building in ${ch.system} (${plural(ch.jumps, "jump")}) is cheaper: ${pct(ch.index)} index instead of ${pct(ch.here)} here.", style = MaterialTheme.typography.bodySmall, color = c.warn) }
    }
    // Who builds what.
    SectionHeader("Wing build plan")
    EchelonCard {
        val builders = r.wing.filter { it.chosen.isNotEmpty() }
        Text(if (builders.isEmpty()) "Nothing fits the wing’s wallets with today’s prices yet." else builders.joinToString(", ") { w -> "${w.name} builds ${w.chosen.joinToString(" and ") { if (it.owned) "${it.name} (owns the blueprint)" else it.name }}" } +
            if (builders.size > 1) ". No overlap, so you don’t undercut each other." else ".", style = MaterialTheme.typography.bodyMedium, color = c.text)
        r.wing.forEach { w ->
            Hairline(Modifier.padding(vertical = Spacing.sm))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(w.name, style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f))
                if (w.chosen.isNotEmpty()) Text("+${short(w.profitDay)} ISK/day", style = Echelon.type.num, color = c.ok)
            }
            Text(if (w.chosen.isEmpty()) "Nothing fits ${w.wallet?.let { "a ${format(it, Kind.Isk)} wallet" } ?: "yet"} with today’s prices."
                else "${w.chosen.joinToString { if (it.owned) "${it.name} (owned)" else it.name }} · start-up ${format(w.spent, Kind.Isk)} · ${w.chosen.size} of ${w.slots} slots${w.wallet?.let { " · ${format(it - w.spent, Kind.Isk)} left" } ?: ""}",
                style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
    }
    SectionHeader("Blueprints to start with", subtitle = "Best first. Tap one for its trip plan and material bill." + if (sm.overBudget > 0 && !ui.settings.showAll) " ${sm.overBudget} more need a bigger budget." else "")
    if (r.picks.isEmpty()) EmptyState(if (sm.overBudget > 0 && !ui.settings.showAll) "${sm.overBudget} picks need more. Grow the wallet with the guide’s stage plan, or look at what’s over budget." else "Try another system or check after the next hourly scan.",
        title = if (sm.overBudget > 0 && !ui.settings.showAll) "Nothing profitable fits this budget yet" else "No starter blueprint turns a profit at today’s prices", icon = EchelonIcons.Plan,
        action = if (sm.overBudget > 0 && !ui.settings.showAll) ({ SecondaryButton("Show picks over budget", { actions.settings(ui.settings.copy(showAll = true)) }) }) else null)
    else EchelonCard(padding = false) {
        r.picks.forEachIndexed { i, p ->
            if (i > 0) Hairline()
            val open = ui.open == p.bp
            ListRow(
                title = p.name,
                supporting = "${pct(p.margin)} margin · pays back in ${payback(p.payback)} · ${short(p.invest)} to start",
                meta = listOfNotNull(p.cat, p.plan?.let { "$it’s plan" }, if (!p.affordable) "Over budget" else null, if (p.missing.isNotEmpty()) "Needs skills" else null, p.owned).joinToString(" · "),
                trailing = { Text("+${short(p.profitDay)}", style = Echelon.type.num, color = if (p.affordable) c.ok else c.textFaint) },
                onClick = { actions.open(if (open) null else p.bp) },
            )
            AnimatedVisibility(open) { PickDetail(p, ui) }
        }
    }
    r.guide?.let { g -> Guide(g, sm) }
    SectionHeader("Facilities", subtitle = "NPC stations in high-sec within 10 jumps; a lower index means cheaper jobs")
    EchelonCard(padding = false) {
        val all = r.facilities.build.map { "Build" to it } + r.facilities.research.map { "Research (ME)" to it }
        if (all.isEmpty()) Text("No high-sec NPC station with these services within 10 jumps.", Modifier.padding(Spacing.md), style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        all.forEachIndexed { i, (kind, f) ->
            if (i > 0) Hairline()
            ListRow(f.station, supporting = "$kind · ${if (f.jumps > 0) plural(f.jumps, "jump") else "here"} · index ${pct(f.index)} · job tax ${pct(f.tax)}", leading = { SecurityBadge(f.system.sec) })
        }
    }
    SectionHeader("My blueprints", subtitle = "A blueprint that matches a pick skips its purchase and uses its own ME and TE")
    EchelonCard {
        LibraryBlock(ui.pilotName, r.library.me, ui.names)
        if (ui.mateName.isNotEmpty()) { Hairline(Modifier.padding(vertical = Spacing.sm)); LibraryBlock(ui.mateName, r.library.mate, ui.names) }
    }
}

@Composable
private fun PickDetail(p: Pick, ui: BuildUi) {
    val c = Echelon.colors
    Column(Modifier.padding(start = Spacing.md, end = Spacing.md, bottom = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        StatRow {
            StatTile("Profit", null, Modifier.weight(1f), display = "+${short(p.profitDay)}", note = "ISK/day", tone = Tone.Ok)
            StatTile("Pays back", null, Modifier.weight(1f), display = if (p.payback < 1) "<1" else "%.1f".format(java.util.Locale.US, p.payback), note = "days")
            StatTile("Start-up", null, Modifier.weight(1f), display = short(p.invest), note = "ISK")
        }
        val lead = listOfNotNull(p.plan?.let { "In $it’s plan." }, if (p.plan == null && !p.affordable) "Over budget." else null,
            p.missing.takeIf { it.isNotEmpty() }?.let { m -> "Needs ${m.joinToString { sk -> "${sk.name} ${ROMAN.getOrElse(sk.level) { "${sk.level}" }}" }}." },
            p.mateOwns?.let { "${ui.mateName} owns this blueprint: $it." }).joinToString(" ")
        if (lead.isNotEmpty()) Text(lead, style = MaterialTheme.typography.bodyMedium, color = if (p.missing.isNotEmpty() || !p.affordable) c.warn else c.text)
        p.flags.forEach { f -> Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) { Tag(f.label, tone = Tone.Warn); Text(f.why, style = MaterialTheme.typography.bodySmall, color = c.textMuted) } }
        Fact("Blueprint", if (p.owned != null) "${p.cat} · ${p.owned} · yours" else "${p.cat} · BPO ${format(p.price, Kind.Isk)} · rank ${p.rank}")
        if (p.owned == null) Fact("NPC sellers", if (p.sellerJumps != null) "${plural(p.sellers, "station")} · nearest ${if (p.sellerJumps == 0) "here" else plural(p.sellerJumps, "jump")}" else "None reachable through high-sec")
        Fact("Research", if (p.research.me > p.research.from) "ME ${p.research.from} → ${p.me} · ${duration(p.research.seconds)} · ${format(p.research.cost, Kind.Isk)}" else if (p.ownedKind == "bpc") "A copy can’t be researched · ME ${p.me}" else "None needed · ME ${p.me}")
        p.ownedTe?.let { KeyValueRow("Time efficiency", "TE $it: builds take $it% less time") }
        p.ownedRuns?.let { Fact("Copy", "${plural(it, "run")} left, so this batch is capped at ${plural(p.runs, "run")}") }
        Fact("Sells", "${if (p.unitsPerDay >= 1) "${"%,d".format(Math.round(p.unitsPerDay))}/day" else "1 every ${Math.round(1 / maxOf(p.unitsPerDay, 1e-6))} days"} at ${format(p.sellPrice, Kind.Isk)}")
        KeyValueRow("At ME 0", "${if (p.profitAtZero > 0) "+" else ""}${format(p.profitAtZero, Kind.Isk)} per unit")
        p.broker?.let { KeyValueRow("Broker fee", "${pct(it.fee)}${if (it.applied) "" else " · standings not applied"}") }
        Fact("Hub market", "${"%,d".format(Math.round(p.daily))} traded/day · ${plural(p.listings, "station")} competing")
        p.trend?.let { t -> Fact("Hub price", "${if (t >= 0) "+" else ""}${Math.round(t * 100)}% vs 7-day average${if (t > 0.15) " · likely a spike" else if (t < -0.1) " · below normal" else ""}") }
        Text("Material bill · ${plural(p.runs, "run")} at ME ${p.me}, bought in ${p.materialsRegion}", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        p.bill.forEach { b -> KeyValueRow("${b.name ?: ui.names[b.type] ?: "Type ${b.type}"} ×${"%,d".format(b.qty)}", format(b.qty * b.price, Kind.Isk)) }
        Text("Trip plan", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        p.legs.forEachIndexed { i, l ->
            Text("${i + 1}. ${l.label}${l.place?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodyMedium, color = c.text)
            Text(when {
                l.place == null -> "No NPC seller reachable through high-sec. Search “${p.name} Blueprint” on the in-game market."
                l.jumps == null -> "Route unknown"
                l.jumps == 0 -> "Here"
                else -> plural(l.jumps, "jump") + if (l.risky > 0) " · ${l.risky} through low-sec" else ""
            }, style = MaterialTheme.typography.bodySmall, color = if (l.risky > 0) c.warn else c.textMuted)
        }
    }
}

@Composable
private fun Guide(g: Guide, sm: BuildSummary) {
    val c = Echelon.colors
    SectionHeader("Build guide")
    EchelonCard {
        Text(g.stage, style = MaterialTheme.typography.titleMedium, color = c.text)
        ProgressBar(((g.wallet ?: 0.0) / g.goal).toFloat().coerceIn(0f, 1f), Modifier.fillMaxWidth().padding(vertical = Spacing.xs))
        Text("${format(g.wallet, Kind.Isk)} of ${format(g.goal, Kind.Isk)}", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        g.steps.forEachIndexed { i, step -> Text("${i + 1}. $step", style = MaterialTheme.typography.bodySmall, color = c.text) }
        Text("Train next", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        if (g.train.isEmpty()) Text(if (g.alpha) "You have every industry skill an Alpha can train. Omega unlocks more slots and lower taxes." else "Core industry skills are done. Look at invention next.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        g.train.forEach { t -> KeyValueRow("${t.name} ${ROMAN.getOrElse(t.level) { "${t.level}" }}${if (t.omega) " (Omega)" else ""}", if (t.from > 0) "from ${ROMAN.getOrElse(t.from) { "${t.from}" }}" else "new"); Text(t.why, style = MaterialTheme.typography.bodySmall, color = c.textFaint) }
        Text("Avoid these traps", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        listOf(
            "Price your own ore at market value: minerals you mine could be sold instead.",
            "Margins under ~${Math.round(g.fees * 100 + 2)}% are losses for you: sales tax and broker fee alone take ${pct(g.fees)}.",
            "Batch your runs: ME rounds up per job, so a 1-run job wastes materials a 100-run job saves.",
            "Never leave a slot idle: research the next blueprint while the current one builds${if (g.science > 1) "; you have ${g.science} research slots" else ""}.",
            "Buy BPOs from the NPC market: unresearched T1 originals are always there at the NPC price.",
        ).plus(if (g.alpha) listOf("Alphas pay an extra industry tax (assumed 2% here). Omega on the main builder removes it.") else emptyList())
            .forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
        g.scc?.let { Text("Assumes SCC surcharge ${pct(it.manufacturing)} on builds and ${pct(it.research)} on research, and ${pct(g.npcTax)} NPC facility tax. Confirm against the in-game job window.", style = MaterialTheme.typography.bodySmall, color = c.textFaint, modifier = Modifier.padding(top = Spacing.xs)) }
    }
}

@Composable
private fun LibraryBlock(name: String, list: List<OwnedBp>?, names: Map<Long, String>) {
    val c = Echelon.colors
    Text(if (list.isNullOrEmpty()) name else "$name · ${plural(list.size, "blueprint")}", style = MaterialTheme.typography.titleSmall, color = c.text)
    when {
        list == null -> Text("$name’s blueprints are not shared with the wing.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        list.isEmpty() -> Text("No blueprints found.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        else -> list.forEach { b ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs), modifier = Modifier.padding(vertical = 2.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(names[b.type] ?: "Type ${b.type}", style = MaterialTheme.typography.bodyMedium, color = c.text)
                    Text(b.loc?.let { if (it in 60_000_000..63_999_999) names[it] ?: "A station" else "In a structure or container" } ?: "Location unknown", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
                }
                Tag(b.label, tone = if (b.kind == "bpo") Tone.Ok else Tone.Neutral)
            }
        }
    }
}
