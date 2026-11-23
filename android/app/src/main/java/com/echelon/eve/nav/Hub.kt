package com.echelon.eve.nav

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.api.Problem
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EchelonRefreshBox
import com.echelon.eve.ui.components.EchelonStripes
import com.echelon.eve.ui.components.Emblem
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.HeroBackground
import com.echelon.eve.ui.components.PilotBadge
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.motion.NoEntrance
import com.echelon.eve.ui.motion.StaggerRoot
import com.echelon.eve.ui.motion.entrance
import com.echelon.eve.ui.motion.parallaxHeader
import com.echelon.eve.ui.motion.HapticMoment
import com.echelon.eve.ui.motion.rememberHaptics
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import com.echelon.eve.ui.motion.sharedContainer
import com.echelon.eve.ui.motion.sharedText
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.formationShape

/** The shared-element key that links a hub card to its open sub-screen (a container transform). */
fun subKey(destination: Destination, key: String) = "sub:${destination.name}:$key"

/** Hub rows grow no wider than this on tablets and in landscape; the ground fills the rest. */
private val HubMaxWidth = Spacing.maxContent

/**
 * A destination's home: a starfield hero with the destination and pilot (it drifts up at half speed and fades as the
 * list scrolls over it), any sign-in or outage banner, then every registered sub-screen as a card (or the card the
 * feature supplies), entering in a stagger. Pull down to refresh everything.
 */
