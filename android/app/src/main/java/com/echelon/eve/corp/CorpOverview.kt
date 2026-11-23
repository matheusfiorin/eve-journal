package com.echelon.eve.corp

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.EveImages
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.RollingText
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SecurityBadge
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.TypeIcon
import com.echelon.eve.ui.format.ago
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.motion.entrance
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.formationShape
import kotlinx.coroutines.delay
import java.util.Locale

// The Corp overview: the console you glance at. The corporation's mark and ticker, its treasury on a rolling counter,
// health rings for towers and structures, every fuel tank as a liquid gauge, and what to do about the sections a role
// is missing for.

/** A section the source pilot's in-game role can't read, and what to do about it. */
data class RoleNote(val section: String, val text: String)

private val SECTION_LABELS = listOf<Pair<String, (CorpSnapshot) -> Section<*>>>(
    "Starbases" to { it.starbases }, "Structures" to { it.structures }, "Wallet" to { it.wallets }, "Division names" to { it.divisions },
    "Members" to { it.members }, "Corp jobs" to { it.jobs }, "Customs offices" to { it.customs }, "Assets" to { it.assets },
)

/** One note per section that has no data because of a missing role or scope: it says which role and who can fix it. */
fun roleNotes(snap: CorpSnapshot): List<RoleNote> = SECTION_LABELS.mapNotNull { (label, pick) ->
    val s = pick(snap)
    val e = s.error ?: return@mapNotNull null
    val stale = if (s.value != null) " Showing the last copy that could be read." else ""
    RoleNote(label, when {
        e.startsWith("needs role") -> "needs the in-game role ${e.removePrefix("needs role ")}. Ask a director to give ${snap.source ?: "the pilot"} that role, or connect a pilot who has it.$stale"
        e.startsWith("needs permission") -> "needs the corporation permission. Reconnect a pilot in Settings and allow it.$stale"
        else -> "could not be read: $e.$stale"
    })
}

/** Towers and structures counted by health; null when the section was never read (a missing role). */
fun CorpSnapshot.towerHealth(): HealthCount? = starbases.value?.map { it.health() }?.tally()
fun CorpSnapshot.structureHealth(): HealthCount? = structures.value?.map { it.health() }?.tally()
fun CorpSnapshot.walletTotal(): Double? = wallets.value?.sumOf { it.balance }

private fun iskDigits(v: Double) = String.format(Locale.US, "%,.0f", v)

/** The treasury as an odometer: digits roll when it first appears and whenever it changes. */
@Composable
fun WalletOdometer(value: Double, modifier: Modifier = Modifier, compact: Boolean = false) {
    val c = Echelon.colors
    val still = Echelon.reduceMotion || LocalInspectionMode.current
    var shown by remember { mutableStateOf(if (still) value else 0.0) }
    var from by remember { mutableStateOf(shown) }
    LaunchedEffect(value, still) {
        if (still) { shown = value; return@LaunchedEffect }
        val start = from
        // Eight quick steps along an ease-out: the digits spin up fast and settle on the last one.
        for (i in 1..8) { val t = i / 8.0; shown = start + (value - start) * (1 - (1 - t) * (1 - t) * (1 - t)); delay(70) }
        shown = value; from = value
    }
    Row(modifier.semantics(mergeDescendants = true) { contentDescription = "${iskDigits(value)} ISK" }, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Row { RollingText(iskDigits(shown), Echelon.type.numLarge.copy(color = c.text, fontSize = androidx.compose.ui.unit.TextUnit(if (compact) 14f else 26f, androidx.compose.ui.unit.TextUnitType.Sp), lineHeight = androidx.compose.ui.unit.TextUnit(if (compact) 18f else 30f, androidx.compose.ui.unit.TextUnitType.Sp))) }
        Text("ISK", style = Echelon.type.overline, color = c.textMuted, modifier = Modifier.padding(bottom = 4.dp))
    }
}

