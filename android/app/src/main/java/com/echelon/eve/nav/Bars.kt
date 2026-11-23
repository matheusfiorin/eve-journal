package com.echelon.eve.nav

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.data.SyncState
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.Portrait
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.motion.Springs
import com.echelon.eve.ui.motion.motionSpec
import com.echelon.eve.ui.motion.pressScale
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.motion.sharedText
import com.echelon.eve.ui.motion.settle
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.formationShape
import kotlinx.coroutines.launch
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
 * Draws under the status bar (edge-to-edge) on a ground that fades into the page, with a hairline that brightens in
 * the middle, the flying pilot's colour.
 */
@Composable
fun TopBar(state: ShellState, actions: ShellActions, onSettings: () -> Unit, modifier: Modifier = Modifier, zone: ZoneId = ZoneId.systemDefault(), wing: (@Composable () -> Unit)? = null) {
    val c = Echelon.colors
    val pilot = Echelon.pilot.color
    Column(modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(c.bg, c.bg.copy(alpha = .9f)))).windowInsetsPadding(WindowInsets.statusBars)) {
        Row(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal)).height(60.dp).padding(start = Spacing.sm, end = Spacing.xs), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PilotSwitcher(state, actions)
            Box(Modifier.weight(1f))
            wing?.invoke()
            SyncIndicator(state, actions, zone)
            IconButton(onSettings) { Icon(EchelonIcons.Settings, "Settings", tint = c.textMuted) }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Brush.horizontalGradient(listOf(c.line, pilot.copy(alpha = .45f), c.line))))
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
    val reduced = Echelon.reduceMotion
    // 48 dp tall whether or not it is a button, so the bar's targets line up.
    Row(Modifier.defaultMinSize(minHeight = Spacing.touch).clip(RoundedCornerShape(Radii.control))
        .then(if (fix != null) Modifier.clickable(onClickLabel = if (line.fix == SyncLine.Fix.Reconnect) "Reconnect" else "Retry", onClick = fix) else Modifier)
        .padding(horizontal = Spacing.sm), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        // The beacon: a heartbeat while a sync runs, a ring settling out when it lands, then the online breath.
        StatusDot(line.tone, Modifier.settle(state.sync.lastSyncedAt, c.ok), live = line.tone == Tone.Ok, heartbeat = state.sync.syncing)
        AnimatedContent(line.text, transitionSpec = {
            if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
            else (slideInVertically(Springs.nav()) { it / 2 } + fadeIn()) togetherWith (slideOutVertically(Springs.nav()) { -it / 2 } + fadeOut())
        }, label = "sync") { text ->
            Text(text, style = Echelon.type.label, color = if (line.tone == Tone.Warn) c.warn else c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(132.dp))
        }
    }
}

/**
 * The pilot switcher: who is flying; the menu shows both pilots with their sign-in state. The pill is drawn 40 dp tall
 * inside a 48 dp target; switching pilots rolls the portrait and name over.
 */
