package com.echelon.eve.plan.sell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
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
import com.echelon.eve.plan.PlanPage
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.format.parseIsk
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import kotlinx.serialization.Serializable

// The bridge's sell.gather and sell.plan answers (android/js/plan/sell.js).

@Serializable data class SellShip(val pilot: Long, val owner: String, val name: String, val shipType: Long, val system: Long? = null, val systemName: String? = null,
    val station: Long? = null, val stationName: String? = null, val connected: Boolean = false)
@Serializable data class From(val kind: String, val pilot: Long? = null, val station: Long? = null)
@Serializable data class SellRow(val key: String, val type: Long, val avail: Long, val from: From, val fromName: String, val pasted: Boolean = false)
@Serializable data class GatherNote(val pilot: String, val text: String)
@Serializable data class Gathered(val ships: List<SellShip> = emptyList(), val rows: List<SellRow> = emptyList(), val notes: List<GatherNote> = emptyList(),
    val pickup: Long? = null, val pickupName: String? = null, val chosen: Boolean = false, val canPick: Boolean = false)
@Serializable data class Sale(val type: Long, val qty: Long, val price: Double, val net: Double, val far: Boolean = false, val orderAt: String? = null, val range: String? = null)
@Serializable data class Pickup(val type: Long, val qty: Long)
@Serializable data class Stop(val station: Long, val name: String, val system: String, val systemId: Long, val pickups: List<Pickup> = emptyList(), val sales: List<Sale> = emptyList())
@Serializable data class ShipPlan(val pilot: Long, val name: String, val route: List<Long>, val routeNames: List<String> = emptyList(), val jumps: Int, val net: Double, val start: String = "", val stops: List<Stop> = emptyList())
@Serializable data class Unsold(val type: Long, val qty: Long, val reason: String, val at: String? = null)
@Serializable data class SellPlan(val key: String, val label: String, val also: List<String> = emptyList(), val jumps: Int, val net: Double, val expectedLoss: Double, val score: Double,
    val soldShare: Double, val together: Boolean = false, val ships: List<ShipPlan> = emptyList(), val unsold: List<Unsold> = emptyList())
@Serializable data class SellNote(val kind: String, val type: Long? = null, val qty: Double? = null, val share: Double? = null, val plan: String? = null)
@Serializable data class SellResult(val plans: List<SellPlan> = emptyList(), val notes: List<SellNote> = emptyList())
@Serializable data class StationHit(val id: Long, val name: String)

/** What a person changed on the form: ships left out, hold sizes, rows left out or cut down, pasted items, the options. */
data class SellForm(
    val off: Set<Long> = emptySet(), val caps: Map<Long, String> = emptyMap(), val skip: Set<String> = emptySet(), val qty: Map<String, String> = emptyMap(),
    val pasted: Map<Long, Long> = emptyMap(), val perJump: String = "1000000", val maxJumps: Int = 15, val lowsec: Boolean = false, val together: Boolean = false, val returnHome: Boolean = false,
)

data class SellUi(
    val form: SellForm, val gathered: Gathered? = null, val info: Map<Long, TypeInfo> = emptyMap(), val names: Map<Long, String> = emptyMap(),
    val result: SellResult? = null, val loaded: Loaded? = null, val planning: Boolean = false, val status: String? = null, val problem: String? = null,
    val mode: String? = null, val pasteText: String = "", val pasteNote: String? = null, val pickupQuery: String? = null, val pickupHits: List<StationHit> = emptyList(),
    val pickupNote: String? = null, val sent: Map<Long, String> = emptyMap(), val canSend: Set<Long> = emptySet(), val unsized: Int = 0,
)

class SellActions(
    val form: (SellForm) -> Unit = {}, val mode: (String) -> Unit = {}, val paste: (String) -> Unit = {}, val addPaste: () -> Unit = {},
    val pickupQuery: (String?) -> Unit = {}, val savePickup: (Long?) -> Unit = {}, val send: (ShipPlan) -> Unit = {}, val retry: () -> Unit = {},
)

