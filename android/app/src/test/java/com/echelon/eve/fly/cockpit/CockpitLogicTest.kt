package com.echelon.eve.fly.cockpit

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.live.LiveUi
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.fly.timers.MIN
import com.echelon.eve.fly.timers.TimerKind
import com.echelon.eve.ui.format.SecBand
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CockpitLogicTest {
    private val now = 1_795_000_000_000L
    private fun at(system: Long, name: String, sec: Double, docked: String? = null, ship: Long = 32880, online: Boolean? = true) =
        Whereabouts(Pilot.Fiofka, name, sec, "The Forge", docked, ship, "Venture", "Gas runner", online = online, systemId = system)

    @Test fun paceStaysUnderTheLiveLimit() {
        assertEquals(60_000L, LivePace.delay(at(1, "Perimeter", .95), failed = false, rateLimited = false, failures = 0))
        assertEquals(90_000L, LivePace.delay(at(1, "Perimeter", .95, docked = "Station"), false, false, 0))
        assertEquals(180_000L, LivePace.delay(at(1, "Perimeter", .95, online = false), false, false, 0))
        // Failures double up to ten minutes; a 429 starts from two minutes.
        assertEquals(listOf(90_000L, 180_000L, 360_000L, 600_000L, 600_000L), (1..5).map { LivePace.delay(null, true, false, it) })
        assertEquals(listOf(120_000L, 240_000L, 480_000L, 600_000L), (1..4).map { LivePace.delay(null, true, true, it) })
        // Never more than 30 reads a minute, even with manual refreshes at the minimum gap.
        assertTrue(60_000L / LivePace.MIN_GAP <= 30)
    }

    @Test fun aJumpIntoLowSecWarns() {
        val e = changes(at(30000144, "Perimeter", .95), at(30002813, "Tama", .3))
        assertEquals(listOf(CockpitEvent.Jumped("Perimeter", "Tama", .3, SecBand.Low)), e)
        assertEquals("Low-sec: Tama", e[0].headline())
        assertEquals(20_000L, e[0].shownFor())
    }

    @Test fun aJumpBackToSafetyDoesNotWarn() {
        val e = changes(at(30002813, "Tama", .3), at(30000144, "Perimeter", .95)).single() as CockpitEvent.Jumped
        assertNull(e.warning)
        assertEquals("Jumped to Perimeter", e.headline())
        val n = changes(at(30002813, "Tama", .3), at(30004000, "EC-P8R", -.4)).single() as CockpitEvent.Jumped
        assertEquals(SecBand.Null, n.warning)
    }

    @Test fun dockShipAndLoginChangesAreReported() {
        assertEquals(listOf(CockpitEvent.Docked("Jita IV - Moon 4")), changes(at(1, "Jita", .95), at(1, "Jita", .95, docked = "Jita IV - Moon 4")))
        assertEquals(listOf(CockpitEvent.Undocked), changes(at(1, "Jita", .95, docked = "x"), at(1, "Jita", .95)))
        assertEquals(listOf(CockpitEvent.ShipChanged("Gas runner")), changes(at(1, "Jita", .95, ship = 1), at(1, "Jita", .95, ship = 2)))
        assertEquals(listOf(CockpitEvent.LoggedOff), changes(at(1, "Jita", .95), at(1, "Jita", .95, online = false)))
        assertEquals(emptyList<CockpitEvent>(), changes(at(1, "Jita", .95), at(1, "Jita", .95)))
        // A jump and an undock in one read: the jump comes first.
        assertTrue(changes(at(1, "Jita", .95, docked = "x"), at(2, "Perimeter", .95)).first() is CockpitEvent.Jumped)
    }

    @Test fun quickTimerReusesTheLastCycle() {
        val mine = WingTimer("m1", "mining", "Mining cycle", now - 10 * MIN, 150_000, owner = Pilot.Fiofka.id)
        val older = WingTimer("m0", "mining", "Mining cycle", now - 30 * MIN, 180_000, owner = Pilot.Fiofka.id)
        val theirs = WingTimer("m2", "mining", "Mining cycle", now - MIN, 60_000, owner = Pilot.Decxus.id)
        val q = QuickTimer.of(listOf(older, mine, theirs), Pilot.Fiofka, TimerKind.Mining)
        assertEquals("m1", q.reuse?.id); assertEquals(150_000L, q.durationMs)
        val fresh = QuickTimer.of(listOf(theirs), Pilot.Fiofka, TimerKind.Gas)
        assertNull(fresh.reuse); assertEquals(TimerKind.Gas.defaultMs, fresh.durationMs)
    }

    @Test fun widgetAndTileText() {
        val running = WingTimer("g", "gas", "Ghost site", now - MIN, 20 * MIN, owner = Pilot.Decxus.id)
        val mining = WingTimer("m", "mining", "Mining cycle", now - 4 * MIN, 3 * MIN, owner = Pilot.Fiofka.id)
        val w = widgetText(listOf(running, mining), Pilot.Fiofka, at(1, "Perimeter", .95), now)
        assertEquals("Ghost site (Decxus)", w.label); assertEquals(running.endsAt, w.endsAt)
        assertEquals("Perimeter 1.0 · in space · Gas runner", w.where)
        assertEquals("Mining cycle\n3:00", w.cycle)
        assertEquals("Open Echelon and choose who is flying", widgetText(emptyList(), null, null, now).where)
        assertEquals(TileText(false, "Tap: restart 3:00"), tileText(listOf(mining), Pilot.Fiofka, now))
        assertEquals(TileText(true, "2:00 left"), tileText(listOf(mining.copy(startedAt = now - MIN)), Pilot.Fiofka, now))
        assertEquals(TileText(false, "Tap: start 3:00"), tileText(emptyList(), Pilot.Fiofka, now))
    }

    @Test fun readLineSaysWhenTheNextReadIs() {
        val ui = CockpitUi(Pilot.Fiofka, me = at(1, "Perimeter", .95), readAt = now - 20_000, nextAt = now + 40_000)
        assertTrue(readLine(ui, now), readLine(ui, now).startsWith("Online · read "))
        assertTrue(readLine(ui, now).endsWith("next in 0:40"))
        assertEquals("Not read yet", readLine(CockpitUi(Pilot.Fiofka), now))
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class CockpitLiveTest {
    private fun place(system: Long, name: String, sec: Double) = Whereabouts(Pilot.Fiofka, name, sec, systemId = system, online = true)

    @Test fun pollsOnScheduleBacksOffAndReportsJumps() = runTest {
        val answers = ArrayDeque(listOf(
            LiveUi(me = place(1, "Perimeter", .95)),
            LiveUi(problem = "busy", rateLimited = true),
            LiveUi(me = place(2, "Tama", .3)),
        ))
        val reads = mutableListOf<Long>()
        val live = CockpitLive({ reads += currentTime; answers.removeFirstOrNull() ?: LiveUi(me = place(2, "Tama", .3)) }, clock = { currentTime })
        val events2 = mutableListOf<CockpitEvent>()
        val collector = launch { live.events.collect { events2 += it } }
        val loop = launch { live.run(Pilot.Fiofka) }
        runCurrent()
        assertEquals(listOf(0L), reads)
        advanceTimeBy(60_001)
        assertEquals(listOf(0L, 60_000L), reads)
        // The failed read keeps the place and waits two minutes (a 429).
        assertEquals("Perimeter", live.state.value.ui.me?.systemName)
        assertEquals("busy", live.state.value.ui.problem)
        advanceTimeBy(120_000)
        assertEquals(listOf(0L, 60_000L, 180_000L), reads)
        assertEquals(listOf(CockpitEvent.Jumped("Perimeter", "Tama", .3, SecBand.Low)), events2)
        loop.cancel(); collector.cancel()
    }

    @Test fun manualRefreshRespectsTheGapAndAPilotSwitchIsNotAJump() = runTest {
        var system = 1L
        val reads = mutableListOf<Long>()
        val live = CockpitLive({ reads += currentTime; LiveUi(me = place(system, "S$system", .9)) }, clock = { currentTime })
        val events = mutableListOf<CockpitEvent>()
        val collector = launch { live.events.collect { events += it } }
        assertTrue(live.readIfDue(Pilot.Fiofka, force = false))
        assertFalse(live.readIfDue(Pilot.Fiofka, force = true))
        advanceTimeBy(10_000)
        assertTrue(live.readIfDue(Pilot.Fiofka, force = true))
        assertFalse(live.readIfDue(Pilot.Fiofka, force = false))
        system = 2
        assertTrue(live.readIfDue(Pilot.Decxus, force = false))
        runCurrent()
        assertEquals(Pilot.Decxus, live.state.value.pilot)
        assertEquals(emptyList<CockpitEvent>(), events)
        assertEquals(3, reads.size)
        collector.cancel()
    }
}
