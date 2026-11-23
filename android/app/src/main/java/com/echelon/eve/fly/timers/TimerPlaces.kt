package com.echelon.eve.fly.timers

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SolarSystem
import com.echelon.eve.core.wing.WingTimer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlin.math.sqrt

// Where a timer is: the solar system it belongs to, kept in the timer's free `meta` object so the wing room
// (worker/wingroom.js keeps meta as it is) and older apps (they ignore it) need no change. Pure rules for reading and
// writing it, for grouping timers by system, for the jump distances and name suggestions, and for the horizon strip's
// time axis. TimersTest pins them.

/** The meta keys: [SYSTEM] is the solar system id; [SYSTEM_NAME] its name, so a phone without the gate map still reads it. */
object TimerMeta {
    const val SYSTEM = "system"
    const val SYSTEM_NAME = "systemName"
    /** Warning points: milliseconds before the end ("warnMs": [120000]). In meta so the wingmate's app warns too. */
    const val WARN = "warnMs"
    /** Where a gas timer is: "wh" (Sleepers) or "ks" (known space). */
    const val SITE = "site"
    /** True: a mining timer starts its next cycle by itself when one ends. */
    const val REPEAT = "repeat"
    /** The mining timer's cycle length and the time to fill the hold from empty, in ms, and what they were worked out from. */
    const val CYCLE = "cycleMs"
    const val HOLD = "holdFullMs"
    const val FIT = "fit"
    /** The Fullerite a gas timer harvests: its type id (a [Fullerite]). In meta so the wingmate's phone sees which gas it is. */
    const val GAS = "gas"
}

/** A solar system a timer is in. [name] may be blank when only the id is known. */
data class TimerSystem(val id: Long, val name: String = "") {
    companion object {
        fun of(s: SolarSystem) = TimerSystem(s.id, s.name)
    }
}

/** The timer's system id, or null for a timer started before timers had one (or started nowhere in particular). */
val WingTimer.systemId: Long? get() = (meta[TimerMeta.SYSTEM] as? JsonPrimitive)?.let { it.longOrNull ?: it.contentOrNull?.toDoubleOrNull()?.toLong() }?.takeIf { it > 0 }

/** The system's name as the starter saw it; null when not stored. */
val WingTimer.systemName: String? get() = (meta[TimerMeta.SYSTEM_NAME] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() && systemId != null }

val WingTimer.system: TimerSystem? get() = systemId?.let { TimerSystem(it, systemName.orEmpty()) }

/** The timer placed in [system] (null takes it out of any system). Other meta keys stay as they are. */
fun WingTimer.placed(system: TimerSystem?): WingTimer = copy(meta = meta.withSystem(system))

/** [this] meta with the system keys set to [system], or removed when null. */
fun JsonObject.withSystem(system: TimerSystem?): JsonObject {
    val rest = this - TimerMeta.SYSTEM - TimerMeta.SYSTEM_NAME
    if (system == null || system.id <= 0) return JsonObject(rest)
    val add = buildMap {
        put(TimerMeta.SYSTEM, JsonPrimitive(system.id))
        system.name.trim().takeIf { it.isNotEmpty() }?.let { put(TimerMeta.SYSTEM_NAME, JsonPrimitive(it)) }
    }
    return JsonObject(rest + add)
}

/** The system's display name: the gate map's, then the stored one. */
fun WingTimer.systemNameIn(systems: Map<Long, SolarSystem>): String? = systemId?.let { systems[it]?.name } ?: systemName

/**
 * How a timer reads in a sentence: "Gas site in Tama". A label that already names the system ("Wreck in Tama") stays as
 * it is, and a timer with no system is just its label.
 */
fun WingTimer.title(systems: Map<Long, SolarSystem> = emptyMap()): String {
    val where = systemNameIn(systems) ?: return label
    return if (label.contains(where, ignoreCase = true)) label else "$label in $where"
}

/** "Gas site in Tama" before a timer exists: what the creation form's headline says. */
fun draftTitle(kind: TimerKind, label: String, system: TimerSystem?): String {
    val what = label.trim().ifEmpty { kind.title }
    val where = system?.name?.takeIf { it.isNotBlank() } ?: return what
    return if (what.contains(where, ignoreCase = true)) what else "$what in $where"
}

