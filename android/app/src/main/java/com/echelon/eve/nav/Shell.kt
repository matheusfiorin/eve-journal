package com.echelon.eve.nav

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.echelon.eve.core.auth.AuthManager
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.GridBackground
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.motion.NavMotion
import com.echelon.eve.ui.motion.ProvideNavScope
import com.echelon.eve.ui.motion.SharedElementsRoot
import com.echelon.eve.ui.motion.StaggerRoot
import com.echelon.eve.ui.motion.warp
import com.echelon.eve.ui.motion.Springs
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.only
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.EchelonTheme
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing
import kotlinx.coroutines.delay
import java.time.ZoneId

/** Which bottom-bar destination a back stack entry belongs to (a sub-screen belongs to its parent). */
fun destinationOf(entry: NavBackStackEntry?): Destination? {
    val d = entry?.destination ?: return null
    return when {
        d.hasRoute(PlanRoute::class) -> Destination.Plan
        d.hasRoute(FlyRoute::class) -> Destination.Fly
        d.hasRoute(CorpRoute::class) -> Destination.Corp
        d.hasRoute(SubRoute::class) -> runCatching { Destination.valueOf(entry.toRoute<SubRoute>().destination) }.getOrNull()
        else -> null
    }
}

/**
 * The app: the theme (tinted for the pilot flying), the welcome and sign-in screen until a pilot is chosen, then the
 * top bar, a NavHost of the three destinations with their registered sub-screens and Settings, and the bottom bar.
 * Everything comes in through [state] and goes out through [actions], so screenshots render it without a backend.
 * Predictive back works throughout: NavHost plays the pop transition while the gesture is in progress.
 */
@Composable
fun EchelonShell(
    state: ShellState,
    actions: ShellActions,
    registry: FeatureRegistry = remember { FeatureRegistry() },
    start: Any = PlanRoute,
    nav: NavHostController = rememberNavController(),
    zone: ZoneId = ZoneId.systemDefault(),
    /** A sub-screen to open once ("Fly/cockpit"), from a widget, tile or notification; [onOpened] clears it. */
    openOnStart: SubRoute? = null,
    onOpened: () -> Unit = {},
) {
    EchelonTheme(state.theme, PilotColors.of(state.selected?.id)) {
        GridBackground(Modifier.fillMaxSize()) {
            if (!state.ready) return@GridBackground
            if (state.selected == null) { WelcomeScreen(state, actions); return@GridBackground }
            val entry by nav.currentBackStackEntryAsState()
            val inSettings = entry?.destination?.hasRoute(SettingsRoute::class) == true
            val current = destinationOf(entry) ?: if (entry == null && !inSettings) Destination.entries.firstOrNull { it.route() == start } else null
            val motion = NavMotion(Echelon.reduceMotion)
            val open = { d: Destination, key: String, arg: String? -> nav.navigate(SubRoute(d.name, key, arg)) }
            androidx.compose.runtime.LaunchedEffect(openOnStart) { openOnStart?.let { nav.navigate(it) { launchSingleTop = true }; onOpened() } }
            Scaffold(
                containerColor = Color.Transparent,
                contentWindowInsets = WindowInsets(0),
                topBar = { if (!inSettings) TopBar(state, actions, onSettings = { nav.navigate(SettingsRoute) { launchSingleTop = true } }, zone = zone,
                    wing = { com.echelon.eve.wing.WingStatusIndicator(onClick = { open(Destination.Fly, "wing", null) }) }) },
                bottomBar = {
                    if (!inSettings) BottomBar(current, onSelect = { d ->
                        nav.navigate(d.route()) {
                            // Each tab keeps its own back stack: leaving saves it, coming back restores it.
                            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true; restoreState = true
                        }
                    })
                },
            ) { padding ->
                SharedElementsRoot {
                    // Changing destination warps: the streaks over the whole NavHost, the scales in NavMotion.tabEnter/tabExit.
                    NavHost(nav, startDestination = start, modifier = Modifier.windowInsetsPadding(WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal)).warp(current), enterTransition = motion.enter, exitTransition = motion.exit, popEnterTransition = motion.popEnter, popExitTransition = motion.popExit) {
                        // Back from a sub-screen to its hub is a pop (the card takes the screen back); back to another tab warps.
                        val hubPopEnter: androidx.compose.animation.AnimatedContentTransitionScope<NavBackStackEntry>.() -> androidx.compose.animation.EnterTransition = {
                            if (initialState.destination.hasRoute(SubRoute::class)) motion.popEnter(this) else motion.tabEnter(this)
                        }
                        val hubExit: androidx.compose.animation.AnimatedContentTransitionScope<NavBackStackEntry>.() -> androidx.compose.animation.ExitTransition = {
                            if (targetState.destination.hasRoute(SubRoute::class) && destinationOf(targetState) == destinationOf(initialState)) motion.underCard(this) else motion.tabExit(this)
                        }
                        Destination.entries.forEach { d ->
                            val hub: @Composable androidx.compose.animation.AnimatedContentScope.(NavBackStackEntry) -> Unit = {
                                ProvideNavScope(this) { DestinationHub(d, state, actions, registry, open, padding) }
                            }
                            when (d) {
                                Destination.Plan -> composable<PlanRoute>(enterTransition = motion.tabEnter, exitTransition = hubExit, popEnterTransition = hubPopEnter, popExitTransition = motion.tabExit, content = hub)
                                Destination.Fly -> composable<FlyRoute>(enterTransition = motion.tabEnter, exitTransition = hubExit, popEnterTransition = hubPopEnter, popExitTransition = motion.tabExit, content = hub)
                                Destination.Corp -> composable<CorpRoute>(enterTransition = motion.tabEnter, exitTransition = hubExit, popEnterTransition = hubPopEnter, popExitTransition = motion.tabExit, content = hub)
                            }
                        }
                        composable<SubRoute> { e ->
                            val r = e.toRoute<SubRoute>()
                            val d = runCatching { Destination.valueOf(r.destination) }.getOrDefault(Destination.Plan)
                            ProvideNavScope(this) { SubScreenHost(d, registry.find(d, r.key), ScreenContext(state.selected, r.arg, open) { nav.popBackStack() }, padding) }
                        }
                        composable<SettingsRoute> { ProvideNavScope(this) { StaggerRoot("settings") { SettingsScreen(state, actions, onBack = { nav.popBackStack() }) } } }
                        registry.features.forEach { it.graph(this, nav) }
                    }
                }
            }
            AuthBanner(state.auth, actions, Modifier.align(Alignment.BottomCenter))
        }
    }
}

