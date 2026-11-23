package com.echelon.eve.fly.timers

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.echelon.eve.fly.cockpit.Suggestion
import com.echelon.eve.fly.cockpit.wormholeLine
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.color
import com.echelon.eve.ui.components.soft
import com.echelon.eve.ui.format.clock
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing

// The pieces the start sheet, a timer's controls and the Fly screens share: the warning chips, what the fit says about a
// mining cycle, the exact-alarm rationale, and the animated suggestion card.

/** The lead times the warning chips offer. */
val WARN_CHOICES = listOf(5 * MIN, 3 * MIN, 2 * MIN, MIN, 30 * SEC)

/** "5 min", "30 s" for a chip. */
fun warnChip(ms: Long): String = spoken(ms)

/** Chips to pick the warnings before the end ("Warn me"): any of the lead times shorter than [length]; none picked means no warnings. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WarnChips(length: Long, selected: List<Long>, onChange: (List<Long>) -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    val options = WARN_CHOICES.filter { it < length }
    if (options.isEmpty()) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(if (selected.isEmpty()) "No warning before the end" else "Warn me " + selected.sortedDescending().joinToString(" and ") { spoken(it) } + " before the end", style = MaterialTheme.typography.titleSmall, color = c.text)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            options.forEach { w -> ChoiceChip(warnChip(w), selected = w in selected, onClick = { onChange(if (w in selected) selected - w else (selected + w).sortedDescending()) }) }
        }
    }
}

/**
 * What the pilot's fit and skills say about mining: "Cycle 1:38 · hold full in 14 min" with what it came from. [onUse]
 * puts the cycle into the form's length (mining timers); [repeat] and [alsoHold] are the two switches.
 */
@Composable
fun MiningPanel(
    ui: MiningUi?, forKind: TimerKind, repeat: Boolean, onRepeat: (Boolean) -> Unit, alsoHold: Boolean, onAlsoHold: (Boolean) -> Unit, onUse: () -> Unit, modifier: Modifier = Modifier,
) {
    val c = Echelon.colors
    if (ui == null) return
    val p = ui.profile
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(Radii.control)).background(c.surface2).border(1.dp, c.lineStrong, RoundedCornerShape(Radii.control)).padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (p == null) {
            Text(ui.note ?: "Working out your cycle…", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            return@Column
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(EchelonIcons.Gauge, null, Modifier.size(18.dp), tint = c.accentStrong)
            Column(Modifier.weight(1f)) {
                Text(miningLine(p), style = Echelon.type.num.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize), color = c.text, maxLines = 2)
                Text("${p.shipName} · ${p.summary} · ${"%.0f".format(p.yieldPerCycle)} m3 a cycle, ${"%.0f".format(p.holdM3)} m3 ${p.holdName}", style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 2)
            }
            if (forKind == TimerKind.Mining) LinkButton("Use ${cycleClock(p.cycleMs)}", onUse)
        }
        if (forKind == TimerKind.Mining) {
            SwitchRow("Repeat every cycle", "The next cycle starts by itself and ticks softly", repeat, onRepeat)
        }
        SwitchRow("Also time when the hold is full", "A second timer: ${holdText(p.holdFullMs)}", alsoHold, onAlsoHold)
    }
}

@Composable
private fun SwitchRow(title: String, detail: String, on: Boolean, onChange: (Boolean) -> Unit) {
    val c = Echelon.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = c.text)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
        Switch(on, onChange, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
    }
}

/**
 * Why exact alarms matter, and the way to turn them on: shown on the Timers screen while the permission is missing.
 * Without it the warnings and ends still arrive, but Android may hold them back by minutes when the phone dozes.
 */
@Composable
fun ExactAlarmCard(onAllow: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    val shape = RoundedCornerShape(Radii.panel)
    Column(modifier.fillMaxWidth().clip(shape).background(Tone.Warn.soft()).border(1.dp, Tone.Warn.color().copy(alpha = .45f), shape).padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(EchelonIcons.Alert, null, Modifier.size(22.dp), tint = c.warn)
            Text("Make the warnings exact", style = MaterialTheme.typography.titleMedium, color = c.text)
        }
        Text(
            "Android may hold a timer’s warning back for minutes while the phone sleeps. Allow exact alarms and “Sleepers in 2 minutes” arrives on the second, even if the app was closed. Otherwise the alerts still come, only possibly late.",
            style = MaterialTheme.typography.bodyMedium, color = c.textMuted,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
            PrimaryButton("Open the setting", onAllow, Modifier.weight(1f))
            LinkButton("Not now", onDismiss, tone = Tone.Neutral)
        }
    }
}

/**
 * The suggestion card: a spring-in from above, a soft pulse on its edge while it waits. One tap starts the timer it names
 * ("Start sleeper timer"); nothing starts on its own. [suggestion] null hides it (sliding away).
 */
@Composable
fun SuggestionCard(suggestion: Suggestion?, mining: MiningUi?, onStart: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val reduced = Echelon.reduceMotion
    AnimatedVisibility(
        visible = suggestion != null, modifier = modifier,
        enter = if (reduced) fadeIn(tween(120)) else slideInVertically(spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessMediumLow)) { -it } + fadeIn(tween(160)) + scaleIn(spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMedium), initialScale = .92f),
        exit = if (reduced) fadeOut(tween(100)) else slideOutVertically(tween(180)) { -it / 2 } + fadeOut(tween(140)),
    ) {
        // The exit still draws the last card while it leaves.
        val s = suggestion ?: return@AnimatedVisibility
        SuggestionBody(s, mining, onStart, onDismiss)
    }
}

@Composable
internal fun SuggestionBody(s: Suggestion, mining: MiningUi?, onStart: () -> Unit, onDismiss: () -> Unit) {
    val c = Echelon.colors
    val reduced = Echelon.reduceMotion
    val pulse by rememberInfiniteTransition(label = "suggestion pulse").animateFloat(0.35f, 0.9f, infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "pulse")
    val edge = c.accentStrong.copy(alpha = if (reduced) .7f else pulse)
    val shape = RoundedCornerShape(Radii.panel)
    val (title, detail, action) = when (s) {
        is Suggestion.Wormhole -> Triple(
            wormholeLine(s.name),
            "Sleepers arrive 15 to 20 minutes after the first ship lands. Start the clock when you warp to the gas: it warns at ${clock(GasSleepers.DEFAULT_MS - GasSleepers.WARN_MS)}.",
            "Start sleeper timer",
        )
        is Suggestion.Mining -> Triple(
            "Undocked${s.ship?.let { " in $it" } ?: ""}",
            mining?.profile?.let { miningLine(it) + " · repeats by itself" } ?: "One timer per cycle of your mining modules.",
            "Start mining timer",
        )
    }
    Column(
        Modifier.fillMaxWidth().clip(shape).background(c.accentSoft).border(1.5.dp, edge, shape).padding(Spacing.lg).semantics { liveRegion = LiveRegionMode.Polite; contentDescription = "$action. $title. $detail" },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(c.accentStrong))
            Text(title, style = Echelon.type.label, color = c.accentStrong, modifier = Modifier.weight(1f), maxLines = 1)
        }
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = c.text)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
            PrimaryButton(action, onStart, Modifier.weight(1f))
            LinkButton("Not now", onDismiss, Modifier.padding(end = Spacing.xs), tone = Tone.Neutral)
        }
    }
}
