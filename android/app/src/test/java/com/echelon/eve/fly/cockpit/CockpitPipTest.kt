package com.echelon.eve.fly.cockpit

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.timers.MAX_TIMER
import com.echelon.eve.fly.timers.MIN
import com.echelon.eve.fly.timers.TimerService
import com.echelon.eve.fly.timers.extended
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** The picture-in-picture window's params and buttons: what it follows, when it auto-enters, which actions it offers. */
class CockpitPipTest {
    private val now = 1_795_000_000_000L
    private fun timer(id: String, left: Long, owner: Pilot = Pilot.Fiofka, paused: Boolean = false, length: Long = 20 * MIN) =
        WingTimer(id, "gas", id, now - (length - left), length, if (paused) now else null, owner.id)

    @Test fun nothingRunningMeansNoAutoEnterAndNoButtons() {
        val s = pipSpec(emptyList(), Pilot.Fiofka, now)
        assertFalse(s.autoEnter)
        assertNull(s.timerId)
        assertTrue(s.actions.isEmpty())
        assertEquals(16 to 9, s.aspect)
    }

    @Test fun ownRunningTimerGetsPauseAndAMinute() {
        val s = pipSpec(listOf(timer("a", 5 * MIN)), Pilot.Fiofka, now)
        assertTrue(s.autoEnter)
        assertEquals("a", s.timerId)
        assertEquals(listOf(PipAction.Pause, PipAction.AddMinute), s.actions)
    }

    @Test fun ownPausedTimerKeepsResumeInReachButDoesNotAutoEnter() {
        val s = pipSpec(listOf(timer("p", 5 * MIN, paused = true)), Pilot.Fiofka, now)
        assertFalse(s.autoEnter)
        assertEquals("p", s.timerId)
        assertEquals(listOf(PipAction.Resume, PipAction.AddMinute), s.actions)
    }

    @Test fun followsTheSoonestOwnRunningTimerOverTheWingmatesAndOverPausedOnes() {
        val timers = listOf(timer("mate", 1 * MIN, Pilot.Decxus), timer("late", 9 * MIN), timer("soon", 3 * MIN), timer("held", 2 * MIN, paused = true))
        assertEquals("soon", pipTarget(timers, Pilot.Fiofka, now)?.id)
        assertEquals("soon", pipSpec(timers, Pilot.Fiofka, now).timerId)
    }

    @Test fun theWingmatesTimerIsShownWithoutButtons() {
        val s = pipSpec(listOf(timer("mate", 4 * MIN, Pilot.Decxus)), Pilot.Fiofka, now)
        assertTrue(s.autoEnter)
        assertEquals("mate", s.timerId)
        assertTrue(s.actions.isEmpty())
    }

    @Test fun noPilotGetsNoButtons() {
        assertTrue(pipSpec(listOf(timer("a", 4 * MIN)), null, now).actions.isEmpty())
    }

    @Test fun specsCompareByValueSoTheActivityOnlyPushesChanges() {
        val a = pipSpec(listOf(timer("a", 5 * MIN)), Pilot.Fiofka, now)
        val b = pipSpec(listOf(timer("a", 4 * MIN)), Pilot.Fiofka, now + MIN)
        assertEquals(a, b)
    }

    @Test fun eachButtonHasItsOwnServiceActionAndRequestCode() {
        assertEquals(listOf(TimerService.ACTION_PAUSE, TimerService.ACTION_RESUME, TimerService.ACTION_EXTEND), PipAction.entries.map { it.action })
        assertEquals(PipAction.entries.size, PipAction.entries.map { it.request }.toSet().size)
        PipAction.entries.forEach { assertTrue(it.title.isNotBlank() && it.description.isNotBlank()) }
        assertEquals("+1 min", PipAction.AddMinute.title)
    }

    @Test fun aMinuteMoreExtendsRunningAndPausedTimersButNotFinishedOnes() {
        val run = timer("a", 30_000)
        assertEquals(30_000 + MIN, run.extended(MIN, now).remaining(now))
        val held = timer("p", 30_000, paused = true)
        assertEquals(30_000 + MIN, held.extended(MIN, now).remaining(now))
        val done = timer("d", 0)
        assertSame(done, done.extended(MIN, now))
        val long = WingTimer("l", "gas", "l", now, MAX_TIMER, owner = Pilot.Fiofka.id)
        assertEquals(MAX_TIMER, long.extended(MIN, now).durationMs)
    }
}
