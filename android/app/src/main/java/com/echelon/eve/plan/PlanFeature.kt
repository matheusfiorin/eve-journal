package com.echelon.eve.plan

import com.echelon.eve.nav.Destination
import com.echelon.eve.nav.Feature
import com.echelon.eve.nav.FeatureRegistry
import com.echelon.eve.nav.SubScreen
import com.echelon.eve.plan.build.BuildRoute
import com.echelon.eve.plan.explore.ExploreRoute
import com.echelon.eve.plan.goals.GoalsRoute
import com.echelon.eve.plan.haul.HaulRoute
import com.echelon.eve.plan.mine.MineRoute
import com.echelon.eve.plan.sell.SellRoute
import com.echelon.eve.plan.trade.TradeRoute
import com.echelon.eve.ui.EchelonIcons

/**
 * PLAN: decide what to do next. Each screen runs the web's own planner through the bridge (android/js/plan, one adapter
 * per screen) on the market, gate map and order book that PlanEngine keeps loaded; Wing goals is the journal's goals.
 */
object PlanFeature : Feature {
    override val destination = Destination.Plan
    override fun install(registry: FeatureRegistry) {
        registry.register(destination, SubScreen("explore", "Explore", "Where to scan for relic and data sites", EchelonIcons.Search, 10) { ExploreRoute(it) })
        registry.register(destination, SubScreen("industry", "Build", "Which blueprint to buy and build", EchelonIcons.Plan, 20) { BuildRoute(it) })
        registry.register(destination, SubScreen("mining", "Mine", "What to mine and where", EchelonIcons.Plan, 30) { MineRoute(it) })
        registry.register(destination, SubScreen("trade", "Trade", "Trade and haul opportunities", EchelonIcons.Swap, 40) { TradeRoute(it) })
        registry.register(destination, SubScreen("sell", "Sell", "The best markets for a cargo", EchelonIcons.Plan, 50) { SellRoute(it) })
        registry.register(destination, SubScreen("haul", "Haul routes", "Safest, balanced and shortest routes", EchelonIcons.Route, 60) { HaulRoute(it) })
        registry.register(destination, SubScreen("goals", "Wing goals", "Shared goals and their progress", EchelonIcons.Wing, 70) { GoalsRoute(it) })
    }
}
