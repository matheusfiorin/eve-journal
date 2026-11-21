package com.echelon.eve.plan.goals

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.plan.PlanPage
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.ProgressBar
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.StatRow
import com.echelon.eve.ui.components.StatTile
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing

data class GoalsUi(
    val goals: List<Goal>? = null, val problem: String? = null, val filter: String = "open", val fields: GoalFields = GoalFields(), val editing: String? = null,
    val formProblem: String? = null, val note: String? = null, val today: String = "", val saving: Boolean = false, val showForm: Boolean = false,
)

class GoalsActions(
    val filter: (String) -> Unit = {}, val fields: (GoalFields) -> Unit = {}, val save: () -> Unit = {}, val cancel: () -> Unit = {}, val add: () -> Unit = {},
    val edit: (Goal) -> Unit = {}, val delete: (Goal) -> Unit = {}, val done: (Goal, Boolean) -> Unit = { _, _ -> }, val step: (Goal, Int, Boolean) -> Unit = { _, _, _ -> }, val retry: () -> Unit = {},
)

private val FILTERS = listOf("open" to "In progress", "all" to "All goals", "done" to "Completed")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GoalsScreen(ui: GoalsUi, actions: GoalsActions, modifier: Modifier = Modifier, scroll: Boolean = true) = PlanPage(modifier, scroll) {
    val c = Echelon.colors
    val all = ui.goals
    when {
        ui.problem != null && all == null -> ErrorState("Couldn’t read the goals", ui.problem, action = { SecondaryButton("Try again", actions.retry) })
        all == null -> SkeletonRows(rows = 3, label = "Reading the wing’s goals…")
        else -> {
            val done = all.count { it.done }
            PrimaryPanel {
                Text("Our goals", style = Echelon.type.screenTitle, color = c.text)
                Text("What the wing is building toward. Either pilot’s milestone counts for both.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                StatRow {
                    StatTile("Done", done.toDouble(), Modifier.weight(1f), note = "of ${all.size}", tone = if (done > 0) Tone.Ok else Tone.Neutral)
                    StatTile("In progress", (all.size - done).toDouble(), Modifier.weight(1f))
                }
                if (!ui.showForm) PrimaryButton("Add a goal", actions.add, Modifier.fillMaxWidth())
            }
            if (ui.showForm) Form(ui, actions)
            ui.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) { FILTERS.forEach { (k, l) -> ChoiceChip(l, selected = ui.filter == k, onClick = { actions.filter(k) }) } }
            val shown = all.filter { ui.filter == "all" || (if (ui.filter == "done") it.done else !it.done) }
            if (shown.isEmpty()) EmptyState(if (all.isEmpty()) "Add one you both want, like “Fly our first exploration fleet”." else "No goals in this view.", title = if (all.isEmpty()) "No shared goals yet" else "Nothing here", icon = EchelonIcons.Wing)
            shown.forEach { g -> GoalCard(g, ui.today, actions) }
        }
    }
}

