package com.echelon.eve.core.wing

import com.echelon.eve.core.model.Pilot
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

// The wing room's protocol (the Worker's Durable Object at GET /api/wing/socket). Every message is a JSON object
// {type, id, from, at, …}. Parsing is lenient on purpose: unknown types are skipped and unknown fields ignored, so the
// room can grow without breaking installed apps.

/**
 * A timer shared with the wing. [startedAt] and [durationMs] define its end; [pausedAt] freezes it. [owner] is the
 * pilot who started it; [shared] false keeps it on the owner's devices only. [kind] is "gas", "mining", "despawn",
 * "cyno" or "generic" (the Fly feature's catalogue); [meta] carries the kind's own data (a site name, a fit summary).
 */
@Serializable
data class WingTimer(
    val id: String,
    val kind: String = "generic",
    val label: String = "",
    val startedAt: Long,
    val durationMs: Long,
    val pausedAt: Long? = null,
    val owner: Long,
    val shared: Boolean = true,
    val meta: JsonObject = JsonObject(emptyMap()),
) {
    val endsAt: Long get() = startedAt + durationMs
    /** Time left; a paused timer keeps what it had when paused. */
    fun remaining(now: Long): Long = ((pausedAt ?: now).let { endsAt - it }).coerceAtLeast(0)
    fun done(now: Long): Boolean = pausedAt == null && now >= endsAt
}

/** A quick call to the wingmate. [system] is set only when the sender chose to share where they are. */
@Serializable
data class WingPing(val kind: String, val text: String? = null, val system: Long? = null) {
    companion object {
        const val UNDOCK = "undock"; const val HELP = "help"; const val OMW = "omw"; const val DOCKED = "docked"; const val CUSTOM = "custom"
    }
}

/** A plan sent to the wingmate: a sell, haul or explore summary and the route's system ids. */
@Serializable
data class SharedPlan(val kind: String, val title: String, val summary: String = "", val route: List<Long> = emptyList(), val data: JsonObject? = null)

/**
 * A pilot's live status, shared only when they opt in (worker/wingroom.js cleanStatus): where they are, in what, doing
 * what, and in follow mode the route they are flying. The room fills [pilot], [name] and [at].
 */
@Serializable
data class WingStatus(
    val share: Boolean = true,
    val system: Long? = null,
    val docked: Boolean? = null,
    val shipType: Long? = null,
    val ship: String? = null,
    val activity: String = IDLE,
    val destination: Long? = null,
    val route: List<Long> = emptyList(),
    val pilot: Long = 0,
    val name: String? = null,
    val at: Long = 0,
) {
    companion object {
        const val IDLE = "idle"; const val MINING = "mining"; const val EXPLORING = "exploring"; const val HAULING = "hauling"
        const val RATTING = "ratting"; const val PVP = "pvp"
        /** The activities the room accepts, in the order the app offers them. */
        val ACTIVITIES = listOf(IDLE, MINING, EXPLORING, HAULING, RATTING, PVP)
    }
}

/** The wingmate's answer to a ping or a shared plan: [SEEN], [ONIT] ("on it") or [CANT]. */
@Serializable
data class WingAck(val kind: String, val at: Long = 0) {
    companion object { const val SEEN = "seen"; const val ONIT = "onit"; const val CANT = "cant" }
}

/** One pilot's part of a session: timers started and systems visited (counted by the room), ISK and units (reported by the app). */
@Serializable
data class Contribution(val timers: Int = 0, val isk: Long = 0, val units: Long = 0, val systems: List<Long> = emptyList())

@Serializable
data class SessionTotals(val isk: Long = 0, val units: Long = 0, val timers: Int = 0, val systems: Int = 0)

/** What a pilot asks for when starting a session together. */
@Serializable
data class SessionPlan(val activity: String, val goal: Long? = null, val where: Long? = null, val title: String? = null)

/** A session the two pilots fly together (worker/wingroom.js); [endedAt] and [totals] are set once it ended. */
@Serializable
data class WingSession(
    val id: String,
    val activity: String,
    val goal: Long? = null,
    val where: Long? = null,
    val title: String? = null,
    val startedBy: Long = 0,
    val startedAt: Long = 0,
    val contrib: Map<String, Contribution> = emptyMap(),
    val endedAt: Long? = null,
    val endedBy: Long? = null,
    val totals: SessionTotals? = null,
) {
    val active: Boolean get() = endedAt == null
    fun of(pilot: Long): Contribution = contrib[pilot.toString()] ?: Contribution()
    /** The room's totals once ended; while running, the same sums over what is known. */
    val sum: SessionTotals get() = totals ?: contrib.values.let { c -> SessionTotals(c.sumOf { it.isk }, c.sumOf { it.units }, c.sumOf { it.timers }, c.flatMap { it.systems }.toSet().size) }
}

