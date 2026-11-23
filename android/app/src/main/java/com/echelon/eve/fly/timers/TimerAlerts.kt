package com.echelon.eve.fly.timers

import com.echelon.eve.core.wing.WingTimer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

// What a timer says before and at its end: the warning points (kept in the timer's meta, so the wingmate's phone warns
// too), the words of each alert, and which notification channel each goes to. Pure: the service, the exact alarms and
// the notifications all read these, and TimerAlertsTest pins them.

/**
 * How long Sleepers take to arrive at a wormhole gas site, and what the timers do about it.
 *
 * Research (read 23 Nov 2026; CCP publishes no figure, so this is community knowledge):
 *  - EVE University wiki, "Gas cloud harvesting" (page modified 8 Nov 2026): wormhole fullerite sites "are undefended
 *    when first warped to, but will spawn several Sleeper NPCs after a certain amount of time has passed (usually about
 *    15-20 minutes)". The page gives one figure for all reservoirs, not one per site.
 *  - EVE Online forums, "Do Sleeper Rats at WH Gas Sites despawn?" (Jun 2018): "they spawn 15-20 minutes after the
 *    first person warps into the site" (Trevor_Dalech) and "15-20 min from the time you initiate warp" (Sinjin_Pava).
 *    Another thread of the same era says exactly 15 minutes after the first warp-in.
 *  - EVE Online forums, "How to Jedi Huff in Wormholes" (Dec 2021): the timer starts when the first pilot warps in
 *    (anyone's, so a wingmate who got there first has started it for you), and the Instrumental site brings a second
 *    wave about 5 minutes after the first.
 *  - Known space has none of this: no Sleepers arrive there (the wiki's Ordinary Perimeter Reservoir note is the only
 *    exception it lists, and that is guarded from the start rather than on a timer).
 *
 * So the default is the early end of the range, 15 minutes: being two minutes early costs two minutes of gas, being
 * late costs the ship. The warning at T-2 min leaves time to finish the cycle and warp out. 17 and 20 minutes are offered
 * for when you know a site ran longer; the length and the warnings can be edited per timer.
 */
object GasSleepers {
    const val DEFAULT_MS = 15 * MIN
    val PRESETS = listOf(15 * MIN, 17 * MIN, 20 * MIN)
    /** The warning before the end, by default. */
    const val WARN_MS = 2 * MIN
    const val SITE_WH = "wh"
    const val SITE_KS = "ks"
    /** Wormhole systems are J-space: ids 31000000 to 31999999 (the Worker's wormhole range). */
    fun isJSpace(systemId: Long?): Boolean = systemId != null && systemId in 31_000_000L..31_999_999L
}

/** The warning points of [this] timer in ms before its end, longest first: its own (meta) or its kind's default. */
val WingTimer.warnings: List<Long> get() {
    val own = (meta[TimerMeta.WARN] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.longOrNull }
    return sanitizeWarnings(own ?: defaultWarnings(TimerKind.of(kind)), durationMs)
}

/** What a timer of [kind] warns at unless told otherwise: a Sleeper or known-space gas timer two minutes ahead; the rest not at all. */
fun defaultWarnings(kind: TimerKind): List<Long> = when (kind) { TimerKind.Sleeper, TimerKind.Gas -> listOf(GasSleepers.WARN_MS); else -> emptyList() }

/** Warnings kept: positive, inside the timer (a warning at or past the start is just noise), distinct, longest first, at most four. */
fun sanitizeWarnings(points: List<Long>, durationMs: Long): List<Long> = points.filter { it in SEC until durationMs }.distinct().sortedDescending().take(4)

/** The timer with its warning points set (an empty list: no warnings; they are stored even then, so a default isn't brought back). */
fun WingTimer.withWarnings(points: List<Long>): WingTimer =
    copy(meta = JsonObject(meta + (TimerMeta.WARN to JsonArray(sanitizeWarnings(points, durationMs).map { JsonPrimitive(it) }))))

/** True for a timer that starts its next cycle by itself when one ends (the mining cycle). */
val WingTimer.repeats: Boolean get() = (meta[TimerMeta.REPEAT] as? JsonPrimitive)?.booleanOrNull == true

fun WingTimer.withRepeat(on: Boolean): WingTimer = copy(meta = JsonObject(if (on) meta + (TimerMeta.REPEAT to JsonPrimitive(true)) else meta - TimerMeta.REPEAT))

/** A mining timer's cycle, and how long a hold takes to fill from empty, as worked out when it started; null when not known. */
val WingTimer.cycleMs: Long? get() = (meta[TimerMeta.CYCLE] as? JsonPrimitive)?.longOrNull?.takeIf { it > 0 }
val WingTimer.holdFullMs: Long? get() = (meta[TimerMeta.HOLD] as? JsonPrimitive)?.longOrNull?.takeIf { it > 0 }

/** "Gas site" site kind in the meta: [GasSleepers.SITE_WH] or [GasSleepers.SITE_KS], else null. */
val WingTimer.site: String? get() = (meta[TimerMeta.SITE] as? JsonPrimitive)?.contentOrNull?.takeIf { it == GasSleepers.SITE_WH || it == GasSleepers.SITE_KS }

