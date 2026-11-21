package com.echelon.eve.fly.timers

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer

// The timer catalogue and the pure rules for running a timer: start, pause, resume, restart, and how a list of them
// reads (yours and your wingmate's, the next to end first). The screen, the store and the service all use these, and
// TimersTest pins them.

/**
 * What a timer is for. [defaultMs] is only where the length starts: every kind's length is set when it is started,
 * because EVE's numbers depend on the site, ship and skills. [presets] are the quick lengths offered for the kind.
 */
enum class TimerKind(val key: String, val title: String, val hint: String, val defaultMs: Long, val presets: List<Long>) {
    Gas("gas", "Gas site", "Until the site's clouds are gone or rats arrive", 20 * MIN, listOf(5 * MIN, 10 * MIN, 15 * MIN, 20 * MIN, 30 * MIN)),
    Mining("mining", "Mining cycle", "One cycle of your mining modules", 3 * MIN, listOf(60 * SEC, 90 * SEC, 2 * MIN, 3 * MIN, 5 * MIN)),
    Despawn("despawn", "Despawn", "A wreck, container or anomaly about to go", 2 * HOUR, listOf(15 * MIN, 30 * MIN, HOUR, 2 * HOUR)),
    Cyno("cyno", "Cyno", "A cynosural field's cycle", 5 * MIN, listOf(5 * MIN, 10 * MIN)),
    Generic("generic", "Timer", "Anything else", 10 * MIN, listOf(MIN, 5 * MIN, 15 * MIN, 30 * MIN, HOUR));

    companion object {
        fun of(key: String): TimerKind = entries.firstOrNull { it.key == key } ?: Generic
    }
}

const val SEC = 1_000L
const val MIN = 60 * SEC
const val HOUR = 60 * MIN
/** The longest timer the app starts (a day): anything longer is a calendar entry, not a countdown. */
const val MAX_TIMER = 24 * HOUR

/** A new timer owned by [owner], running from [now]. A blank [label] takes the kind's title. */
fun newTimer(id: String, kind: TimerKind, durationMs: Long, owner: Pilot, now: Long, label: String = "", shared: Boolean = true) = WingTimer(
    id = id, kind = kind.key, label = label.trim().ifEmpty { kind.title }, startedAt = now,
    durationMs = durationMs.coerceIn(SEC, MAX_TIMER), owner = owner.id, shared = shared,
)

/** Freezes the time left. Pausing a paused or finished timer changes nothing. */
fun WingTimer.paused(now: Long): WingTimer = if (pausedAt != null || done(now)) this else copy(pausedAt = now)

/** Carries on from where it was paused: the start moves forward by the time spent paused. */
fun WingTimer.resumed(now: Long): WingTimer = pausedAt?.let { copy(startedAt = startedAt + (now - it).coerceAtLeast(0), pausedAt = null) } ?: this

/** Starts again from the full length (the next mining cycle, a fresh despawn). */
fun WingTimer.restarted(now: Long): WingTimer = copy(startedAt = now, pausedAt = null)

/** Running means counting down now: not paused and not yet at zero. */
fun WingTimer.running(now: Long): Boolean = pausedAt == null && now < endsAt

/** How far along, 0 to 1. */
fun WingTimer.progress(now: Long): Float = if (durationMs <= 0) 1f else (1f - remaining(now).toFloat() / durationMs).coerceIn(0f, 1f)

/**
 * The timers as the screen lists them: [active] (running or paused) with the soonest end first and paused ones after,
 * then [finished] newest first. [mine] says which belong to the flying pilot; the others are the wingmate's.
 * Unshared timers of the wingmate never reach this phone; the room only sends them to their owner.
 */
data class TimerBoard(val active: List<WingTimer>, val finished: List<WingTimer>, val next: WingTimer?) {
    val runningCount: Int get() = active.count { it.pausedAt == null }

    companion object {
        fun of(timers: Collection<WingTimer>, now: Long): TimerBoard {
            val (done, active) = timers.partition { it.done(now) }
            val sorted = active.sortedWith(compareBy<WingTimer>({ it.pausedAt != null }, { it.remaining(now) }, { it.label }))
            return TimerBoard(sorted, done.sortedByDescending { it.endsAt }, sorted.firstOrNull { it.pausedAt == null })
        }
    }
}

/** Only the owner may change a timer; the wingmate sees it and can add their own. */
fun WingTimer.ownedBy(pilot: Pilot?): Boolean = pilot != null && owner == pilot.id
