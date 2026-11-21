package com.echelon.eve.fly.fit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.fly.FlyPage
import com.echelon.eve.fly.PilotPicker
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.ListRow
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.TypeIcon
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import kotlinx.serialization.Serializable

/** One line of a fit, as fit.js fitGroups returns it: a module (with its loaded charge) or a stack in a bay. */
@Serializable
data class FitItem(val type: Long, val flag: String = "", val qty: Long = 1, val group: String = "", val charge: Long? = null)

/** The bridge's `fit.groups` answer: items by slot group, the counts, and the groups in display order with titles. */
@Serializable
data class FitGroups(val groups: Map<String, List<FitItem>> = emptyMap(), val counts: Map<String, Long> = emptyMap(), val slots: List<List<String>> = emptyList())

/** The fit screen's state for one pilot. [note] says why there is no fit. */
data class FitUi(
    val pilot: Pilot,
    val shipType: Long? = null,
    val shipName: String? = null,
    val groups: FitGroups? = null,
    val names: Map<Long, String> = emptyMap(),
    val eft: String? = null,
    val loading: Boolean = false,
    val note: String? = null,
    val fromWing: Boolean = false,
)

@Composable
fun FitScreen(ui: FitUi?, flying: Pilot?, onPick: (Pilot) -> Unit, onCopy: (String) -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true) = FlyPage(modifier, scroll) {
    if (ui == null || flying == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Fly); return@FlyPage }
    PilotPicker(ui.pilot, onPick)
    val c = Echelon.colors
    val name = { id: Long -> ui.names[id] ?: "…" }
    when {
        ui.groups != null && ui.shipType != null -> {
            PrimaryPanel {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    TypeIcon(ui.shipType, size = 56.dp, contentDescription = ui.names[ui.shipType])
                    Column(Modifier.weight(1f)) {
                        Text(ui.shipName?.takeIf { it.isNotBlank() } ?: name(ui.shipType), style = Echelon.type.screenTitle, color = c.text, maxLines = 1)
                        Text(name(ui.shipType), style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
                    }
                    if (ui.fromWing) Tag("Shared")
                }
                PrimaryButton("Copy as EFT", { ui.eft?.let(onCopy) }, Modifier.fillMaxWidth(), enabled = ui.eft != null)
            }
            ui.groups.slots.forEach { slot ->
                val key = slot.getOrNull(0) ?: return@forEach
                val items = ui.groups.groups[key].orEmpty()
                if (items.isEmpty()) return@forEach
                SectionHeader(slot.getOrNull(1) ?: key, subtitle = ui.groups.counts[key]?.let { if (key in STACKED) "$it items" else "$it fitted" })
                EchelonCard(padding = false) {
                    items.forEachIndexed { i, item ->
                        if (i > 0) Hairline()
                        ListRow(
                            title = name(item.type),
                            supporting = item.charge?.let { "Loaded: ${name(it)}" },
                            leading = { TypeIcon(item.type, size = 32.dp) },
                            trailing = if (key in STACKED) ({ Text("×${item.qty}", style = Echelon.type.num, color = c.textMuted) }) else null,
                        )
                    }
                }
            }
        }
        ui.loading -> SkeletonRows(rows = 6, label = "Reading the fit…")
        else -> EmptyState(ui.note ?: "No fit to show.", title = "No fit", icon = EchelonIcons.Fly)
    }
}

/** Groups that hold stacks (shown with a quantity) rather than fitted modules. */
private val STACKED = setOf("drones", "fighters", "special", "cargo")
