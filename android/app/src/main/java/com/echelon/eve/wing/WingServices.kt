package com.echelon.eve.wing

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.echelon.eve.AppContainer
import com.echelon.eve.core.esi.eveNames
import com.echelon.eve.core.model.Location
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.Ship
import com.echelon.eve.core.wing.SessionPlan
import com.echelon.eve.core.wing.jumpsBetween
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import java.util.WeakHashMap

/**
 * The wing's coordination services, one set per [AppContainer]: this phone's wing choices, the live status publisher,
 * the session reporter and the background notifier. [start] runs once from EchelonApp.onCreate.
 *
 * For other features (Plan screens, the top bar):
 * - [follow] shares a route the pilot is about to fly (follow mode); [stopFollowing] clears it.
 * - [startSession] starts a session together; the Wing screen shows it and its summary.
 * - [jumpsToWingmate] is the "jumps apart" the Wing screen and the indicator show.
 * - `WingStatusIndicator()` (WingIndicator.kt) is the compact status for a top bar.
 */
class WingServices(private val c: AppContainer) {
    val settings: WingSettings = SharedWingSettings(c.app)
    private val json = Json { ignoreUnknownKeys = true }
    private var started = false

    val alerts = WingAlerts(systemName = { id -> c.market.state.value.data?.systems?.get(id)?.name })

    val publisher = StatusPublisher(c.scope, c.wingChannel, settings, c.selectedPilot, where = { p -> where(p) })
    val reporter = SessionReporter(c.scope, c.wingChannel, settings, c.selectedPilot, c.pilots.pilots.map { list ->
        { p: Pilot -> list.firstOrNull { it.pilot == p }?.private?.let { Ledger.of(it.op("wallet")?.value, it.op("mining")?.value) } ?: Ledger() }
    })
    val notifier = WingNotifier(c.app, c.scope, c.wingChannel, c.selectedPilot,
        foreground = { ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) }, alerts = alerts)

    fun start() {
        if (started) return
        started = true
        publisher.start(); reporter.start(); notifier.start()
    }

    /** Where [p] is: GET /api/live when it answers, else the last synced snapshot. The ship is named by its type. */
    private suspend fun where(p: Pilot): Whereabouts? {
        val token = c.sessions.token(p.id) ?: return null
        val live = runCatching { c.api.live(token) }.getOrNull()
        val w = live?.let { Whereabouts.of(it) } ?: run {
            val snap = c.pilots.state(p).private ?: return null
            val loc = snap.op("location")?.value?.let { runCatching { json.decodeFromJsonElement(Location.serializer(), it) }.getOrNull() }
            val ship = snap.op("ship")?.value?.let { runCatching { json.decodeFromJsonElement(Ship.serializer(), it) }.getOrNull() }
            Whereabouts(loc?.solarSystemId, loc?.docked, ship?.shipTypeId, ship?.shipName?.takeIf { it.isNotBlank() })
        }
        val type = w.shipType ?: return w
        val names = c.eveNames
        val typeName = names.name(type) ?: runCatching { names.resolve(listOf(type)); names.name(type) }.getOrNull()
        return w.copy(ship = typeName ?: w.ship)
    }

    /** Follow mode: share [route] (system ids, start first) as where this pilot is heading. */
    fun follow(route: List<Long>) { settings.setRoute(route); settings.setShareRoute(true) }
    fun stopFollowing() = settings.setRoute(emptyList())

    /** Starts a session together as the flying pilot; false when nobody is flying. */
    fun startSession(plan: SessionPlan): Boolean { val p = c.selectedPilot.value ?: return false; c.wingChannel.startSession(p, plan); return true }

    /** Jumps between the flying pilot and their wingmate by their shared statuses; null when either is unknown. */
    fun jumpsToWingmate(): Int? {
        val p = c.selectedPilot.value ?: return null
        val st = c.wingChannel.statuses.value
        return jumpsBetween(c.market.state.value.data?.systems ?: return null, st[p.id]?.system, st[p.wingmate.id]?.system)
    }

    companion object {
        private val all = WeakHashMap<AppContainer, WingServices>()
        fun of(container: AppContainer): WingServices = synchronized(all) { all.getOrPut(container) { WingServices(container) } }
    }
}

/** Shorthand for [WingServices.of]. */
val AppContainer.wingServices: WingServices get() = WingServices.of(this)
