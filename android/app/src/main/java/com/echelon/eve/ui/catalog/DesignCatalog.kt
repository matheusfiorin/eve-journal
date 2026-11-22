package com.echelon.eve.ui.catalog

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.echelon.eve.R
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.Countdown
import com.echelon.eve.ui.components.Dart
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EchelonStripes
import com.echelon.eve.ui.components.Emblem
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.HeroBackground
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.ListRow
import com.echelon.eve.ui.components.LoadingCrossfade
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
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.WingChip
import com.echelon.eve.ui.components.Wordmark
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.motion.CelebrationFrame
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.formationShape

/**
 * Every design-system piece on one scrolling page: the Formation identity (emblem, launcher icon, palette, type),
 * then the components and the motion vocabulary frozen at telling moments. A living reference, and the Paparazzi
 * golden that guards it.
 */
@Composable
fun DesignCatalog(modifier: Modifier = Modifier, now: Long = 1_800_000_000_000L, scroll: Boolean = true) {
    val c = Echelon.colors
    Column((if (scroll) modifier.verticalScroll(rememberScrollState()) else modifier).padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        HeroBackground(Modifier.fillMaxWidth().height(132.dp).clip(formationShape(Radii.cut, Radii.panel))) {
            Wordmark(Modifier.align(Alignment.CenterStart).padding(Spacing.lg), size = 48.dp, tagline = "FORMATION · DESIGN SYSTEM")
        }

        SectionHeader("Identity", subtitle = "Launcher icon, themed icon, the emblem's highlight and the motif")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
            LauncherIcon(themed = false)
            LauncherIcon(themed = true)
            Emblem(size = 48.dp, highlight = PilotColors.Fiofka)
            Emblem(size = 48.dp, highlight = PilotColors.Decxus)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) { EchelonStripes(height = 14.dp); Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Dart(PilotColors.Fiofka.color, Modifier.size(12.dp)); Dart(PilotColors.Decxus.color, Modifier.size(12.dp)) } }
        }
        Palette()
        TypeSpecimen()
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            listOf(EchelonIcons.PlanSelected, EchelonIcons.FlySelected, EchelonIcons.CorpSelected, EchelonIcons.Wing, EchelonIcons.Timer, EchelonIcons.Route,
                EchelonIcons.Waypoint, EchelonIcons.Gauge, EchelonIcons.Target, EchelonIcons.Bell, EchelonIcons.Sparkle).forEach { IconTile(it) }
        }

        PrimaryPanel {
            Text("Primary panel", style = Echelon.type.screenTitle, color = c.text)
            StatRow {
                StatTile("Wallet", 12_500_000.25, Modifier.weight(1f), kind = Kind.Isk, note = "Fiofka")
                StatTile("Jobs ready", 3.0, Modifier.weight(1f), tone = Tone.Ok)
                StatTile("Fuel", null, Modifier.weight(1f), display = "2d 4h", tone = Tone.Warn)
            }
            ProgressBar(.62f)
        }
        SectionHeader("Chips and badges", subtitle = "Tags, choices, security and pilots")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Tag("Ready", tone = Tone.Ok); Tag("Outbid", tone = Tone.Warn); Tag("Reinforced", tone = Tone.Danger); Tag("Hauling"); Tag("Shared", tone = Tone.Accent)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) { ChoiceChip("High-sec", true, {}); ChoiceChip("Low-sec", false, {}); ChoiceChip("Null-sec", false, {}) }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
            listOf(1.0, 0.5, 0.4, 0.1, -0.3).forEach { SecurityBadge(it) }
            SecurityBadge(0.946, outlined = true)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            PilotBadge("Fiofka", PilotColors.Fiofka); PilotBadge("Decxus", PilotColors.Decxus)
            StatusDot(Tone.Ok, live = true); StatusDot(Tone.Warn); StatusDot(Tone.Neutral)
        }
        WingChip("Decxus", PilotColors.Decxus, "started ‘Gas site’", now - 180_000, now)
        SectionHeader("Rows and cards")
        EchelonCard(padding = false) {
            ListRow("Jita", supporting = "The Forge · 3 jumps", meta = "Updated 4 min ago", leading = { SecurityBadge(0.946) }, onClick = {})
            Hairline()
            ListRow("Tritanium", supporting = "Sell in Amarr", trailing = { Text("+1.2M", style = Echelon.type.num, color = c.ok) })
        }
        EchelonCard(onClick = {}, shape = formationShape()) {
            Text("A card that leads somewhere", style = MaterialTheme.typography.titleSmall, color = c.text)
            Text("formationShape(): the cut corner marks what opens.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
        SectionHeader("Progress and time")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xl), verticalAlignment = Alignment.CenterVertically) {
            ProgressRing(.72f) { Text("72%", style = Echelon.type.numSmall, color = c.text) }
            Countdown(now + 245_000, now = now, label = "Sleepers in", total = 900_000)
            Countdown(now + 30_000, now = now, label = "Cycle")
        }
        ProgressBar(1f)
        SectionHeader("Motion", subtitle = "Frozen mid-flight: a celebration burst, and the skeleton that cross-fades to content")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(120.dp).clip(RoundedCornerShape(Radii.panel)).background(c.surface1), contentAlignment = Alignment.Center) {
                CelebrationFrame(.32f, Modifier.fillMaxSize())
                Text("Done", style = Echelon.type.numLarge, color = c.ok)
            }
            Box(Modifier.weight(1f)) { LoadingCrossfade(loading = true, skeleton = { SkeletonRows(rows = 2, label = null) }) {} }
        }
        SectionHeader("States")
        SkeletonRows(rows = 3)
        EmptyState("No industry jobs running.", title = "Nothing to deliver", icon = EchelonIcons.Corp)
        ErrorState("EVE isn’t answering", "Showing data from 14:20. We’ll try again shortly.", tone = Tone.Warn, action = { SecondaryButton("Retry", {}) })
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) { PrimaryButton("Connect with EVE", {}); SecondaryButton("Later", {}); LinkButton("Skip", {}) }
    }
}

