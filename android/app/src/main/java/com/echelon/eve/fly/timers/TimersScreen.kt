package com.echelon.eve.fly.timers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.Countdown
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.ProgressBar
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.WingChip
import com.echelon.eve.ui.format.clock
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing

/** What the Timers screen can do; the route wires these to [TimerStore]. */
class TimerActions(
    val start: (kind: TimerKind, durationMs: Long, label: String, shared: Boolean) -> Unit = { _, _, _, _ -> },
    val pause: (String) -> Unit = {},
    val resume: (String) -> Unit = {},
    val restart: (String) -> Unit = {},
    val share: (String, Boolean) -> Unit = { _, _ -> },
    val remove: (String) -> Unit = {},
    val clearFinished: () -> Unit = {},
)

/**
 * The Timers screen: start a timer (kind, length, label, shared or not), then the running ones with the soonest end
 * first, the wingmate's marked with their chip, and the finished ones under them. Stateless apart from the form.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TimersScreen(pilot: Pilot?, timers: Collection<WingTimer>, now: Long, actions: TimerActions, modifier: Modifier = Modifier, scroll: Boolean = true) {
    Column(
        modifier.fillMaxSize().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier).padding(Spacing.gutter).navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        if (pilot == null) {
            EmptyState("Choose who is flying at the top of the screen, then start a timer.", title = "No pilot flying", icon = EchelonIcons.Timer)
            return@Column
        }
        NewTimer(pilot, actions)
        val board = TimerBoard.of(timers, now)
        if (board.active.isEmpty() && board.finished.isEmpty()) {
            EmptyState("Timers you start show here, and so do the ones ${pilot.wingmate.displayName} shares.", title = "No timers yet", icon = EchelonIcons.Timer)
        }
        if (board.active.isNotEmpty()) {
            SectionHeader("Running", subtitle = plural(board.active.size, "timer"))
            board.active.forEach { TimerCard(it, pilot, now, actions) }
        }
        if (board.finished.isNotEmpty()) {
            SectionHeader("Finished", action = if (board.finished.any { it.ownedBy(pilot) }) ({ LinkButton("Clear mine", actions.clearFinished) }) else null)
            board.finished.forEach { TimerCard(it, pilot, now, actions) }
        }
        Spacer(Modifier.size(Spacing.lg))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NewTimer(pilot: Pilot, actions: TimerActions) {
    val c = Echelon.colors
    var kindKey by rememberSaveable { mutableStateOf(TimerKind.Gas.key) }
    val kind = TimerKind.of(kindKey)
    var length by rememberSaveable(kindKey) { mutableLongStateOf(kind.defaultMs) }
    var label by rememberSaveable { mutableStateOf("") }
    var shared by rememberSaveable { mutableStateOf(true) }
    PrimaryPanel {
        Text("New timer", style = Echelon.type.screenTitle, color = c.text)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            TimerKind.entries.forEach { k -> ChoiceChip(k.title, selected = k == kind, onClick = { kindKey = k.key }) }
        }
        Text(kind.hint, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            val step = stepFor(length)
            IconButton(onClick = { length = (length - step).coerceAtLeast(SEC * 10) }, Modifier.semantics { contentDescription = "Shorter" }) { Text("−", style = Echelon.type.numLarge, color = c.text) }
            Text(clock(length), style = Echelon.type.numLarge, color = c.text, modifier = Modifier.weight(1f).semantics { contentDescription = "Length ${duration(length / 1000.0)}" })
            IconButton(onClick = { length = (length + step).coerceAtMost(MAX_TIMER) }, Modifier.semantics { contentDescription = "Longer" }) { Icon(EchelonIcons.Plus, null, tint = c.text) }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            kind.presets.forEach { p -> ChoiceChip(short(p), selected = p == length, onClick = { length = p }) }
        }
        OutlinedTextField(
            value = label, onValueChange = { label = it.take(60) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            label = { Text("Label") }, placeholder = { Text(kind.title) },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Share with ${pilot.wingmate.displayName}", style = MaterialTheme.typography.titleSmall, color = c.text)
                Text(if (shared) "They see it count down and get told when it ends" else "Only on your devices", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            }
            Switch(shared, { shared = it }, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
        }
        PrimaryButton("Start ${duration(length / 1000.0)}", onClick = { actions.start(kind, length, label, shared); label = "" }, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun TimerCard(t: WingTimer, pilot: Pilot, now: Long, actions: TimerActions) {
    val c = Echelon.colors
    val mine = t.ownedBy(pilot)
    val done = t.done(now)
    val owner = Pilot.of(t.owner)
    EchelonCard(tone = if (done) Tone.Ok else Tone.Neutral) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(t.label, style = MaterialTheme.typography.titleMedium, color = c.text, maxLines = 1)
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Tag(TimerKind.of(t.kind).title)
                    if (t.pausedAt != null) Tag("Paused", tone = Tone.Warn)
                    if (mine && !t.shared) Tag("Private")
                }
            }
            if (t.pausedAt != null) Text(clock(t.remaining(now)), style = Echelon.type.numLarge, color = c.textMuted)
            else Countdown(t.endsAt, now = now, warnUnderMillis = if (t.durationMs > 5 * MIN) MIN else 10 * SEC)
        }
        ProgressBar(t.progress(now), Modifier.fillMaxWidth().padding(top = Spacing.sm), color = if (done) c.ok else PilotColors.of(t.owner).color)
        if (!mine && owner != null) WingChip(owner.displayName, PilotColors.of(owner.id), "started it", t.startedAt, now, Modifier.padding(top = Spacing.sm))
        if (mine) Row(Modifier.padding(top = Spacing.xs), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when {
                done -> LinkButton("Again", { actions.restart(t.id) })
                t.pausedAt != null -> LinkButton("Resume", { actions.resume(t.id) })
                else -> LinkButton("Pause", { actions.pause(t.id) })
            }
            if (!done) LinkButton("Restart", { actions.restart(t.id) })
            LinkButton(if (t.shared) "Stop sharing" else "Share", { actions.share(t.id, !t.shared) }, tone = Tone.Neutral)
            LinkButton("Remove", { actions.remove(t.id) }, tone = Tone.Danger)
        }
    }
}

/** The −/+ step: 10 s under 2 min, a minute under 15 min, then 5 minutes. */
internal fun stepFor(length: Long): Long = when { length < 2 * MIN -> 10 * SEC; length < 15 * MIN -> MIN; else -> 5 * MIN }

/** "90s", "5m", "1h", "1h 30m" for the preset chips. */
internal fun short(ms: Long): String {
    val s = ms / 1000
    return when {
        s < 120 && s % 60 != 0L -> "${s}s"
        s < 3600 -> "${s / 60}m"
        s % 3600 == 0L -> "${s / 3600}h"
        else -> "${s / 3600}h ${(s % 3600) / 60}m"
    }
}
