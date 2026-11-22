package com.echelon.eve.fly.cockpit

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.fly.live.LiveUi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * GET /api/live on a schedule while someone watches (the cockpit, Where I am), shared by every screen so two of them
 * never double the reads. It lives in FlyServices, so a rotation or a trip to another screen keeps the last place and
 * the schedule: coming back does not spend a read early. [events] says what changed between two good reads.
 */
class CockpitLive(private val read: suspend (Pilot) -> LiveUi, private val clock: () -> Long = System::currentTimeMillis) {
    data class State(
        val pilot: Pilot? = null,
        val ui: LiveUi = LiveUi(),
        /** The last good read (epoch ms), 0 before any. */
        val readAt: Long = 0,
        /** The last attempt, good or not. */
        val triedAt: Long = 0,
        /** When the next scheduled read is due. */
        val nextAt: Long = 0,
        val failures: Int = 0,
        val reading: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()
    private val _events = MutableSharedFlow<CockpitEvent>(extraBufferCapacity = 16)
    val events: SharedFlow<CockpitEvent> = _events.asSharedFlow()
    private val poke = Channel<Unit>(Channel.CONFLATED)
    private val lock = Mutex()

    /** Reads now if the last attempt is at least [LivePace.MIN_GAP] old (a manual refresh); the loop picks it up. */
    fun refresh() { poke.trySend(Unit) }

    /** Reads on [LivePace]'s schedule for [pilot] until cancelled (run it while the screen is started). */
    suspend fun run(pilot: Pilot) {
        readIfDue(pilot, force = false)
        while (true) {
            val wait = (_state.value.nextAt - clock()).coerceAtLeast(1_000)
            val forced = withTimeoutOrNull(wait) { poke.receive(); true } ?: false
            readIfDue(pilot, forced)
        }
    }

    /** One read when it is due (or forced and not too soon after the last). True when it read. */
    suspend fun readIfDue(pilot: Pilot, force: Boolean): Boolean = lock.withLock {
        val s = _state.value
        val same = s.pilot == pilot
        val now = clock()
        val due = !same || now >= s.nextAt || (force && now - s.triedAt >= LivePace.MIN_GAP)
        if (!due) return false
        _state.value = if (same) s.copy(reading = true) else State(pilot, LiveUi(loading = true), reading = true)
        val got = try { read(pilot) } catch (e: CancellationException) { _state.update { it.copy(reading = false) }; throw e } catch (e: Exception) { LiveUi(problem = e.message ?: "The backend did not answer.") }
        val prev = if (same) s.ui.me else null
        val failed = got.me == null
        val failures = if (failed) (if (same) s.failures else 0) + 1 else 0
        val t = clock()
        // A failed read keeps the last place on screen, with the problem under it.
        val ui = if (failed && prev != null) got.copy(me = prev) else got
        _state.value = State(pilot, ui.copy(loading = false), readAt = if (failed) (if (same) s.readAt else 0) else t, triedAt = t,
            nextAt = t + LivePace.delay(got.me, failed, got.rateLimited, failures), failures = failures)
        if (!failed && prev != null) changes(prev, got.me!!).forEach { _events.tryEmit(it) }
        true
    }
}
