package com.echelon.eve.nav

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.api.Problem
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.Emblem
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.KeyValueRow
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.Portrait
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.theme.Backdrop
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.MotionPref
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Settings: the pilots connected on this phone (connect, reconnect, sign out, disconnect), appearance, and about. */
@Composable
fun SettingsScreen(state: ShellState, actions: ShellActions, onBack: () -> Unit, zone: ZoneId = ZoneId.systemDefault()) {
    val c = Echelon.colors
    var confirm by remember { mutableStateOf<Pilot?>(null) }
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)) {
        BackBar("Settings", onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = Spacing.gutter).padding(bottom = Spacing.xxl),
            verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SectionHeader("Pilots", subtitle = "Each pilot connects once. The backend keeps the EVE sign-in; this phone keeps only a session, locked with its keystore.")
            state.pilots.forEach { p -> PilotCard(p, state.selected == p.pilot, actions, zone, onDisconnect = { confirm = p.pilot }) }

            SectionHeader("Appearance")
            EchelonCard {
                Text("Background", style = Echelon.type.label, color = c.textMuted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    listOf(Backdrop.Space to "Starfield", Backdrop.Plain to "Grid", Backdrop.Oled to "Black").forEach { (b, label) ->
                        ChoiceChip(label, state.theme.backdrop == b, { actions.setTheme(state.theme.copy(backdrop = b)) })
                    }
                }
                Text("Motion", style = Echelon.type.label, color = c.textMuted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    ChoiceChip("Follow the system", state.theme.motion == MotionPref.System, { actions.setTheme(state.theme.copy(motion = MotionPref.System)) })
                    ChoiceChip("Reduce motion", state.theme.motion == MotionPref.Reduced, { actions.setTheme(state.theme.copy(motion = MotionPref.Reduced)) })
                }
                Text("With reduced motion, screens change without sliding and numbers don’t count up. Turning off animations in Android’s settings does the same.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            }

            SectionHeader("About")
            EchelonCard {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    Emblem(size = 36.dp)
                    Column { Text("Echelon", style = Echelon.type.screenTitle, color = c.text); Text("The wing console for Fiofka and Decxus", style = MaterialTheme.typography.bodySmall, color = c.textMuted) }
                }
                KeyValueRow("Version", state.version.ifBlank { "—" })
                KeyValueRow("Backend", state.backendHost.ifBlank { "—" })
                Hairline()
                Text("Fonts: Michroma, Barlow Semi Condensed and Martian Mono, under the SIL Open Font License.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                Text("Data from EVE ESI. Not affiliated with CCP Games. © 2014 CCP hf. All rights reserved. “EVE”, “EVE Online”, “CCP”, and all related logos and images are trademarks or registered trademarks of CCP hf.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
            }
        }
    }
    confirm?.let { p ->
        AlertDialog(onDismissRequest = { confirm = null }, containerColor = c.surface2,
            title = { Text("Disconnect ${p.displayName} everywhere?") },
            text = { Text("This ends ${p.displayName}’s sessions on every device, removes the EVE sign-in from the backend and stops its syncing. Connect again any time.") },
            confirmButton = { PrimaryButton("Disconnect", { confirm = null; actions.disconnect(p) }) },
            dismissButton = { LinkButton("Keep connected", { confirm = null }, tone = Tone.Neutral) })
    }
}

@Composable
private fun PilotCard(p: PilotState, selected: Boolean, actions: ShellActions, zone: ZoneId, onDisconnect: () -> Unit) {
    val c = Echelon.colors
    val colors = PilotColors.of(p.id)
    val expired = p.problem?.kind == Problem.Kind.Expired
    EchelonCard(tone = if (expired) Tone.Warn else Tone.Neutral) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Portrait(p.id, colors, size = 48.dp, contentDescription = "Portrait of ${p.name}")
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text(p.name, style = MaterialTheme.typography.titleMedium, color = colors.color)
                    if (selected) Tag("Flying", tone = Tone.Accent)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusDot(if (expired) Tone.Warn else if (p.connected) Tone.Ok else Tone.Neutral)
                    Text(statusOf(p), style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                }
                p.private?.expires?.let { Text("Signed in until ${DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(zone).format(Instant.ofEpochMilli(it))}, renewed as you use it", style = Echelon.type.label, color = c.textFaint) }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            when {
                expired -> PrimaryButton("Reconnect", { actions.connect(p.pilot) })
                !p.connected -> PrimaryButton("Connect with EVE", { actions.connect(p.pilot) })
                else -> {
                    SecondaryButton("Reconnect", { actions.connect(p.pilot) })
                    SecondaryButton("Sign out here", { actions.signOutHere(p.pilot) })
                    LinkButton("Disconnect", onDisconnect, tone = Tone.Danger)
                }
            }
            if (!selected) LinkButton("Fly as ${p.name}", { actions.selectPilot(p.pilot) })
        }
    }
}
