package com.echelon.eve.plan.trade

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import com.echelon.eve.plan.Fact
import com.echelon.eve.plan.PlanPage
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
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.StatRow
import com.echelon.eve.ui.components.StatTile
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.compactNumber
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.format.parseIsk
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import kotlinx.serialization.Serializable

// The bridge's trade.plan answer (android/js/plan/trade.js).

@Serializable data class Place(val loc: Long, val station: String, val system: Long? = null, val systemName: String? = null, val price: Double = 0.0)
@Serializable
data class Haul(val type: Long, val name: String? = null, val from: Place, val to: Place, val units: Long, val m3: Double, val invest: Double, val profit: Double, val perJump: Double,
    val toA: Int, val ab: Int, val whole: Boolean = false)
@Serializable
data class Spread(val type: Long, val name: String? = null, val at: Place, val buy: Double, val sell: Double, val margin: Double, val volume: Double, val capital: Double, val daily: Double, val jumps: Int? = null)
@Serializable
data class BuildMargin(val type: Long, val name: String? = null, val at: Place, val materials: Double, val job: Double, val revenue: Double, val profit: Double, val margin: Double, val daily: Double, val jumps: Int? = null)
@Serializable data class Fees(val salesTax: Double, val brokerFee: Double, val known: Boolean = false, val brokerLevel: Int = 0, val cargo: Double = 5000.0, val budget: Double? = null)
@Serializable data class HubFee(val hub: String, val fee: Double, val applied: Boolean = false, val faction: Double? = null, val corp: Double? = null)
@Serializable
data class TradeResult(
    val ready: Boolean = false, val hauls: List<Haul> = emptyList(), val spreads: List<Spread> = emptyList(), val builds: List<BuildMargin> = emptyList(),
    val tooDear: Int = 0, val index: Double = 0.0, val recipesError: String? = null, val fees: Fees? = null, val brokers: List<HubFee> = emptyList(),
    val needOwners: List<Long> = emptyList(), val items: Int = 0,
)

data class TradeSettings(val from: Long = 30000142, val maxJumps: Int = 5, val cargo: String = "", val budget: String = "", val list: String = "haul", val sort: String = "")

data class TradeUi(
    val pilotName: String, val settings: TradeSettings, val starts: List<Pair<Long, String>>, val result: TradeResult? = null, val problem: String? = null,
    val open: Int? = null, val canSend: Boolean = false, val sent: String? = null, val names: Map<Long, String> = emptyMap(), val regions: Int = 0,
)

class TradeActions(val settings: (TradeSettings) -> Unit = {}, val open: (Int?) -> Unit = {}, val send: (List<Long>) -> Unit = {}, val retry: () -> Unit = {})

private val LISTS = listOf("haul" to "Haul & flip", "spread" to "Station spreads", "build" to "Build")
private val SORTS = mapOf(
    "haul" to listOf("" to "Profit per jump", "profit" to "Total profit", "invest" to "Lowest investment", "jumps" to "Fewest jumps"),
    "spread" to listOf("" to "Best first", "margin" to "Highest margin", "daily" to "Most per day", "jumps" to "Fewest jumps"),
    "build" to listOf("" to "Best first", "profit" to "Profit per run", "margin" to "Highest margin", "materials" to "Cheapest materials"),
)
private fun short(v: Double) = compactNumber(v)
private fun pct(x: Double, d: Int = 1) = "%.${d}f%%".format(java.util.Locale.US, x * 100)
private fun jumpsText(j: Int?) = when (j) { null -> "—"; 0 -> "here"; else -> "$j j" }

