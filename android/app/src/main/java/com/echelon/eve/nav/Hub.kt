package com.echelon.eve.nav

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.api.Problem
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.HeroBackground
import com.echelon.eve.ui.components.PilotBadge
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.motion.sharedContainer
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing

/** The shared-element key that links a hub card to its open sub-screen (a container transform). */
fun subKey(destination: Destination, key: String) = "sub:${destination.name}:$key"

/**
 * A destination's home: a starfield hero with the destination and pilot, any sign-in or outage banner, then every
 * registered sub-screen as a card (or the card the feature supplies). Pull down to refresh everything.
 */
@Composable
fun DestinationHub(destination: Destination, state: ShellState, actions: ShellActions, registry: FeatureRegistry, open: (Destination, String, String?) -> Unit, contentPadding: PaddingValues = PaddingValues()) {
    val entries = registry.entries(destination, state.selected)
    PullToRefreshBox(isRefreshing = state.sync.syncing, onRefresh = actions.refresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Spacing.xxl + contentPadding.calculateBottomPadding(), top = contentPadding.calculateTopPadding()), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            item("hero") { Hero(destination, state.selected) }
            item("banner") { Banner(state, actions) }
            if (entries.isEmpty()) item("empty") { EmptyState("Nothing here yet.", Modifier.padding(horizontal = Spacing.gutter)) }
            items(entries, key = { it.key }) { screen ->
                val ctx = ScreenContext(state.selected, null, open, {})
                Box(Modifier.padding(horizontal = Spacing.gutter)) {
                    val onOpen = { open(destination, screen.key, null) }
                    if (screen.card != null) Box(Modifier.sharedContainer(subKey(destination, screen.key))) { screen.card.invoke(ctx, onOpen) }
                    else HubCard(screen, Modifier.sharedContainer(subKey(destination, screen.key)), onOpen)
                }
            }
        }
    }
}

@Composable
private fun Hero(destination: Destination, pilot: Pilot?) {
    val c = Echelon.colors
    HeroBackground(Modifier.fillMaxWidth().height(148.dp), seed = destination.ordinal + 3) {
        Column(Modifier.align(Alignment.BottomStart).padding(horizontal = Spacing.gutter, vertical = Spacing.lg), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (pilot != null) PilotBadge(pilot.displayName, PilotColors.of(pilot.id))
            Text(destination.label, style = Echelon.type.hero, color = c.text)
            Text(destination.blurb, style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
        }
    }
}

/** Only one banner at a time: an expired sign-in (with Reconnect) wins over an outage (with Retry). */
@Composable
private fun Banner(state: ShellState, actions: ShellActions) {
    val expired = state.sync.expired.firstOrNull()
    val outage = state.sync.outage
    Box(Modifier.padding(horizontal = Spacing.gutter)) {
        when {
            expired != null -> ErrorState("${expired.displayName}’s sign-in expired", "Connect again to see ${expired.displayName}’s private data. The rest of the app keeps working.", tone = Tone.Warn,
                action = { PrimaryButton("Reconnect ${expired.displayName}", { actions.connect(expired) }) })
            outage != null && outage.kind == Problem.Kind.Outage -> ErrorState("EVE isn’t answering", "${outage.message} What you see is the last data we got.", tone = Tone.Warn,
                action = { SecondaryButton("Retry", actions.refresh) })
        }
    }
}

/** The default hub card: icon, title and one line, the whole card a target. */
@Composable
fun HubCard(screen: SubScreen, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    val c = Echelon.colors
    EchelonCard(modifier.fillMaxWidth(), onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Icon(screen.icon, null, Modifier.size(24.dp), tint = c.accent)
            Column(Modifier.weight(1f)) {
                Text(screen.title, style = MaterialTheme.typography.titleSmall, color = c.text)
                Text(screen.summary, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
            }
            Icon(EchelonIcons.Chevron, null, Modifier.size(18.dp), tint = c.textFaint)
        }
    }
}

/** A sub-screen's frame: back bar and title, then the feature's content; its container morphs from the hub card. */
@Composable
fun SubScreenHost(destination: Destination, screen: SubScreen?, ctx: ScreenContext, contentPadding: PaddingValues) {
    Column(Modifier.fillMaxSize().padding(top = contentPadding.calculateTopPadding()).sharedContainer(subKey(destination, screen?.key ?: "missing"))) {
        BackBar(screen?.title ?: destination.label, ctx.back)
        Box(Modifier.weight(1f).padding(bottom = contentPadding.calculateBottomPadding())) {
            if (screen != null) screen.content(ctx) else EmptyState("This screen isn’t available in this version.", Modifier.padding(Spacing.gutter))
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
