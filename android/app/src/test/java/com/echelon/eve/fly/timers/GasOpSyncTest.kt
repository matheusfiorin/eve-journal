package com.echelon.eve.fly.timers

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.GasOp
import com.echelon.eve.core.wing.WingSession
import com.echelon.eve.core.wing.WingTimer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GasOpSyncTest {
    private val t0 = 1_795_000_000_000L
    private val venture = MiningProfile("Venture", listOf(MiningGroup(Harvest.Gas, 25266, "Gas Cloud Scoop I", 2, 2, 25_500.0, 20.0)), Harvest.Gas, 25_500, 40.0, 94.1, 5000.0, 3_187_500, "mining hold")
    private val inputs = GasInputs(GasRate.of(venture), prices = GasPrices(average = mapOf(Fullerite.C320.typeId to 4000.0)))

    private var session: WingSession? = WingSession("s1", "mining", startedBy = Pilot.Fiofka.id, startedAt = t0 - MIN)
    private var timers = listOf<WingTimer>()
    private val sent = mutableListOf<GasOp>()
    private var pilot: Pilot? = Pilot.Fiofka
    private val sync = OpSync({ pilot }, { session }, { timers }, { inputs }, { _, op -> sent += op })

    private fun gasTimer(id: String = "t1", start: Long = t0, owner: Pilot = Pilot.Fiofka, kind: String = "sleeper", len: Long = 15 * MIN) =
        WingTimer(id, kind, "Gas", start, len, null, owner.id).withGas(Fullerite.C320)

    @Test fun aGasTimerStartedInASessionBecomesAnOperationAtOnce() {
        timers = listOf(gasTimer()); sync.tick(t0 + 1000)
        val op = sent.single()
        assertEquals(listOf("t1", "t1", 30377L, t0, null, 0L), listOf(op.id, op.timer, op.gas, op.startedAt, op.endedAt, op.units))
        assertEquals(Pilot.Fiofka.id, op.by)
    }

    @Test fun updatesComeAtMostEveryHalfMinuteAndOnlyWhenTheCountMoved() {
        timers = listOf(gasTimer()); sync.tick(t0); sent.clear()
        sync.tick(t0 + 26_000)      // one cycle done (8 units), but only 26 s since the first report
        assertTrue(sent.isEmpty())
        sync.tick(t0 + 31_000)      // 30 s passed, the count moved
        assertEquals(8, sent.single().units); sent.clear()
        sync.tick(t0 + 40_000)      // another cycle has not completed yet: nothing new
        sync.tick(t0 + 62_000)      // two more cycles done, 31 s since the last report
        assertEquals(16, sent.single().units)
    }

    @Test fun theEndOfTheTimerFinishesTheOperationOnce() {
        timers = listOf(gasTimer()); sync.tick(t0); sent.clear()
        sync.tick(t0 + 15 * MIN + 2000)
        val end = sent.single()
        assertEquals(t0 + 15 * MIN, end.endedAt); assertEquals((15 * MIN / 25_500) * 8, end.units)
        sync.tick(t0 + 16 * MIN); sync.tick(t0 + HOUR); assertEquals(1, sent.size)
    }

    @Test fun aTimerTakenOffTheBoardEndsItsOperationWhereItStood() {
        timers = listOf(gasTimer()); sync.tick(t0); sync.tick(t0 + 5 * MIN); sent.clear()
        timers = emptyList(); sync.tick(t0 + 5 * MIN + 10_000)
        val op = sent.single()
        assertEquals(t0 + 5 * MIN + 10_000, op.endedAt); assertTrue(op.units > 0)
        sync.tick(t0 + 6 * MIN); assertEquals(1, sent.size)
    }

    @Test fun onlyMyGasTimersStartedDuringTheSessionCount() {
        timers = listOf(gasTimer("old", start = t0 - 10 * MIN), gasTimer("theirs", owner = Pilot.Decxus), gasTimer("mining", kind = "mining"), gasTimer("gas", kind = "gas"))
        sync.tick(t0 + 1000)
        assertEquals(listOf("gas"), sent.map { it.id })
    }

    @Test fun noSessionNoOperationsAndANewSessionStartsClean() {
        session = null; timers = listOf(gasTimer()); sync.tick(t0 + 1000); assertTrue(sent.isEmpty())
        session = WingSession("s1", "mining", startedBy = 1, startedAt = t0 - MIN); sync.tick(t0 + 2000); assertEquals(1, sent.size)
        session = WingSession("s2", "mining", startedBy = 1, startedAt = t0 - 30_000); sync.tick(t0 + 3000); assertEquals("a new session hears the running timer again", 2, sent.size)
        session = session!!.copy(endedAt = t0 + 4000); sync.tick(t0 + 5000); assertEquals(2, sent.size)
        pilot = null; session = WingSession("s3", "mining", startedAt = t0 - 1); sync.tick(t0 + 6000); assertEquals(2, sent.size)
    }

    @Test fun withoutAFitTheOperationStillListsWithZeros() {
        val blind = OpSync({ pilot }, { session }, { listOf(gasTimer()) }, { GasInputs() }, { _, op -> sent += op })
        blind.tick(t0 + 5 * MIN)
        assertEquals(0, sent.single().units); assertEquals(0, sent.single().value); assertNotNull(sent.single().gas); assertNull(sent.single().endedAt)
    }
}
