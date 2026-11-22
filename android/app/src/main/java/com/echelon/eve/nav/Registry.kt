package com.echelon.eve.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.EchelonIcons
import kotlinx.serialization.Serializable

// The shell's extension points. A feature package (plan, fly, corp) owns a Feature object that registers its
// sub-screens with the registry; the shell lists them on the destination's hub and routes to them. Adding a screen
// never touches the shell: write the composable, register it in your Feature, done. See ARCHITECTURE.md.

/** The three bottom-bar destinations; [selectedIcon] is the filled twin the tab bar shows when selected. */
enum class Destination(val label: String, val icon: ImageVector, val blurb: String, val selectedIcon: ImageVector = icon) {
    Plan("Plan", EchelonIcons.Plan, "Decide what to do next", EchelonIcons.PlanSelected),
    Fly("Fly", EchelonIcons.Fly, "Timers and help while you play", EchelonIcons.FlySelected),
    Corp("Corp", EchelonIcons.Corp, "Structures, wallet and assets", EchelonIcons.CorpSelected),
}

// Type-safe routes (Navigation Compose with kotlinx.serialization).
@Serializable data object PlanRoute
@Serializable data object FlyRoute
@Serializable data object CorpRoute
@Serializable data object SettingsRoute
/** Any registered sub-screen: [destination] and [key] pick it, [arg] is its own optional argument (an id, a filter). */
@Serializable data class SubRoute(val destination: String, val key: String, val arg: String? = null)

fun Destination.route(): Any = when (this) { Destination.Plan -> PlanRoute; Destination.Fly -> FlyRoute; Destination.Corp -> CorpRoute }

/** What a sub-screen gets: who is flying, the argument it was opened with, and how to move on. */
@Immutable
data class ScreenContext(
    val pilot: Pilot?,
    val arg: String?,
    /** Opens another registered sub-screen (in any destination). */
    val open: (destination: Destination, key: String, arg: String?) -> Unit,
    val back: () -> Unit,
)

/**
 * One entry on a destination's hub.
 * - [key] is unique within its destination and is the route's key (keep it stable: it is in saved back stacks).
 * - [card] optionally replaces the default hub card with a live summary (a timer, fuel left); it should call onOpen
 *   when tapped. Without it the hub shows [title], [summary] and [icon].
 * - [content] is the full screen, drawn under the shell's top bar with its own back arrow and title.
 * - [order] sorts the hub (lower first); [visible] hides an entry, e.g. when a pilot lacks a scope.
 */
@Immutable
class SubScreen(
    val key: String,
    val title: String,
    val summary: String,
    val icon: ImageVector,
    val order: Int = 100,
    val visible: (Pilot?) -> Boolean = { true },
    val card: (@Composable (ctx: ScreenContext, onOpen: () -> Unit) -> Unit)? = null,
    val content: @Composable (ScreenContext) -> Unit,
)

/** A feature package's entry point: registers sub-screens and, if it needs them, routes of its own. */
interface Feature {
    val destination: Destination
    fun install(registry: FeatureRegistry)
    /** Extra typed routes (a detail screen with its own arguments). Most features need none. */
    fun graph(builder: NavGraphBuilder, nav: NavController) {}
    /** Work that must start with the app, not with the feature's first screen (Fly's timers resume their service). */
    fun start(container: com.echelon.eve.AppContainer) {}
}

/** Holds every feature's sub-screens. Built once at start-up from [Features.all]; read-only afterwards. */
class FeatureRegistry(features: List<Feature> = Features.all) {
    private val screens = mutableMapOf<Destination, MutableList<SubScreen>>()
    val features: List<Feature> = features

    init { features.forEach { it.install(this) } }

    fun register(destination: Destination, screen: SubScreen) {
        val list = screens.getOrPut(destination) { mutableListOf() }
        require(list.none { it.key == screen.key }) { "${destination.name} already has a sub-screen '${screen.key}'" }
        list += screen
    }

    fun entries(destination: Destination, pilot: Pilot? = null): List<SubScreen> =
        screens[destination].orEmpty().filter { it.visible(pilot) }.sortedWith(compareBy({ it.order }, { it.title }))

    fun find(destination: Destination, key: String): SubScreen? = screens[destination]?.firstOrNull { it.key == key }
}
