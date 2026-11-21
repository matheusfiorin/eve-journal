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
    }, onActive = { TimerService.ensure(c.app) })

    private val local = MutableStateFlow(load())

    /** Every timer by id: this phone's own first (they are the newest truth), then the room's. */
    val timers: StateFlow<Map<String, WingTimer>> = combine(local, room.timers) { mine, shared -> shared + mine }
        .stateIn(scope, SharingStarted.Eagerly, local.value)

    init {
        // Whenever something is counting down, the service keeps it alive in the background and rings at its end.
        scope.launch { timers.collect { all -> if (all.values.any { it.running(clock()) }) onActive() } }
    }

    fun board(now: Long = clock()): TimerBoard = TimerBoard.of(timers.value.values, now)

    /** Starts a timer for [owner]; a shared one also goes to the wing room. Returns it. */
    fun start(owner: Pilot, kind: TimerKind, durationMs: Long, label: String = "", shared: Boolean = true): WingTimer =
        newTimer(UUID.randomUUID().toString(), kind, durationMs, owner, clock(), label, shared).also { put(it) }

    fun pause(id: String) = change(id) { it.paused(clock()) }
    fun resume(id: String) = change(id) { it.resumed(clock()) }
    fun restart(id: String) = change(id) { it.restarted(clock()) }
    /** Shares a private timer with the wing, or takes a shared one back (the room tells the wingmate it is gone). */
    fun setShared(id: String, shared: Boolean) = change(id) { it.copy(shared = shared) }

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
                runCatching { f.parentFile?.mkdirs(); val tmp = File(f.path + ".tmp"); tmp.writeText(WingCodec.json.encodeToString(LIST, snapshot)); tmp.renameTo(f) }
            }
        }
    }

    companion object {
        const val FILE = "fly-timers.json"
        private const val DAY = 86_400_000L
        private val LIST = ListSerializer(WingTimer.serializer())
    }
}
