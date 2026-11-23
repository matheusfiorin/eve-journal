package com.echelon.eve.core.wing

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import kotlin.math.min
import kotlin.random.Random

/**
 * Reconnect delays: [baseMs] doubling to [maxMs], each with ±20 % jitter so two phones don't retry in step. The jitter never lifts a delay
 * past [maxMs] (a cap is a cap: a dead room costs one try a minute, not more), and never takes one below 80 % of its step.
 */
class Backoff(private val baseMs: Long = 1_000, private val maxMs: Long = 60_000, private val random: Random = Random.Default) {
    private var attempt = 0
    /** How many delays were handed out since the last [reset]. */
    val attempts: Int get() = attempt
    fun next(): Long { val d = min(maxMs, baseMs shl min(attempt, 16)); attempt++; return min(maxMs, (d * (0.8 + random.nextDouble() * 0.4)).toLong()) }
    fun reset() { attempt = 0 }
}

/** Something received from the wingmate, with who sent it and when, for the UI's feed and chips; [acks] are the answers to it. */
data class WingEvent<T>(val from: Pilot?, val at: Long, val value: T, val id: String, val acks: Map<Long, WingAck> = emptyMap())

/**
 * The live link to the wing room: an OkHttp WebSocket to GET /api/wing/socket with the flying pilot's session as a
 * bearer token. The room sends a `state` snapshot first, then every change; this class folds them into StateFlows.
 *
 * It is connected only while something holds it: the app in the foreground ([FOREGROUND], from the process
 * lifecycle; register the channel with ProcessLifecycleOwner) or a running timer service ([TIMER_SERVICE]: the Fly
 * feature calls [onTimerServiceStarted] / [onTimerServiceStopped]). With no holds it closes, and the room marks the
 * pilot offline. Drops reconnect with [Backoff] (capped, jittered; it starts over only after a connection stayed up for
 * [stableMs], so a room that accepts and drops at once is not hammered); a refused session (401) stops retrying until the token
 * changes. A heartbeat ([heartbeatMs], an OkHttp ping) finds a connection that died silently, e.g. after a network switch, and
 * sends it down the same retry path; a ping every 25 s is far cheaper for the battery than a stale socket that hides messages.
 *
 * Outgoing messages sent while disconnected are queued (the latest 50) and flushed once the snapshot has arrived.
 */