private val REASONS = mapOf("no quotes" to "No buy orders found", "below floor" to "Buy orders are below the price floor", "no buyer in range" to "No buyer within reach",
    "no buyer on route" to "No buyer on this route", "not picked up" to "Not picked up on this trip", "no room" to "No room left in the hold", "no ship" to "No ship to carry it")
private val ALSO = mapOf("here" to "Sell here", "best" to "Best", "most" to "Most ISK")

/** A row's quantity after the person's edit, never above what is there. */
internal fun qtyOf(row: SellRow, form: SellForm): Long = (form.qty[row.key]?.toLongOrNull() ?: row.avail).coerceIn(0, row.avail)
private fun num(n: Number) = "%,d".format(Math.round(n.toDouble()))
private fun m3Text(n: Double) = if (n >= 10) num(n) else "${Math.round(n * 100) / 100.0}"

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SellScreen(ui: SellUi, actions: SellActions, modifier: Modifier = Modifier, scroll: Boolean = true) = PlanPage(modifier, scroll) {
    val c = Echelon.colors
    val f = ui.form
    val name = { id: Long -> ui.info[id]?.name ?: ui.names[id] ?: "Type $id" }
    val fieldColors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text)
    // The answer first, then what goes into it.
    when {
        ui.problem != null -> ErrorState("Couldn’t plan the sale", ui.problem, action = { SecondaryButton("Try again", actions.retry) })
        ui.planning && ui.result == null -> SkeletonRows(rows = 4, label = "Planning the sale…")
        ui.result != null -> Plans(ui, ui.result, actions, name)
        ui.status != null -> Text(ui.status, style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
    }
    val g = ui.gathered ?: run { SkeletonRows(rows = 3, label = "Loading the market…"); return@PlanPage }
    SectionHeader("Ships")
    EchelonCard {
        if (g.ships.isEmpty()) Text("No ship to plan with yet.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        g.ships.forEachIndexed { i, s ->
            if (i > 0) Hairline(Modifier.padding(vertical = Spacing.xs))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(s.pilot !in f.off, { on -> actions.form(f.copy(off = if (on) f.off - s.pilot else f.off + s.pilot)) }, colors = CheckboxDefaults.colors(checkedColor = c.accent))
                Column(Modifier.weight(1f)) {
                    Text(s.name, style = MaterialTheme.typography.titleSmall, color = c.text)
                    Text("${name(s.shipType)} · ${s.owner}", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                    Text(s.stationName?.let { "Docked at $it" } ?: "Not docked${s.systemName?.let { ", in $it" } ?: ""}. Dock to sell from a hangar.",
                        style = MaterialTheme.typography.bodySmall, color = if (s.station == null) c.warn else c.textFaint)
                }
                OutlinedTextField(f.caps[s.pilot] ?: ui.info[s.shipType]?.capacity?.let { m3Text(it) } ?: "", { v -> actions.form(f.copy(caps = f.caps + (s.pilot to v))) }, Modifier.width(110.dp),
                    singleLine = true, label = { Text("Cargo m³") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), colors = fieldColors)
            }
        }
        g.notes.forEach { Text(it.text, style = MaterialTheme.typography.bodySmall, color = c.textMuted, modifier = Modifier.padding(top = Spacing.xs)) }
    }
    SectionHeader("Pickup", subtitle = "Both pilots’ hangars at a station are counted together")
    EchelonCard {
        when {
            !g.canPick -> Text("Connect the flying pilot to choose where to pick items up.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            ui.pickupQuery != null -> {
                OutlinedTextField(ui.pickupQuery, { actions.pickupQuery(it) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Station") }, colors = fieldColors)
                ui.pickupHits.forEach { h -> LinkButton(h.name, { actions.savePickup(h.id) }, tone = Tone.Neutral) }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) { LinkButton("Cancel", { actions.pickupQuery(null) }, tone = Tone.Neutral) }
            }
            else -> {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Text(g.pickupName?.let { "Item hangar at $it" } ?: "No station to pick up from. Dock, or choose one.", style = MaterialTheme.typography.bodyMedium, color = c.text, modifier = Modifier.weight(1f))
                    if (g.chosen) Tag("Chosen by you")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    LinkButton("Change", { actions.pickupQuery("") })
                    if (g.chosen) LinkButton("Use docked station", { actions.savePickup(null) }, tone = Tone.Neutral)
                }
            }
        }
        ui.pickupNote?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
    }
    SectionHeader("Items", subtitle = plural(g.rows.count { it.key !in f.skip && qtyOf(it, f) > 0 }, "item") + " to sell")
    EchelonCard {
        if (g.rows.isEmpty()) Text("Nothing to sell yet. Load a hold, dock where a hangar holds items, choose a pickup station, or paste a list.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        g.rows.forEachIndexed { i, r ->
            if (i > 0) Hairline(Modifier.padding(vertical = Spacing.xs))
            val on = r.key !in f.skip
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(on, { v -> actions.form(f.copy(skip = if (v) f.skip - r.key else f.skip + r.key)) }, colors = CheckboxDefaults.colors(checkedColor = c.accent))
                Column(Modifier.weight(1f)) {
                    Text(name(r.type), style = MaterialTheme.typography.titleSmall, color = if (on) c.text else c.textFaint)
                    Text(r.fromName + if (r.pasted) " · pasted" else "", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                    Text(ui.info[r.type]?.let { "${m3Text(qtyOf(r, f) * it.volume)} m³" } ?: "size unknown", style = Echelon.type.label, color = c.textFaint)
                }
                OutlinedTextField(f.qty[r.key] ?: r.avail.toString(), { v -> actions.form(f.copy(qty = f.qty + (r.key to v))) }, Modifier.width(110.dp), singleLine = true,
                    label = { Text("Quantity") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), colors = fieldColors)
            }
        }
    }
    SectionHeader("Paste a list", subtitle = "From an inventory window (name, tab, quantity), or “5 x Name”")
    EchelonCard {
        OutlinedTextField(ui.pasteText, actions.paste, Modifier.fillMaxWidth(), minLines = 3, label = { Text("Items") }, colors = fieldColors)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SecondaryButton("Add items", actions.addPaste)
            ui.pasteNote?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted, modifier = Modifier.weight(1f)) }
        }
    }
    SectionHeader("Options")
    EchelonCard {
        OutlinedTextField(f.perJump, { actions.form(f.copy(perJump = it)) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("A jump is worth (ISK)") },
            supportingText = parseIsk(f.perJump)?.let { { Text("${format(it.toDouble(), Kind.Isk)} a jump: a longer trip must earn at least this much more") } },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), colors = fieldColors)
        Text("Look for buyers within", style = Echelon.type.label, color = c.textMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            listOf(0, 5, 10, 15, 20).forEach { j -> ChoiceChip(if (j == 0) "Here" else "$j jumps", selected = f.maxJumps == j, onClick = { actions.form(f.copy(maxJumps = j)) }) }
        }
        Toggle("Allow low-sec", f.lowsec) { actions.form(f.copy(lowsec = it)) }
        Toggle("Fly together", f.together) { actions.form(f.copy(together = it)) }
        Toggle("Come back home", f.returnHome) { actions.form(f.copy(returnHome = it)) }
    }
}

