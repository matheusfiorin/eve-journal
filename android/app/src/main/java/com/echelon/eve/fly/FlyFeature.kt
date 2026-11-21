package com.echelon.eve.fly

import com.echelon.eve.nav.Destination
import com.echelon.eve.nav.Feature
import com.echelon.eve.nav.FeatureRegistry
import com.echelon.eve.nav.Placeholder
import com.echelon.eve.nav.SubScreen
import com.echelon.eve.ui.EchelonIcons

/** FLY: help during play. Stub entries from the scaffold; the Fly agent replaces them (timers, live, fit, queue, jobs). */
object FlyFeature : Feature {
    override val destination = Destination.Fly
    override fun install(registry: FeatureRegistry) {
        fun stub(key: String, title: String, summary: String, order: Int, icon: androidx.compose.ui.graphics.vector.ImageVector) =
            registry.register(destination, SubScreen(key, title, summary, icon, order) { Placeholder(title, summary) })
        stub("timers", "Timers", "Gas sites, mining cycles, despawn and cyno", 10, EchelonIcons.Timer)
        stub("live", "Where I am", "Live location and ship from EVE", 20, EchelonIcons.Route)
        stub("fit", "Current fit", "Copy as EFT", 30, EchelonIcons.Fly)
        stub("skills", "Skill queue", "What is training and when it ends", 40, EchelonIcons.Pilot)
        stub("jobs", "Jobs ready", "Industry jobs to deliver", 50, EchelonIcons.Check)
    }
}