/** What the creation form starts: everything [TimerStore.start] needs. */
data class TimerDraft(
    val kind: TimerKind, val durationMs: Long, val label: String = "", val shared: Boolean = true, val system: TimerSystem? = null,
    /** Warning points (ms before the end); null takes the kind's default, an empty list means none. Kept in the timer's meta. */
    val warnings: List<Long>? = null,
    /** A mining timer starts its next cycle by itself. */
    val repeat: Boolean = false,
    /** From the fit: the cycle, the time to fill the hold, and a short description of what they came from. */
    val cycleMs: Long? = null, val holdFullMs: Long? = null, val fit: String? = null,
    /** The gas of a Sleeper or gas timer; null takes the last one used. */
    val gas: Fullerite? = null,
)

/** The meta a draft adds to its timer: the site, warning points, repeat and the mining figures. */
fun TimerDraft.applyTo(t: WingTimer): WingTimer {
    var out = t
    if (kind == TimerKind.Sleeper) out = out.withSite(GasSleepers.SITE_WH) else if (kind == TimerKind.Gas) out = out.withSite(GasSleepers.SITE_KS)
    if (warnings != null) out = out.withWarnings(warnings)
    if (repeat) out = out.withRepeat(true)
    if (gas != null && kind.isGas) out = out.withGas(gas)
    val extra = buildMap {
        cycleMs?.let { put(TimerMeta.CYCLE, JsonPrimitive(it)) }
        holdFullMs?.let { put(TimerMeta.HOLD, JsonPrimitive(it)) }
        fit?.takeIf { it.isNotBlank() }?.let { put(TimerMeta.FIT, JsonPrimitive(it.take(120))) }
    }
    return if (extra.isEmpty()) out else out.copy(meta = JsonObject(out.meta + extra))
}

// ---- the gate map ----

/**
 * Jumps from [from] to every system within [maxJumps] gates (a breadth-first walk of the gate links). [from] itself is 0.
 * Empty when [from] is unknown.
 */
fun jumpsFrom(from: Long?, systems: Map<Long, SolarSystem>, maxJumps: Int = 60): Map<Long, Int> {
    if (from == null || from !in systems) return emptyMap()
    val out = HashMap<Long, Int>(); out[from] = 0
    var ring = listOf(from)
    var depth = 0
    while (ring.isNotEmpty() && depth < maxJumps) {
        depth++
        val next = ArrayList<Long>()
        for (id in ring) for (n in systems[id]?.links.orEmpty()) if (n !in out && n in systems) { out[n] = depth; next += n }
        ring = next
    }
    return out
}

/** The shortest gate path from [from] to [to], both ends included; empty when either is unknown or unreachable. */
fun gatePath(from: Long?, to: Long?, systems: Map<Long, SolarSystem>, maxJumps: Int = 60): List<Long> {
    if (from == null || to == null || from !in systems || to !in systems) return emptyList()
    if (from == to) return listOf(from)
    val prev = HashMap<Long, Long>(); prev[from] = from
    var ring = listOf(from); var depth = 0
    while (ring.isNotEmpty() && depth < maxJumps) {
        depth++
        val next = ArrayList<Long>()
        for (id in ring) for (n in systems[id]?.links.orEmpty()) if (n !in prev && n in systems) {
            prev[n] = id; next += n
            if (n == to) return generateSequence(to) { p -> prev[p]?.takeIf { p != from } }.toList().reversed()
        }
        ring = next
    }
    return emptyList()
}

/** "here", "1 jump", "12 jumps", or null when not known. */
fun jumpsText(jumps: Int?): String? = when (jumps) { null -> null; 0 -> "here"; 1 -> "1 jump"; else -> "$jumps jumps" }

/**
 * Systems whose names match [query] for the form's suggestions: an exact name first, then names starting with it, then
 * names containing it; within each, the nearer ones (by [near], jumps from you) and then by name. Blank query: none.
 */
fun suggestSystems(query: String, systems: Map<Long, SolarSystem>, near: Map<Long, Int> = emptyMap(), limit: Int = 6): List<SolarSystem> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return emptyList()
    fun rank(s: SolarSystem): Int { val n = s.name.lowercase(); return when { n == q -> 0; n.startsWith(q) -> 1; n.contains(q) -> 2; else -> 3 } }
    return systems.values.asSequence().filter { rank(it) < 3 }
        .sortedWith(compareBy<SolarSystem>({ rank(it) }, { near[it.id] ?: Int.MAX_VALUE }, { it.name.lowercase() }))
        .take(limit).toList()
}

