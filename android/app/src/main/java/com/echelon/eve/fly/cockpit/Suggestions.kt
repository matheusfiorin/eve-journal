package com.echelon.eve.fly.cockpit

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.fly.timers.GasSleepers
import com.echelon.eve.fly.timers.TimerKind
import com.echelon.eve.fly.timers.running
import com.echelon.eve.fly.timers.systemId

// Suggestions: one tap starts the timer a moment calls for, and nothing starts on its own. SuggestionsTest pins the rules.

/** A timer the cockpit offers because of what just happened. [at] is when it was noticed (epoch ms). */
sealed interface Suggestion {
    val at: Long

    /** The pilot has just entered a wormhole system: the Sleeper gas timer, from the first ship's landing. */
    data class Wormhole(val systemId: Long, val name: String?, override val at: Long) : Suggestion

    /** The pilot has just undocked in a mining hull: the mining cycle timer. */
    data class Mining(val ship: String?, override val at: Long) : Suggestion
}

/** Ship type ids of the mining hulls: the Venture, Prospect and Endurance, the barges and exhumers, and the industrial command ships. */
val MINING_HULLS: Set<Long> = setOf(
    32880, 33697, 37135,          // Venture, Prospect, Endurance
    17480, 17478, 17476,          // Procurer, Retriever, Covetor
    22546, 22548, 22544,          // Skiff, Mackinaw, Hulk
    42244, 28606, 28352,          // Porpoise, Orca, Rorqual
)

/** "Class 3 · J123456", or "J-space · J123456" when the universe data has no class (the gate map holds known space only). */
fun wormholeLine(name: String?, wormholeClass: Int? = null): String = listOfNotNull(wormholeClass?.let { "Class $it" } ?: "J-space", name).joinToString(" · ")

/**
 * What the suggestion is after the read that took the pilot from [prev] to [next]: a new one when they entered a
 * wormhole system or undocked in a mining hull, none once they dock or leave the wormhole, else [current] unchanged.
 * Nothing is suggested for a first read (the app opening in a wormhole is not an entry).
 */
fun nextSuggestion(current: Suggestion?, prev: Whereabouts?, next: Whereabouts, now: Long, miningHull: (Long?) -> Boolean = { it in MINING_HULLS }): Suggestion? {
    if (prev == null) return current
    val enteredWormhole = GasSleepers.isJSpace(next.systemId) && next.systemId != prev.systemId
    val left = GasSleepers.isJSpace(prev.systemId) && !GasSleepers.isJSpace(next.systemId)
    return when {
        enteredWormhole -> Suggestion.Wormhole(next.systemId!!, next.systemName, now)
        prev.dockedAt == null && next.dockedAt != null -> null
        left && current is Suggestion.Wormhole -> null
        prev.dockedAt != null && next.dockedAt == null && miningHull(next.shipType) -> Suggestion.Mining(next.shipName?.takeIf { it.isNotBlank() } ?: next.shipTypeName, now)
        else -> current
    }
}

/** True when the suggestion still makes sense: not when that timer is already running for [pilot] (in that system, for the wormhole one). */
fun Suggestion.worthShowing(timers: Collection<WingTimer>, pilot: Pilot, now: Long): Boolean = when (this) {
    is Suggestion.Wormhole -> timers.none { it.owner == pilot.id && it.kind == TimerKind.Sleeper.key && it.running(now) && it.systemId == systemId }
    is Suggestion.Mining -> timers.none { it.owner == pilot.id && it.kind == TimerKind.Mining.key && it.running(now) }
}
