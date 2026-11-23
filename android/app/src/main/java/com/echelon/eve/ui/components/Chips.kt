package com.echelon.eve.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow


import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.format.secBand
import com.echelon.eve.ui.format.secColor
import com.echelon.eve.ui.format.secLabel
import com.echelon.eve.ui.format.secText
import com.echelon.eve.ui.motion.Springs
import com.echelon.eve.ui.motion.pressScale
import com.echelon.eve.ui.motion.pulse
import com.echelon.eve.ui.motion.heartbeat
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.indication
import androidx.compose.material3.ripple
import androidx.compose.runtime.remember
import com.echelon.eve.ui.motion.motionSpec
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing

/** The semantic tones every component shares: neutral, the UI accent, and the three states. */
enum class Tone { Neutral, Accent, Ok, Warn, Danger, Info }

@Composable
fun Tone.color(): Color = Echelon.colors.let { c -> when (this) { Tone.Neutral -> c.textMuted; Tone.Accent -> c.accentStrong; Tone.Ok -> c.ok; Tone.Warn -> c.warn; Tone.Danger -> c.danger; Tone.Info -> c.info } }

@Composable
fun Tone.soft(): Color = Echelon.colors.let { c -> when (this) { Tone.Neutral -> c.surface2; Tone.Accent -> c.accentSoft; Tone.Ok -> c.okSoft; Tone.Warn -> c.warnSoft; Tone.Danger -> c.dangerSoft; Tone.Info -> c.info.copy(alpha = .13f) } }

/** A small static label (.tag / .chip): "Ready", "Outbid", "Low-sec". */
@Composable
fun Tag(text: String, modifier: Modifier = Modifier, tone: Tone = Tone.Neutral) {
    val c = Echelon.colors
    val shape = RoundedCornerShape(Radii.chip)
    Box(modifier.height(20.dp).clip(shape).background(tone.soft()).border(1.dp, if (tone == Tone.Neutral) c.lineStrong else tone.color().copy(alpha = .4f), shape).padding(horizontal = 7.dp), contentAlignment = Alignment.Center) {
        Text(text, style = Echelon.type.chip, color = tone.color(), maxLines = 1)
    }
}

/**
 * A selectable chip (filters, segments). Selection animates its fill and border on a spring and ticks the haptics.
 * 48 dp tall for the thumb, drawn 32 dp.
 */
@Composable
fun ChoiceChip(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    val haptics = rememberHaptics()
    val fill by animateColorAsState(if (selected) c.accentSoft else c.surface2, motionSpec(Springs.select()), label = "chip fill")
    val edge by animateColorAsState(if (selected) c.accent else c.lineStrong, motionSpec(Springs.select()), label = "chip edge")
    val shape = RoundedCornerShape(Radii.control)
    val interaction = remember { MutableInteractionSource() }
    Box(modifier.defaultMinSize(minHeight = Spacing.touch).selectable(selected, interactionSource = interaction, indication = null, role = Role.Tab, onClick = { haptics.select(); onClick() }), contentAlignment = Alignment.Center) {
        Box(Modifier.pressScale(interaction, .94f).height(32.dp).clip(shape).background(fill).border(1.dp, edge, shape).indication(interaction, ripple(color = c.accent)).padding(horizontal = Spacing.md), contentAlignment = Alignment.Center) {
            Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelMedium, color = if (selected) c.text else c.textMuted, maxLines = 1)
        }
    }
}

/** A security light and figure (map.js secLight): a glowing dot in EVE's hue and the one-decimal status. */
@Composable
fun SecurityBadge(sec: Double, modifier: Modifier = Modifier, outlined: Boolean = false) {
    val hue = secColor(sec)
    val shape = RoundedCornerShape(99.dp)
    Row(
        modifier.semantics(mergeDescendants = true) { contentDescription = "Security ${secLabel(sec)}, ${secBand(sec).label}" }
            .then(if (outlined) Modifier.border(1.dp, hue, shape).padding(horizontal = 10.dp, vertical = 4.dp) else Modifier),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(9.dp).shadow(6.dp, CircleShape, ambientColor = hue, spotColor = hue).clip(CircleShape).background(hue))
        Text(secLabel(sec), style = Echelon.type.numSmall, color = secText(sec))
    }
}

/** The pilot's role badge (.role-badge): a diamond and the name in the pilot's colour. */
@Composable
fun PilotBadge(name: String, pilot: PilotColors, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(99.dp)
    Row(modifier.height(24.dp).clip(shape).background(pilot.soft).border(1.dp, pilot.color.copy(alpha = .4f), shape).padding(start = 8.dp, end = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Dart(pilot.color, Modifier.size(8.dp))
        Text(name, style = Echelon.type.label, color = pilot.color, maxLines = 1)
    }
}

/** The formation's dart (the emblem's chevron), pointing up: a pilot marker in badges and chips. */
@Composable
fun Dart(color: Color, modifier: Modifier = Modifier) {
    androidx.compose.foundation.Canvas(modifier) {
        val w = size.width; val h = size.height
        drawPath(androidx.compose.ui.graphics.Path().apply { moveTo(w / 2, 0f); lineTo(w, h); lineTo(w / 2, h * .74f); lineTo(0f, h); close() }, color)
    }
}

/**
 * A status dot; [live] adds a halo that breathes (online, the beacon), [heartbeat] a lub-dub (a sync running). Both
 * are still in screenshots and with reduced motion.
 */
@Composable
fun StatusDot(tone: Tone, modifier: Modifier = Modifier, live: Boolean = false, heartbeat: Boolean = false) {
    val color = if (tone == Tone.Neutral) Echelon.colors.textFaint else tone.color()
    Box(modifier.size(8.dp).pulse(live && !heartbeat, color).heartbeat(heartbeat, color).clip(CircleShape).background(color))
}
