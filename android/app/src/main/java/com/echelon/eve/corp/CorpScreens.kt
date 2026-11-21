package com.echelon.eve.corp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.model.Pilot
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
import com.echelon.eve.ui.components.TypeIcon
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.ago
import com.echelon.eve.ui.format.compactNumber
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import java.time.Instant

/** What every Corp screen needs to turn ids into words: system names and security, type names, member names. */
data class CorpNames(
    val systems: Map<Long, Pair<String, Double>> = emptyMap(),
    val types: Map<Long, String> = emptyMap(),
    val members: Map<Long, String> = emptyMap(),
) {
    fun system(id: Long) = systems[id]?.first ?: "System $id"
    fun sec(id: Long) = systems[id]?.second
    fun type(id: Long) = types[id] ?: "Type $id"
}

internal fun iso(s: String?): Long? = s?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
private fun pct(x: Double?) = x?.let { "${Math.round(it * 1000) / 10.0}%" } ?: "—"

@Composable
fun CorpPage(modifier: Modifier = Modifier, scroll: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxSize().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier).padding(Spacing.gutter).navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg)) { content(); Spacer(Modifier.size(Spacing.lg)) }
}

/**
 * The frame every Corp section shares: loading, "no corporation data yet", the backend's error, then the section's own
 * problem (a role or scope it needs, never read yet) before its content; and how old the snapshot is.
 */
@Composable
fun <T> CorpSection(load: Load<CorpSnapshot>, now: Long, pick: (CorpSnapshot) -> Section<T>, onRetry: () -> Unit, empty: String, content: @Composable ColumnScope.(CorpSnapshot, T) -> Unit) {
    val c = Echelon.colors
    when (load) {
        Load.Loading -> SkeletonRows(rows = 4, label = "Reading the corporation…")
        is Load.Failed -> if (load.missing) EmptyState(load.message, title = "No corporation data yet", icon = EchelonIcons.Corp)
            else ErrorState("Couldn’t read the corporation", load.message, action = { SecondaryButton("Try again", onRetry) })
        is Load.Ready -> {
            val snap = load.value
            val s = pick(snap)
            Text("Corporation data from ${ago(snap.updatedAt, now)}${snap.source?.let { ", read with $it’s roles" } ?: ""}${if (snap.partial) " · still filling in" else ""}.",
                style = MaterialTheme.typography.bodySmall, color = c.textFaint)
            when {
                s.value == null && s.error != null -> EmptyState(sectionProblem(s.error), title = "Not available", icon = EchelonIcons.Alert)
                s.value == null -> EmptyState("This section is read on the next corporation sync, about once an hour.", title = "Not read yet", icon = EchelonIcons.Corp)
                else -> {
                    if (s.error != null) Text("${sectionProblem(s.error)} Showing the last copy that could be read.", style = MaterialTheme.typography.bodySmall, color = c.warn)
                    if (s.truncated) Text("EVE returned more than the app keeps; the biggest entries are shown.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                    val v = s.value
                    if (v is Collection<*> && v.isEmpty()) EmptyState(empty, title = "Nothing here", icon = EchelonIcons.Corp)
                    else Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) { content(snap, v) }
                }
            }
        }
    }
}

/** The Worker's section errors in a sentence that says what to do. */
fun sectionProblem(e: String): String = when {
    e.startsWith("needs role") -> "This section needs the in-game role ${e.removePrefix("needs role ")}: ESI only answers a pilot who has it. Ask a director for the role, or connect a pilot who has it."
    e.startsWith("needs permission") -> "No connected pilot allowed this corporation scope yet. Reconnect a pilot in Settings to grant it."
    else -> "$e."
}

