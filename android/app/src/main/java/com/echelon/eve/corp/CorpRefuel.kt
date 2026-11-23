package com.echelon.eve.corp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.toClipEntry
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.TypeIcon
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.motion.AnimatedNumber
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

// The refuel planner: pick 7, 14 or 30 days and see, for every tower and structure, the blocks and cubic metres to haul,
// the total, and a shopping list to paste into EVE's Multibuy.

val REFUEL_DAYS = listOf(7, 14, 30)

private fun blocks(n: Long) = String.format(Locale.US, "%,d", n)
private fun volume(m3: Double) = String.format(Locale.US, "%,.0f m³", m3)

/**
 * @param days one of [REFUEL_DAYS]; @param structureBlock the block structures are bought as; @param onCopy gets the
 * multibuy text (the route puts it on the clipboard); [copied] lights the button for a moment after.
 */
@Composable
fun RefuelScreen(
    load: Load<CorpSnapshot>, names: CorpNames, now: Long, days: Int, onDays: (Int) -> Unit, structureBlock: FuelBlock, onBlock: (FuelBlock) -> Unit,
    copied: Boolean, onCopy: (String) -> Unit, onRetry: () -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true,
) = CorpPage(modifier, scroll) {
    CorpFrame(load, onRetry) { snap ->
        val c = Echelon.colors
        if (snap.starbases.value == null && snap.structures.value == null) {
            EmptyState(roleNotes(snap).firstOrNull { it.section == "Starbases" || it.section == "Structures" }?.let { "${it.section} ${it.text}" } ?: "Towers and structures are read on the next corporation sync, about once an hour.", title = "Nothing to plan yet", icon = EchelonIcons.Gauge)
            return@CorpFrame
        }
        val haptics = rememberHaptics()
        val plan = refuelPlan(snap, days, names::typeOrNull, structureBlock)

        PrimaryPanel {
            Text("REFUEL PLANNER", style = Echelon.type.overline, color = c.accentStrong)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text("Run for", style = MaterialTheme.typography.bodyMedium, color = c.textMuted, modifier = Modifier.padding(bottom = 3.dp))
                AnimatedNumber(days.toDouble(), from = days.toDouble(), style = Echelon.type.numLarge.copy(fontSize = androidx.compose.ui.unit.TextUnit(30f, androidx.compose.ui.unit.TextUnitType.Sp), lineHeight = androidx.compose.ui.unit.TextUnit(34f, androidx.compose.ui.unit.TextUnitType.Sp)), color = c.text)
                Text("days", style = MaterialTheme.typography.bodyMedium, color = c.textMuted, modifier = Modifier.padding(bottom = 3.dp))
            }
            // A slider with three detents: 7, 14, 30.
            val index = REFUEL_DAYS.indexOf(days).coerceAtLeast(0)
            Slider(index.toFloat(), { v -> val i = v.toInt().coerceIn(0, 2); if (i != index) { haptics.tick(); onDays(REFUEL_DAYS[i]) } }, valueRange = 0f..2f, steps = 1,
                colors = SliderDefaults.colors(thumbColor = c.accent, activeTrackColor = c.accent, inactiveTrackColor = c.surface3, activeTickColor = c.textOnAccent, inactiveTickColor = c.tick))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                REFUEL_DAYS.forEach { Text("$it d", style = Echelon.type.numSmall, color = if (it == days) c.accentStrong else c.textFaint) }
            }
            Hairline()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.xl)) {
                Column {
                    Text("FUEL BLOCKS TO ADD", style = Echelon.type.overline, color = c.textMuted)
                    AnimatedNumber(plan.totalBlocks.toDouble(), from = plan.totalBlocks.toDouble() * .8, style = Echelon.type.numLarge, color = c.text, text = { blocks(Math.round(it)) })
                }
                Column {
                    Text("CARGO", style = Echelon.type.overline, color = c.textMuted)
                    AnimatedNumber(plan.totalVolume, from = plan.totalVolume * .8, style = Echelon.type.numLarge, color = c.text, text = { volume(it) })
                }
            }
            if (plan.shopping.isEmpty()) Text("Everything already holds $days days. Nothing to buy.", style = MaterialTheme.typography.bodySmall, color = c.ok)
            else plan.shopping.forEach { (name, qty) -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(name, style = MaterialTheme.typography.bodySmall, color = c.textMuted); Text(blocks(qty), style = Echelon.type.numSmall, color = c.text) } }
            PrimaryButton(if (copied) "Copied to the clipboard" else "Copy shopping list", { haptics.confirm(); onCopy(multibuy(plan)) }, Modifier.fillMaxWidth(), enabled = plan.shopping.isNotEmpty())
        }

        if (plan.lines.any { !it.tower }) {
            Text("Structures take any fuel block. Buy them as:", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                FuelBlock.entries.forEach { b -> ChoiceChip(b.name, b == structureBlock, { haptics.select(); onBlock(b) }) }
            }
        }

        SectionHeader("Per tower and structure", subtitle = "Top-up from what is in each bay now, to $days days.")
        EchelonCard(padding = false) {
            plan.lines.forEachIndexed { i, l ->
                if (i > 0) Hairline()
                RefuelRow(l, names, snap, days)
            }
        }
        Text("A tower burns ${towerBurn("small")}, ${towerBurn("medium")} or ${towerBurn("large")} blocks an hour by size. A structure burns what its online services use (market 40, manufacturing 12, research 12, reprocessing 10 an hour), worked out from their names, so check the bay in game before a big haul. A block is 5 m³.",
            style = MaterialTheme.typography.bodySmall, color = c.textFaint)
    }
}

private fun CorpNames.typeOrNull(id: Long): String? = types[id]

@Composable
private fun RefuelRow(l: RefuelLine, names: CorpNames, snap: CorpSnapshot, days: Int) {
    val c = Echelon.colors
    val type = if (l.tower) snap.starbases.value.orEmpty().firstOrNull { it.id == l.id }?.type else snap.structures.value.orEmpty().firstOrNull { it.id == l.id }?.type
    Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.lg, vertical = Spacing.md), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (type != null) TypeIcon(type, size = 36.dp, contentDescription = names.type(type))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(l.label, style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1)
            Text(when {
                l.burnPerHour == 0 -> "Not burning fuel"
                else -> "${l.burnPerHour}/h${l.hoursLeft?.let { " · ${duration(it * 3600)} left" } ?: ""}"
            }, style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 1)
            if (l.raceUnknown) Text("Race not known yet: bought as ${l.blockName}", style = Echelon.type.label, color = c.warn)
        }
        Column(horizontalAlignment = Alignment.End) {
            when {
                l.burnPerHour == 0 -> Tag("Idle", tone = Tone.Neutral)
                l.toAdd == 0L -> Tag("Covered", tone = Tone.Ok)
                else -> {
                    Text("+${blocks(l.toAdd)}", style = Echelon.type.num, color = c.text)
                    Text(volume(l.volume), style = Echelon.type.numSmall, color = c.textMuted)
                }
            }
        }
    }
}

/** The route's clipboard hand-off: sets the text, then keeps "copied" lit for two seconds. */
@Composable
fun rememberCopier(): Pair<Boolean, (String) -> Unit> {
    val clipboard = LocalClipboard.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    val inspecting = LocalInspectionMode.current
    LaunchedEffect(copied) { if (copied) { delay(2000); copied = false } }
    return copied to { text ->
        if (!inspecting) scope.launch { clipboard.setClipEntry(android.content.ClipData.newPlainText("Fuel shopping list", text).toClipEntry()) }
        copied = true
    }
}
