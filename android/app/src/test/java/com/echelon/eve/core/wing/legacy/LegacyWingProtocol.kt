package com.echelon.eve.core.wing.legacy

// Frozen copy of the wing protocol as merged in PR #4 (4b9d0f1): what an un-updated phone still runs. Verbatim except this package, so
// WingCompatTest can decode the current room frames the way that app does. Do not edit it to follow the protocol.

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
    data class PlanShare(override val id: String, override val from: Long, override val at: Long, val plan: SharedPlan) : WingMessage
    data class Ping(override val id: String, override val from: Long, override val at: Long, val ping: WingPing) : WingMessage
    /** Outgoing: this app's own presence. Incoming: the room broadcasts everyone's presence as [list] (worker/wingroom.js
     *  broadcastPresence, sent with from = 0), which replaces what the app knew. */
    data class PresenceUpdate(override val id: String, override val from: Long, override val at: Long, val online: Boolean, val timers: Int, val list: List<Presence>? = null) : WingMessage
    /** The room's snapshot, sent first on every connection: current timers and the last shared items (pings, plans). */
    data class State(override val id: String, override val from: Long, override val at: Long, val timers: List<WingTimer>, val items: List<WingMessage>, val presence: List<Presence>) : WingMessage
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
            is WingMessage.State, is WingMessage.Error -> {}
        }
    }.toString()

    fun typeOf(m: WingMessage) = when (m) {
        is WingMessage.TimerUpsert -> "timer.upsert"; is WingMessage.TimerRemove -> "timer.remove"; is WingMessage.PlanShare -> "plan.share"
        is WingMessage.Ping -> "ping"; is WingMessage.PresenceUpdate -> "presence"; is WingMessage.State -> "state"; is WingMessage.Error -> "error"
    }

    /** Decodes one incoming frame; null for anything this app doesn't understand (an unknown type, a bad shape). */
    fun decode(text: String): WingMessage? = runCatching { decode(json.parseToJsonElement(text) as JsonObject) }.getOrNull()

    private fun <T> JsonObject.obj(key: String, s: KSerializer<T>): T = json.decodeFromJsonElement(s, getValue(key))
    private fun JsonObject.str(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull
    private fun JsonObject.long(key: String) = str(key)?.toDoubleOrNull()?.toLong()

    fun decode(o: JsonObject): WingMessage? {
        val id = o.str("id") ?: ""; val from = o.long("from") ?: 0; val at = o.long("at") ?: 0
        return when (o.str("type")) {
            "timer.upsert" -> WingMessage.TimerUpsert(id, from, at, o.obj("timer", WingTimer.serializer()))
            "timer.remove" -> WingMessage.TimerRemove(id, from, at, (o["timer"] as? JsonObject)?.str("id") ?: o.str("timerId") ?: return null)
            "plan.share" -> WingMessage.PlanShare(id, from, at, o.obj("plan", SharedPlan.serializer()))
            "ping" -> WingMessage.Ping(id, from, at, json.decodeFromJsonElement(WingPing.serializer(), o))
            "presence" -> WingMessage.PresenceUpdate(id, from, at, (o["online"] as? JsonPrimitive)?.contentOrNull?.toBooleanStrictOrNull() ?: true, o.long("timers")?.toInt() ?: 0,
                (o["presence"] as? JsonArray)?.mapNotNull { runCatching { json.decodeFromJsonElement(Presence.serializer(), it) }.getOrNull() })
            "state" -> WingMessage.State(id, from, at,
                (o["timers"] as? JsonArray)?.mapNotNull { runCatching { json.decodeFromJsonElement(WingTimer.serializer(), it) }.getOrNull() } ?: emptyList(),
                (o["items"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let { item -> runCatching { decode(item) }.getOrNull() } } ?: emptyList(),
                (o["presence"] as? JsonArray)?.mapNotNull { runCatching { json.decodeFromJsonElement(Presence.serializer(), it) }.getOrNull() } ?: emptyList())
            "error" -> WingMessage.Error(id, from, at, o.str("message") ?: o.str("error") ?: o.str("code") ?: "The wing room refused a message.")
            else -> null
        }
    }
}
