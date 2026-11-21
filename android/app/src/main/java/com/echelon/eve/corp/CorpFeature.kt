package com.echelon.eve.corp

import com.echelon.eve.nav.Destination
import com.echelon.eve.nav.Feature
import com.echelon.eve.nav.FeatureRegistry
import com.echelon.eve.nav.Placeholder
import com.echelon.eve.nav.SubScreen
import com.echelon.eve.ui.EchelonIcons

/** CORP: the corporation and personal assets. Stub entries from the scaffold; the Corp agent replaces them. */
object CorpFeature : Feature {
    override val destination = Destination.Corp
    override fun install(registry: FeatureRegistry) {
        fun stub(key: String, title: String, summary: String, order: Int, icon: androidx.compose.ui.graphics.vector.ImageVector) =
            registry.register(destination, SubScreen(key, title, summary, icon, order) { Placeholder(title, summary) })
        stub("starbases", "Starbases", "Fuel, strontium and reinforcement", 10, EchelonIcons.Alert)
        stub("structures", "Structures", "Fuel expiry, services and state", 20, EchelonIcons.Corp)
        stub("wallet", "Wallet", "Corporation wallet divisions", 30, EchelonIcons.Corp)
        stub("members", "Members", "Who is in the corporation", 40, EchelonIcons.Wing)
        stub("industry", "Corp jobs", "Corporation industry jobs", 50, EchelonIcons.Check)
        stub("customs", "Customs offices", "Planetary customs offices", 60, EchelonIcons.Route)
        stub("assets", "Assets", "Personal and corp assets by location", 70, EchelonIcons.Search)
    }
}
