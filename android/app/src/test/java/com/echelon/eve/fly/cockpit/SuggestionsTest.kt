package com.echelon.eve.fly.cockpit

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.fly.live.LiveUi
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.fly.timers.GasSleepers
import com.echelon.eve.fly.timers.MIN
import com.echelon.eve.fly.timers.TimerKind
import com.echelon.eve.fly.timers.newTimer
import com.echelon.eve.fly.timers.placed
import com.echelon.eve.fly.timers.TimerSystem
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The wormhole-entry and mining-undock suggestions, the gas tile's words and the one-tap gas rules. */
@OptIn(ExperimentalCoroutinesApi::class)
class SuggestionsTest {
    private val now = 1_795_000_000_000L
    private fun at(system: Long, name: String, docked: String? = null, ship: Long = 32880, shipName: String = "Gas Hog") =
        Whereabouts(Pilot.Fiofka, systemName = name, sec = -1.0, dockedAt = docked, shipType = ship, shipTypeName = "Venture", shipName = shipName, systemId = system)

    @Test fun enteringAWormholeSystemOffersTheSleeperTimer() {
        val s = nextSuggestion(null, at(30000142, "Jita"), at(31001234, "J123456"), now)
        assertEquals(Suggestion.Wormhole(31001234, "J123456", now), s)
        assertEquals("J-space · J123456", wormholeLine("J123456"))
        assertEquals("Class 3 · J123456", wormholeLine("J123456", 3))
    }

    @Test fun theFirstReadInAWormholeIsNotAnEntryAndASecondReadKeepsTheCard() {
        assertNull(nextSuggestion(null, null, at(31001234, "J123456"), now))
        val s = Suggestion.Wormhole(31001234, "J123456", now)
        assertEquals(s, nextSuggestion(s, at(31001234, "J123456"), at(31001234, "J123456"), now + MIN))
    }

    @Test fun jumpingBetweenWormholeSystemsOffersANewOneAndLeavingOrDockingClearsIt() {
        val s = Suggestion.Wormhole(31001234, "J123456", now)
        assertEquals(31001235L, (nextSuggestion(s, at(31001234, "J123456"), at(31001235, "J123457"), now + MIN) as Suggestion.Wormhole).systemId)
        assertNull(nextSuggestion(s, at(31001234, "J123456"), at(30000142, "Jita"), now))
        assertNull(nextSuggestion(s, at(31001234, "J123456"), at(31001234, "J123456", docked = "a structure"), now))
    }

    @Test fun undockingInAMiningHullOffersTheMiningTimerButNotInOtherShips() {
        val s = nextSuggestion(null, at(30000142, "Jita", docked = "Jita IV"), at(30000142, "Jita"), now)
        assertEquals(Suggestion.Mining("Gas Hog", now), s)
        assertNull(nextSuggestion(null, at(30000142, "Jita", docked = "Jita IV", ship = 587), at(30000142, "Jita", ship = 587), now))
        // Nothing changed: no new suggestion, and a dock clears it.
        assertNull(nextSuggestion(s, at(30000142, "Jita"), at(30000142, "Jita", docked = "Jita IV"), now))
    }

    @Test fun aSuggestionIsNotShownWhenThatTimerIsAlreadyRunning() {
        val me = Pilot.Fiofka
        val wh = Suggestion.Wormhole(31001234, "J123456", now)
        val running = newTimer("a", TimerKind.Sleeper, 15 * MIN, me, now, system = TimerSystem(31001234, "J123456"))
        assertFalse(wh.worthShowing(listOf(running), me, now + MIN))
        assertTrue(wh.worthShowing(listOf(running), Pilot.Decxus, now + MIN))
        assertTrue(wh.worthShowing(listOf(running.placed(TimerSystem(31009999, "J999999"))), me, now + MIN))
        assertTrue(wh.worthShowing(listOf(running), me, now + 16 * MIN))
        val mining = Suggestion.Mining("Gas Hog", now)
        assertTrue(mining.worthShowing(listOf(running), me, now))
        assertFalse(mining.worthShowing(listOf(newTimer("m", TimerKind.Mining, MIN, me, now)), me, now))
    }

    @Test fun theLiveFeedOffersThenDismisses() = runTest {
        val reads = ArrayDeque(listOf(LiveUi(me = at(30000142, "Jita")), LiveUi(me = at(31001234, "J123456"))))
        var t = now
        val live = CockpitLive({ reads.removeFirst() }, clock = { t })
        live.readIfDue(Pilot.Fiofka, force = false)
        assertNull(live.suggestion.value)
        t += 200_000
        live.readIfDue(Pilot.Fiofka, force = false)
        assertEquals(31001234L, (live.suggestion.value as Suggestion.Wormhole).systemId)
        live.dismissSuggestion()
        assertNull(live.suggestion.value)
    }

    // ---- the gas tile and the one-tap gas rules ----

    @Test fun gasTimersAreWormholeOrKnownSpaceByWhereYouAre() {
        assertEquals(TimerKind.Sleeper, CockpitControl.gasKindFor(31001234))
        assertEquals(TimerKind.Sleeper, CockpitControl.gasKindFor(null))
        assertEquals(TimerKind.Gas, CockpitControl.gasKindFor(30000142))
        assertTrue(GasSleepers.isJSpace(31001234))
    }

    @Test fun theGasTileSaysWhatATapDoes() {
        val me = Pilot.Fiofka
        assertEquals(TileText(false, "Tap: start Sleeper timer"), gasTileText(emptyList(), me, 31001234, now))
        assertEquals(TileText(false, "Tap: start gas timer"), gasTileText(emptyList(), me, 30000142, now))
        val sleeper = newTimer("s", TimerKind.Sleeper, 15 * MIN, me, now)
        assertEquals(TileText(true, "Sleepers in 10:00 · tap to stop"), gasTileText(listOf(sleeper), me, null, now + 5 * MIN))
        val gas = newTimer("g", TimerKind.Gas, 20 * MIN, me, now)
        assertEquals(TileText(true, "15:00 left · tap to stop"), gasTileText(listOf(gas), me, 30000142, now + 5 * MIN))
        // Finished or the wingmate's: the tile is idle again.
        assertEquals(TileText(false, "Tap: start Sleeper timer"), gasTileText(listOf(sleeper), me, null, now + 16 * MIN))
        assertEquals(TileText(false, "Tap: start Sleeper timer"), gasTileText(listOf(newTimer("d", TimerKind.Sleeper, 15 * MIN, Pilot.Decxus, now)), me, null, now))
    }
}