@Composable
fun DestinationHub(destination: Destination, state: ShellState, actions: ShellActions, registry: FeatureRegistry, open: (Destination, String, String?) -> Unit, contentPadding: PaddingValues = PaddingValues()) {
    val entries = registry.entries(destination, state.selected)
    val list = rememberLazyListState()
    // A pull you made gets its "sync done" tick when the sync lands (the background syncs stay silent).
    val haptics = rememberHaptics()
    val asked = remember { booleanArrayOf(false) }
    LaunchedEffect(state.sync.syncing) { if (!state.sync.syncing && asked[0]) { asked[0] = false; haptics.play(HapticMoment.SyncDone) } }
    StaggerRoot("hub:${destination.name}") {
        EchelonRefreshBox(isRefreshing = state.sync.syncing, onRefresh = { asked[0] = true; actions.refresh() }, modifier = Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(bottom = Spacing.xxl + contentPadding.calculateBottomPadding(), top = contentPadding.calculateTopPadding()),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm), horizontalAlignment = Alignment.CenterHorizontally) {
                item("hero") {
                    // Parallax: while the hero is the first row, it moves at half the scroll and fades out.
                    Hero(destination, state.selected, Modifier.parallaxHeader(list))
                }
                item("banner") { Banner(state, actions, Modifier.widthIn(max = HubMaxWidth)) }
                if (entries.isEmpty()) item("empty") { EmptyState("Nothing here yet.", Modifier.widthIn(max = HubMaxWidth).padding(horizontal = Spacing.gutter)) }
                itemsIndexed(entries, key = { _, it -> it.key }) { i, screen ->
                    val ctx = ScreenContext(state.selected, null, open, {})
                    Box(Modifier.widthIn(max = HubMaxWidth).fillMaxWidth().padding(horizontal = Spacing.gutter).entrance(i + 1)) {
                        val onOpen = { open(destination, screen.key, null) }
                        NoEntrance {
                            val key = subKey(destination, screen.key)
                            if (screen.card != null) Box(Modifier.sharedContainer(key)) { screen.card.invoke(ctx, onOpen) }
                            else HubCard(screen, Modifier.sharedContainer(key), onOpen, sharedKey = key)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Hero(destination: Destination, pilot: Pilot?, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    HeroBackground(modifier.fillMaxWidth().height(160.dp), seed = destination.ordinal + 3) {
        // The hero dissolves into the ground instead of ending on an edge (under the text, over the stars).
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(.5f to Color.Transparent, 1f to c.bg.copy(alpha = .9f))))
        // The formation, large and faint, riding the hero's right edge: the brand's watermark.
        Emblem(Modifier.align(Alignment.CenterEnd).padding(end = Spacing.lg).graphicsLayer { alpha = .16f }, size = 120.dp, highlight = pilot?.let { PilotColors.of(it.id) })
        Column(Modifier.align(Alignment.BottomCenter).widthIn(max = HubMaxWidth).fillMaxWidth().padding(horizontal = Spacing.gutter, vertical = Spacing.lg), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (pilot != null) PilotBadge(pilot.displayName, PilotColors.of(pilot.id), Modifier.entrance(0))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Text(destination.label, style = Echelon.type.hero, color = c.text)
                EchelonStripes(Modifier.padding(top = 6.dp), height = 18.dp)
            }
            Text(destination.blurb, style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
        }
    }
}

/** Only one banner at a time: an expired sign-in (with Reconnect) wins over an outage (with Retry). */
@Composable
private fun Banner(state: ShellState, actions: ShellActions, modifier: Modifier = Modifier) {
    val expired = state.sync.expired.firstOrNull()
    val outage = state.sync.outage
    Box(modifier.padding(horizontal = Spacing.gutter)) {
        when {
            expired != null -> ErrorState("${expired.displayName}’s sign-in expired", "Connect again to see ${expired.displayName}’s private data. The rest of the app keeps working.", tone = Tone.Warn,
                action = { PrimaryButton("Reconnect ${expired.displayName}", { actions.connect(expired) }) })
            outage != null && outage.kind == Problem.Kind.Outage -> ErrorState("EVE isn’t answering", "${outage.message} What you see is the last data we got.", tone = Tone.Warn,
                action = { SecondaryButton("Retry", actions.refresh) })
        }
    }
}

/** The default hub card for a registered sub-screen. */
@Composable
fun HubCard(screen: SubScreen, modifier: Modifier = Modifier, onOpen: () -> Unit, sharedKey: String? = null) =
    HubCard(screen.title, screen.summary, screen.icon, onOpen, modifier, sharedKey)

/**
 * A hub card: the icon on a Formation tile, the title and one line, a chevron (or [trailing], such as a live
 * countdown), the whole card a target that sinks under the finger. Its title flies into the screen's back bar when
 * opened from the hub ([sharedKey] = subKey(...)); feature `card`s can use this to keep the hub's look.
 */
@Composable
fun HubCard(title: String, summary: String, icon: ImageVector, onOpen: () -> Unit, modifier: Modifier = Modifier, sharedKey: String? = null, trailing: (@Composable () -> Unit)? = null) {
    val c = Echelon.colors
    EchelonCard(modifier.fillMaxWidth(), onClick = onOpen, shape = formationShape(Radii.cut, Radii.panel), onClickLabel = "Open $title") {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            val tile = formationShape(cut = 8.dp, radius = Radii.control)
            Box(Modifier.size(40.dp).clip(tile).background(c.accentSoft).border(1.dp, c.accentLine.copy(alpha = .5f), tile), contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(22.dp), tint = c.accentStrong)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(title, (if (sharedKey != null) Modifier.sharedText("$sharedKey:title") else Modifier), style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(summary, style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (trailing != null) trailing() else Icon(EchelonIcons.Chevron, null, Modifier.size(18.dp), tint = c.textFaint)
        }
    }
}

/**
 * A sub-screen's frame: back bar and title, then the feature's content. Its container morphs from the hub card, the
 * card's title flies into the back bar, and the screen's cards and headers enter in a stagger (once per visit).
 */
@Composable
fun SubScreenHost(destination: Destination, screen: SubScreen?, ctx: ScreenContext, contentPadding: PaddingValues) {
    val key = subKey(destination, screen?.key ?: "missing")
    Column(Modifier.fillMaxSize().padding(top = contentPadding.calculateTopPadding()).sharedContainer(key)) {
        BackBar(screen?.title ?: destination.label, ctx.back, sharedKey = if (screen?.card == null) key else null)
        Box(Modifier.weight(1f).padding(bottom = contentPadding.calculateBottomPadding()), contentAlignment = Alignment.TopCenter) {
            Box(Modifier.widthIn(max = HubMaxWidth).fillMaxSize()) {
                StaggerRoot("$key:${ctx.arg}") {
                    if (screen != null) screen.content(ctx) else EmptyState("This screen isn’t available in this version.", Modifier.padding(Spacing.gutter))
                }
            }
        }
    }
}

/** What a scaffold stub shows until its feature lands. */
@Composable
fun Placeholder(title: String, summary: String) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        EmptyState("$summary. This screen is on its way.", title = title, icon = EchelonIcons.Timer)
    }
}
