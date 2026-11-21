package com.echelon.eve.plan.haul

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.PopupProperties
import com.echelon.eve.plan.PlanPage
import com.echelon.eve.plan.Sys
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SecurityBadge
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.color
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.format.parseIsk
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import kotlinx.serialization.Serializable

// The bridge's haul.plan answer (android/js/plan/haul.js).

@Serializable data class HaulLive(val kills: Int = 0, val gateKills: Int = 0, val last: Long? = null, val sb: Boolean = false, val dictor: Boolean = false, val ships: List<Long> = emptyList())
@Serializable data class HaulStep(val system: Sys, val stop: Boolean = false, val p: Double = 0.0, val band: String = "hi", val d24: Int = 0, val perHour: Int = 0, val live: HaulLive? = null)
@Serializable
data class HaulMode(
    val stops: List<Sys> = emptyList(), val route: List<Long> = emptyList(), val jumps: Int = 0, val survival: Double = 1.0, val expectedLoss: Double = 0.0,
    val minutes: Double = 0.0, val lowsec: Boolean = false, val steps: List<HaulStep> = emptyList(), val unreachable: List<Sys>? = null, val sameAs: String? = null,
)
@Serializable data class HaulHull(val key: String, val name: String, val cargo: Double, val why: String)
@Serializable data class HaulLiveSummary(val kills: Int = 0)
@Serializable
data class HaulResult(
    val hull: HaulHull? = null, val suggested: String? = null, val fits: Boolean = true, val modes: Map<String, HaulMode> = emptyMap(),
    val regions: List<Long> = emptyList(), val gates: List<Long> = emptyList(), val live: HaulLiveSummary? = null, val killDays: Int = 0, val error: String? = null,
)

/** The form: stop names in order, the cargo, avoided systems and the route options. */
data class HaulForm(
    val stops: List<String> = listOf("Jita", "Amarr"),
    val value: String = "",
    val volume: String = "",
    val avoid: String = "",
    val hull: String? = null,
    val lowsec: Boolean = false,
    val optimize: Boolean = false,
    val roundTrip: Boolean = false,
)

data class HaulUi(
    val form: HaulForm,
    val result: HaulResult? = null,
    val mode: String = "balanced",
    val planning: Boolean = false,
    /** Unknown names, too few stops and the like: why there is no plan. */
    val problem: String? = null,
    /** "Live: 23 kills in the last hour across 6 regions from zKillboard." or why there are none. */
    val liveNote: String? = null,
    val names: Map<Long, String> = emptyMap(),
    /** System names for the stop fields' suggestions. */
    val systemNames: List<String> = emptyList(),
    val canSend: Boolean = false,
    val sent: String? = null,
    val pilotName: String = "",
)

class HaulActions(
    val form: (HaulForm) -> Unit = {},
    val plan: () -> Unit = {},
    val mode: (String) -> Unit = {},
    val send: () -> Unit = {},
)

private val MODES = listOf("safest" to "Safest", "balanced" to "Balanced", "shortest" to "Shortest")
private val HULLS = listOf("br" to "Blockade runner", "t1" to "T1 industrial", "dst" to "Deep space transport", "freighter" to "Freighter")

