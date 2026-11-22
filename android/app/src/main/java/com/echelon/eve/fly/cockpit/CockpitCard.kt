package com.echelon.eve.fly.cockpit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.Countdown
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.SecurityBadge
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing

/** The cockpit's card on the Fly hub: the last place read and the next timer, so the hub itself is glanceable. */
@Composable
fun CockpitHubCard(me: Whereabouts?, next: WingTimer?, now: Long, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    EchelonCard(modifier.fillMaxWidth(), tone = Tone.Accent, onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Icon(EchelonIcons.Fly, null, Modifier.size(28.dp), tint = c.accent)
            Column(Modifier.weight(1f)) {
                Text("Cockpit", style = MaterialTheme.typography.titleMedium, color = c.text)
                if (me?.systemName != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    me.sec?.let { SecurityBadge(it) }
                    Text(me.systemName + if (me.dockedAt != null) " · docked" else " · in space", style = MaterialTheme.typography.bodyMedium, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                } else Text("Open while you play: where you are, timers, calls", style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 2)
            }
            if (next != null) Column(horizontalAlignment = Alignment.End) {
                Countdown(next.endsAt, now = now, style = Echelon.type.num)
                Text(next.label, style = Echelon.type.label, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            } else Icon(EchelonIcons.Chevron, null, Modifier.size(18.dp), tint = c.textFaint)
        }
    }
}
