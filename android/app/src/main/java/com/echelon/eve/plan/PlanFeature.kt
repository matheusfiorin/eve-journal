package com.echelon.eve.plan

import com.echelon.eve.nav.Destination
import com.echelon.eve.nav.Feature
import com.echelon.eve.nav.FeatureRegistry
import com.echelon.eve.nav.Placeholder
import com.echelon.eve.nav.SubScreen
import com.echelon.eve.ui.EchelonIcons

/**
 * PLAN: decide what to do next. Stub entries from the scaffold; the Plan agent replaces each content lambda with the
 * real screen (and its card with a live summary). The planners run through core.js.PlannerBridge.
 */
object PlanFeature : Feature {
    override val destination = Destination.Plan
    override fun install(registry: FeatureRegistry) {
        fun stub(key: String, title: String, summary: String, order: Int, icon: androidx.compose.ui.graphics.vector.ImageVector = EchelonIcons.Plan) =
            registry.register(destination, SubScreen(key, title, summary, icon, order) { Placeholder(title, summary) })
        registry.register(destination, SubScreen("explore", "Explore", "Where to scan for relic and data sites", EchelonIcons.Search, 10) { com.echelon.eve.plan.explore.ExploreRoute(it) })
        stub("industry", "Build", "Which blueprint to buy and build", 20)
        registry.register(destination, SubScreen("mining", "Mine", "What to mine and where", EchelonIcons.Plan, 30) { com.echelon.eve.plan.mine.MineRoute(it) })
        stub("trade", "Trade", "Trade and haul opportunities", 40, EchelonIcons.Swap)
        stub("sell", "Sell", "The best markets for a cargo", 50)
        registry.register(destination, SubScreen("haul", "Haul routes", "Safest, balanced and shortest routes", EchelonIcons.Route, 60) { com.echelon.eve.plan.haul.HaulRoute(it) })
        stub("goals", "Wing goals", "Shared goals and their progress", 70, EchelonIcons.Wing)
    }
}