/** The corporation's logo on a cut-cornered frame; the ticker shows until (and without) the image. */
@Composable
fun CorpMark(corporationId: Long, ticker: String, modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 56.dp) {
    val c = Echelon.colors
    val shape = formationShape(cut = 10.dp, radius = Radii.control)
    Box(modifier.size(size).clip(shape).background(c.surfaceSunk).border(1.dp, c.accentLine, shape), contentAlignment = Alignment.Center) {
        Text(ticker.take(3).ifBlank { "C" }, style = Echelon.type.overline, color = c.textFaint)
        if (corporationId > 0) AsyncImage(EveImages.corpLogo(corporationId, size), null, Modifier.matchParentSize().padding(3.dp), contentScale = ContentScale.Fit)
    }
}

private fun corpTitle(snap: CorpSnapshot, info: CorpInfo?) = info?.name ?: "Corporation ${snap.corporationId}"

/** The frame the overview and its card share: skeleton while loading, the empty and error states, then the snapshot. */
@Composable
internal fun CorpFrame(load: Load<CorpSnapshot>, onRetry: () -> Unit, content: @Composable (CorpSnapshot) -> Unit) {
    when (load) {
        Load.Loading -> SkeletonRows(rows = 4, label = "Reading the corporation…")
        is Load.Failed -> if (load.missing) EmptyState(load.message, title = "No corporation data yet", icon = EchelonIcons.Corp)
            else ErrorState("Couldn’t read the corporation", load.message, action = { SecondaryButton("Try again", onRetry) })
        is Load.Ready -> content(load.value)
    }
}

/** A coloured count with its word ("3 OK"), the legend under a ring. */
@Composable
private fun Legend(count: HealthCount?, none: String) {
    val c = Echelon.colors
    if (count == null || count.total == 0) { Text(if (count == null) "Locked" else none, style = Echelon.type.label, color = c.textFaint); return }
    androidx.compose.foundation.layout.FlowRow(Modifier.widthIn(max = 150.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        listOf(Health.Ok to "OK", Health.Low to "low", Health.Reinforced to "reinf.").forEach { (h, w) ->
            if (count.of(h) > 0) Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).clip(androidx.compose.foundation.shape.CircleShape).background(h.color()))
                Text("${count.of(h)} $w", style = Echelon.type.numSmall, color = c.textMuted)
            }
        }
    }
}

// ── The full overview ──

/**
 * The console: header (mark, name, ticker, members, treasury, data age and source pilot), the two health rings, the
 * fuel bay (one liquid gauge per tower and structure, reinforced ones pulsing red), what a missing role blocks, and a
 * way into the refuel planner. [open] takes a Corp sub-screen key and an optional item id.
 */