// ── Starbases ──
@Composable
fun StarbasesScreen(load: Load<CorpSnapshot>, names: CorpNames, now: Long, onRetry: () -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true) = CorpPage(modifier, scroll) {
    CorpSection(load, now, { it.starbases }, onRetry, "The corporation has no starbases.") { _, list ->
        val c = Echelon.colors
        val low = list.count { it.state == "online" && (it.fuelHoursLeft ?: Double.MAX_VALUE) < 24 }
        PrimaryPanel {
            StatRow {
                StatTile("Towers", list.size.toDouble(), Modifier.weight(1f))
                StatTile("Online", list.count { it.state == "online" }.toDouble(), Modifier.weight(1f))
                StatTile("Low fuel", low.toDouble(), Modifier.weight(1f), note = "under a day", tone = if (low > 0) Tone.Danger else Tone.Ok)
            }
            Text("Fuel and strontium hours use EVE University’s burn rates by tower size: a faction tower burns a little less, so its warning comes early, never late.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
        list.sortedWith(compareBy({ it.state != "reinforced" }, { it.fuelHoursLeft ?: Double.MAX_VALUE })).forEach { t ->
            val left = t.fuelHoursLeft
            val tone = when { t.state == "reinforced" -> Tone.Danger; left != null && left < 24 -> Tone.Danger; left != null && left < 72 -> Tone.Warn; else -> Tone.Neutral }
            EchelonCard(tone = tone) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    TypeIcon(t.type, size = 40.dp, contentDescription = names.type(t.type))
                    Column(Modifier.weight(1f)) {
                        Text(names.type(t.type), style = MaterialTheme.typography.titleSmall, color = c.text)
                        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                            names.sec(t.system)?.let { SecurityBadge(it) }
                            Text(names.system(t.system), style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                        }
                    }
                    Tag(stateWord(t.state), tone = if (t.state == "online") Tone.Ok else if (t.state == "reinforced") Tone.Danger else Tone.Warn)
                }
                if (left != null) {
                    ProgressBar((left / 720.0).toFloat().coerceIn(0f, 1f), Modifier.fillMaxWidth().padding(top = Spacing.sm), color = when (tone) { Tone.Danger -> c.danger; Tone.Warn -> c.warn; else -> c.ok })
                    KeyValueRow("Fuel left", if (t.state == "online") duration(left * 3600) else "${duration(left * 3600)} (not burning)")
                } else KeyValueRow("Fuel", "Not read")
                KeyValueRow("Fuel blocks", "%,d".format(t.fuelBlocks))
                KeyValueRow("Strontium", "%,d · ${duration(t.strontiumHours * 3600)} of reinforcement".format(t.strontium))
                iso(t.reinforcedUntil)?.let { KeyValueRow("Reinforced until", "${Instant.ofEpochMilli(it)} (${if (it > now) "in ${duration((it - now) / 1000.0)}" else "passed"})") }
                iso(t.unanchorAt)?.let { KeyValueRow("Unanchors", Instant.ofEpochMilli(it).toString()) }
            }
        }
    }
}

private fun stateWord(s: String?) = when (s) { null -> "Unknown"; "online" -> "Online"; "offline" -> "Offline"; "onlining" -> "Onlining"; "reinforced" -> "Reinforced"; "unanchored" -> "Unanchored"
    "shield_vulnerable" -> "Vulnerable"; "armor_reinforce" -> "Armor reinforced"; "hull_reinforce" -> "Hull reinforced"; "armor_vulnerable" -> "Armor vulnerable"; "hull_vulnerable" -> "Hull vulnerable"
    "low_power" -> "Low power"; "abandoned" -> "Abandoned"; "anchoring" -> "Anchoring"; "deploy_vulnerable" -> "Deploying"; "fitting_invulnerable" -> "Fitting"; "onlining_vulnerable" -> "Onlining"
    else -> s.replace('_', ' ').replaceFirstChar { it.uppercase() } }