/** The web's risk words (navigate.js): a percentage, or "<0.1%". */
internal fun risk(p: Double): String = when { p >= 0.1 -> "${Math.round(p * 100)}%"; p >= 0.001 -> "${"%.1f".format(java.util.Locale.US, p * 100)}%"; else -> "<0.1%" }
internal fun level(p: Double): Tone = when { p >= 0.05 -> Tone.Danger; p >= 0.01 -> Tone.Warn; else -> Tone.Ok }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HaulScreen(ui: HaulUi, now: Long, actions: HaulActions, modifier: Modifier = Modifier, scroll: Boolean = true) = PlanPage(modifier, scroll) {
    val c = Echelon.colors
    val f = ui.form
    val r = ui.result
    // The answer first, the form under it, as the web does on a phone once there is a plan.
    if (r != null && ui.problem == null) Result(ui, r, now, actions)
    else if (ui.planning) SkeletonRows(rows = 4, label = "Planning the route…")
    else if (ui.problem != null) ErrorState("No plan", ui.problem, tone = Tone.Warn)

    SectionHeader("Trip")
    EchelonCard {
        f.stops.forEachIndexed { i, name ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(when (i) { 0 -> "From"; f.stops.lastIndex -> "To"; else -> "$i" }, style = Echelon.type.label, color = c.textMuted, modifier = Modifier.width(36.dp))
                SystemField(name, ui.systemNames, { v -> actions.form(f.copy(stops = f.stops.toMutableList().also { it[i] = v })) }, Modifier.weight(1f))
                if (i > 0) LinkButton("↑", { actions.form(f.copy(stops = f.stops.toMutableList().also { java.util.Collections.swap(it, i, i - 1) })) }, tone = Tone.Neutral)
                if (f.stops.size > 2) LinkButton("✕", { actions.form(f.copy(stops = f.stops.filterIndexed { j, _ -> j != i })) }, tone = Tone.Danger)
            }
        }
        LinkButton("+ Add a stop", { actions.form(f.copy(stops = f.stops.dropLast(1) + "" + f.stops.last())) })
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.padding(top = Spacing.sm)) {
            Field("Cargo value (ISK)", f.value, { actions.form(f.copy(value = it)) }, Modifier.weight(1f), number = true,
                hint = parseIsk(f.value)?.takeIf { it > 0 }?.let { format(it.toDouble(), Kind.Isk) })
            Field("Volume (m³)", f.volume, { actions.form(f.copy(volume = it)) }, Modifier.weight(1f), number = true)
        }
        Field("Avoid (system names, comma separated)", f.avoid, { actions.form(f.copy(avoid = it)) }, Modifier.fillMaxWidth())
        Text("Hull", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ChoiceChip("Suggest", selected = f.hull == null, onClick = { actions.form(f.copy(hull = null)) })
            HULLS.forEach { (k, n) -> ChoiceChip(n, selected = f.hull == k, onClick = { actions.form(f.copy(hull = k)) }) }
        }
        Toggle("Allow low-sec", "Shorter, far riskier", f.lowsec) { actions.form(f.copy(lowsec = it)) }
        Toggle("Best stop order", "Visit the middle stops in the order with the fewest jumps", f.optimize) { actions.form(f.copy(optimize = it)) }
        Toggle("Round trip", "Come back to the first stop", f.roundTrip) { actions.form(f.copy(roundTrip = it)) }
        PrimaryButton(if (ui.planning) "Planning…" else "Plan route", actions.plan, Modifier.fillMaxWidth().padding(top = Spacing.sm), enabled = !ui.planning)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Result(ui: HaulUi, r: HaulResult, now: Long, actions: HaulActions) {
    val c = Echelon.colors
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        MODES.forEach { (key, label) ->
            val m = r.modes[key]
            EchelonCard(Modifier.weight(1f), tone = if (key == ui.mode) Tone.Accent else Tone.Neutral, onClick = { actions.mode(key) }) {
                Text(label, style = MaterialTheme.typography.titleSmall, color = c.text)
                if (m == null || m.unreachable != null) Text("No route", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                else {
                    Text(plural(m.jumps, "jump"), style = Echelon.type.num, color = c.text)
                    Text("${risk(1 - m.survival)} risk", style = MaterialTheme.typography.bodySmall, color = level(1 - m.survival).color())
                    Text("~${Math.round(m.minutes)} min", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                }
            }
        }
    }
    val m = r.modes[ui.mode] ?: return
    if (m.unreachable != null) {
        ErrorState("No route", "No route from ${m.unreachable.getOrNull(0)?.name} to ${m.unreachable.getOrNull(1)?.name} with these settings.${if (ui.form.lowsec) "" else " Allow low-sec, or drop an avoided system."}", tone = Tone.Warn)
        return
    }
    val label = MODES.first { it.first == ui.mode }.second
    PrimaryPanel {
        Text("$label route", style = Echelon.type.screenTitle, color = c.text)
        Text(m.stops.joinToString(" → ") { it.name }, style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
        if (m.sameAs != null) Text("Same as ${MODES.first { it.first == m.sameAs }.second}.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
        r.hull?.let { h ->
            Text("${h.name}${if (ui.form.hull == null) " (suggested)" else ""}: ${h.why}", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            if (!r.fits) Text("${ui.form.volume} m³ won’t fit; split the load.", style = MaterialTheme.typography.bodySmall, color = c.danger)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Tag("Arrive ${risk(m.survival)}", tone = level(1 - m.survival))
            Text("${format(m.expectedLoss, Kind.Isk)} expected loss${if (m.lowsec) " · low-sec" else ""}", style = MaterialTheme.typography.bodySmall, color = if (m.lowsec) c.warn else c.textMuted)
        }
        val worst = m.steps.sortedByDescending { it.p }.take(3).filter { it.p >= 0.005 }
        if (worst.isNotEmpty()) Text("Watch ${worst.joinToString { "${it.system.name} (${risk(it.p)})" }}.${if (worst.any { (it.live?.gateKills ?: 0) > 0 }) " Gate kills in the last hour: a camp may still be there. Scout with an alt or wait it out." else ""}",
            style = MaterialTheme.typography.bodySmall, color = level(worst.first().p).color())
        else Text("No hotspots on this route right now.", style = MaterialTheme.typography.bodySmall, color = c.ok)
        if (ui.canSend) PrimaryButton("Send to ${ui.pilotName}’s autopilot", actions.send, Modifier.fillMaxWidth())
        if (ui.canSend && m.route.size - 1 > 40) Text("Over 40 jumps: only your stops are sent, so the in-game autopilot picks the path between them.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
        ui.sent?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
        ui.liveNote?.let { Text("$it Kill history: ${if (r.killDays > 0) plural(r.killDays, "day") + " of hourly ESI data" else "starting"}.", style = MaterialTheme.typography.bodySmall, color = c.textFaint) }
    }
    SectionHeader("Jumps", subtitle = plural(m.steps.size, "system"))
    EchelonCard(padding = false) {
        m.steps.forEachIndexed { i, st ->
            if (i > 0) Hairline()
            Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                SecurityBadge(st.system.sec)
                Column(Modifier.weight(1f)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                        Text(st.system.name, style = MaterialTheme.typography.titleSmall, color = c.text)
                        if (st.stop) Tag("Stop")
                        if (st.live?.sb == true) Tag("Smartbombs", tone = Tone.Danger)
                        if (st.live?.dictor == true) Tag(if (st.band == "hi") "Interdictors" else "Bubbles", tone = Tone.Danger)
                    }
                    val l = st.live
                    Text(if (l == null) "No kills in the last hour" else buildString {
                        append("${l.gateKills} on your gates · ${plural(l.kills, "kill")} last hour")
                        l.last?.let { append(", latest ${maxOf(1, (now - it) / 60_000)} min ago") }
                        val ships = l.ships.mapNotNull { ui.names[it] }
                        if (ships.isNotEmpty()) append(" · ${ships.joinToString()}")
                    }, style = MaterialTheme.typography.bodySmall, color = if ((l?.gateKills ?: 0) > 0) c.danger else c.textMuted)
                    Text("${st.d24} ship kills over ~24 h · ${"%,d".format(st.perHour)} jumps/h", style = Echelon.type.label, color = c.textFaint)
                }
                Text(risk(st.p), style = Echelon.type.num, color = level(st.p).color())
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, number: Boolean = false, hint: String? = null) {
    val c = Echelon.colors
    OutlinedTextField(value, onChange, modifier, singleLine = true, label = { Text(label) }, supportingText = hint?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = if (number) KeyboardType.Number else KeyboardType.Text),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text))
}

/** A stop: free text with up to six matching system names offered under it. */
@Composable
private fun SystemField(value: String, systems: List<String>, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    var open by remember { mutableStateOf(false) }
    val matches = remember(value, systems) { if (value.length < 2) emptyList() else systems.filter { it.startsWith(value, ignoreCase = true) && !it.equals(value, ignoreCase = true) }.take(6) }
    Box(modifier) {
        OutlinedTextField(value, { onChange(it); open = true }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("System name") },
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text))
        DropdownMenu(open && matches.isNotEmpty(), { open = false }, properties = PopupProperties(focusable = false)) {
            matches.forEach { m -> DropdownMenuItem({ Text(m) }, { onChange(m); open = false }) }
        }
    }
}

@Composable
private fun Toggle(title: String, sub: String, on: Boolean, set: (Boolean) -> Unit) {
    val c = Echelon.colors
    Row(Modifier.padding(top = Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = c.text)
            Text(sub, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
        Switch(on, set, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
    }
}
