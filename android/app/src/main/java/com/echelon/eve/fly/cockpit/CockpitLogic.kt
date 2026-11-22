package com.echelon.eve.fly.cockpit

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.fly.timers.TimerKind
import com.echelon.eve.ui.format.SecBand
import com.echelon.eve.ui.format.secBand

// The cockpit's pure rules: how often to ask GET /api/live, what changed between two reads (a jump, a dock, a new
// ship), and which timer a one-tap button starts. CockpitLogicTest pins them.

/**
 * How long to wait before the next GET /api/live. The Worker allows 30 reads a minute per session, and ESI caches
 * location for a few seconds anyway, so once a minute in space is plenty; docked or logged off moves less.
 * A failure backs off, doubling up to ten minutes; a 429 starts from a longer wait.
 */
object LivePace {
    const val UNDOCKED = 60_000L
    const val DOCKED = 90_000L
    const val OFFLINE = 180_000L
    const val ERROR = 90_000L
    const val LIMITED = 120_000L
    const val MAX = 600_000L
    /** A manual refresh is honoured at most this often. */
    const val MIN_GAP = 10_000L

    fun delay(me: Whereabouts?, failed: Boolean, rateLimited: Boolean, failures: Int): Long = when {
        rateLimited -> backoff(LIMITED, failures)
        failed -> backoff(ERROR, failures)
        me?.online == false -> OFFLINE
        me?.dockedAt != null -> DOCKED
        else -> UNDOCKED
    }

    private fun backoff(base: Long, failures: Int): Long = (base shl (failures - 1).coerceIn(0, 8)).coerceAtMost(MAX)
}

/** Something that happened between two reads of where the flying pilot is. */
sealed interface CockpitEvent {
    /** A new system. [warning] is set when it is a worse security band than the last one (into low-sec or null-sec). */
    data class Jumped(val from: String?, val to: String, val sec: Double?, val warning: SecBand?) : CockpitEvent
    data class Docked(val at: String) : CockpitEvent
    data object Undocked : CockpitEvent
    data class ShipChanged(val name: String) : CockpitEvent
    data object LoggedOff : CockpitEvent
    data object LoggedOn : CockpitEvent
}

/** What changed from [prev] to [next], most important first (a jump before an undock). */
fun changes(prev: Whereabouts, next: Whereabouts): List<CockpitEvent> {
    val out = mutableListOf<CockpitEvent>()
    val moved = when {
        prev.systemId != null && next.systemId != null -> prev.systemId != next.systemId
        else -> prev.systemName != null && next.systemName != null && prev.systemName != next.systemName
    }
    if (moved && next.systemName != null) {
        val worse = next.sec?.let { n -> prev.sec?.let { p -> secBand(n).takeIf { it.ordinal > secBand(p).ordinal } } }
        out += CockpitEvent.Jumped(prev.systemName, next.systemName, next.sec, worse)
    }
    if (prev.dockedAt == null && next.dockedAt != null) out += CockpitEvent.Docked(next.dockedAt)
    if (prev.dockedAt != null && next.dockedAt == null) out += CockpitEvent.Undocked
    val shipMoved = (prev.shipType != null && next.shipType != null && prev.shipType != next.shipType) ||
        (!prev.shipName.isNullOrBlank() && !next.shipName.isNullOrBlank() && prev.shipName != next.shipName)
    if (shipMoved) out += CockpitEvent.ShipChanged(next.shipName?.takeIf { it.isNotBlank() } ?: next.shipTypeName ?: "a new ship")
    if (prev.online == true && next.online == false) out += CockpitEvent.LoggedOff
    if (prev.online == false && next.online == true) out += CockpitEvent.LoggedOn
    return out
}

/** The one line the cockpit's banner shows for [e]. */
fun CockpitEvent.headline(): String = when (this) {
    is CockpitEvent.Jumped -> when (warning) {
        SecBand.Null -> "Null-sec: $to"
        SecBand.Low -> "Low-sec: $to"
        else -> "Jumped to $to"
    }
    is CockpitEvent.Docked -> "Docked at $at"
    CockpitEvent.Undocked -> "Undocked"
    is CockpitEvent.ShipChanged -> "Now flying $name"
    CockpitEvent.LoggedOff -> "Logged off"
    CockpitEvent.LoggedOn -> "Logged in"
}

/** How long the banner stays: a security warning longer than a plain jump. */
fun CockpitEvent.shownFor(): Long = if (this is CockpitEvent.Jumped && warning != null) 20_000L else 8_000L

/**
 * A one-tap timer: the flying pilot's last timer of [kind] when there is one (tapping restarts it, the next mining
 * cycle at the length they used), else a new one at the kind's default length.
 */
data class QuickTimer(val kind: TimerKind, val durationMs: Long, val reuse: WingTimer?) {
    companion object {
        fun of(timers: Collection<WingTimer>, pilot: Pilot, kind: TimerKind): QuickTimer {
            val last = timers.filter { it.owner == pilot.id && it.kind == kind.key }.maxByOrNull { it.startedAt }
            return QuickTimer(kind, last?.durationMs ?: kind.defaultMs, last)
        }
    }
}

/** The cockpit's quick timers, in button order. */
val QUICK_KINDS = listOf(TimerKind.Mining, TimerKind.Gas)