// ── Structures ──
@Composable
fun StructuresScreen(load: Load<CorpSnapshot>, names: CorpNames, now: Long, onRetry: () -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true) = CorpPage(modifier, scroll) {
    CorpSection(load, now, { it.structures }, onRetry, "The corporation has no Upwell structures.") { _, list ->
        val c = Echelon.colors
        val low = list.count { (it.fuelDaysLeft ?: Double.MAX_VALUE) < 3 }
        val attacked = list.count { it.state == "armor_reinforce" || it.state == "hull_reinforce" }
        PrimaryPanel {
            StatRow {
                StatTile("Structures", list.size.toDouble(), Modifier.weight(1f))
                StatTile("Low fuel", low.toDouble(), Modifier.weight(1f), note = "under 3 days", tone = if (low > 0) Tone.Warn else Tone.Ok)
                StatTile("Reinforced", attacked.toDouble(), Modifier.weight(1f), tone = if (attacked > 0) Tone.Danger else Tone.Ok)
            }
        }
        list.sortedWith(compareBy({ !(it.state == "armor_reinforce" || it.state == "hull_reinforce") }, { it.fuelDaysLeft ?: Double.MAX_VALUE })).forEach { s ->
            val days = s.fuelDaysLeft
            val reinforced = s.state == "armor_reinforce" || s.state == "hull_reinforce"
            EchelonCard(tone = when { reinforced -> Tone.Danger; days != null && days < 3 -> Tone.Warn; else -> Tone.Neutral }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    TypeIcon(s.type, size = 40.dp, contentDescription = names.type(s.type))
                    Column(Modifier.weight(1f)) {
                        Text(s.name ?: names.type(s.type), style = MaterialTheme.typography.titleSmall, color = c.text)
                        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                            names.sec(s.system)?.let { SecurityBadge(it) }
                            Text("${names.system(s.system)} · ${names.type(s.type)}", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                        }
                    }
                    Tag(stateWord(s.state), tone = if (reinforced) Tone.Danger else if (s.state == "shield_vulnerable") Tone.Ok else Tone.Warn)
                }
                KeyValueRow("Fuel", days?.let { if (it <= 0) "Out of fuel" else "${duration(it * 86400)} left" } ?: "No fuel (low power or never fuelled)")
                iso(s.stateTimerEnd)?.let { KeyValueRow("State timer ends", if (it > now) "in ${duration((it - now) / 1000.0)}" else "passed") }
                s.reinforceHour?.let { KeyValueRow("Reinforce hour", "%02d:00 EVE".format(it)) }
                iso(s.unanchorsAt)?.let { KeyValueRow("Unanchors", Instant.ofEpochMilli(it).toString()) }
                if (s.services.isNotEmpty()) Text(s.services.joinToString(" · ") { "${it.name} ${if (it.state == "online") "on" else "off"}" }, style = MaterialTheme.typography.bodySmall, color = c.textMuted, modifier = Modifier.padding(top = Spacing.xs))
            }
        }
    }
}

// ── Wallet ──
@Composable
fun WalletScreen(load: Load<CorpSnapshot>, now: Long, onRetry: () -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true) = CorpPage(modifier, scroll) {
    CorpSection(load, now, { it.wallets }, onRetry, "No wallet divisions were read.") { snap, list ->
        val c = Echelon.colors
        val labels = snap.divisions.value?.wallet?.associate { it.division to it.name }.orEmpty()
        PrimaryPanel { StatTile("All divisions", list.sumOf { it.balance }, Modifier.fillMaxWidth(), kind = Kind.Isk) }
        EchelonCard(padding = false) {
            list.sortedBy { it.division }.forEachIndexed { i, w ->
                if (i > 0) Hairline()
                ListRow(labels[w.division]?.takeIf { it.isNotBlank() } ?: if (w.division == 1) "Master wallet" else "Division ${w.division}", supporting = "Division ${w.division}",
                    trailing = { Text(format(w.balance, Kind.Isk), style = Echelon.type.num, color = c.text) })
            }
        }
        if (snap.divisions.value == null) Text("Division names need the Director role; numbers are shown instead.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
    }
}

// ── Members ──
@Composable
fun MembersScreen(load: Load<CorpSnapshot>, now: Long, onRetry: () -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true) = CorpPage(modifier, scroll) {
    CorpSection(load, now, { it.members }, onRetry, "No members were read.") { snap, list ->
        val c = Echelon.colors
        var query by rememberSaveable { mutableStateOf("") }
        PrimaryPanel { StatTile("Members", snap.memberCount.toDouble(), Modifier.fillMaxWidth(), note = if (snap.memberCount > list.size) "the first ${list.size} are listed" else null) }
        OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Find a member") },
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text))
        val shown = list.filter { (_, n) -> query.isBlank() || (n ?: "").contains(query.trim(), ignoreCase = true) }.sortedBy { (it.second ?: "~").lowercase() }
        EchelonCard(padding = false) {
            shown.forEachIndexed { i, (id, n) ->
                if (i > 0) Hairline()
                ListRow(n ?: "Pilot $id", supporting = Pilot.of(id)?.let { "Your wing" },
                    leading = { com.echelon.eve.ui.components.Portrait(id, com.echelon.eve.ui.theme.PilotColors.of(id), size = 32.dp) })
            }
        }
    }
}