class WingChannel(
    private val client: OkHttpClient,
    private val base: HttpUrl,
    private val scope: CoroutineScope,
    /** The flying pilot and their session token, or null when nobody is signed in (then the channel stays closed). */
    private val identity: () -> Pair<Pilot, String>?,
    private val onUnauthorized: (token: String) -> Unit = {},
    private val clock: () -> Long = System::currentTimeMillis,
    private val backoff: Backoff = Backoff(),
    private val heartbeatMs: Long = HEARTBEAT_MS,
    private val stableMs: Long = STABLE_MS,
    /** A monotonic clock for how long a connection lived (not [clock], which tests pin). */
    private val uptime: () -> Long = { System.nanoTime() / 1_000_000 },
) : DefaultLifecycleObserver {
    sealed interface Status {
        data object Idle : Status
        data object Connecting : Status
        data object Connected : Status
        data class Retrying(val inMs: Long, val reason: String) : Status
        /** The session was refused; connecting again needs a new sign-in. */
        data object Unauthorized : Status
    }

    private val _status = MutableStateFlow<Status>(Status.Idle)
    val status: StateFlow<Status> = _status.asStateFlow()
    private val _timers = MutableStateFlow<Map<String, WingTimer>>(emptyMap())
    /** Every timer in the room, both pilots', by id. The UI tells the wingmate's apart by [WingTimer.owner]. */
    val timers: StateFlow<Map<String, WingTimer>> = _timers.asStateFlow()
    private val _presence = MutableStateFlow<Map<Long, Presence>>(emptyMap())
    val presence: StateFlow<Map<Long, Presence>> = _presence.asStateFlow()
    private val _pings = MutableStateFlow<List<WingEvent<WingPing>>>(emptyList())
    /** The last [KEEP] pings, newest first (the snapshot's history, then live ones). */
    val pings: StateFlow<List<WingEvent<WingPing>>> = _pings.asStateFlow()
    private val _plans = MutableStateFlow<List<WingEvent<SharedPlan>>>(emptyList())
    val plans: StateFlow<List<WingEvent<SharedPlan>>> = _plans.asStateFlow()
    private val _statuses = MutableStateFlow<Map<Long, WingStatus>>(emptyMap())
    /** Each pilot's live status by pilot id (only pilots who share it). This phone's own is what it last sent. */
    val statuses: StateFlow<Map<Long, WingStatus>> = _statuses.asStateFlow()
    private val _session = MutableStateFlow<WingSession?>(null)
    /** The session the two pilots are flying, or null. */
    val session: StateFlow<WingSession?> = _session.asStateFlow()
    private val _history = MutableStateFlow<List<WingSession>>(emptyList())
    /** Ended sessions with their totals, newest first (the room keeps the last ten). */
    val sessionHistory: StateFlow<List<WingSession>> = _history.asStateFlow()
    private val _pending = MutableStateFlow(0)
    /** How many messages wait in the outbox for the room: the sync indicator's "queued". */
    val pending: StateFlow<Int> = _pending.asStateFlow()
    private val _incoming = MutableSharedFlow<WingMessage>(extraBufferCapacity = 64)
    /** Live messages as they arrive (not the snapshot): for haptics and notifications on a wingmate's ping. */
    val incoming: SharedFlow<WingMessage> = _incoming.asSharedFlow()

    private val lock = Any()
    private val holds = mutableSetOf<String>()
    private var socket: WebSocket? = null
    private var socketToken: String? = null
    private var socketOpen = false
    private var openedAt: Long? = null
    /** The client the sockets use: the app's, with the heartbeat. */
    internal val socketClient: OkHttpClient = client.newBuilder().pingInterval(heartbeatMs, java.util.concurrent.TimeUnit.MILLISECONDS).build()
    private var refusedToken: String? = null
    private var retry: Job? = null
    private var stateWait: Job? = null
    private val outbox = ArrayDeque<WingMessage>()

    // Lifecycle hooks.
    fun hold(reason: String) { synchronized(lock) { holds += reason }; ensure() }
    fun release(reason: String) { val none = synchronized(lock) { holds -= reason; holds.isEmpty() }; if (none) disconnect() }
    fun onTimerServiceStarted() = hold(TIMER_SERVICE)
    fun onTimerServiceStopped() = release(TIMER_SERVICE)
    override fun onStart(owner: LifecycleOwner) = hold(FOREGROUND)
    override fun onStop(owner: LifecycleOwner) = release(FOREGROUND)
    /** The flying pilot or their session changed: reconnect as them. */
    fun identityChanged() { disconnect(keepHolds = true); ensure() }

    // Sending.
    /** A private timer is sent so the room drops it, and leaves this copy too: the room's remove goes to everyone but the sender. */
    fun upsertTimer(timer: WingTimer) = send(WingMessage.TimerUpsert(newId(), timer.owner, clock(), timer)).also { applyTimer(timer) }
    fun removeTimer(timerId: String, from: Pilot) = send(WingMessage.TimerRemove(newId(), from.id, clock(), timerId)).also { _timers.update { it - timerId } }
    fun ping(from: Pilot, ping: WingPing) = send(WingMessage.Ping(newId(), from.id, clock(), ping))
    fun sharePlan(from: Pilot, plan: SharedPlan) = send(WingMessage.PlanShare(newId(), from.id, clock(), plan))
    /** Shares this pilot's live status (null stops sharing it). Only the latest one waits in the outbox. */
    fun publishStatus(from: Pilot, status: WingStatus?): Boolean {
        _statuses.update { if (status == null) it - from.id else it + (from.id to status.copy(pilot = from.id, name = from.displayName, at = clock())) }
        return send(WingMessage.StatusUpdate(newId(), from.id, clock(), status))
    }
    /** Answers the wingmate's ping or plan [ref] with a [WingAck] kind. Applied here at once. */
    fun ack(from: Pilot, ref: String, kind: String): Boolean = send(WingMessage.Ack(newId(), from.id, clock(), ref, kind)).also { applyAck(from.id, ref, kind, clock()) }
    fun startSession(from: Pilot, plan: SessionPlan) = send(WingMessage.SessionStart(newId(), from.id, clock(), plan))
    /** This pilot's own totals in the running session; only the latest report waits in the outbox. */
    fun reportContribution(from: Pilot, isk: Long? = null, units: Long? = null) = send(WingMessage.SessionContrib(newId(), from.id, clock(), isk, units))
    fun endSession(from: Pilot, sessionId: String? = _session.value?.id) = send(WingMessage.SessionEnd(newId(), from.id, clock(), sessionId))

    /** Sends now if connected, else queues. Returns true when it went out immediately. */
    fun send(message: WingMessage): Boolean {
        val ws = synchronized(lock) { socket.takeIf { _status.value == Status.Connected } }
        if (ws != null && ws.send(WingCodec.encode(message))) return true
        synchronized(lock) {
            // A newer status or contribution makes a queued one pointless.
            if (message is WingMessage.StatusUpdate || message is WingMessage.SessionContrib) outbox.removeAll { it::class == message::class }
            outbox.addLast(message); while (outbox.size > KEEP) outbox.removeFirst()
            _pending.value = outbox.size
        }
        ensure()
        return false
    }

    private fun ensure() {
        val who = identity() ?: return
        synchronized(lock) {
            if (holds.isEmpty() || socket != null || retry?.isActive == true) return
            if (who.second == refusedToken) { _status.value = Status.Unauthorized; return }
            open(who)
        }
    }

    private fun open(who: Pair<Pilot, String>) {
        _status.value = Status.Connecting
        val url = base.newBuilder().encodedPath("/api/wing/socket").build()
        val request = Request.Builder().url(url).header("Authorization", "Bearer ${who.second}").build()
        socketToken = who.second
        socketOpen = false; openedAt = null
        socket = socketClient.newWebSocket(request, Listener(who))
    }

    private fun disconnect(keepHolds: Boolean = false) {
        synchronized(lock) {
            retry?.cancel(); retry = null; stateWait?.cancel(); stateWait = null
            // A socket still connecting has nobody to say goodbye to; cancelling frees it at once instead of after the handshake.
            socket?.let { if (socketOpen) it.close(1000, if (keepHolds) "switching pilot" else "app closed") else it.cancel() }
            socket = null; socketOpen = false; openedAt = null
            // Wanting the room again later (the app comes back to the front) is a fresh start, not the next step of an old outage.
            if (!keepHolds) backoff.reset()
        }
        _status.value = Status.Idle
    }

    private fun scheduleRetry(reason: String) {
        synchronized(lock) {
            socket = null
            if (openedAt?.let { uptime() - it >= stableMs } == true) backoff.reset()
            openedAt = null; socketOpen = false
            if (holds.isEmpty()) { _status.value = Status.Idle; return }
            val wait = backoff.next()
            _status.value = Status.Retrying(wait, reason)
            retry = scope.launch { delay(wait); synchronized(lock) { retry = null }; ensure() }
        }
    }

    private inner class Listener(private val who: Pair<Pilot, String>) : WebSocketListener() {
        private fun current(ws: WebSocket) = synchronized(lock) { socket === ws }

        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!current(webSocket)) return
            synchronized(lock) { socketOpen = true; openedAt = uptime() }
            webSocket.send(WingCodec.encode(WingMessage.PresenceUpdate(newId(), who.first.id, clock(), true, _timers.value.values.count { it.owner == who.first.id && !it.done(clock()) })))
            // The room sends its snapshot first. Until it lands, sends stay queued, so the snapshot can't overwrite them;
            // a room that sends none still counts as connected after a moment.
            synchronized(lock) { stateWait?.cancel(); stateWait = scope.launch { delay(STATE_WAIT_MS); ready(webSocket) } }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!current(webSocket)) return
            val m = WingCodec.decode(text) ?: return
            apply(m)
            if (m is WingMessage.State) ready(webSocket) else _incoming.tryEmit(m)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (current(webSocket)) scheduleRetry("closed ($code)")
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!current(webSocket)) return
            if (response?.code == 401 || response?.code == 403) {
                synchronized(lock) { socket = null; socketOpen = false; openedAt = null; refusedToken = who.second }
                _status.value = Status.Unauthorized
                if (response.code == 401) onUnauthorized(who.second)
                return
            }
            scheduleRetry(t.message ?: "connection lost")
        }
    }

    /** The snapshot is in (or the wait ran out): mark connected and send what was queued, applying it over the snapshot. */
    private fun ready(ws: WebSocket) {
        val queued = synchronized(lock) {
            if (socket !== ws || _status.value == Status.Connected) return
            stateWait?.cancel(); stateWait = null
            _status.value = Status.Connected
            outbox.toList().also { outbox.clear(); _pending.value = 0 }
        }
        for (m in queued) { if (m is WingMessage.TimerUpsert) applyTimer(m.timer); if (m is WingMessage.TimerRemove) _timers.update { it - m.timerId }; ws.send(WingCodec.encode(m)) }
    }

    // Folding messages into state.
    internal fun apply(m: WingMessage) {
        when (m) {
            is WingMessage.State -> {
                val now = clock()
                // Timers more than a day past their end are the room's to expire; drop any it still sent.
                _timers.value = m.timers.filter { it.pausedAt != null || now - it.endsAt < DAY }.associateBy { it.id }
                _presence.value = m.presence.associateBy { it.pilot }
                _pings.value = m.items.filterIsInstance<WingMessage.Ping>().map { WingEvent(it.pilot, it.at, it.ping, it.id, it.acks) }.sortedByDescending { it.at }.take(KEEP)
                _plans.value = m.items.filterIsInstance<WingMessage.PlanShare>().map { WingEvent(it.pilot, it.at, it.plan, it.id, it.acks) }.sortedByDescending { it.at }.take(KEEP)
                _statuses.value = m.statuses.filter { it.pilot != 0L }.associateBy { it.pilot }
                _session.value = m.session?.takeIf { it.active }
                _history.value = m.sessions.sortedByDescending { it.startedAt }
            }
            is WingMessage.StatusUpdate -> _statuses.update { if (m.status == null) it - m.from else it + (m.from to m.status.copy(pilot = m.from)) }
            is WingMessage.Ack -> applyAck(m.from, m.ref, m.kind, m.at)
            is WingMessage.SessionEvent -> when (m.phase) {
                "end" -> {
                    _history.update { (listOf(m.session) + it.filter { s -> s.id != m.session.id }).sortedByDescending { s -> s.startedAt }.take(10) }
                    _session.update { if (it?.id == m.session.id) null else it }
                }
                // A late update for a session that already ended (or a start after a newer one) changes nothing.
                else -> _session.update { cur -> if (_history.value.any { it.id == m.session.id } || (cur != null && cur.id != m.session.id && cur.startedAt > m.session.startedAt)) cur else m.session }
            }
            is WingMessage.SessionStart, is WingMessage.SessionContrib, is WingMessage.SessionEnd -> {}
            is WingMessage.TimerUpsert -> applyTimer(m.timer)
            is WingMessage.TimerRemove -> _timers.update { it - m.timerId }
            is WingMessage.Ping -> _pings.update { (listOf(WingEvent(m.pilot, m.at, m.ping, m.id, m.acks)) + it.filter { e -> e.id != m.id }).take(KEEP) }
            is WingMessage.PlanShare -> _plans.update { (listOf(WingEvent(m.pilot, m.at, m.plan, m.id, m.acks)) + it.filter { e -> e.id != m.id }).take(KEEP) }
            is WingMessage.PresenceUpdate -> if (m.list != null) _presence.value = m.list.associateBy { it.pilot } else _presence.update { it + (m.from to Presence(m.from, m.online, m.timers, m.at)) }
            is WingMessage.Error -> {}
        }
    }

    /** An answer replaces an earlier one, but a "seen" never replaces "on it" or "can't" (as the room keeps them). */
    private fun applyAck(pilot: Long, ref: String, kind: String, at: Long) {
        fun <T> List<WingEvent<T>>.with() = map { e ->
            val had = e.acks[pilot]
            if (e.id != ref || (had != null && (had.kind == kind || kind == WingAck.SEEN))) e else e.copy(acks = e.acks + (pilot to WingAck(kind, at)))
        }
        _pings.update { it.with() }; _plans.update { it.with() }
    }

    private fun applyTimer(t: WingTimer) = _timers.update { if (t.shared) it + (t.id to t) else it - t.id }

    private fun newId() = UUID.randomUUID().toString()

    companion object {
        const val FOREGROUND = "foreground"
        const val TIMER_SERVICE = "timer-service"
        const val KEEP = 50
        private const val DAY = 86_400_000L
        private const val STATE_WAIT_MS = 3_000L
        const val HEARTBEAT_MS = 25_000L
        const val STABLE_MS = 10_000L
    }
}
