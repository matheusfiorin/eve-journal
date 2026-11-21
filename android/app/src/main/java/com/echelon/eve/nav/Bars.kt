package com.echelon.eve.nav

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VectorConverter
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.unit.Dp
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.data.SyncState
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.Portrait
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.color
import com.echelon.eve.ui.motion.Springs
import com.echelon.eve.ui.motion.motionSpec
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** The sync line's words, tone and fix (ui/pilots.js syncStatus): expired sign-ins first, then outages, then the time. */
data class SyncLine(val text: String, val tone: Tone, val fix: Fix?) { enum class Fix { Reconnect, Retry } }

fun syncLine(sync: SyncState, zone: ZoneId = ZoneId.systemDefault()): SyncLine {
    val time = { t: Long -> DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(zone).format(Instant.ofEpochMilli(t)) }
    return when {
        sync.expired.isNotEmpty() -> SyncLine("${sync.expired.joinToString(" and ") { "${it.displayName}’s" }} sign-in${if (sync.expired.size > 1) "s" else ""} expired", Tone.Warn, SyncLine.Fix.Reconnect)
        sync.outage != null -> SyncLine("EVE isn’t answering${sync.dataFrom?.let { ". Data from ${time(it)}" } ?: ""}", Tone.Warn, SyncLine.Fix.Retry)
        sync.syncing -> SyncLine("Syncing…", Tone.Neutral, null)
        sync.dataFrom != null && (sync.lastSyncedAt ?: 0) - sync.dataFrom > 10 * 60_000 -> SyncLine("EVE data from ${time(sync.dataFrom)}", Tone.Neutral, null)
        sync.lastSyncedAt != null -> SyncLine("Synced ${time(sync.lastSyncedAt)}", Tone.Ok, null)
        else -> SyncLine("Not synced yet", Tone.Neutral, null)
    }
}

/**
 * The top bar: the pilot switcher on the left (portrait ringed in the pilot's colour), the sync line, and settings.
 * Draws under the status bar (edge-to-edge) with a translucent ground, like the web's sticky strip.
 */
@Composable
fun TopBar(state: ShellState, actions: ShellActions, onSettings: () -> Unit, modifier: Modifier = Modifier, zone: ZoneId = ZoneId.systemDefault()) {
    val c = Echelon.colors
    Column(modifier.fillMaxWidth().background(c.bg.copy(alpha = .92f)).windowInsetsPadding(WindowInsets.statusBars)) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(start = Spacing.md, end = Spacing.xs), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PilotSwitcher(state, actions)
            Box(Modifier.weight(1f))
            SyncIndicator(state, actions, zone)
            IconButton(onSettings) { Icon(EchelonIcons.Settings, "Settings", tint = c.textMuted) }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
    }
}

@Composable
private fun SyncIndicator(state: ShellState, actions: ShellActions, zone: ZoneId) {
    val line = syncLine(state.sync, zone)
    val c = Echelon.colors
    val fix: (() -> Unit)? = when (line.fix) {
        SyncLine.Fix.Reconnect -> ({ state.sync.expired.firstOrNull()?.let(actions.connect) })
        SyncLine.Fix.Retry -> actions.refresh
        null -> null
    }
    Row(Modifier.clip(RoundedCornerShape(Radii.control)).then(if (fix != null) Modifier.clickable(onClickLabel = if (line.fix == SyncLine.Fix.Reconnect) "Reconnect" else "Retry", onClick = fix) else Modifier)
        .padding(horizontal = Spacing.sm, vertical = Spacing.xs), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        StatusDot(line.tone, live = line.tone == Tone.Ok)
        Text(line.text, style = Echelon.type.label, color = if (line.tone == Tone.Warn) c.warn else c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(132.dp))
    }
}