/** The adaptive launcher icon as the launcher masks it (a circle here), in colour or as the themed (monochrome) icon. */
@Composable
private fun LauncherIcon(themed: Boolean) {
    Box(Modifier.size(56.dp).clip(CircleShape).background(if (themed) Color(0xFF2B2F45) else Color.Transparent), contentAlignment = Alignment.Center) {
        if (!themed) Image(painterResource(R.drawable.ic_launcher_background), null, Modifier.size(84.dp))
        Image(painterResource(if (themed) R.drawable.ic_launcher_monochrome else R.drawable.ic_launcher_foreground), null, Modifier.size(84.dp),
            colorFilter = if (themed) ColorFilter.tint(Color(0xFFD8DCF5)) else null)
    }
}

@Composable
private fun Palette() {
    val c = Echelon.colors
    val swatches = listOf("bg" to c.bg, "surface 1" to c.surface1, "surface 2" to c.surface2, "surface 3" to c.surface3, "Ion" to c.accent, "Flare" to c.flare,
        "Fiofka" to PilotColors.Fiofka.color, "Decxus" to PilotColors.Decxus.color, "ok" to c.ok, "warn" to c.warn, "danger" to c.danger, "info" to c.info)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        swatches.forEach { (name, color) ->
            Column(Modifier.width(52.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Box(Modifier.fillMaxWidth().height(28.dp).clip(RoundedCornerShape(Radii.control)).background(color).border(1.dp, c.line, RoundedCornerShape(Radii.control)))
                Text(name, style = Echelon.type.chip, color = c.textMuted, maxLines = 1)
            }
        }
    }
}

@Composable
private fun TypeSpecimen() {
    val c = Echelon.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text("FORMATION · OXANIUM", style = Echelon.type.overline, color = c.accentStrong)
        Text("Plan the next op", style = Echelon.type.screenTitle, color = c.text)
        Text("Saira for the interface: compact, open at 12 sp, built for a HUD.", style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
        Text("1,234,567.89 ISK  ·  0:04:05  ·  0.9", style = Echelon.type.num, color = c.text)
    }
}

@Composable
private fun IconTile(icon: ImageVector) {
    Icon(icon, null, Modifier.size(22.dp), tint = Echelon.colors.accentStrong)
}
