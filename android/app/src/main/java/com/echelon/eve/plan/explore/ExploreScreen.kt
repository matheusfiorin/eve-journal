package com.echelon.eve.plan.explore

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.plan.PlanPage
import com.echelon.eve.plan.Sys
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.motion.ScanSweep
import com.echelon.eve.ui.motion.rememberScanSweep
import com.echelon.eve.ui.motion.scanReveal
import com.echelon.eve.ui.motion.scanSweep
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.KeyValueRow
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.ListRow
import com.echelon.eve.ui.components.PrimaryButton
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
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import kotlinx.serialization.Serializable

// The bridge's explore.rank and explore.shortcuts answers (android/js/plan/explore.js).

@Serializable
data class ExploreRow(
    val system: Sys, val jumps: Int, val traffic: Long, val kills: Double, val quiet: Double, val safe: Double,
    val deadEnd: Boolean = false, val visited: Long? = null, val pirates: String = "", val score: Int, val band: String = "hi",
)

@Serializable data class ExploreLoop(val stops: List<Sys>, val route: List<Long>, val jumps: Int, val survival: Double, val minutes: Int)
@Serializable data class Explorer(val ship: String, val race: String, val typeId: Long, val level: Int? = null)
@Serializable data class TrainStep(val key: String, val from: Int, val level: Int, val why: String, val name: String)

@Serializable
data class ExploreResult(
    val start: Sys? = null, val safe: Boolean = true, val rows: List<ExploreRow> = emptyList(), val loop: ExploreLoop? = null,
    val explorer: Explorer? = null, val train: List<TrainStep> = emptyList(), val visited: Int = 0, val trafficHours: Double = 0.0, val error: String? = null,
)

@Serializable data class Shortcut(val hub: String, val system: Sys, val jumps: Int, val size: String? = null, val hours: Double? = null, val signature: String? = null, val lowsec: Boolean = false)

/** The settings the web's Explore toolbar has. */
data class ExploreSettings(
    val from: Long = 30000142,
    val maxJumps: Int = 10,
    val bands: Set<String> = setOf("hi"),
    val tolerance: String = "normal",
    val loop: Int = 5,
)

data class ExploreUi(
    val pilot: Pilot,
    val settings: ExploreSettings,
    /** Start systems on offer: the pilot's location first, then the trade hubs. */
    val starts: List<Pair<Long, String>>,
    val result: ExploreResult? = null,
    val loading: Boolean = false,
    val problem: String? = null,
    val shortcuts: List<Shortcut>? = null,
    val shortcutsProblem: String? = null,
    val regionName: (Long) -> String = { "" },
    /** Which row is open (system id). */
    val open: Long? = null,
    /** "Autopilot set: 9 waypoints" and the like. */
    val sent: String? = null,
)

class ExploreActions(
    val settings: (ExploreSettings) -> Unit = {},
    val open: (Long?) -> Unit = {},
    val mark: (Long) -> Unit = {},
    val sendLoop: () -> Unit = {},
    val sendTo: (Long) -> Unit = {},
    val retry: () -> Unit = {},
    /** Sends tonight's loop to the wingmate through the wing room. */
    val share: () -> Unit = {},
)

private val ROMAN = listOf("0", "I", "II", "III", "IV", "V")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ExploreScreen(ui: ExploreUi, now: Long, actions: ExploreActions, canSend: Boolean, modifier: Modifier = Modifier, scroll: Boolean = true) = PlanPage(modifier, scroll) {
    val c = Echelon.colors
    val s = ui.settings
    // Settings: where from, how far, which space, how careful, how many stops.
    EchelonCard {
        Text("From", style = Echelon.type.label, color = c.textMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ui.starts.forEach { (id, label) -> ChoiceChip(label, selected = id == s.from, onClick = { actions.settings(s.copy(from = id)) }) }
        }
        Text("Within", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            listOf(5, 10, 15, 20).forEach { j -> ChoiceChip("$j jumps", selected = j == s.maxJumps, onClick = { actions.settings(s.copy(maxJumps = j)) }) }
        }
        Text("Space", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            listOf("hi" to "High-sec", "low" to "Low-sec", "null" to "Null-sec").forEach { (k, label) ->
                ChoiceChip(label, selected = k in s.bands, onClick = { actions.settings(s.copy(bands = if (k in s.bands) s.bands - k else s.bands + k)) })
            }
        }
        Text("Risk", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            listOf("careful" to "Careful", "normal" to "Normal", "bold" to "Bold").forEach { (k, label) -> ChoiceChip(label, selected = k == s.tolerance, onClick = { actions.settings(s.copy(tolerance = k)) }) }
        }
        Text("Loop stops", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            listOf(3, 5, 8).forEach { n -> ChoiceChip("$n systems", selected = n == s.loop, onClick = { actions.settings(s.copy(loop = n)) }) }
        }
    }
    val r = ui.result
    val developing = rememberWasLoading(r == null)
    when {
        s.bands.isEmpty() -> EmptyState("High-sec is the safe place to start.", title = "Pick at least one security band", icon = EchelonIcons.Search,
            action = { SecondaryButton("Use high-sec", { actions.settings(s.copy(bands = setOf("hi"))) }) })
        ui.problem != null -> ErrorState("Couldn’t rank systems", ui.problem, action = { SecondaryButton("Try again", actions.retry) })
        r == null -> SkeletonRows(rows = 5, label = "Reading traffic across New Eden…")
        else -> Developed(developing) { Results(ui, r, now, actions, canSend) }
    }
}