/** The system named exactly [name] (any case), or null. */
fun systemNamed(name: String, systems: Map<Long, SolarSystem>): SolarSystem? = name.trim().takeIf { it.isNotEmpty() }?.let { n -> systems.values.firstOrNull { it.name.equals(n, ignoreCase = true) } }

// ---- the system board ----

/**
 * One card of the system board: the timers in [systemId] (null: the timers that have no system) with the soonest end
 * first, then paused ones, then finished ones newest first. [here] is the flying pilot's system, [wingmateHere] the
 * wingmate's; [jumps] is the distance from the flying pilot when known.
 */
data class SystemGroup(
    val systemId: Long?,
    val name: String?,
    val timers: List<WingTimer>,
    val here: Boolean = false,
    val wingmateHere: Boolean = false,
    val jumps: Int? = null,
) {
    /** The soonest end still counting down in this system. */
    fun nextEnd(now: Long): Long? = timers.filter { it.running(now) }.minOfOrNull { it.endsAt }
    val key: String get() = systemId?.toString() ?: "none"
}

object SystemBoard {
    /**
     * Groups [timers] by system. Your current system comes first ("here", even with no timers, so you can start one
     * there), then the systems with something counting down by soonest end, then those with only paused timers, then
     * those with only finished ones (newest end first). The wingmate's system shows up as a card only when it has timers.
     */
    fun of(timers: Collection<WingTimer>, now: Long, here: Long? = null, wingmateAt: Long? = null, systems: Map<Long, SolarSystem> = emptyMap(), jumps: Map<Long, Int> = emptyMap()): List<SystemGroup> {
        val bySystem = timers.groupBy { it.systemId }
        val ids = bySystem.keys + listOfNotNull(here)
        val groups = ids.map { id ->
            val list = bySystem[id].orEmpty()
            val board = TimerBoard.of(list, now)
            SystemGroup(
                id, id?.let { systems[it]?.name ?: list.firstNotNullOfOrNull { t -> t.systemName } },
                board.active + board.finished, here = id != null && id == here, wingmateHere = id != null && id == wingmateAt,
                jumps = id?.let { jumps[it] },
            )
        }
        return groups.sortedWith(compareBy<SystemGroup>(
            { if (it.here) 0 else 1 },
            { g -> when { g.nextEnd(now) != null -> 0; g.timers.any { it.pausedAt != null } -> 1; else -> 2 } },
            { it.nextEnd(now) ?: Long.MAX_VALUE },
            { g -> -(g.timers.maxOfOrNull { it.endsAt } ?: 0L) },
            { it.systemId == null },
            { it.name.orEmpty() },
        ))
    }
}

// ---- the horizon strip ----

/** The horizon's window: the shortest of these that holds the furthest running end. */
val HORIZONS = listOf(5 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 6 * HOUR, 12 * HOUR, MAX_TIMER)

/** How far ahead the horizon looks for [timers] at [now]: enough for the last running end. */
fun horizonSpan(timers: Collection<WingTimer>, now: Long): Long {
    val far = timers.filter { it.running(now) }.maxOfOrNull { it.endsAt - now } ?: return HORIZONS[1]
    return HORIZONS.firstOrNull { it >= far } ?: HORIZONS.last()
}

/**
 * Where [remaining] sits on the horizon, 0 (now) to 1 (the span's end). The axis is a square root, so a cycle ending in
 * a minute and a despawn in two hours both get room; anything past the span sits at the edge.
 */
fun horizonX(remaining: Long, span: Long): Float = if (span <= 0) 1f else sqrt((remaining.coerceIn(0, span)).toFloat() / span)

/** The horizon's tick marks (time from now) inside [span]: a handful of round figures. */
fun horizonTicks(span: Long): List<Long> = listOf(MIN, 5 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 6 * HOUR, 12 * HOUR).filter { it < span }.takeLast(4) + span

/**
 * How pressing a timer is, 0 to 1, for sizing its mark: 1 at the end, falling with the time left (a minute left is
 * still 0.8, an hour about 0.25). Paused and finished timers are calm (0).
 */
fun urgency(t: WingTimer, now: Long): Float {
    if (!t.running(now)) return 0f
    val minutes = t.remaining(now) / MIN.toFloat()
    return (1f / (1f + minutes / 4f)).let { it.coerceIn(0f, 1f) }
}

/** The pilot whose colour a timer wears: its owner. */
fun WingTimer.ownerPilot(): Pilot? = Pilot.of(owner)