@Composable
fun CorpOverviewScreen(
    load: Load<CorpSnapshot>, info: CorpInfo?, names: CorpNames, now: Long, onRetry: () -> Unit, open: (String, String?) -> Unit,
    modifier: Modifier = Modifier, scroll: Boolean = true,
) = CorpPage(modifier, scroll) {
    CorpFrame(load, onRetry) { snap ->
        val c = Echelon.colors
        val towers = snap.towerHealth(); val structures = snap.structureHealth()
        val haptics = rememberHaptics()
        val alarm = (towers?.reinforced ?: 0) + (structures?.reinforced ?: 0)
        val inspecting = LocalInspectionMode.current
        LaunchedEffect(alarm) { if (alarm > 0 && !inspecting) haptics.reject() }

        PrimaryPanel {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                CorpMark(snap.corporationId, info?.ticker.orEmpty())
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("STATION · CORPORATION", style = Echelon.type.overline, color = c.accentStrong)
                    Text(corpTitle(snap, info), style = Echelon.type.screenTitle, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                        info?.ticker?.takeIf { it.isNotBlank() }?.let { Tag("[$it]", tone = Tone.Accent) }
                        Text(plural(snap.memberCount, "member"), style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                    }
                }
            }
            Hairline()
            Text("TREASURY · ALL DIVISIONS", style = Echelon.type.overline, color = c.textMuted)
            snap.walletTotal()?.let { WalletOdometer(it) } ?: Text("Needs the Accountant role", style = MaterialTheme.typography.bodyMedium, color = c.textFaint)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusDot(if (snap.partial) Tone.Warn else Tone.Ok, live = !snap.partial)
                Text("Synced ${ago(snap.updatedAt, now)}${snap.source?.let { " · read by $it" } ?: ""}${if (snap.partial) " · still filling in" else ""}", style = Echelon.type.label, color = c.textMuted)
            }
        }

        SectionHeader("Systems check")
        EchelonCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                RingColumn("Towers", towers, "no towers", 0, onClick = { open("starbases", null) })
                RingColumn("Structures", structures, "no structures", 220, onClick = { open("structures", null) })
            }
        }

        val bay = fuelBay(snap, names)
        if (bay.isNotEmpty()) {
            SectionHeader("Fuel bay", subtitle = "Notch: the alert line. Under it, the tower or structure is low.")
            EchelonCard(padding = false) {
                bay.forEachIndexed { i, row ->
                    if (i > 0) Hairline()
                    FuelRow(row, names) { open(if (row.tower) "starbases" else "structures", row.id.toString()) }
                }
            }
            PrimaryButton("Plan a refuel", { open("refuel", null) }, Modifier.fillMaxWidth())
        }

        val notes = roleNotes(snap)
        if (notes.isNotEmpty()) {
            SectionHeader("Locked sections", subtitle = "What this corporation's data needs from a pilot.")
            EchelonCard(tone = Tone.Warn) {
                notes.forEachIndexed { i, n ->
                    if (i > 0) Hairline()
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.Top) {
                        Icon(EchelonIcons.Alert, null, Modifier.size(18.dp).padding(top = 2.dp), tint = c.warn)
                        Text("${n.section} ${n.text}", style = MaterialTheme.typography.bodySmall, color = c.text)
                    }
                }
            }
        }
    }
}

