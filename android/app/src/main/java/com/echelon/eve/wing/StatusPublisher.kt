package com.echelon.eve.wing

import com.echelon.eve.core.model.LiveStatus
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingStatus
import com.echelon.eve.core.wing.routeLeft
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/** Where a pilot is, as the publisher needs it (from GET /api/live, or the last synced snapshot). */
data class Whereabouts(val system: Long? = null, val docked: Boolean? = null, val shipType: Long? = null, val ship: String? = null) {
    companion object {
        fun of(live: LiveStatus, shipTypeName: String? = null) =
            Whereabouts(live.system, if (live.system == null) null else live.station != null || live.structure != null, live.shipType, shipTypeName ?: live.shipName?.takeIf { it.isNotBlank() })
    }
}

/**
 * Publishes the flying pilot's live status into the wing room while they opt in ([WingSettings.shareStatus]) and the
 * room is connected: at once on any change of choice, then every [everyMs] (GET /api/live is limited to 30 a minute;
 * one a minute leaves room for the Live screen). A status that did not change is sent again only every [refreshMs], so
 * the room's copy stays fresh (it drops statuses after 12 h). Turning sharing off clears it in the room.
 */
class StatusPublisher(
    private val scope: CoroutineScope,
    private val channel: WingChannel,
    private val settings: WingSettings,
    private val pilot: StateFlow<Pilot?>,
    private val where: suspend (Pilot) -> Whereabouts?,
    private val clock: () -> Long = System::currentTimeMillis,
    private val everyMs: Long = 60_000,
    private val refreshMs: Long = 10 * 60_000,
) {
    private var last: Pair<Pilot, WingStatus>? = null
    private var lastAt = 0L

    @OptIn(ExperimentalCoroutinesApi::class)
    fun start(): Job = scope.launch {
        combine(channel.status, settings.shareStatus, settings.activity, settings.shareRoute, settings.route) { s, share, activity, shareRoute, route ->
            Choice(s == WingChannel.Status.Connected, share, activity, if (shareRoute) route else emptyList())
        }.combine(pilot) { c, p -> c to p }.distinctUntilChanged().collectLatest { (c, p) ->
            if (!c.connected || p == null) return@collectLatest
            // Not sharing: clear what the room still holds of this pilot (from this run, or an earlier one).
            if (!c.share) { if (last?.first == p || p.id in channel.statuses.value) channel.publishStatus(p, null); last = null; return@collectLatest }
            while (true) { publish(p, c); delay(everyMs) }
        }
    }

    private data class Choice(val connected: Boolean, val share: Boolean, val activity: String, val route: List<Long>)

    private suspend fun publish(p: Pilot, c: Choice) {
        val w = runCatching { where(p) }.getOrNull() ?: Whereabouts()
        val next = status(w, c.activity, c.route)
        val now = clock()
        if (last == p to next && now - lastAt < refreshMs) return
        channel.publishStatus(p, next)
        last = p to next; lastAt = now
    }

    companion object {
        /** The status to share: where the pilot is, and in follow mode what is left of their route (its end is the destination). */
        fun status(w: Whereabouts, activity: String, route: List<Long>): WingStatus {
            val left = routeLeft(route, w.system)
            return WingStatus(system = w.system, docked = w.docked, shipType = w.shipType, ship = w.ship?.take(64), activity = activity,
                destination = left.lastOrNull(), route = if (left.isEmpty()) emptyList() else (listOfNotNull(w.system?.takeIf { it in route }) + left).take(60))
        }
    }
}