@Composable
fun PilotSwitcher(state: ShellState, actions: ShellActions) {
    val c = Echelon.colors
    val haptics = rememberHaptics()
    var open by remember { mutableStateOf(false) }
    val current = state.selected
    val colors = PilotColors.of(current?.id)
    val interaction = remember { MutableInteractionSource() }
    val reduced = Echelon.reduceMotion
    val pill = RoundedCornerShape(99.dp)
    Box {
        Box(Modifier.height(Spacing.touch).clickable(interaction, null, onClickLabel = "Switch pilot") { open = true }
            .semantics { contentDescription = "Flying as ${current?.displayName ?: "nobody"}. Switch pilot" }, contentAlignment = Alignment.Center) {
            Row(Modifier.pressScale(interaction, .95f).height(40.dp).clip(pill).background(colors.soft).border(1.dp, colors.color.copy(alpha = .5f), pill)
                .then(Modifier.drawBehind { drawRect(Brush.horizontalGradient(listOf(colors.color.copy(alpha = .14f), Color.Transparent))) })
                .padding(start = 4.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                AnimatedContent(current, transitionSpec = {
                    if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                    else (slideInVertically(Springs.select()) { it } + fadeIn()) togetherWith (slideOutVertically(Springs.select()) { -it } + fadeOut())
                }, label = "pilot") { p ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        Portrait(p?.id, PilotColors.of(p?.id), size = 32.dp)
                        Text(p?.displayName ?: "Choose pilot", style = MaterialTheme.typography.labelLarge, color = c.text)
                    }
                }
                Icon(EchelonIcons.Swap, null, Modifier.size(14.dp), tint = c.textMuted)
            }
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
 * The bottom navigation: three destinations under a Formation pill (cut at its top-end corner) that travels like a
 * worm: its leading edge springs ahead, the trailing edge catches up. The selected icon swaps to its filled twin and
 * pops; the label brightens. One-handed: the whole cell is the target. Pads for the gesture bar itself, and keeps its
 * cells together (480 dp at most) on tablets and in landscape.
 */
@Composable
fun BottomBar(selected: Destination?, onSelect: (Destination) -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    val haptics = rememberHaptics()
    val items = Destination.entries
    Column(modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(c.surface1.copy(alpha = .94f), c.bg))).drawBehind {
        drawLine(Brush.horizontalGradient(listOf(c.line, c.lineStrong, c.line)), Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx())
    }.windowInsetsPadding(WindowInsets.navigationBars), horizontalAlignment = Alignment.CenterHorizontally) {
        BoxWithConstraints(Modifier.widthIn(max = 480.dp).fillMaxWidth().height(68.dp).selectableGroup()) {
            val cell = maxWidth / items.size
            val index = items.indexOf(selected).coerceAtLeast(0)
            val pill = 64.dp
            val targetLeft = cell * index + (cell - pill) / 2
            val targetRight = targetLeft + pill
            // The two edges of the pill, each on its own spring: the one in the direction of travel is stiffer.
            val left = remember { Animatable(targetLeft, Dp.VectorConverter) }
            val right = remember { Animatable(targetRight, Dp.VectorConverter) }
            var placed by remember { mutableStateOf(false) }
            val reduced = Echelon.reduceMotion
            LaunchedEffect(targetLeft, selected != null) {
                if (selected == null) return@LaunchedEffect
                if (!placed || reduced) { left.snapTo(targetLeft); right.snapTo(targetRight); placed = true; return@LaunchedEffect }
                val forward = targetLeft > left.value
                val lead = spring<Dp>(dampingRatio = .75f, stiffness = 900f)
                val trail = spring<Dp>(dampingRatio = .8f, stiffness = 260f)
                kotlinx.coroutines.coroutineScope {
                    launch { left.animateTo(targetLeft, if (forward) trail else lead) }
                    launch { right.animateTo(targetRight, if (forward) lead else trail) }
                }
            }
            if (selected != null) {
                val l = if (placed) left.value else targetLeft
                val r = if (placed) right.value else targetRight
                val shape = formationShape(cut = 9.dp, radius = 10.dp)
                Box(Modifier.offset(x = l, y = 8.dp).size(r - l, 34.dp).clip(shape)
                    .background(Brush.verticalGradient(listOf(c.accent.copy(alpha = .30f), c.accentSoft))).border(1.dp, c.accentLine, shape))
            }
            Row(Modifier.fillMaxWidth().fillMaxHeight()) {
                items.forEach { d ->
                    val on = d == selected
                    val tint by animateColorAsState(if (on) c.accentStrong else c.textMuted, motionSpec(Springs.select()), label = "tint")
                    val lift by animateFloatAsState(if (on) 1.1f else 1f, motionSpec(Springs.pop()), label = "lift")
                    val interaction = remember { MutableInteractionSource() }
                    Column(Modifier.weight(1f).fillMaxHeight().selectable(on, interaction, ripple(bounded = false, radius = 40.dp, color = c.accent), role = Role.Tab, onClick = { if (!on) haptics.select(); onSelect(d) }),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Top) {
                        Box(Modifier.padding(top = 13.dp).height(24.dp).pressScale(interaction, .88f), contentAlignment = Alignment.Center) {
                            Crossfade(on, animationSpec = motionSpec(tween(160), androidx.compose.animation.core.snap()), label = "icon") { sel ->
                                Icon(if (sel) d.selectedIcon else d.icon, null, Modifier.size(22.dp).graphicsLayer { scaleX = lift; scaleY = lift }, tint = tint)
                            }
                        }
                        Text(d.label, Modifier.padding(top = 9.dp), style = Echelon.type.label, color = if (on) c.text else c.textMuted)
                    }
                }
            }
        }
    }
}

/**
 * The title row of a sub-screen or Settings: back arrow and title. With [sharedKey] the title flies in from the hub
 * card that opened the screen (a shared element), so the card visibly becomes the screen.
 */
@Composable
fun BackBar(title: String, onBack: () -> Unit, modifier: Modifier = Modifier, sharedKey: String? = null) {
    val c = Echelon.colors
    Row(modifier.fillMaxWidth().height(56.dp).padding(end = Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onBack) { Icon(EchelonIcons.Back, "Back", tint = c.text) }
        Text(title, (if (sharedKey != null) Modifier.sharedText("$sharedKey:title") else Modifier), style = Echelon.type.screenTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