@Composable
private fun RingColumn(label: String, count: HealthCount?, none: String, delayMillis: Int, onClick: () -> Unit) {
    Column(Modifier.clip(androidx.compose.foundation.shape.RoundedCornerShape(Radii.control)).clickable(onClickLabel = "Open $label", role = Role.Button, onClick = onClick).padding(Spacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        HealthRing(count ?: HealthCount(), label.uppercase(), delayMillis = delayMillis)
        Legend(count, none)
    }
}

/** One gauge in the fuel bay: a tower (hours of 30 days) or a structure (days of 30). */
data class FuelRowData(val id: Long, val tower: Boolean, val type: Long, val title: String, val system: Long, val health: Health, val fraction: Float?, val readout: String, val mark: Float)

/** Every tower and structure with a reading, reinforced first, then the least fuel. */
fun fuelBay(snap: CorpSnapshot, names: CorpNames): List<FuelRowData> {
    val towers = snap.starbases.value.orEmpty().map { t ->
        val left = t.fuelHoursLeft
        // The gauge still shows the bay of a reinforced or offline tower (its hours from the blocks it holds).
        FuelRowData(t.id, true, t.type, names.type(t.type), t.system, t.health(), (left ?: t.fuelHours)?.let { (it / Thresholds.TOWER_GAUGE_HOURS).toFloat() },
            when { t.state == "reinforced" -> "Reinforced"; t.state != "online" -> "Offline"; left == null -> "Not read"; else -> duration(left * 3600) }, (Thresholds.TOWER_HOURS / Thresholds.TOWER_GAUGE_HOURS).toFloat())
    }
    val structures = snap.structures.value.orEmpty().map { s ->
        val left = s.fuelDaysLeft
        FuelRowData(s.id, false, s.type, s.name ?: names.type(s.type), s.system, s.health(), left?.let { (it / Thresholds.STRUCTURE_GAUGE_DAYS).toFloat() },
            when { s.isReinforced() -> "Reinforced"; left == null -> "No fuel"; left <= 0 -> "Out of fuel"; else -> duration(left * 86400) }, (Thresholds.STRUCTURE_DAYS / Thresholds.STRUCTURE_GAUGE_DAYS).toFloat())
    }
    return (towers + structures).sortedWith(compareBy({ it.health != Health.Reinforced }, { it.health != Health.Low }, { it.fraction ?: Float.MAX_VALUE }))
}

@Composable
private fun FuelRow(row: FuelRowData, names: CorpNames, onClick: () -> Unit) {
    val c = Echelon.colors
    Column(Modifier.fillMaxWidth().reinforcedPulse(row.health == Health.Reinforced).clickable(onClickLabel = "Open ${row.title}", role = Role.Button, onClick = onClick).padding(horizontal = Spacing.lg, vertical = Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            TypeIcon(row.type, size = 36.dp, contentDescription = names.type(row.type))
            Column(Modifier.weight(1f)) {
                Text(row.title, style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                    names.sec(row.system)?.let { SecurityBadge(it) }
                    Text(names.system(row.system), style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 1)
                }
            }
            Text(row.readout, style = Echelon.type.num, color = row.health.color(), maxLines = 1)
        }
        LiquidGauge(row.fraction ?: 0f, row.health.color(), mark = row.mark, label = "${row.title}: ${row.readout}")
    }
}

// ── The hub card ──

/**
 * The hub's top card: the overview in miniature (mark, ticker, members, treasury, two small rings and a sentence
 * saying what needs attention). Tapping opens the full overview. It does nothing until a snapshot exists, and then
 * it is the first thing on the Corp tab.
 */
@Composable
fun CorpOverviewCard(load: Load<CorpSnapshot>, info: CorpInfo?, now: Long, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    EchelonCard(modifier.fillMaxWidth(), onClick = onOpen, shape = formationShape(Radii.cut, Radii.panel), onClickLabel = "Open the corporation overview") {
        when (load) {
            Load.Loading -> SkeletonRows(rows = 2, label = "Reading the corporation…")
            is Load.Failed -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                CorpMark(0, "")
                Column(Modifier.weight(1f)) {
                    Text("Corporation overview", style = MaterialTheme.typography.titleSmall, color = c.text)
                    Text(load.message, style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            is Load.Ready -> {
                val snap = load.value
                val towers = snap.towerHealth(); val structures = snap.structureHealth()
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    CorpMark(snap.corporationId, info?.ticker.orEmpty(), size = 48.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(corpTitle(snap, info), style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${info?.ticker?.takeIf { it.isNotBlank() }?.let { "[$it] · " } ?: ""}${plural(snap.memberCount, "member")}", style = Echelon.type.label, color = c.textMuted)
                        snap.walletTotal()?.let { WalletOdometer(it, compact = true) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                        HealthRing(towers ?: HealthCount(), "TOWERS", size = 60.dp, stroke = 6.dp)
                        HealthRing(structures ?: HealthCount(), "STRUCTURES", size = 60.dp, stroke = 6.dp, delayMillis = 160)
                    }
                }
                Text(attentionLine(snap, towers, structures, now), style = Echelon.type.label, color = if (attentionTone(towers, structures) == Tone.Ok) c.textMuted else if (attentionTone(towers, structures) == Tone.Danger) c.danger else c.warn)
            }
        }
    }
}

private fun attentionTone(towers: HealthCount?, structures: HealthCount?) = when {
    (towers?.reinforced ?: 0) + (structures?.reinforced ?: 0) > 0 -> Tone.Danger
    (towers?.low ?: 0) + (structures?.low ?: 0) > 0 -> Tone.Warn
    else -> Tone.Ok
}

/** One sentence: what needs attention, or that all is well, and how old the reading is. */
fun attentionLine(snap: CorpSnapshot, towers: HealthCount?, structures: HealthCount?, now: Long): String {
    val parts = buildList {
        val r = (towers?.reinforced ?: 0) + (structures?.reinforced ?: 0); if (r > 0) add("$r reinforced")
        val l = (towers?.low ?: 0) + (structures?.low ?: 0); if (l > 0) add("$l low on fuel")
    }
    val head = if (parts.isEmpty()) (if (towers == null && structures == null) "Structures need a role to read" else "All towers and structures healthy") else parts.joinToString(" · ")
    return "$head · ${ago(snap.updatedAt, now)}"
}