fun WingTimer.withSite(site: String?): WingTimer = copy(meta = JsonObject(if (site == null) meta - TimerMeta.SITE else meta + (TimerMeta.SITE to JsonPrimitive(site))))

// ---- the alerts ----

enum class AlertKind { Warn, End }

/** One notification a timer will raise: [at] is when (epoch ms), [remainingMs] how long the timer had left then. */
data class TimerAlert(val timerId: String, val kind: AlertKind, val at: Long, val remainingMs: Long, val title: String, val text: String, val channel: String, val endsAt: Long, val owner: Long) {
    /** Stable per timer, kind, time and end, so rescheduling the same alert is the same alarm and a restart is a new one. */
    val key: String get() = "$timerId|${kind.name}|$remainingMs|$endsAt"
}

/** The notification channels: each alert has its own, so each can sound and vibrate its own way (channels fix the pattern when made). */
object TimerChannels {
    const val ONGOING = "timers"
    /** Two short pulses: a warning before the end. */
    const val WARN = "timers_warn"
    /** Three long pulses and a short one: the Sleepers are due, warp out. */
    const val WARP = "timers_warp"
    /** One firm pulse: a timer reached zero. */
    const val DONE = "timers_done"
    /** One tick: a mining cycle ended and the next began. */
    const val CYCLE = "timers_cycle"

    val WARN_PATTERN = longArrayOf(0, 120, 120, 120)
    val WARP_PATTERN = longArrayOf(0, 500, 150, 500, 150, 500, 150, 120)
    val DONE_PATTERN = longArrayOf(0, 400)
    val CYCLE_PATTERN = longArrayOf(0, 60)

    fun patternOf(channel: String): LongArray = when (channel) { WARN -> WARN_PATTERN; WARP -> WARP_PATTERN; CYCLE -> CYCLE_PATTERN; else -> DONE_PATTERN }
}

/** The alert at the end of [t]'s time left [left]: "Sleepers in 2 min: get ready to warp out" or "Gas site: 2 min left". */
fun warnText(t: WingTimer, left: Long): String {
    val kind = TimerKind.of(t.kind)
    return if (kind == TimerKind.Sleeper) "Sleepers in ${spoken(left)}. Finish the cycle and get ready to warp out." else "${t.label}: ${spoken(left)} left."
}

/** What the end of [t] says: "Sleepers due: warp out" for wormhole gas, "Cycle done" for a repeating mining timer, else "<label> is done". */
fun endText(t: WingTimer): Pair<String, String> = when {
    TimerKind.of(t.kind) == TimerKind.Sleeper -> "Sleepers due: warp out" to "${t.label} ran ${clockText(t.durationMs)}. Warp out now."
    t.repeats -> "${t.label}: cycle done" to "The next cycle has started."
    else -> "${t.label} is done" to "Ran ${clockText(t.durationMs)}"
}

/** The channel the end of [t] goes to: the loud warp-out one for Sleepers, a tick for a repeating cycle, the done one otherwise. */
fun endChannel(t: WingTimer): String = when {
    TimerKind.of(t.kind) == TimerKind.Sleeper -> TimerChannels.WARP
    t.repeats -> TimerChannels.CYCLE
    else -> TimerChannels.DONE
}

/** Every alert [t] raises over its run (warnings and the end), earliest first; a paused timer has none. */
fun allAlerts(t: WingTimer, systemName: String? = null): List<TimerAlert> {
    if (t.pausedAt != null) return emptyList()
    val where = systemName?.let { " in $it" } ?: ""
    val warns = t.warnings.map { w ->
        TimerAlert(t.id, AlertKind.Warn, t.endsAt - w, w, if (TimerKind.of(t.kind) == TimerKind.Sleeper) "Sleepers soon$where" else "${t.label}$where: ${spoken(w)} left", warnText(t, w), TimerChannels.WARN, t.endsAt, t.owner)
    }
    val (title, text) = endText(t)
    return (warns + TimerAlert(t.id, AlertKind.End, t.endsAt, 0, title, if (systemName == null) text else "$text ($systemName)", endChannel(t), t.endsAt, t.owner))
        .sortedBy { it.at }
}

/** The alerts of [t] still to come after [now]. A warning already past is dropped (the end still comes). */
fun alertsOf(t: WingTimer, now: Long, systemName: String? = null): List<TimerAlert> = allAlerts(t, systemName).filter { it.at > now }

/** The alerts of [t] that came due in the last [window] ms (the service rings these; older ones are not announced late). */
fun dueAlerts(t: WingTimer, now: Long, window: Long, systemName: String? = null): List<TimerAlert> = allAlerts(t, systemName).filter { it.at <= now && now - it.at < window }

/** "2 min", "30 s", "1 min 30 s" for a lead time. */
fun spoken(ms: Long): String {
    val s = ms / 1000
    return when {
        s < 60 -> "$s s"
        s % 60 == 0L -> "${s / 60} min"
        else -> "${s / 60} min ${s % 60} s"
    }
}

private fun clockText(ms: Long): String { val s = ms / 1000; return "%d:%02d".format(s / 60, s % 60) }