@Composable
private fun Plans(ui: SellUi, r: SellResult, actions: SellActions, name: (Long) -> String) {
    val c = Echelon.colors
    val chosen = r.plans.firstOrNull { it.key == ui.mode } ?: r.plans.firstOrNull()
    if (chosen == null) { EmptyState("There is no plan to show for these ships and items.", title = "No plan", icon = EchelonIcons.Route); return }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        r.plans.take(3).forEach { p ->
            EchelonCard(Modifier.weight(1f), tone = if (p.key == chosen.key) Tone.Accent else Tone.Neutral, onClick = { actions.mode(p.key) }) {
                Text(p.label, style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1)
                Text(plural(p.jumps, "jump"), style = Echelon.type.num, color = c.text)
                Text("${format(p.net, Kind.Isk)} net", style = MaterialTheme.typography.bodySmall, color = c.ok)
                Text("${Math.round(p.soldShare * 100)}% sold", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            }
        }
    }
    if (r.plans.size > 3) Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) { r.plans.drop(3).forEach { p -> ChoiceChip("${p.label} · ${plural(p.jumps, "jump")}", selected = p.key == chosen.key, onClick = { actions.mode(p.key) }) } }
    PrimaryPanel {
        Text(chosen.label, style = Echelon.type.screenTitle, color = c.text)
        Text("${plural(chosen.jumps, "jump")} · ${format(chosen.net, Kind.Isk)} after tax · ${format(chosen.expectedLoss, Kind.Isk)} expected loss · ${Math.round(chosen.soldShare * 100)}% of the value sold" +
            if (chosen.also.isNotEmpty()) " · also ${chosen.also.joinToString(" and ") { ALSO[it] ?: it }}" else "", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        chosen.ships.forEach { s ->
            Hairline(Modifier.padding(vertical = Spacing.sm))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(s.name, style = MaterialTheme.typography.titleSmall, color = c.text)
                    Text("starts in ${s.start} · ${plural(s.jumps, "jump")}", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                }
                Text(format(s.net, Kind.Isk), style = Echelon.type.num, color = c.ok)
            }
            if (s.stops.isEmpty()) Text("Nothing to sell or pick up on this trip.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            s.stops.forEachIndexed { i, st ->
                Text("${i + 1}. ${st.name}", style = MaterialTheme.typography.bodyMedium, color = c.text, modifier = Modifier.padding(top = Spacing.xs))
                st.pickups.forEach { k -> Text("Pick up ${num(k.qty)} × ${name(k.type)}", style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
                st.sales.forEach { k -> Text("Sell ${num(k.qty)} × ${name(k.type)} at ${"%,.2f".format(k.price)} · ${format(k.net, Kind.Isk)}" +
                    if (k.far) " (buy order in ${k.orderAt}, ${k.range})" else "", style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
            }
            if (s.route.size > 1) Text(s.routeNames.joinToString(" → "), style = Echelon.type.label, color = c.textFaint)
            if (s.route.size > 1 && s.pilot in ui.canSend) PrimaryButton("Send ${s.name}’s route to autopilot", { actions.send(s) }, Modifier.fillMaxWidth().padding(top = Spacing.xs))
            ui.sent[s.pilot]?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
        }
    }
    val unsold = chosen.unsold.sortedBy { name(it.type) }
    if (unsold.isNotEmpty()) {
        SectionHeader("Not sold")
        EchelonCard { unsold.forEach { u -> Text("${num(u.qty)} × ${name(u.type)} · ${REASONS[u.reason] ?: u.reason}${u.at?.let { " · at $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = c.textMuted) } }
    }
    val notes = buildList {
        r.notes.forEach { n -> when (n.kind) {
            "no-quotes" -> add("No buy orders found for ${n.type?.let(name)}.")
            "below-floor" -> add("Every buy order for ${n.type?.let(name)} is under the price floor.")
            "thin" -> if (n.plan == chosen.key) add("Thin book for ${n.type?.let(name)}: this plan sells ${num(n.qty ?: 0.0)}, about ${Math.round((n.share ?: 0.0) * 100)}% of the buy orders it can reach. The price will not hold.")
        } }
        ui.loaded?.let { l ->
            if (l.capped) add("Stopped after ${l.calls} requests to EVE, so some regions are missing. Try fewer jumps or fewer items.")
            if (l.failed > 0) add("Buy orders could not be loaded for ${plural(l.failed, "region and item pair", "region and item pairs")}; those prices are missing.")
        }
        if (ui.unsized > 0) add("${plural(ui.unsized, "item")} left out because EVE did not give its size.")
    }
    notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = c.warn) }
    ui.status?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textFaint) }
}

@Composable
private fun Toggle(title: String, on: Boolean, set: (Boolean) -> Unit) {
    val c = Echelon.colors
    Row(Modifier.padding(top = Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f))
        Switch(on, set, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
    }
}