@Composable
private fun GoalCard(g: Goal, today: String, actions: GoalsActions) {
    val c = Echelon.colors
    val owner = g.owner
    // The web asks first too (wing.js): a delete removes the goal for both pilots.
    var confirm by remember { mutableStateOf(false) }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Delete this goal for the whole wing?") },
        text = { Text("“${g.title}” goes for both pilots, on the website too.") },
        confirmButton = { TextButton({ confirm = false; actions.delete(g) }) { Text("Delete", color = c.danger) } },
        dismissButton = { TextButton({ confirm = false }) { Text("Keep it") } },
        containerColor = c.surface2, titleContentColor = c.text, textContentColor = c.textMuted,
    )
    EchelonCard(tone = if (g.done) Tone.Ok else Tone.Neutral) {
        Row(verticalAlignment = Alignment.Top) {
            Checkbox(g.done, { actions.done(g, it) }, colors = CheckboxDefaults.colors(checkedColor = c.ok))
            Column(Modifier.weight(1f).padding(top = Spacing.sm)) {
                Text(g.title, style = MaterialTheme.typography.titleMedium, color = c.text)
                val overdue = !g.done && g.due != null && today.isNotEmpty() && g.due!! < today
                Text(listOfNotNull(if (owner == null) "For the wing" else "${owner.displayName}’s, for the wing", g.category, g.due?.let { "Target $it" }).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = if (overdue) c.danger else owner?.let { PilotColors.of(it.id).color } ?: c.textMuted)
            }
        }
        g.target?.let { t ->
            val r = g.result
            ProgressBar(if (r != null && t > 0) (r / t).toFloat().coerceIn(0f, 1f) else 0f, Modifier.fillMaxWidth().padding(top = Spacing.sm), color = c.ok)
            Text(if (r != null) "${format(r, Kind.Isk)} of ${format(t, Kind.Isk)}${if (r >= t) " · target reached" else ""}" else "Target ${format(t, Kind.Isk)} · no result yet",
                style = MaterialTheme.typography.bodySmall, color = if (r != null && r >= t) c.ok else c.textMuted)
        }
        g.steps.forEachIndexed { i, st ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(st.done, { actions.step(g, i, it) }, colors = CheckboxDefaults.colors(checkedColor = c.accent))
                Text(st.text, style = MaterialTheme.typography.bodyMedium, color = if (st.done) c.textFaint else c.text)
            }
        }
        g.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textMuted, modifier = Modifier.padding(top = Spacing.xs)) }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.padding(top = Spacing.xs)) {
            LinkButton("Edit", { actions.edit(g) }, tone = Tone.Neutral)
            LinkButton("Delete", { confirm = true }, tone = Tone.Danger)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Form(ui: GoalsUi, actions: GoalsActions) {
    val c = Echelon.colors
    val f = ui.fields
    val colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text)
    SectionHeader(if (ui.editing != null) "Edit goal" else "New goal")
    EchelonCard {
        OutlinedTextField(f.title, { actions.fields(f.copy(title = it.take(160))) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Next milestone") }, placeholder = { Text("Fly our first exploration fleet") }, colors = colors)
        Text("Pilot", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            (listOf("Both pilots") + Pilot.entries.map { it.displayName } + listOf(f.pilot)).distinct().forEach { p -> ChoiceChip(p, selected = f.pilot == p, onClick = { actions.fields(f.copy(pilot = p)) }) }
        }
        Text("Focus", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.padding(top = Spacing.sm))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            (GoalRules.CATEGORIES + listOf(f.category)).distinct().filter { it.isNotEmpty() }.forEach { cat -> ChoiceChip(cat, selected = f.category == cat, onClick = { actions.fields(f.copy(category = cat)) }) }
        }
        OutlinedTextField(f.due, { actions.fields(f.copy(due = it.take(10))) }, Modifier.fillMaxWidth().padding(top = Spacing.sm), singleLine = true, label = { Text("Target date (YYYY-MM-DD)") }, colors = colors)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            OutlinedTextField(f.target, { actions.fields(f.copy(target = it)) }, Modifier.weight(1f), singleLine = true, label = { Text("Target (ISK)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), colors = colors)
            OutlinedTextField(f.result, { actions.fields(f.copy(result = it)) }, Modifier.weight(1f), singleLine = true, label = { Text("Result so far") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), colors = colors)
        }
        OutlinedTextField(f.steps, { actions.fields(f.copy(steps = it.take(4000))) }, Modifier.fillMaxWidth(), minLines = 3, label = { Text("Steps, one per line") }, colors = colors)
        OutlinedTextField(f.notes, { actions.fields(f.copy(notes = it.take(4000))) }, Modifier.fillMaxWidth(), minLines = 2, label = { Text("Notes") }, colors = colors)
        ui.formProblem?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.danger) }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = Spacing.sm)) {
            PrimaryButton(if (ui.saving) "Saving…" else if (ui.editing != null) "Save changes" else "Add goal", actions.save, Modifier.weight(1f), enabled = !ui.saving)
            SecondaryButton("Cancel", actions.cancel)
        }
    }
}