/**
 * The sign-in's progress outside the welcome screen: waiting for the browser, failed (with Try again), or connected
 * (a short confirmation that goes by itself, with a confirm haptic).
 */
@Composable
fun AuthBanner(auth: AuthManager.State, actions: ShellActions, modifier: Modifier = Modifier) {
    val haptics = rememberHaptics()
    LaunchedEffect(auth) {
        when (auth) { is AuthManager.State.Connected -> { haptics.confirm(); delay(3000); actions.dismissAuth() }; is AuthManager.State.Failed -> haptics.reject(); else -> {} }
    }
    AnimatedVisibility(auth !is AuthManager.State.Idle, modifier.windowInsetsPadding(WindowInsets.navigationBars).padding(start = Spacing.gutter, end = Spacing.gutter, bottom = 84.dp).widthIn(max = Spacing.maxContent), enter = if (Echelon.reduceMotion) fadeIn(tween(0)) else slideInVertically(Springs.select()) { it } + fadeIn(), exit = if (Echelon.reduceMotion) fadeOut(tween(0)) else slideOutVertically(Springs.nav()) { it } + fadeOut()) {
        val c = Echelon.colors
        val tone = when (auth) { is AuthManager.State.Failed -> Tone.Danger; is AuthManager.State.Connected -> Tone.Ok; else -> Tone.Neutral }
        EchelonCard(Modifier.fillMaxWidth(), tone = tone) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Column(Modifier.weight(1f)) {
                    val (title, body) = when (auth) {
                        is AuthManager.State.Waiting -> "Signing in ${auth.pilot.displayName}" to "Finish in the browser, then come back here."
                        is AuthManager.State.Failed -> "Sign-in didn’t finish" to auth.message
                        is AuthManager.State.Connected -> "${auth.pilot.displayName} is connected" to "Private data is on its way."
                        AuthManager.State.Idle -> "" to ""
                    }
                    Text(title, style = MaterialTheme.typography.titleSmall, color = c.text)
                    Text(body, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
                }
                if (auth is AuthManager.State.Failed && auth.pilot != null) PrimaryButton("Try again", { actions.connect(auth.pilot) })
                LinkButton(if (auth is AuthManager.State.Waiting) "Cancel" else "Close", actions.dismissAuth, tone = Tone.Neutral)
            }
        }
    }
}

