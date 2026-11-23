package com.echelon.eve.fly.timers

import com.echelon.eve.core.model.MarketData
import com.echelon.eve.core.model.MarketMeta
import com.echelon.eve.core.model.MarketRegion
import com.echelon.eve.core.model.MarketSnapshot
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.GasOp
import com.echelon.eve.core.wing.WingTimer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GasOpsTest {
    private val t0 = 1_795_000_000_000L
    private val C320 = Fullerite.C320

    /** The user's Venture from FLY_TIMERS.md: 2 scoops, 25.5 s cycle, 20 m3 a scoop and cycle, 5000 m3 hold. */
    private val venture = MiningProfile("Venture", listOf(MiningGroup(Harvest.Gas, 25266, "Gas Cloud Scoop I", 2, 2, 25_500.0, 20.0)), Harvest.Gas, 25_500, 40.0, 94.1, 5000.0, 3_187_500, "mining hold")
    private val rate = GasRate.of(venture)!!
    private val prices = GasPrices(average = mapOf(C320.typeId to 4_000.0))
    private val inputs = GasInputs(rate, prices = prices)
    private fun timer(len: Long = 15 * MIN, paused: Long? = null, gas: Fullerite? = C320, start: Long = t0) =
        WingTimer("t1", "sleeper", "Gas site", start, len, paused, Pilot.Fiofka.id).let { if (gas != null) it.withGas(gas) else it }

    // ---- the verified gas ----

    @Test fun theNineFulleritesHaveTheirEsiTypeIdsAndVolumes() {
        // /universe/types/{id} on ESI, 23 Nov 2026 (group 711): name, id, volume.
        val esi = mapOf("C50" to (30370L to 1.0), "C60" to (30371L to 1.0), "C70" to (30372L to 1.0), "C72" to (30373L to 2.0), "C84" to (30374L to 2.0),
            "C28" to (30375L to 2.0), "C32" to (30376L to 5.0), "C320" to (30377L to 5.0), "C540" to (30378L to 10.0))
        assertEquals(esi.keys, Fullerite.entries.map { it.short }.toSet())
        for (f in Fullerite.entries) { assertEquals(f.short, esi.getValue(f.short).first, f.typeId); assertEquals(f.short, esi.getValue(f.short).second, f.volume, 0.0); assertEquals("Fullerite-${f.short}", f.title) }
        assertEquals(C320, Fullerite.of(30377)); assertNull(Fullerite.of(34)); assertNull(Fullerite.of(null))
    }

    // ---- the rate ----

    @Test fun theRateSumsEveryGasModuleOfTheFit() {
        assertEquals(1, rate.modules.size); assertEquals(5000.0, rate.holdM3, 0.0); assertEquals(25_500, rate.cycleMs)
        assertEquals(40.0 * 60_000 / 25_500, rate.perMinute, 1e-9)
        // Modules that differ (a second kind with its own cycle) add up cycle by cycle.
        val mixed = GasRate(listOf(GasModule(1, 10_000, 10.0), GasModule(2, 25_000, 20.0)), 1000.0)
        assertEquals(3 * 10.0 + 2 * 20.0 * 1, mixed.m3At(30_000), 0.0)   // 3 cycles of the first, 1 of the second
        assertEquals(0.0, mixed.m3At(9_999), 0.0)
        // Only gas harvesters count: ore lasers in the fit are not gas.
        val ore = MiningProfile("Retriever", listOf(MiningGroup(Harvest.Ore, 1, "Miner", 2, 2, 60_000.0, 100.0)), Harvest.Ore, 60_000, 200.0, 200.0, 100.0, 60_000, "ore hold")
        assertNull(GasRate.of(ore)); assertNull(GasRate.of(null))
        val both = venture.copy(groups = venture.groups + ore.groups)
        assertEquals(1, GasRate.of(both)!!.modules.size)
    }

    @Test fun theHoldFillsOnTheCycleThatCarriesItPastCapacity() {
        assertEquals(125L * 25_500, rate.holdFullAfterMs)
        val odd = GasRate(listOf(GasModule(1, 10_000, 30.0)), 100.0)          // 3.33 cycles: the fourth fills it
        assertEquals(40_000L, odd.holdFullAfterMs)
        assertNull(GasRate(emptyList(), 100.0).holdFullAfterMs); assertNull(GasRate(listOf(GasModule(1, 1000, 1.0)), 0.0).holdFullAfterMs)
    }

    // ---- the estimate ----

    @Test fun completedCyclesOnlyNoPartialCycle() {
        val just = GasOps.estimate(timer(), inputs, t0 + 25_499)!!
        assertEquals(0, just.units); assertEquals(0, just.value); assertEquals(0.0, just.m3, 0.0)
        val one = GasOps.estimate(timer(), inputs, t0 + 25_500)!!
        assertEquals(40.0, one.m3, 0.0); assertEquals(8, one.units); assertEquals(32_000, one.value); assertEquals(1, one.batches)
        val ten = GasOps.estimate(timer(), inputs, t0 + 10 * 25_500 + 12_000)!!
        assertEquals(400.0, ten.m3, 0.0); assertEquals(80, ten.units); assertEquals(10, ten.batches)
    }

    @Test fun unitsAreFlooredFromTheUnitVolume() {
        // 40 m3 a cycle of C540 (10 m3 each) is 4 units; of C50 (1 m3) 40; a cycle that does not divide leaves the rest in the hold.
        val c540 = GasOps.estimate(Fullerite.C540, 25_500, inputs)!!; assertEquals(4, c540.units)
        val c50 = GasOps.estimate(Fullerite.C50, 25_500, inputs)!!; assertEquals(40, c50.units)
        val odd = GasInputs(GasRate(listOf(GasModule(1, 1000, 7.0)), 1000.0), prices = prices)
        assertEquals(1, GasOps.estimate(C320, 1000, odd)!!.units)
        assertEquals(2, GasOps.estimate(C320, 2000, odd)!!.units); assertEquals(14.0, GasOps.estimate(C320, 2000, odd)!!.m3, 0.0)
        // ESI's volume wins over the table when the types cache has it; a zero or missing one falls back.
        assertEquals(20, GasOps.estimate(Fullerite.C50, 25_500, inputs.copy(volumes = mapOf(Fullerite.C50.typeId to 2.0)))!!.units)
        assertEquals(40, GasOps.estimate(Fullerite.C50, 25_500, inputs.copy(volumes = mapOf(Fullerite.C50.typeId to 0.0)))!!.units)
        assertEquals(2.0, inputs.copy(volumes = mapOf(30370L to 2.0)).unitVolume(Fullerite.C50), 0.0)
    }

    @Test fun theHoldCapsTheEstimateAndTheTimerEndStopsIt() {
        val full = GasOps.estimate(timer(len = 60 * MIN), inputs, t0 + 60 * MIN)!!     // 60 min of cycles is past the 53 min the hold takes
        assertTrue(full.holdFull); assertEquals(5000.0, full.m3, 0.0); assertEquals(1000, full.units); assertEquals(1f, full.fill, 0f); assertNull(full.holdFullInMs)
        // After the timer's end nothing more is counted, however long ago it ended.
        val ended = GasOps.estimate(timer(), inputs, t0 + 5 * 60 * MIN)!!
        val atEnd = GasOps.estimate(timer(), inputs, t0 + 15 * MIN)!!
        assertEquals(atEnd.units, ended.units); assertEquals(15 * MIN, ended.activeMs); assertNull(ended.timerEndInMs)
        assertEquals(floorUnits(15 * MIN), ended.units)
    }

    private fun floorUnits(ms: Long): Long = (ms / 25_500) * 8

    @Test fun aPauseFreezesTheCountAndAResumeCarriesOn() {
        val t = timer(len = 20 * MIN)
        val paused = t.paused(t0 + 5 * MIN)
        val a = GasOps.estimate(paused, inputs, t0 + 5 * MIN)!!
        val later = GasOps.estimate(paused, inputs, t0 + 12 * MIN)!!
        assertEquals(a.units, later.units); assertEquals(5 * MIN, later.activeMs); assertNull(later.timerEndInMs)
        // Resumed after 7 minutes paused: the start moved forward, so 5 minutes of work are still 5, and it counts on from there.
        val resumed = paused.resumed(t0 + 12 * MIN)
        assertEquals(5 * MIN, GasOps.activeMs(resumed, t0 + 12 * MIN))
        assertEquals(floorUnits(8 * MIN), GasOps.estimate(resumed, inputs, t0 + 15 * MIN)!!.units)
    }

    @Test fun theNextThingIsTheHoldOrTheSleepersWhicheverComesFirst() {
        // A 15 minute Sleeper timer ends long before the 53 minute hold fills.
        val e = GasOps.estimate(timer(), inputs, t0 + 5 * MIN)!!
        assertEquals(10 * MIN, e.timerEndInMs); assertEquals(125L * 25_500 - 5 * MIN, e.holdFullInMs)
        assertEquals(false to 10 * MIN, e.next)
        // A long timer on a small hold fills first.
        val small = GasInputs(GasRate(listOf(GasModule(2, 25_500, 20.0)), 400.0), prices = prices)
        val s = GasOps.estimate(timer(len = 60 * MIN), small, t0 + 2 * MIN)!!
        assertEquals(true, s.next!!.first); assertEquals(10L * 25_500 - 2 * MIN, s.next!!.second)
        assertNull(GasOps.estimate(timer(), inputs, t0 + 16 * MIN)!!.next)
    }

    @Test fun noGasNoFitNoEstimate() {
        assertNull(GasOps.estimate(timer(gas = null), inputs, t0 + MIN))
        assertNull(GasOps.estimate(timer(), GasInputs(null, prices = prices), t0 + MIN))
    }

    @Test fun theHoldGaugeFills() {
        val e = GasOps.estimate(timer(len = 60 * MIN), inputs, t0 + 26 * 25_500)!!
        assertEquals(26 * 40.0 / 5000.0, e.fill.toDouble(), 1e-6); assertEquals(8, e.unitsPerBatch)
    }

    // ---- prices ----

    private fun market(buys: String): MarketData {
        val region = Json.parseToJsonElement("""{"types":{"30377":{"b":$buys,"s":[]}}}""") as JsonObject
        return MarketData(MarketSnapshot(MarketMeta(), regions = listOf(MarketRegion(GasMarket.FORGE, 0, region))), null)
    }

    @Test fun jitaBestBuyBeatsTheEsiAverageAndSaysSo() {
        val data = market("[[60003760, 3500.5, 100], [60003760, 3700, 20], [60008494, 9999, 5]]")
        val p = GasMarket.prices(data, mapOf(30377L to 4000.0))
        assertEquals(GasPrice(3700.0, PriceSource.JitaBuy), p.of(30377))
        assertEquals("Jita best buy", p.of(30377)!!.source.label)
        val v = GasOps.estimate(C320, 25_500, GasInputs(rate, prices = p))!!
        assertEquals(8 * 3700L, v.value); assertEquals(PriceSource.JitaBuy, v.price!!.source)
    }

    @Test fun withoutJitaTheEsiAverageIsUsedAndLabelled() {
        for (data in listOf(null, market("[]"), market("[[60008494, 9999, 5]]"), MarketData(MarketSnapshot(), null))) {
            val p = GasMarket.prices(data, mapOf(30377L to 4000.0))
            assertEquals(GasPrice(4000.0, PriceSource.EsiAverage), p.of(30377)); assertEquals("ESI average", p.of(30377)!!.source.label)
        }
        // Neither knows it: no price, no value (and the estimate still counts units).
        val none = GasOps.estimate(C320, 25_500, GasInputs(rate))!!
        assertNull(none.price); assertEquals(0, none.value); assertEquals(8, none.units)
        assertNull(GasPrices(average = mapOf(30377L to 0.0)).of(30377))
    }

    // ---- the operation and the reports ----

    @Test fun theOperationIsTheTimersWithItsNumbers() {
        val t = timer()
        val e = GasOps.estimate(t, inputs, t0 + 5 * MIN)!!
        val op = GasOps.op(t, Pilot.Fiofka.id, e, t0 + 5 * MIN)
        assertEquals(GasOp("t1", Pilot.Fiofka.id, "t1", 30377, t0, null, e.units, e.m3, e.value), op); assertTrue(op.live)
        // A finished timer's operation ended at the timer's end; a removed one where it was stopped.
        assertEquals(t0 + 15 * MIN, GasOps.op(t, 1, e, t0 + 20 * MIN).endedAt)
        assertEquals(t0 + 7 * MIN, GasOps.op(t, 1, e, t0 + 8 * MIN, stoppedAt = t0 + 7 * MIN).endedAt)
        // No estimate yet (no fit): zeros, so the site still lists.
        assertEquals(0, GasOps.op(t, 1, null, t0 + MIN).units)
    }

    @Test fun anOperationIsSentFirstThenAtMostEveryHalfMinuteAndAtItsEnd() {
        fun op(units: Long, ended: Long? = null) = GasOp("t1", 1, "t1", 30377, t0, ended, units, units * 5.0, units * 4000)
        assertTrue("the first report", GasOps.shouldReport(null, op(0), t0))
        val last = GasOps.Reported(t0, 8, null)
        assertFalse("a batch inside 30 s waits", GasOps.shouldReport(last, op(16), t0 + 29_999))
        assertTrue("a batch after 30 s goes", GasOps.shouldReport(last, op(16), t0 + 30_000))
        assertFalse("nothing changed", GasOps.shouldReport(last, op(8), t0 + 5 * MIN))
        assertTrue("the end goes at once", GasOps.shouldReport(last, op(8, ended = t0 + 1000), t0 + 1000))
        assertFalse("and only once", GasOps.shouldReport(GasOps.Reported(t0, 8, t0 + 1000), op(8, ended = t0 + 1000), t0 + 5 * MIN))
    }

    // ---- reconciliation ----

    private val ledger = Json.parseToJsonElement("""[
        {"date":"2026-11-17","quantity":900,"solar_system_id":31000005,"type_id":30377},
        {"date":"2026-11-18","quantity":410,"solar_system_id":31000005,"type_id":30377},
        {"date":"2026-11-18","quantity":77,"solar_system_id":31000005,"type_id":30378},
        {"date":"2026-11-18","quantity":12,"solar_system_id":30000142,"type_id":1230},
        {"date":"2026-11-18"}, "junk"]""")

    @Test fun theLedgerConfirmsTheGasOfTheDaysTheOperationCovered() {
        val rows = GasOps.ledgerRows(ledger)
        assertEquals(4, rows.size)
        val day = 1_795_000_000_000L  // 2026-11-18 UTC
        assertEquals("2026-11-18", java.time.Instant.ofEpochMilli(day).atZone(java.time.ZoneOffset.UTC).toLocalDate().toString())
        val op = GasOp("t1", 1, "t1", 30377, day, null, 400, 2000.0, 1_600_000)
        assertEquals(410L, GasOps.confirmedUnits(rows, op, day + MIN))
        assertEquals("the other gas is not this one", 77L, GasOps.confirmedUnits(rows, op.copy(gas = 30378), day + MIN))
        assertNull("nothing in the ledger for it", GasOps.confirmedUnits(rows, op.copy(gas = 30370), day + MIN))
        // An operation that began the day before and ended today covers both days.
        assertEquals(1310L, GasOps.confirmedUnits(rows, op.copy(startedAt = day - 86_400_000, endedAt = day + MIN), day + HOUR))
        assertNull(GasOps.confirmedUnits(emptyList(), op, day))
        assertNotNull(GasOps.ledgerRows(null))
    }
}