/** Whether a pilot has the app open, and how many timers they are running. */
@Serializable
data class Presence(val pilot: Long, val online: Boolean, val timers: Int = 0, val at: Long = 0)

/** One protocol message. [from] is the sending pilot's id, [at] its send time (epoch ms). */
sealed interface WingMessage {
    val id: String
    val from: Long
    val at: Long

    data class TimerUpsert(override val id: String, override val from: Long, override val at: Long, val timer: WingTimer) : WingMessage
    data class TimerRemove(override val id: String, override val from: Long, override val at: Long, val timerId: String) : WingMessage
    data class PlanShare(override val id: String, override val from: Long, override val at: Long, val plan: SharedPlan, val acks: Map<Long, WingAck> = emptyMap()) : WingMessage
    data class Ping(override val id: String, override val from: Long, override val at: Long, val ping: WingPing, val acks: Map<Long, WingAck> = emptyMap()) : WingMessage
    /** A pilot's live status; null [status] means they stopped sharing it. Outgoing, a null status sends {share:false}. */
    data class StatusUpdate(override val id: String, override val from: Long, override val at: Long, val status: WingStatus?) : WingMessage
    /** An answer ([WingAck] kind) to the ping or plan whose message id is [ref]. */
    data class Ack(override val id: String, override val from: Long, override val at: Long, val ref: String, val kind: String) : WingMessage
    /** Outgoing: start a session together. The room answers with a [SessionEvent] to both phones. */
    data class SessionStart(override val id: String, override val from: Long, override val at: Long, val plan: SessionPlan) : WingMessage
    /** Outgoing: this pilot's own totals in the running session (they replace the last report). */
    data class SessionContrib(override val id: String, override val from: Long, override val at: Long, val isk: Long? = null, val units: Long? = null) : WingMessage
    /** Outgoing: end the running session ([sessionId], when given, must be it). */
    data class SessionEnd(override val id: String, override val from: Long, override val at: Long, val sessionId: String? = null) : WingMessage
    /** Incoming: the room's session.start, session.update or session.end ([phase] start, update or end). */
    data class SessionEvent(override val id: String, override val from: Long, override val at: Long, val phase: String, val session: WingSession) : WingMessage
    /** Outgoing: this app's own presence. Incoming: the room broadcasts everyone's presence as [list] (worker/wingroom.js
     *  broadcastPresence, sent with from = 0), which replaces what the app knew. */
    data class PresenceUpdate(override val id: String, override val from: Long, override val at: Long, val online: Boolean, val timers: Int, val list: List<Presence>? = null) : WingMessage
    /** The room's snapshot, sent first on every connection: current timers and the last shared items (pings, plans). */
    data class State(override val id: String, override val from: Long, override val at: Long, val timers: List<WingTimer>, val items: List<WingMessage>, val presence: List<Presence>,
        val statuses: List<WingStatus> = emptyList(), val session: WingSession? = null, val sessions: List<WingSession> = emptyList()) : WingMessage
    data class Error(override val id: String, override val from: Long, override val at: Long, val message: String) : WingMessage

    val pilot: Pilot? get() = Pilot.of(from)
}

