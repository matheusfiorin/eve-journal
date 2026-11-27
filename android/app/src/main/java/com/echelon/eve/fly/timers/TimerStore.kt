package com.echelon.eve.fly.timers

import com.echelon.eve.AppContainer
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingCodec
import com.echelon.eve.core.wing.WingTimer
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

/**
 * The timers this phone shows: the ones it started (kept in a file, so private timers and an offline start survive the
 * app being closed) merged with the wing room's (the wingmate's shared timers, and ours started on another device).
 * The room keeps shared timers only (worker/wingroom.js drops a private one), so this phone is where a private timer
 * lives. Every change to a shared timer also goes to the room through [com.echelon.eve.core.wing.WingChannel].
 */
class TimerStore internal constructor(
    private val scope: CoroutineScope,
    private val file: File?,
    private val room: Room,
    private val clock: () -> Long = System::currentTimeMillis,
    private val onActive: () -> Unit = {},
    private val io: CoroutineDispatcher = Dispatchers.IO,
    /** Where a pilot is now, from their synced snapshot or the wing summary: new timers start there by default. */
    private val locate: (Pilot) -> TimerSystem? = { null },
    /** Told every timer list this store holds (boot, each change): the exact alarms follow it. */
    private val onTimers: (Collection<WingTimer>) -> Unit = {},
    /** The gas the pilot harvested last: a new Sleeper or gas timer starts with it (the site's gas is picked when starting). */
    private val lastGas: GasChoice = GasChoice.Memory(),
) {
    /** What the store needs from the wing room: its timers, and the two sends. */
    interface Room {
        val timers: StateFlow<Map<String, WingTimer>>
        fun upsert(timer: WingTimer)
        fun remove(id: String, owner: Pilot)
    }

    constructor(c: AppContainer) : this(c.scope, File(c.app.filesDir, FILE), object : Room {
        override val timers = c.wingChannel.timers
        override fun upsert(timer: WingTimer) { c.wingChannel.upsertTimer(timer) }
        override fun remove(id: String, owner: Pilot) { c.wingChannel.removeTimer(id, owner) }
    }, onActive = { TimerService.ensure(c.app) }, locate = { p -> TimerLocator(c).systemOf(p) }, onTimers = { resyncAlarms(c.app) }, lastGas = GasChoice.Shared(c.app))

    /** The last live location the app read for each pilot (GET /api/live), fresher than the synced snapshot. */
    private val seen = java.util.concurrent.ConcurrentHashMap<Pilot, TimerSystem>()

    /** Tells the store where [pilot] is now (the Timers screen reads it live); new timers default to it. */
    fun noteLocation(pilot: Pilot, system: TimerSystem?) { if (system == null) seen.remove(pilot) else seen[pilot] = system }

    /** Where [pilot] is as far as this phone knows: the live read first, then the synced snapshot or the wing summary. */
    fun here(pilot: Pilot): TimerSystem? = seen[pilot] ?: locate(pilot)

    private val local = MutableStateFlow(load())

    /** Every timer by id: this phone's own first (they are the newest truth), then the room's. */
    val timers: StateFlow<Map<String, WingTimer>> = combine(local, room.timers) { mine, shared -> shared + mine }
        .stateIn(scope, SharingStarted.Eagerly, local.value)

    init {
        // Whenever something is counting down, the service keeps it alive in the background and rings at its end.
        scope.launch { timers.collect { all -> if (all.values.any { it.running(clock()) }) onActive(); runCatching { onTimers(all.values) } } }
    }

    fun board(now: Long = clock()): TimerBoard = TimerBoard.of(timers.value.values, now)

    /**
     * Starts a timer for [owner] in [system] (by default where [owner] is now; null for no system); a shared one also
     * goes to the wing room. Returns it.
     */
    fun start(owner: Pilot, kind: TimerKind, durationMs: Long, label: String = "", shared: Boolean = true, system: TimerSystem? = here(owner)): WingTimer =
        withGas(newTimer(UUID.randomUUID().toString(), kind, durationMs, owner, clock(), label, shared, system)).also { put(it) }

    /** Starts what the creation form describes. */
    fun start(owner: Pilot, draft: TimerDraft): WingTimer =
        withGas(draft.applyTo(newTimer(UUID.randomUUID().toString(), draft.kind, draft.durationMs, owner, clock(), draft.label, draft.shared, draft.system))).also { put(it) }

    /** A Sleeper or gas timer carries its gas: the one picked, else the last used; the choice is remembered for the next site. */
    private fun withGas(t: WingTimer): WingTimer =
        if (!TimerKind.of(t.kind).isGas) t else (t.gas ?: lastGas.get()).let { g -> lastGas.set(g); t.withGas(g) }

    /** The gas a new gas timer would start with. */
    fun lastGasChoice(): Fullerite = lastGas.get()

    /** Changes the gas of a timer (the pilot picked another cloud); the estimate recounts from the timer's start. */
    fun setGas(id: String, gas: Fullerite) { lastGas.set(gas); change(id) { it.withGas(gas) } }

    fun pause(id: String) = change(id) { it.paused(clock()) }
    fun resume(id: String) = change(id) { it.resumed(clock()) }
    fun restart(id: String) = change(id) { it.restarted(clock()) }
    /** Adds [ms] to the time left (PiP's +1 min). */
    fun extend(id: String, ms: Long) = change(id) { it.extended(ms, clock()) }
    /** Shares a private timer with the wing, or takes a shared one back (the room tells the wingmate it is gone). */
    fun setShared(id: String, shared: Boolean) = change(id) { it.copy(shared = shared) }
    /** Moves a timer to another system (null: no system). */
    fun place(id: String, system: TimerSystem?) = change(id) { it.placed(system) }

    /** Changes the warning points of a timer (ms before the end; empty: none). The wingmate's phone sees it too. */
    fun setWarnings(id: String, points: List<Long>) = change(id) { it.withWarnings(points) }

    /**
     * A repeating timer that reached its end [endsAt] starts its next cycle at that end (so cycles don't drift). The
     * service and the alarm receiver both call it for the same end; only the first one changes anything. Only this phone's
     * own timers advance: the wingmate's phone advances theirs.
     */
    fun advance(id: String, endsAt: Long) { if (id in local.value) change(id) { t -> advanced(t, endsAt) } }

    private fun advanced(t: WingTimer, endsAt: Long): WingTimer =
        if (!t.repeats || t.pausedAt != null || t.endsAt != endsAt || !t.done(clock())) t
        else t.copy(startedAt = if (clock() - endsAt < t.durationMs) endsAt else clock())

    /** Removes one of this phone's pilots' timers here and, if it was shared, in the room. */
    fun remove(id: String) {
        val t = timers.value[id] ?: return
        val owner = Pilot.of(t.owner) ?: return
        local.update { it - id }; persist()
        if (t.shared) room.remove(id, owner)
    }

    /** Clears the finished timers of [owner]. */
    fun clearFinished(owner: Pilot) {
        val now = clock()
        timers.value.values.filter { it.owner == owner.id && it.done(now) }.forEach { remove(it.id) }
    }

    private fun change(id: String, edit: (WingTimer) -> WingTimer) {
        val t = timers.value[id] ?: return
        val next = edit(t)
        if (next != t) put(next, wasShared = t.shared)
    }

    private fun put(t: WingTimer, wasShared: Boolean = false) {
        local.update { it + (t.id to t) }; persist()
        // A timer turned private is sent once more as private, which makes the room drop it and tell the wingmate.
        if (t.shared || wasShared) room.upsert(t)
    }

    private fun load(): Map<String, WingTimer> = runCatching {
        val text = file?.takeIf { it.exists() }?.readText() ?: return emptyMap()
        val now = clock()
        // Finished timers older than a day are history, as the room treats them.
        WingCodec.json.decodeFromString(LIST, text).filter { it.pausedAt != null || now - it.endsAt < DAY }.associateBy { it.id }
    }.getOrDefault(emptyMap())

    private val writing = kotlinx.coroutines.sync.Mutex()

    /** Writes the newest timers, one write at a time, so two quick changes can't interleave or land out of order. */
    private fun persist() {
        val f = file ?: return
        scope.launch(io) {
            writing.withLock {
                val snapshot = local.value.values.toList()
                runCatching {
                    f.parentFile?.mkdirs()
                    val tmp = File(f.path + ".tmp")
                    tmp.writeText(WingCodec.json.encodeToString(LIST, snapshot))
                    // File.renameTo may refuse an existing target on Windows, leaving stale timers on disk.
                    try {
                        Files.move(tmp.toPath(), f.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                    } catch (_: AtomicMoveNotSupportedException) {
                        Files.move(tmp.toPath(), f.toPath(), StandardCopyOption.REPLACE_EXISTING)
                    }
                }
            }
        }
    }

    companion object {
        const val FILE = "fly-timers.json"
        private const val DAY = 86_400_000L
        private val LIST = ListSerializer(WingTimer.serializer())
    }
}
