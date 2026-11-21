package com.echelon.eve.fly.live

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
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.KeyValueRow
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SecurityBadge
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.TypeIcon
import com.echelon.eve.ui.format.ago
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing

/** Where a pilot is, in names: what GET /api/live (or the wing summary, for the wingmate) says, resolved for display. */
data class Whereabouts(
    val pilot: Pilot,
    val systemName: String? = null,
    val sec: Double? = null,
    val region: String? = null,
    /** The station's name; "a structure" for a citadel (their names are not public); null in space. */
    val dockedAt: String? = null,
    val shipType: Long? = null,
    val shipTypeName: String? = null,
    val shipName: String? = null,
    /** True/false when the pilot granted the online scope; null when not known. */
    val online: Boolean? = null,
    val lastSeen: Long? = null,
    /** When this was read (epoch ms). */
    val at: Long? = null,
)

/** The screen's state: the flying pilot read live, and what the wingmate shares. */
data class LiveUi(
    val me: Whereabouts? = null,
    val loading: Boolean = false,
    val problem: String? = null,
    val wingmate: Whereabouts? = null,
    /** Why the wingmate's position is not shown (not sharing, level too low). */
    val wingmateNote: String? = null,
)

@Composable
fun LiveScreen(pilot: Pilot?, ui: LiveUi, now: Long, onRefresh: () -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true) = FlyPage(modifier, scroll) {
    if (pilot == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Route); return@FlyPage }
    when {
        ui.me != null -> Place(ui.me, now, primary = true)
        ui.loading -> SkeletonRows(rows = 3, label = "Asking EVE where ${pilot.displayName} is…")
        ui.problem != null -> ErrorState("Couldn’t read ${pilot.displayName}’s location", ui.problem, action = { SecondaryButton("Try again", onRefresh) })
    }
    if (ui.me != null && ui.problem != null) Text(ui.problem, style = MaterialTheme.typography.bodySmall, color = Echelon.colors.warn)
    SecondaryButton(if (ui.loading) "Reading…" else "Read again", onRefresh, Modifier.fillMaxWidth(), enabled = !ui.loading)
    SectionHeader(pilot.wingmate.displayName, subtitle = "From the wing’s last sync")
    when {
        ui.wingmate != null -> Place(ui.wingmate, now, primary = false)
        else -> EchelonCard { Text(ui.wingmateNote ?: "${pilot.wingmate.displayName} does not share where they are.", style = MaterialTheme.typography.bodyMedium, color = Echelon.colors.textMuted) }
    }
}

@Composable
private fun Place(w: Whereabouts, now: Long, primary: Boolean) {
    val c = Echelon.colors
    val body: @Composable () -> Unit = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            if (w.sec != null) SecurityBadge(w.sec)
            Text(w.systemName ?: "Unknown system", style = if (primary) Echelon.type.screenTitle else MaterialTheme.typography.titleLarge, color = c.text)
        }
        if (w.region != null) Text(w.region, style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
        Text(w.dockedAt?.let { "Docked at $it" } ?: "In space", style = MaterialTheme.typography.titleSmall, color = c.text)
        if (w.shipType != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            TypeIcon(w.shipType, size = 40.dp, contentDescription = w.shipTypeName)
            Column {
                Text(w.shipName?.takeIf { it.isNotBlank() } ?: w.shipTypeName ?: "Ship", style = MaterialTheme.typography.titleSmall, color = c.text)
                if (w.shipTypeName != null && !w.shipName.isNullOrBlank()) Text(w.shipTypeName, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            }
        }
        if (w.online != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatusDot(if (w.online) Tone.Ok else Tone.Neutral, live = w.online)
            Text(if (w.online) "Online" else w.lastSeen?.let { "Offline · last seen ${ago(it, now)}" } ?: "Offline", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
        if (w.at != null) KeyValueRow("Read", ago(w.at, now))
    }
    if (primary) PrimaryPanel { body() } else EchelonCard { body() }
}
