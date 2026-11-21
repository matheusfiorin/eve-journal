package com.echelon.eve.ui.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.Countdown
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.Emblem
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.HeroBackground
import com.echelon.eve.ui.components.ListRow
import com.echelon.eve.ui.components.PilotBadge
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.ProgressBar
import com.echelon.eve.ui.components.ProgressRing
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SecurityBadge
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.StatRow
import com.echelon.eve.ui.components.StatTile
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing

/** Every design-system component on one scrolling page: a living reference, and the Paparazzi golden that guards it. */
@Composable
fun DesignCatalog(modifier: Modifier = Modifier, now: Long = 1_800_000_000_000L, scroll: Boolean = true) {
    Column((if (scroll) modifier.verticalScroll(rememberScrollState()) else modifier).padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        HeroBackground(Modifier.fillMaxWidth().height(120.dp)) {
            Row(Modifier.padding(Spacing.lg), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Emblem(size = 40.dp)
                Column {
                    Text("Echelon", style = Echelon.type.hero.copy(fontSize = MaterialTheme.typography.headlineMedium.fontSize), color = Echelon.colors.text)
                    Text("Design system", style = MaterialTheme.typography.bodySmall, color = Echelon.colors.textMuted)
                }
            }
        }
        PrimaryPanel {
            Text("Primary panel", style = Echelon.type.screenTitle, color = Echelon.colors.text)
            StatRow {
                StatTile("Wallet", 12_500_000.25, Modifier.weight(1f), kind = Kind.Isk, note = "Fiofka")
                StatTile("Jobs ready", 3.0, Modifier.weight(1f), tone = Tone.Ok)
                StatTile("Fuel", null, Modifier.weight(1f), display = "2d 4h", tone = Tone.Warn)
            }
            ProgressBar(.62f)
        }
        SectionHeader("Chips and badges", subtitle = "Tags, choices, security and pilots")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Tag("Ready", tone = Tone.Ok); Tag("Outbid", tone = Tone.Warn); Tag("Reinforced", tone = Tone.Danger); Tag("Hauling")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) { ChoiceChip("High-sec", true, {}); ChoiceChip("Low-sec", false, {}); ChoiceChip("Null-sec", false, {}) }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
            listOf(1.0, 0.5, 0.4, 0.1, -0.3).forEach { SecurityBadge(it) }
            SecurityBadge(0.946, outlined = true)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) { PilotBadge("Fiofka", PilotColors.Fiofka); PilotBadge("Decxus", PilotColors.Decxus) }
        SectionHeader("Rows")
        EchelonCard(padding = false) {
            ListRow("Jita", supporting = "The Forge · 3 jumps", meta = "Updated 4 min ago", leading = { SecurityBadge(0.946) }, onClick = {})
            Hairline()
            ListRow("Tritanium", supporting = "Sell in Amarr", trailing = { Text("+1.2M", style = Echelon.type.num, color = Echelon.colors.ok) })
        }
        SectionHeader("Progress and time")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xl), verticalAlignment = Alignment.CenterVertically) {
            ProgressRing(.72f) { Text("72%", style = Echelon.type.numSmall, color = Echelon.colors.text) }
            Countdown(now + 245_000, now = now, label = "Sleepers in", total = 900_000)
            Countdown(now + 30_000, now = now, label = "Cycle")
        }
        SectionHeader("States")
        SkeletonRows(rows = 3)
        EmptyState("No industry jobs running.", title = "Nothing to deliver", icon = EchelonIcons.Corp)
        ErrorState("EVE isn’t answering", "Showing data from 14:20. We’ll try again shortly.", tone = Tone.Warn, action = { SecondaryButton("Retry", {}) })
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) { PrimaryButton("Connect with EVE", {}); SecondaryButton("Later", {}) }
    }
}