@Composable
private fun Results(ui: ExploreUi, r: ExploreResult, now: Long, actions: ExploreActions, canSend: Boolean) {
    val c = Echelon.colors
    val start = r.start?.name ?: "you"
    // Tonight's loop.
    PrimaryPanel {
        Text("Tonight’s loop", style = Echelon.type.screenTitle, color = c.text)
        val loop = r.loop
        if (loop == null) Text("Nothing to loop through with these settings. Widen the range or add a security band.", style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
        else {
            StatRow {
                StatTile("Systems", loop.stops.size.toDouble(), Modifier.weight(1f))
                StatTile("Jumps", loop.jumps.toDouble(), Modifier.weight(1f))
                StatTile("Time", null, Modifier.weight(1f), display = "~${loop.minutes} min")
            }
            val (word, tone) = riskWord(loop.survival)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Tag(word, tone = tone)
                Text("Arrive safely ${pct(loop.survival)}", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            }
            Text("The best systems in the order with the fewest jumps, back to $start. About 1 min a jump and ~12 min scanning a system.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            loop.stops.forEachIndexed { i, st ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text("${i + 1}", style = Echelon.type.numSmall, color = c.textFaint)
                    SecurityBadge(st.sec)
                    Text(st.name, style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f))
                    Text(ui.regionName(st.region), style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                }
            }
            if (canSend) PrimaryButton("Send loop to ${ui.pilot.displayName}’s autopilot", actions.sendLoop, Modifier.fillMaxWidth())
            SecondaryButton("Share with ${ui.pilot.wingmate.displayName}", actions.share, Modifier.fillMaxWidth())
            ui.sent?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
        }
    }
    // Where to scan.
    SectionHeader("Where to scan", subtitle = buildString {
        append("${plural(r.rows.size, "system")} within ${ui.settings.maxJumps} jumps of $start")
        if (r.visited > 0) append(" · ${plural(r.visited, "recent visit")} pushed down")
    })
    if (r.rows.isEmpty()) EmptyState("Widen the range or add a security band.", title = "No systems match", icon = EchelonIcons.Search,
        action = if (ui.settings.maxJumps < 20) ({ SecondaryButton("Search 20 jumps", { actions.settings(ui.settings.copy(maxJumps = 20)) }) }) else null)
    else {
        // The ranking resolves like a probe scan: the beam turns across the card and each system appears as it passes.
        val sweep = rememberScanSweep(r)
        EchelonCard(Modifier.scanSweep(sweep), padding = false) {
            r.rows.forEachIndexed { i, row ->
                Column(Modifier.scanReveal(sweep, ScanSweep.listAt(i, r.rows.size))) {
                    if (i > 0) Hairline()
                    SystemRow(row, ui, now, open = ui.open == row.system.id, actions, canSend)
                }
            }
        }
    }
    Text("EVE doesn’t publish signature counts, so quiet means least travelled: fewer ships through a system means fewer explorers clearing its sites. Traffic covers ${trafficSpan(r.trafficHours)}.",
        style = MaterialTheme.typography.bodySmall, color = c.textFaint)
    // The explorer.
    r.explorer?.let { e ->
        SectionHeader("Your explorer")
        EchelonCard {
            Text(e.ship, style = MaterialTheme.typography.titleMedium, color = c.text)
            Text(when (e.level) { null -> "Connect to match your skills"; 0 -> "Train ${e.race} Frigate I to fly it"; else -> "${e.race} Frigate ${ROMAN.getOrElse(e.level) { "${e.level}" }}" },
                style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            Text("Fit a Core Probe Launcher, a Relic Analyzer and a Data Analyzer; add a Scan Rangefinding Array if CPU allows.", style = MaterialTheme.typography.bodySmall, color = c.textMuted, modifier = Modifier.padding(top = Spacing.xs))
            if (r.train.isNotEmpty()) {
                Text("Train next", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
                r.train.forEach { t ->
                    KeyValueRow("${t.name} ${ROMAN.getOrElse(t.level) { "${t.level}" }}", if (t.from > 0) "from ${ROMAN.getOrElse(t.from) { "${t.from}" }}" else "new")
                    Text(t.why, style = MaterialTheme.typography.bodySmall, color = c.textFaint)
                }
            }
        }
    }
    // Wormhole shortcuts (EVE-Scout).
    SectionHeader("Wormhole shortcuts", subtitle = "Live Thera and Turnur connections from EVE-Scout")
    EchelonCard(padding = ui.shortcuts.isNullOrEmpty()) {
        val list = ui.shortcuts
        when {
            ui.shortcutsProblem != null -> Text("EVE-Scout unavailable: ${ui.shortcutsProblem}", style = MaterialTheme.typography.bodySmall, color = c.warn)
            list == null -> Text("Asking EVE-Scout…", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            list.isEmpty() -> Text("No Thera or Turnur connection within 15 jumps right now.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            else -> list.forEachIndexed { i, sc ->
                if (i > 0) Hairline()
                Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    SecurityBadge(sc.system.sec)
                    Column(Modifier.weight(1f)) {
                        Text("${sc.system.name} → ${sc.hub}", style = MaterialTheme.typography.titleSmall, color = c.text)
                        Text(listOfNotNull(plural(sc.jumps, "jump"), if (sc.lowsec) "through low-sec" else null, sc.size?.let { "$it ships" }, sc.hours?.let { "${it.toInt()} h left" }, sc.signature?.let { "sig $it" }).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = if (sc.lowsec) c.warn else c.textMuted)
                    }
                }
            }
        }
    }
}

@Composable
private fun SystemRow(row: ExploreRow, ui: ExploreUi, now: Long, open: Boolean, actions: ExploreActions, canSend: Boolean) {
    val c = Echelon.colors
    Column {
        ListRow(
                title = row.system.name,
                supporting = "${ui.regionName(row.system.region)} · ${if (row.jumps > 0) plural(row.jumps, "jump") else "here"} · ${"%,d".format(row.traffic)} jumps a day",
                meta = listOfNotNull(if (row.deadEnd) "Dead end" else null, row.visited?.let { "Visited ${agoShort(it, now)}" }, if (row.kills >= 1) plural(Math.round(row.kills).toInt(), "kill") else null).joinToString(" · ").ifEmpty { null },
                leading = { SecurityBadge(row.system.sec) },
                trailing = { Text("${row.score}", style = Echelon.type.num, color = if (row.score >= 50) c.ok else c.text) },
                onClick = { actions.open(if (open) null else row.system.id) },
            )
        AnimatedVisibility(open) {
            Column(Modifier.padding(start = Spacing.md, end = Spacing.md, bottom = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                KeyValueRow("Rats", row.pirates)
                KeyValueRow("Ship kills (~24 h)", if (row.kills >= 0.5) "${Math.round(row.kills)}" else "none")
                KeyValueRow("Quiet", pct(row.quiet, 0))
                KeyValueRow("Safe", pct(row.safe, 0))
                if (row.deadEnd) KeyValueRow("Dead end", "One gate in and out")
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    LinkButton(if (row.visited != null) "Scanned again" else "Mark scanned", { actions.mark(row.system.id) })
                    if (canSend && row.jumps > 0) LinkButton("Set autopilot here", { actions.sendTo(row.system.id) }, tone = Tone.Neutral)
                }
            }
        }
    }
}

internal fun riskWord(survival: Double): Pair<String, Tone> = when {
    survival >= 0.99 -> "Quiet" to Tone.Ok
    survival >= 0.95 -> "Some traffic" to Tone.Warn
    else -> "Hot" to Tone.Danger
}

internal fun pct(x: Double, decimals: Int = 1): String = if (decimals == 0) "${Math.round(x * 100)}%" else "${Math.round(x * 1000) / 10.0}%"

internal fun trafficSpan(hours: Double): String = when { hours >= 24 -> "the last day"; hours >= 1 -> "${Math.round(hours)} hours of history"; else -> "the last hour (history is still building)" }

internal fun agoShort(at: Long, now: Long): String { val h = (now - at) / 3_600_000.0; return if (h < 1) "under an hour ago" else if (h < 48) "${Math.round(h)} h ago" else "${Math.round(h / 24)} days ago" }
