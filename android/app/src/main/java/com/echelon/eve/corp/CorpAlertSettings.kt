package com.echelon.eve.corp

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.selection.toggleable
import androidx.core.content.ContextCompat
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing

/**
 * Settings, "Corp alerts": one switch per alert type. Stateful wrapper over [CorpAlertSettingsCard]; the Settings screen
 * calls this one line. Turning a type on asks for the notification permission on Android 13+.
 */
@Composable
fun CorpAlertSettingsSection() {
    val context = LocalContext.current
    val inspecting = androidx.compose.ui.platform.LocalInspectionMode.current
    val prefs = remember { if (inspecting) InMemoryCorpAlertPrefs() else SharedCorpAlertPrefs(context) }
    var on by remember { mutableStateOf(AlertKind.entries.associateWith { prefs.enabled(it) }) }
    // No activity (previews, screenshots) means no permission launcher; the inspection flag never changes within a composition.
    val ask = if (inspecting) null else rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    val haptics = rememberHaptics()
    SectionHeader("Corp alerts", subtitle = "Checked every hour, with a network, even when the app is closed. Each tower or structure tells you once, and again after a refuel.")
    CorpAlertSettingsCard(on) { kind, value ->
        on = on + (kind to value); prefs.setEnabled(kind, value); haptics.select()
        if (value && android.os.Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) ask?.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}

@Composable
fun CorpAlertSettingsCard(on: Map<AlertKind, Boolean>, onSet: (AlertKind, Boolean) -> Unit) {
    val c = Echelon.colors
    EchelonCard(padding = false) {
        AlertKind.entries.forEachIndexed { i, kind ->
            if (i > 0) Hairline()
            val checked = on[kind] ?: true
            Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 64.dp).toggleable(checked, role = Role.Switch, onValueChange = { onSet(kind, it) }).padding(horizontal = Spacing.lg, vertical = Spacing.sm),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Column(Modifier.weight(1f)) {
                    Text(kind.label, style = MaterialTheme.typography.titleSmall, color = c.text)
                    Text(kind.summary, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                }
                Switch(checked, null, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
            }
        }
    }
}