object WingCodec {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true; encodeDefaults = true }

    /** Encodes an outgoing message as the room expects it. */
    fun encode(m: WingMessage): String = buildJsonObject {
        put("type", typeOf(m)); put("id", m.id); put("from", m.from); put("at", m.at)
        when (m) {
            is WingMessage.TimerUpsert -> put("timer", json.encodeToJsonElement(WingTimer.serializer(), m.timer))
            is WingMessage.TimerRemove -> put("timer", buildJsonObject { put("id", m.timerId) })
            is WingMessage.PlanShare -> put("plan", json.encodeToJsonElement(SharedPlan.serializer(), m.plan))
            is WingMessage.Ping -> json.encodeToJsonElement(WingPing.serializer(), m.ping).let { it as JsonObject }.forEach { (k, v) -> put(k, v) }
            is WingMessage.PresenceUpdate -> { put("online", m.online); put("timers", m.timers) }
            is WingMessage.StatusUpdate -> put("status", m.status?.let { json.encodeToJsonElement(WingStatus.serializer(), it.copy(pilot = 0, name = null, at = 0)).let { o -> JsonObject((o as JsonObject).filterKeys { k -> k !in setOf("pilot", "name", "at") }) } } ?: buildJsonObject { put("share", false) })
            is WingMessage.Ack -> { put("ref", m.ref); put("kind", m.kind) }
            is WingMessage.SessionStart -> put("session", json.encodeToJsonElement(SessionPlan.serializer(), m.plan))
            is WingMessage.SessionContrib -> put("contrib", buildJsonObject { m.isk?.let { put("isk", it) }; m.units?.let { put("units", it) } })
            is WingMessage.SessionEnd -> m.sessionId?.let { put("session", buildJsonObject { put("id", it) }) }
            is WingMessage.State, is WingMessage.Error, is WingMessage.SessionEvent -> {}
        }
    }.toString()

    fun typeOf(m: WingMessage) = when (m) {
        is WingMessage.TimerUpsert -> "timer.upsert"; is WingMessage.TimerRemove -> "timer.remove"; is WingMessage.PlanShare -> "plan.share"
        is WingMessage.Ping -> "ping"; is WingMessage.PresenceUpdate -> "presence"; is WingMessage.State -> "state"; is WingMessage.Error -> "error"
        is WingMessage.StatusUpdate -> "status"; is WingMessage.Ack -> "ack"; is WingMessage.SessionStart -> "session.start"
        is WingMessage.SessionContrib -> "session.contrib"; is WingMessage.SessionEnd -> "session.end"; is WingMessage.SessionEvent -> "session.${m.phase}"
    }

    /** Decodes one incoming frame; null for anything this app doesn't understand (an unknown type, a bad shape). */
    fun decode(text: String): WingMessage? = runCatching { decode(json.parseToJsonElement(text) as JsonObject) }.getOrNull()

    private fun <T> JsonObject.obj(key: String, s: KSerializer<T>): T = json.decodeFromJsonElement(s, getValue(key))
    private fun JsonObject.str(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull
    private fun JsonObject.long(key: String) = str(key)?.toDoubleOrNull()?.toLong()

    /** The answers kept on a ping or plan: {"<pilot id>": {kind, at}}. */
    private fun acks(o: JsonObject): Map<Long, WingAck> = (o["acks"] as? JsonObject)?.mapNotNull { (k, v) ->
        val pilot = k.toLongOrNull() ?: return@mapNotNull null
        runCatching { pilot to json.decodeFromJsonElement(WingAck.serializer(), v) }.getOrNull()
    }?.toMap() ?: emptyMap()
    private fun session(o: JsonObject?): WingSession? = o?.let { runCatching { json.decodeFromJsonElement(WingSession.serializer(), it) }.getOrNull() }

    fun decode(o: JsonObject): WingMessage? {
        val id = o.str("id") ?: ""; val from = o.long("from") ?: 0; val at = o.long("at") ?: 0
        return when (o.str("type")) {
            "timer.upsert" -> WingMessage.TimerUpsert(id, from, at, o.obj("timer", WingTimer.serializer()))
            "timer.remove" -> WingMessage.TimerRemove(id, from, at, (o["timer"] as? JsonObject)?.str("id") ?: o.str("timerId") ?: return null)
            "plan.share" -> WingMessage.PlanShare(id, from, at, o.obj("plan", SharedPlan.serializer()), acks(o))
            "ping" -> WingMessage.Ping(id, from, at, json.decodeFromJsonElement(WingPing.serializer(), o), acks(o))
            "status" -> WingMessage.StatusUpdate(id, from, at, (o["status"] as? JsonObject)?.let { json.decodeFromJsonElement(WingStatus.serializer(), it) }?.takeIf { it.share })
            "ack" -> WingMessage.Ack(id, from, at, o.str("ref") ?: return null, o.str("kind") ?: return null)
            "session.start", "session.update", "session.end" -> WingMessage.SessionEvent(id, from, at, o.str("type")!!.removePrefix("session."), session(o["session"] as? JsonObject) ?: return null)
            "presence" -> WingMessage.PresenceUpdate(id, from, at, (o["online"] as? JsonPrimitive)?.contentOrNull?.toBooleanStrictOrNull() ?: true, o.long("timers")?.toInt() ?: 0,
                (o["presence"] as? JsonArray)?.mapNotNull { runCatching { json.decodeFromJsonElement(Presence.serializer(), it) }.getOrNull() })
            "state" -> WingMessage.State(id, from, at,
                (o["timers"] as? JsonArray)?.mapNotNull { runCatching { json.decodeFromJsonElement(WingTimer.serializer(), it) }.getOrNull() } ?: emptyList(),
                (o["items"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let { item -> runCatching { decode(item) }.getOrNull() } } ?: emptyList(),
                (o["presence"] as? JsonArray)?.mapNotNull { runCatching { json.decodeFromJsonElement(Presence.serializer(), it) }.getOrNull() } ?: emptyList(),
                (o["statuses"] as? JsonArray)?.mapNotNull { runCatching { json.decodeFromJsonElement(WingStatus.serializer(), it) }.getOrNull() } ?: emptyList(),
                session(o["session"] as? JsonObject),
                (o["sessions"] as? JsonArray)?.mapNotNull { session(it as? JsonObject) } ?: emptyList())
            "error" -> WingMessage.Error(id, from, at, o.str("message") ?: o.str("error") ?: o.str("code") ?: "The wing room refused a message.")
            else -> null
        }
    }
}
