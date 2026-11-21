package com.echelon.eve.core.data

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.echelon.eve.core.api.Problem
import com.echelon.eve.core.auth.SessionStore
import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Refreshes pilots, wing and market together and keeps [state] (the top bar's sync line) truthful. The Worker syncs
 * ESI every 10 minutes on its own, so the app only reads: on start, when it comes back to the foreground after
 * [staleAfterMs], and on pull-to-refresh, which also asks the Worker for a fresh ESI sync. Overlapping requests join
 * the running refresh instead of starting another.
 *
 * Register it with ProcessLifecycleOwner (the AppContainer does) for the on-resume refresh.
 */
class SyncCoordinator(
    private val scope: CoroutineScope,
    private val pilots: PilotRepository,
    private val wing: WingRepository,
    private val market: MarketRepository,
    private val sessions: SessionStore,
    private val selected: () -> Pilot?,
    private val clock: () -> Long = System::currentTimeMillis,
    private val staleAfterMs: Long = 60_000,
) : DefaultLifecycleObserver {
    private val _state = MutableStateFlow(SyncState())
    val state: StateFlow<SyncState> = _state.asStateFlow()
    private var running: Job? = null
    private val extra = mutableListOf<suspend () -> Unit>()

    /** Feature packages add their own refresh work (corp snapshot, timers) so pull-to-refresh covers it too. */
    fun addRefresher(work: suspend () -> Unit) { synchronized(extra) { extra += work } }

    /** Refreshes now; [force] = pull-to-refresh. Returns the job so callers (the pull indicator) can await it. */
    fun refresh(force: Boolean = false): Job {
        running?.takeIf { it.isActive }?.let { return it }
        return scope.launch {
            _state.update { it.copy(syncing = true) }
            sessions.load()
            val jobs = listOf(launch { pilots.refresh(force) }, launch { wing.refresh(selected()) }, launch { market.refresh() }) +
                synchronized(extra) { extra.toList() }.map { launch { runCatching { it() } } }
            jobs.joinAll()
            _state.value = summarize()
        }.also { running = it }
    }

    private fun summarize(): SyncState {
        val list = pilots.pilots.value
        val expired = list.filter { it.problem?.kind == Problem.Kind.Expired }.map { it.pilot }
        val outage = list.firstNotNullOfOrNull { p -> p.problem?.takeIf { it.kind == Problem.Kind.Outage } } ?: wing.problem.value ?: market.state.value.problem
        // When the oldest private data on screen was read from EVE (ui/pilots.js dataTime).
        val times = list.mapNotNull { it.private?.fetchedAt ?: wing.of(it.pilot)?.fetchedAt }.mapNotNull { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        return SyncState(syncing = false, lastSyncedAt = clock(), dataFrom = times.minOrNull(), expired = expired, outage = outage)
    }

    override fun onStart(owner: LifecycleOwner) {
        val last = _state.value.lastSyncedAt
        if (last == null || clock() - last > staleAfterMs) refresh()
    }
}
