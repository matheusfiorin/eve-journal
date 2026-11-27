package com.echelon.eve.fly.timers

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class TimersTest {
    private val t0 = 1_795_000_000_000L
    private fun timer(id: String, start: Long = t0, length: Long = 10 * MIN, owner: Pilot = Pilot.Fiofka, paused: Long? = null, shared: Boolean = true) =
        WingTimer(id, "gas", id, start, length, paused, owner.id, shared)

    @Test fun newTimerTakesTheKindsTitleAndClampsItsLength() {
        val t = newTimer("a", TimerKind.Cyno, 0, Pilot.Decxus, t0, label = "  ")
        assertEquals("Cyno", t.label)
        assertEquals(SEC, t.durationMs)
        assertEquals(Pilot.Decxus.id, t.owner)
        assertEquals(MAX_TIMER, newTimer("b", TimerKind.Despawn, 3 * MAX_TIMER, Pilot.Fiofka, t0).durationMs)
        assertEquals("Ghost site", newTimer("c", TimerKind.Gas, MIN, Pilot.Fiofka, t0, label = " Ghost site ").label)
    }

    @Test fun pauseFreezesAndResumeCarriesOn() {
        val t = timer("a")
        val p = t.paused(t0 + 4 * MIN)
        assertEquals(6 * MIN, p.remaining(t0 + 30 * MIN))
        assertFalse(p.running(t0 + 30 * MIN))
        assertFalse(p.done(t0 + 30 * MIN))
        // Resumed 20 minutes later, it still has the six minutes it had.
        val r = p.resumed(t0 + 24 * MIN)
        assertNull(r.pausedAt)
        assertEquals(6 * MIN, r.remaining(t0 + 24 * MIN))
        assertEquals(t0 + 30 * MIN, r.endsAt)
        // Pausing twice keeps the first pause; resuming a running timer changes nothing.
        assertEquals(p, p.paused(t0 + 5 * MIN))
        assertEquals(t, t.resumed(t0))
        // A finished timer can't be paused.
        assertEquals(t, t.paused(t0 + 11 * MIN))
    }

    @Test fun restartRunsTheFullLengthAgain() {
        val r = timer("a").paused(t0 + MIN).restarted(t0 + 50 * MIN)
        assertEquals(t0 + 60 * MIN, r.endsAt)
        assertNull(r.pausedAt)
        assertEquals(0.5f, r.progress(t0 + 55 * MIN), 0.001f)
    }

    @Test fun theBoardPutsTheSoonestFirstThenPausedThenFinished() {
        val now = t0 + 5 * MIN
        val board = TimerBoard.of(listOf(
            timer("long", length = HOUR), timer("soon", length = 6 * MIN), timer("paused", length = 7 * MIN, paused = t0 + MIN),
            timer("done1", length = 2 * MIN), timer("done2", length = 4 * MIN, owner = Pilot.Decxus),
        ), now)
        assertEquals(listOf("soon", "long", "paused"), board.active.map { it.id })
        assertEquals(listOf("done2", "done1"), board.finished.map { it.id })
        assertEquals("soon", board.next?.id)
        assertEquals(2, board.runningCount)
        assertNull(TimerBoard.of(listOf(timer("p", paused = t0)), now).next)
    }

    @Test fun formForms() {
        assertEquals("90s", short(90 * SEC)); assertEquals("5m", short(5 * MIN)); assertEquals("2h", short(2 * HOUR)); assertEquals("1h 30m", short(90 * MIN))
        assertEquals(10 * SEC, stepFor(MIN)); assertEquals(MIN, stepFor(5 * MIN)); assertEquals(5 * MIN, stepFor(HOUR))
    }

    // The store, against a fake wing room.
    private class FakeRoom : TimerStore.Room {
        val state = MutableStateFlow<Map<String, WingTimer>>(emptyMap())
        override val timers: StateFlow<Map<String, WingTimer>> = state
        val upserts = mutableListOf<WingTimer>(); val removes = mutableListOf<String>()
        override fun upsert(timer: WingTimer) { upserts += timer }
        override fun remove(id: String, owner: Pilot) { removes += id }
    }

    @get:Rule val tmp = TemporaryFolder()

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun store(scope: TestScope, room: FakeRoom, file: File, now: () -> Long = { t0 }, active: () -> Unit = {}, locate: (Pilot) -> TimerSystem? = { null }): TimerStore {
        val d = UnconfinedTestDispatcher(scope.testScheduler)
        return TimerStore(kotlinx.coroutines.CoroutineScope(scope.backgroundScope.coroutineContext + d), file, room, now, active, io = d, locate = locate)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun newTimersStartWhereTheOwnerIsUnlessToldOtherwise() = runTest {
        val room = FakeRoom(); val file = File(tmp.root, "t.json")
        val tama = TimerSystem(30002813, "Tama"); val jita = TimerSystem(30000142, "Jita")
        val s = store(this, room, file, locate = { if (it == Pilot.Fiofka) tama else null })
        // By default: the owner's synced location, and the same in the room.
        val a = s.start(Pilot.Fiofka, TimerKind.Gas, 20 * MIN)
        assertEquals(tama, a.system)
        assertEquals(30002813L, room.upserts.last().systemId)
        // A live read the screen made wins over the synced one; null in the store's eyes falls back again.
        s.noteLocation(Pilot.Fiofka, jita)
        assertEquals(jita, s.start(Pilot.Fiofka, TimerKind.Cyno, 5 * MIN).system)
        s.noteLocation(Pilot.Fiofka, null)
        assertEquals(tama, s.here(Pilot.Fiofka))
        // An explicit system, or explicitly none; a pilot nowhere known gets none.
        assertEquals(jita, s.start(Pilot.Fiofka, TimerDraft(TimerKind.Despawn, HOUR, system = jita)).system)
        assertNull(s.start(Pilot.Fiofka, TimerKind.Generic, MIN, system = null).system)
        assertNull(s.start(Pilot.Decxus, TimerKind.Generic, MIN).system)
        // Moving keeps the timer and its other meta; it reaches the room; it survives a restart.
        s.place(a.id, jita)
        assertEquals(jita, s.timers.value.getValue(a.id).system)
        assertEquals(a.id, room.upserts.last().id)
        advanceUntilIdle()
        assertEquals(jita, store(this, FakeRoom(), file).timers.value.getValue(a.id).system)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun replacingAndRemovingSavedTimersSurvivesRestart() = runTest {
        val room = FakeRoom(); val file = File(tmp.root, "replace.json")
        val s = store(this, room, file)
        val original = s.start(Pilot.Fiofka, TimerKind.Generic, HOUR, shared = false)
        advanceUntilIdle()
        assertEquals(original, store(this, FakeRoom(), file).timers.value.getValue(original.id))
        val jita = TimerSystem(30000142, "Jita")
        s.place(original.id, jita)
        advanceUntilIdle()
        assertEquals(jita, store(this, FakeRoom(), file).timers.value.getValue(original.id).system)
        s.remove(original.id)
        advanceUntilIdle()
        assertTrue(store(this, FakeRoom(), file).timers.value.isEmpty())
        assertTrue(room.upserts.isEmpty()); assertTrue(room.removes.isEmpty())
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun gasTimersCarryTheGasThePilotPickedElseTheLastOneUsed() = runTest {
        val room = FakeRoom(); val d = UnconfinedTestDispatcher(testScheduler)
        val choice = GasChoice.Memory()
        val s = TimerStore(kotlinx.coroutines.CoroutineScope(backgroundScope.coroutineContext + d), File(tmp.root, "g.json"), room, { t0 }, {}, io = d, lastGas = choice)
        // Nothing picked yet: the default; and it reaches the room in the timer's meta.
        val a = s.start(Pilot.Fiofka, TimerKind.Sleeper, 15 * MIN)
        assertEquals(GasChoice.DEFAULT, a.gas); assertEquals(GasChoice.DEFAULT.typeId, room.upserts.last().gas!!.typeId)
        // A picked gas wins and becomes the next default; a plain gas timer takes it too.
        val b = s.start(Pilot.Fiofka, TimerDraft(TimerKind.Sleeper, 15 * MIN, gas = Fullerite.C540))
        assertEquals(Fullerite.C540, b.gas); assertEquals(Fullerite.C540, choice.get())
        assertEquals(Fullerite.C540, s.start(Pilot.Fiofka, TimerKind.Gas, 20 * MIN).gas)
        // Changing the gas of a running timer reaches the room and the default; other kinds carry none.
        s.setGas(a.id, Fullerite.C50)
        assertEquals(Fullerite.C50, s.timers.value.getValue(a.id).gas); assertEquals(Fullerite.C50, room.upserts.last().gas); assertEquals(Fullerite.C50, s.lastGasChoice())
        assertNull(s.start(Pilot.Fiofka, TimerKind.Mining, MIN).gas); assertNull(s.start(Pilot.Fiofka, TimerDraft(TimerKind.Cyno, MIN, gas = Fullerite.C28)).gas)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun sharedTimersGoToTheRoomPrivateOnesStayHere() = runTest {
        val room = FakeRoom(); var active = 0
        val s = store(this, room, File(tmp.root, "t.json"), active = { active++ })
        val shared = s.start(Pilot.Fiofka, TimerKind.Gas, 15 * MIN, "Ghost site")
        val private = s.start(Pilot.Fiofka, TimerKind.Mining, 3 * MIN, shared = false)
        assertEquals(listOf(shared.id), room.upserts.map { it.id })
        assertEquals(setOf(shared.id, private.id), s.timers.value.keys)
        assertTrue(active > 0)
        // Taking a shared timer back sends it once more as private (the room drops it and tells the wingmate).
        s.setShared(shared.id, false)
        assertEquals(false, room.upserts.last().shared)
        val sent = room.upserts.size
        s.pause(private.id)
        assertEquals(sent, room.upserts.size)
        s.remove(private.id); s.remove(shared.id)
        assertTrue(room.removes.isEmpty())
        assertTrue(s.timers.value.isEmpty())
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun mergesTheWingmatesTimersAndKeepsOwnOnesOnDisk() = runTest {
        val room = FakeRoom()
        val file = File(tmp.root, "t.json")
        val s = store(this, room, file)
        val mine = s.start(Pilot.Fiofka, TimerKind.Cyno, 5 * MIN, shared = false)
        room.state.value = mapOf("w" to timer("w", owner = Pilot.Decxus))
        assertEquals(setOf(mine.id, "w"), s.timers.value.keys)
        advanceUntilIdle()
        // A new store (the app restarted) reads its own timers back, private ones included; the room's stay the room's.
        val again = store(this, FakeRoom(), file)
        assertEquals(setOf(mine.id), again.timers.value.keys)
        assertEquals(false, again.timers.value.getValue(mine.id).shared)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun clearFinishedRemovesOnlyThatPilotsFinishedTimers() = runTest {
        var now = t0
        val room = FakeRoom()
        val s = store(this, room, File(tmp.root, "t.json"), now = { now })
        val a = s.start(Pilot.Fiofka, TimerKind.Generic, MIN)
        val b = s.start(Pilot.Fiofka, TimerKind.Generic, HOUR)
        room.state.value = mapOf("w" to timer("w", length = MIN, owner = Pilot.Decxus))
        now = t0 + 2 * MIN
        s.clearFinished(Pilot.Fiofka)
        assertEquals(setOf(b.id, "w"), s.timers.value.keys)
        assertEquals(listOf(a.id), room.removes)
    }
}