// ── Corp jobs ──
/** One job at [now]: ESI says "active" for a while after a job ends, so a past end counts as ready (jobs.js jobState). */
data class JobState(val progress: Float, val remaining: Long, val ready: Boolean, val paused: Boolean)
fun jobState(j: CorpJob, now: Long): JobState {
    val start = iso(j.startDate) ?: 0; val end = iso(j.endDate) ?: 0
    val ready = j.status == "ready" || (j.status == "active" && end <= now)
    val progress = if (end > start) ((now - start).toFloat() / (end - start)).coerceIn(0f, 1f) else if (j.status == "ready") 1f else 0f
    return JobState(progress, (end - now).coerceAtLeast(0), ready, j.status == "paused")
}
private val ACTIVITIES = mapOf(1 to "Manufacturing", 3 to "TE research", 4 to "ME research", 5 to "Copying", 7 to "Reverse engineering", 8 to "Invention", 9 to "Reactions", 11 to "Reactions")

@Composable
fun CorpJobsScreen(load: Load<CorpSnapshot>, names: CorpNames, now: Long, onRetry: () -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true) = CorpPage(modifier, scroll) {
    CorpSection(load, now, { it.jobs }, onRetry, "No corporation industry jobs are running.") { snap, list ->
        val c = Echelon.colors
        val members = snap.members.value?.associate { it.first to it.second }.orEmpty() + names.members
        val states = list.associateWith { jobState(it, now) }
        val sorted = list.sortedWith(compareBy({ !states.getValue(it).ready }, { states.getValue(it).paused }, { states.getValue(it).remaining }))
        PrimaryPanel {
            StatRow {
                StatTile("Ready", states.values.count { it.ready }.toDouble(), Modifier.weight(1f), tone = if (states.values.any { it.ready }) Tone.Ok else Tone.Neutral)
                StatTile("Running", states.values.count { !it.ready && !it.paused }.toDouble(), Modifier.weight(1f))
                StatTile("Next done", null, Modifier.weight(1f), display = states.values.filter { !it.ready && !it.paused }.minOfOrNull { it.remaining }?.let { duration(it / 1000.0) } ?: "—")
            }
        }
        sorted.forEach { j ->
            val s = states.getValue(j)
            val type = j.productTypeId ?: j.blueprintTypeId
            EchelonCard(tone = if (s.ready) Tone.Ok else Tone.Neutral) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    TypeIcon(type, size = 40.dp, contentDescription = names.type(type))
                    Column(Modifier.weight(1f)) {
                        Text(names.type(type), style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1)
                        Text("${ACTIVITIES[j.activityId] ?: "Industry"} · ${plural(j.runs, "run")}${j.installerId?.let { id -> " · ${members[id] ?: "a member"}" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 1)
                    }
                    when { s.ready -> Tag("Ready", tone = Tone.Ok); s.paused -> Tag("Paused", tone = Tone.Warn); else -> Text(duration(s.remaining / 1000.0), style = Echelon.type.num, color = c.text) }
                }
                ProgressBar(if (s.ready) 1f else s.progress, Modifier.fillMaxWidth().padding(top = Spacing.sm), color = if (s.ready) c.ok else c.accent)
            }
        }
    }
}