/** The rows of the chosen list, sorted the web's way (TRADE_SORTS). */
internal fun sortedHauls(list: List<Haul>, sort: String) = when (sort) { "profit" -> list.sortedByDescending { it.profit }; "invest" -> list.sortedBy { it.invest }; "jumps" -> list.sortedBy { it.toA + it.ab }; else -> list }
internal fun sortedSpreads(list: List<Spread>, sort: String) = when (sort) { "margin" -> list.sortedByDescending { it.margin }; "daily" -> list.sortedByDescending { it.daily }; "jumps" -> list.sortedBy { it.jumps ?: 999 }; else -> list }
internal fun sortedBuilds(list: List<BuildMargin>, sort: String) = when (sort) { "profit" -> list.sortedByDescending { it.profit }; "margin" -> list.sortedByDescending { it.margin }; "materials" -> list.sortedBy { it.materials }; else -> list }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TradeScreen(ui: TradeUi, actions: TradeActions, modifier: Modifier = Modifier, scroll: Boolean = true) = PlanPage(modifier, scroll) {
    val c = Echelon.colors
    val s = ui.settings
    EchelonCard {
        Text("From", style = Echelon.type.label, color = c.textMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ui.starts.forEach { (id, label) -> ChoiceChip(label, selected = id == s.from, onClick = { actions.settings(s.copy(from = id)) }) }
        }
        Text("Buy within", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            listOf(0 to "This system", 5 to "5 jumps", 10 to "10 jumps", 99 to "Any distance").forEach { (j, l) -> ChoiceChip(l, selected = j == s.maxJumps, onClick = { actions.settings(s.copy(maxJumps = j)) }) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.padding(top = Spacing.sm)) {
            val colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text)
            OutlinedTextField(s.cargo, { actions.settings(s.copy(cargo = it)) }, Modifier.weight(1f), singleLine = true, label = { Text("Cargo (m³)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), colors = colors)
            OutlinedTextField(s.budget, { actions.settings(s.copy(budget = it)) }, Modifier.weight(1f), singleLine = true, label = { Text("Budget (ISK)") },
                supportingText = parseIsk(s.budget)?.let { { Text(format(it.toDouble(), Kind.Isk)) } }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), colors = colors)
        }
    }
    val r = ui.result
    when {
        ui.problem != null -> ErrorState("Couldn’t scan the market", ui.problem, action = { SecondaryButton("Try again", actions.retry) })
        r == null -> SkeletonRows(rows = 5, label = "Scanning stations…")
        !r.ready -> EmptyState("The hourly pipeline stores its first scan on its next run.", title = "No market data yet", icon = EchelonIcons.Swap)
        else -> Results(ui, r, actions)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Results(ui: TradeUi, r: TradeResult, actions: TradeActions) {
    val c = Echelon.colors
    val s = ui.settings
    val f = r.fees
    val best = r.hauls.firstOrNull()
    val name = { type: Long, n: String? -> n ?: ui.names[type] ?: "Type $type" }
    PrimaryPanel {
        StatRow {
            StatTile("Budget", null, Modifier.weight(1f), display = f?.budget?.let { short(it) } ?: "Any", note = if (f?.budget != null) "ISK" else null)
            StatTile("Cargo", f?.cargo ?: 0.0, Modifier.weight(1f), note = "m³")
            StatTile("Best haul", null, Modifier.weight(1f), display = best?.let { "+${short(it.perJump)}" } ?: "—", note = if (best != null) "ISK per jump" else null, tone = Tone.Ok)
        }
        Text(best?.let { "Best haul: ${name(it.type, it.name)} from ${it.from.systemName} to ${it.to.systemName}, ${plural(it.toA + it.ab, "jump")} in all." } ?: "No haul pays for this cargo and budget right now.",
            style = MaterialTheme.typography.bodyMedium, color = c.text)
        f?.let { Text("Sales tax ${pct(it.salesTax, 2)} · broker fee ${pct(it.brokerFee, 2)} before standings · ${if (it.known) "from ${ui.pilotName}’s skills" else "base rates (connect for your skills)"}", style = MaterialTheme.typography.bodySmall, color = c.textFaint) }
    }
    if (r.brokers.isNotEmpty()) {
        SectionHeader("Broker fee by hub", subtitle = "Less 0.03% per point of faction standing and 0.02% per point of corporation standing, never below 1%")
        EchelonCard(padding = false) {
            r.brokers.forEachIndexed { i, h ->
                if (i > 0) Hairline()
                ListRow(h.hub, supporting = if (h.applied) "standing ${"%.1f".format(h.faction ?: 0.0)} with the faction, ${"%.1f".format(h.corp ?: 0.0)} with the corporation" else "standings not applied",
                    trailing = { Text(pct(h.fee, 2), style = Echelon.type.num, color = c.text) })
            }
        }
    }
    val counts = mapOf("haul" to r.hauls.size, "spread" to r.spreads.size, "build" to r.builds.size)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        LISTS.forEach { (k, l) -> ChoiceChip("$l · ${counts[k]}", selected = s.list == k, onClick = { actions.settings(s.copy(list = k, sort = "")); actions.open(null) }) }
    }
    Text(when (s.list) {
        "haul" -> "Buy from a sell order, fly, sell into a buy order. Ranked by profit per jump."
        "spread" -> "Buy at the top bid, relist at the lowest ask. About 5% of daily volume, within your budget."
        else -> "One run with an ME 0 blueprint you own, at ${pct(r.index, 2)} system index + fees." + if (r.tooDear > 0) " ${r.tooDear} more profitable ${if (r.tooDear == 1) "build needs" else "builds need"} a bigger budget." else ""
    }, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SORTS.getValue(s.list).forEach { (k, l) -> ChoiceChip(l, selected = s.sort == k, onClick = { actions.settings(s.copy(sort = k)) }) }
    }
    when (s.list) {
        "haul" -> {
            val list = sortedHauls(r.hauls, s.sort)
            if (list.isEmpty()) EmptyState("Widen the buy range or raise the budget.", title = "No profitable hauls within ${s.maxJumps} jumps for this cargo", icon = EchelonIcons.Swap,
                action = { SecondaryButton("Search any distance", { actions.settings(s.copy(maxJumps = 99)) }) })
            else EchelonCard(padding = false) {
                list.forEachIndexed { i, h ->
                    if (i > 0) Hairline()
                    ListRow(name(h.type, h.name), supporting = "${h.from.systemName} ${jumpsText(h.toA)} → ${h.to.systemName} +${h.ab} j · ${"%,d".format(h.units)} units",
                        meta = "Invest ${short(h.invest)} · +${short(h.profit)}${if (h.whole) " · whole budget" else ""}",
                        trailing = { Column(horizontalAlignment = Alignment.End) { Text(short(h.perJump), style = Echelon.type.num, color = c.ok); Text("ISK/jump", style = Echelon.type.label, color = c.textMuted) } },
                        onClick = { actions.open(if (ui.open == i) null else i) })
                    AnimatedVisibility(ui.open == i) {
                        Detail {
                            KeyValueRow("Cargo", "${"%,d".format(h.units)} units · ${"%,d".format(Math.round(h.m3))} m³")
                            Fact("Buy", "${format(h.from.price, Kind.Isk)} each · ${h.from.station}")
                            Fact("Sell", "${format(h.to.price, Kind.Isk)} each · ${h.to.station}")
                            Fact("Route", "${jumpsText(h.toA)} to buy, then ${plural(h.ab, "jump")} to sell")
                            Text("Buy from a sell order, fly, sell into a buy order. Prices move: check both orders before you undock.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
                            if (ui.canSend) LinkButton("Set autopilot: buy, then sell", { actions.send(listOfNotNull(h.from.system?.takeIf { h.toA > 0 }, h.to.system)) })
                        }
                    }
                }
            }
        }
        "spread" -> {
            val list = sortedSpreads(r.spreads, s.sort)
            if (list.isEmpty()) EmptyState("Try another starting hub or a bigger budget.", title = "No station spreads beat fees within ${s.maxJumps} jumps", icon = EchelonIcons.Swap)
            else EchelonCard(padding = false) {
                list.forEachIndexed { i, t ->
                    if (i > 0) Hairline()
                    ListRow(name(t.type, t.name), supporting = "${t.at.systemName} ${jumpsText(t.jumps)} · ${short(t.buy)} → ${short(t.sell)} · ${pct(t.margin)} margin",
                        trailing = { Column(horizontalAlignment = Alignment.End) { Text("~${short(t.daily)}", style = Echelon.type.num, color = c.ok); Text("per day", style = Echelon.type.label, color = c.textMuted) } },
                        onClick = { actions.open(if (ui.open == i) null else i) })
                    AnimatedVisibility(ui.open == i) {
                        Detail {
                            Fact("Station", t.at.station)
                            KeyValueRow("Top bid", format(t.buy, Kind.Isk)); KeyValueRow("Lowest ask", format(t.sell, Kind.Isk))
                            KeyValueRow("Traded per day", "%,d".format(Math.round(t.volume))); KeyValueRow("In orders", format(t.capital, Kind.Isk))
                            Text("Place a buy order at the top bid and relist at the lowest ask. The estimate assumes you capture 5% of daily volume, with no more buy orders than your budget covers.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
                            if (ui.canSend && (t.jumps ?: 0) > 0) t.at.system?.let { LinkButton("Set autopilot there", { actions.send(listOf(it)) }) }
                        }
                    }
                }
            }
        }
        else -> {
            val list = sortedBuilds(r.builds, s.sort)
            when {
                r.recipesError != null -> ErrorState("Manufacturing data is missing", r.recipesError, tone = Tone.Warn)
                list.isEmpty() -> EmptyState("It appears after the next hourly scan.", title = "No manufacturing data yet", icon = EchelonIcons.Swap)
                else -> EchelonCard(padding = false) {
                    list.forEachIndexed { i, b ->
                        if (i > 0) Hairline()
                        ListRow(name(b.type, b.name), supporting = "${pct(b.margin)} margin · sells at ${b.at.systemName}${b.jumps?.let { " ${jumpsText(it)}" } ?: ""}",
                            meta = "Materials ${short(b.materials)} · job ${short(b.job)}",
                            trailing = { Text("${if (b.profit > 0) "+" else ""}${short(b.profit)}", style = Echelon.type.num, color = if (b.profit > 0) c.ok else c.danger) },
                            onClick = { actions.open(if (ui.open == i) null else i) })
                        AnimatedVisibility(ui.open == i) {
                            Detail {
                                KeyValueRow("Materials", format(b.materials, Kind.Isk)); KeyValueRow("Job cost", format(b.job, Kind.Isk)); KeyValueRow("Revenue", format(b.revenue, Kind.Isk))
                                Fact("Sells at", b.at.station); KeyValueRow("Sold per day", "%,d".format(Math.round(b.daily)))
                                Text("One run with an ME 0 blueprint you own: materials at the cheapest scanned ask, product listed at the best ask.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
                            }
                        }
                    }
                }
            }
        }
    }
    ui.sent?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
}

@Composable
private fun Detail(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(start = Spacing.md, end = Spacing.md, bottom = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) { content() }
}