/** The pilot switcher (.pilot-switch): who is flying; the menu shows both pilots with their sign-in state. */
@Composable
fun PilotSwitcher(state: ShellState, actions: ShellActions) {
    val c = Echelon.colors
    val haptics = rememberHaptics()
    var open by remember { mutableStateOf(false) }
    val current = state.selected
    val colors = PilotColors.of(current?.id)
    Box {
        Row(Modifier.height(40.dp).clip(RoundedCornerShape(99.dp)).background(colors.soft).border(1.dp, colors.color.copy(alpha = .45f), RoundedCornerShape(99.dp))
            .clickable(onClickLabel = "Switch pilot") { open = true }.padding(start = 4.dp, end = 12.dp)
            .semantics { contentDescription = "Flying as ${current?.displayName ?: "nobody"}. Switch pilot" },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Portrait(current?.id, colors, size = 32.dp)
            Text(current?.displayName ?: "Choose pilot", style = MaterialTheme.typography.labelLarge, color = c.text)
            Icon(EchelonIcons.Swap, null, Modifier.size(14.dp), tint = c.textMuted)
        }
        DropdownMenu(open, { open = false }, containerColor = c.surface2) {
            state.pilots.forEach { p ->
                DropdownMenuItem(
                    text = { Column { Text(p.name, style = MaterialTheme.typography.titleSmall, color = PilotColors.of(p.id).color); Text(statusOf(p), style = MaterialTheme.typography.bodySmall, color = c.textMuted) } },
                    leadingIcon = { Portrait(p.id, PilotColors.of(p.id), size = 32.dp) },
                    trailingIcon = { if (p.pilot == current) Icon(EchelonIcons.Check, "Selected", tint = c.accent) },
                    onClick = { open = false; haptics.select(); actions.selectPilot(p.pilot) },
                )
            }
        }
    }
}

/** A pilot's sign-in state in plain words. */
fun statusOf(p: PilotState): String = when {
    p.problem?.kind == com.echelon.eve.core.api.Problem.Kind.Expired -> "Sign-in expired"
    p.connected && p.problem != null -> "Connected · EVE isn’t answering"
    p.connected -> "Connected on this phone"
    else -> "Not connected on this phone"
}

/**
 * The bottom navigation: three destinations, a pill that slides to the selected one on a spring, the icon lifting
 * slightly and tinting to the accent. One-handed: the whole cell is the target. Pads for the gesture bar itself.
 */
@Composable
fun BottomBar(selected: Destination?, onSelect: (Destination) -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    val haptics = rememberHaptics()
    val items = Destination.entries
    Column(modifier.fillMaxWidth().background(c.surface1.copy(alpha = .96f)).drawBehind { drawLine(c.line, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }.windowInsetsPadding(WindowInsets.navigationBars)) {
        BoxWithConstraints(Modifier.fillMaxWidth().height(68.dp).selectableGroup()) {
            val cell = maxWidth / items.size
            val target = cell * items.indexOf(selected).coerceAtLeast(0)
            // The pill appears in place the first time a destination is known, and slides only between destinations.
            val x = remember { Animatable(target, Dp.VectorConverter) }
            var placed by remember { mutableStateOf(false) }
            val spec = motionSpec(Springs.select<Dp>())
            LaunchedEffect(target, selected != null) {
                if (selected == null) return@LaunchedEffect
                if (!placed) { x.snapTo(target); placed = true } else x.animateTo(target, spec)
            }
            val pill = 64.dp
            if (selected != null) Box(Modifier.offset(x = (if (placed) x.value else target) + (cell - pill) / 2, y = 10.dp).size(pill, 32.dp).clip(RoundedCornerShape(99.dp)).background(c.accentSoft).border(1.dp, c.accentLine, RoundedCornerShape(99.dp)))
            Row(Modifier.fillMaxWidth().fillMaxHeight()) {
                items.forEach { d ->
                    val on = d == selected
                    val tint by animateColorAsState(if (on) c.accentStrong else c.textMuted, motionSpec(Springs.select()), label = "tint")
                    val lift by animateFloatAsState(if (on) 1.08f else 1f, motionSpec(Springs.select()), label = "lift")
                    Column(Modifier.weight(1f).fillMaxHeight().selectable(on, role = Role.Tab, onClick = { if (!on) haptics.select(); onSelect(d) }),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Top) {
                        Box(Modifier.padding(top = 14.dp).height(24.dp), contentAlignment = Alignment.Center) { Icon(d.icon, null, Modifier.size(22.dp).scale(lift), tint = tint) }
                        Text(d.label, Modifier.padding(top = 10.dp), style = Echelon.type.label, color = if (on) c.text else c.textMuted)
                    }
                }
            }
        }
    }
}

/** The title row of a sub-screen or Settings: back arrow and title. */
@Composable
fun BackBar(title: String, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    Row(modifier.fillMaxWidth().height(56.dp).padding(end = Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onBack) { Icon(EchelonIcons.Back, "Back", tint = c.text) }
        Text(title, style = Echelon.type.screenTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
