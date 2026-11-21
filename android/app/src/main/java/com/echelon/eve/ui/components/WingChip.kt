package com.echelon.eve.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.format.ago
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors

/**
 * Who did something in the wing, and when: "Decxus started ‘Gas site’ 3 min ago", in that pilot's colour. Shown on a
 * wingmate's shared timer, ping or plan, so their items read apart from your own at a glance.
 */
@Composable
fun WingChip(pilotName: String, pilot: PilotColors, action: String, at: Long, now: Long, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(99.dp)
    Row(modifier.height(24.dp).clip(shape).background(pilot.soft).border(1.dp, pilot.color.copy(alpha = .4f), shape).padding(start = 8.dp, end = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).rotate(45f).background(pilot.color))
        Text("$pilotName $action ${ago(at, now)}", style = Echelon.type.label, color = Echelon.colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
