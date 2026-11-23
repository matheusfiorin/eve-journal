package com.echelon.eve.fly

import com.echelon.eve.AppContainer
import com.echelon.eve.core.esi.EveNames
import com.echelon.eve.core.esi.eveNames
import com.echelon.eve.fly.timers.TimerStore
import java.util.WeakHashMap

/** The Fly feature's long-lived objects, one set per [AppContainer] (built on first use). */
class FlyServices(val container: AppContainer) {
    val names: EveNames get() = container.eveNames
    val timers = TimerStore(container)
    /** The mining cycle and hold-full time from the flying pilot's fit and skills (ESI dogma, cached). */
    val mining = com.echelon.eve.fly.timers.MiningLoader(container)
    /** GET /api/live on a schedule while the cockpit or Where I am is open (one schedule for both). */
    val cockpit = com.echelon.eve.fly.cockpit.CockpitLive({ FlyLoader(container).live(it) })

    companion object {
        private val all = WeakHashMap<AppContainer, FlyServices>()
        fun of(container: AppContainer): FlyServices = synchronized(all) { all.getOrPut(container) { FlyServices(container) } }
    }
}

/** Shorthand for [FlyServices.of]. */
val AppContainer.fly: FlyServices get() = FlyServices.of(this)