// ── Customs offices ──
@Composable
fun CustomsScreen(load: Load<CorpSnapshot>, names: CorpNames, now: Long, onRetry: () -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true) = CorpPage(modifier, scroll) {
    CorpSection(load, now, { it.customs }, onRetry, "The corporation owns no customs offices.") { _, list ->
        val c = Echelon.colors
        PrimaryPanel { StatTile("Customs offices", list.size.toDouble(), Modifier.fillMaxWidth()) }
        EchelonCard(padding = false) {
            list.sortedBy { names.system(it.systemId) }.forEachIndexed { i, o ->
                if (i > 0) Hairline()
                ListRow(names.system(o.systemId),
                    supporting = "Tax: corp ${pct(o.taxCorp)} · alliance ${pct(o.taxAlliance)} · good ${pct(o.taxGood)} · neutral ${pct(o.taxNeutral)} · bad ${pct(o.taxBad)}",
                    meta = if (o.exitStart != null && o.exitEnd != null) "Reinforcement exits %02d:00–%02d:00 EVE".format(o.exitStart, o.exitEnd) else null,
                    leading = { names.sec(o.systemId)?.let { SecurityBadge(it) } })
            }
        }
        Text("Tax rates as EVE reports them: the share of the export or import cost the office keeps.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
    }
}

// ── Assets ──
data class PlaceValue(val id: Long, val name: String, val kind: String, val items: Int, val value: Double, val top: List<Triple<Long, Long, Double>>)

/** Places by value at ESI's average prices, the biggest types in each; types without a price count zero. */
fun valuePlaces(places: List<Pair<Long, Pair<String, String>>>, types: (Long) -> List<Pair<Long, Long>>, items: (Long) -> Int, prices: Map<Long, Double>): List<PlaceValue> =
    places.map { (id, label) ->
        val rows = types(id).groupBy({ it.first }, { it.second }).map { (t, q) -> val n = q.sum(); Triple(t, n, n * (prices[t] ?: 0.0)) }.sortedByDescending { it.third }
        PlaceValue(id, label.first, label.second, items(id), rows.sumOf { it.third }, rows.take(5))
    }.sortedByDescending { it.value }

@Composable
fun AssetsScreen(
    corp: Load<CorpSnapshot>, mine: Load<MyAssets>?, whose: Pilot, prices: Map<Long, Double>, names: CorpNames, placeNames: Map<Long, String>, now: Long,
    onWhose: (Pilot) -> Unit, onRetry: () -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true,
) = CorpPage(modifier, scroll) {
    val c = Echelon.colors
    var tab by rememberSaveable { mutableStateOf("mine") }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Pilot.entries.forEach { p -> ChoiceChip(p.displayName, selected = tab == "mine" && whose == p, onClick = { tab = "mine"; onWhose(p) }) }
        ChoiceChip("Corporation", selected = tab == "corp", onClick = { tab = "corp" })
    }
    if (tab == "corp") CorpSection(corp, now, { it.assets }, onRetry, "The corporation holds no assets.") { _, a ->
        val list = valuePlaces(a.places.map { it.id to ((placeNames[it.id] ?: names.systems[it.id]?.first ?: "Location ${it.id}") to "place") },
            { id -> a.places.first { it.id == id }.types.mapNotNull { r -> if (r.size >= 2) r[0] to r[1] else null } }, { id -> a.places.first { it.id == id }.items }, prices)
        Places("${"%,d".format(a.items)} items in ${plural(a.locations, "place")}", list, names, prices.isEmpty())
    } else when (mine) {
        null, Load.Loading -> SkeletonRows(rows = 4, label = "Reading ${whose.displayName}’s assets…")
        is Load.Failed -> ErrorState("Couldn’t read the assets", mine.message, action = { SecondaryButton("Try again", onRetry) })
        is Load.Ready -> {
            val a = mine.value
            if (a.locations.isEmpty()) EmptyState("${whose.displayName} has no assets.", title = "Nothing here", icon = EchelonIcons.Search)
            else {
                val byId = a.locations.associateBy { it.id }
                val list = valuePlaces(a.locations.map { it.id to ((it.name ?: placeNames[it.id] ?: when (it.kind) { "structure" -> "A structure"; "solar_system" -> "In space in ${names.system(it.id)}"; else -> "Location ${it.id}" }) to it.kind) },
                    { id -> byId.getValue(id).flatten() }, { id -> byId.getValue(id).count }, prices)
                Places("${"%,d".format(a.items)} items in ${plural(a.locations.size, "place")}${if (a.truncated) " (EVE had more than the app reads)" else ""}", list, names, prices.isEmpty())
                a.fetchedAt?.let { iso(it) }?.let { Text("Read from EVE ${ago(it, now)}${if (a.cached) " (kept up to an hour)" else ""}.", style = MaterialTheme.typography.bodySmall, color = c.textFaint) }
            }
        }
    }
}

@Composable
private fun Places(summary: String, list: List<PlaceValue>, names: CorpNames, noPrices: Boolean) {
    val c = Echelon.colors
    PrimaryPanel {
        StatTile("Estimated value", list.sumOf { it.value }, Modifier.fillMaxWidth(), kind = Kind.Isk, note = summary)
        if (noPrices) Text("Prices are still loading; values show as zero until they arrive.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        else Text("At ESI’s average prices. Blueprint copies and items without a market price count as zero.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
    }
    list.forEach { p ->
        EchelonCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(p.name, style = MaterialTheme.typography.titleSmall, color = c.text)
                    Text(plural(p.items, "item"), style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                }
                Text(compactNumber(p.value), style = Echelon.type.num, color = c.text)
            }
            p.top.forEach { (t, q, v) -> KeyValueRow("${names.type(t)} ×${"%,d".format(q)}", if (v > 0) compactNumber(v) else "—") }
        }
    }
}
