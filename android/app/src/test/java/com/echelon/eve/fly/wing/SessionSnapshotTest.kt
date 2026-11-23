package com.echelon.eve.fly.wing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.Contribution
import com.echelon.eve.core.wing.GasOp
import com.echelon.eve.core.wing.SessionAdd
import com.echelon.eve.core.wing.WingSession
import com.echelon.eve.core.wing.WingStatus
import com.echelon.eve.fly.timers.Fullerite
import com.echelon.eve.fly.timers.GasEstimate
import com.echelon.eve.fly.timers.GasInputs
import com.echelon.eve.fly.timers.GasModule
import com.echelon.eve.fly.timers.GasOps
import com.echelon.eve.fly.timers.GasPrices
import com.echelon.eve.fly.timers.GasRate
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.ui.theme.Spacing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

private const val NOW = 1_795_000_000_000L
private const val MIN = 60_000L
private val FIO = Pilot.Fiofka.id
private val DEC = Pilot.Decxus.id

/** The session card (goal over operations), its compact form and the Add ISK sheet. */
object SessionFixtures {
    /** A stronger fit than the user's Venture, so the live site reads like the plan: 36k ISK a unit, 8 units a cycle. */
    val inputs = GasInputs(GasRate(listOf(GasModule(2, 25_500, 20.0)), 5000.0), prices = GasPrices(jitaBuy = mapOf(Fullerite.C320.typeId to 36_000.0)))
    val liveEstimate: GasEstimate = GasOps.estimate(Fullerite.C320, 16 * MIN, inputs, timerLeftMs = 4 * MIN)!!

    private val ops = listOf(
        GasOp("t1", DEC, "t1", Fullerite.C540.typeId, NOW - 70 * MIN, NOW - 55 * MIN, 140, 1400.0, 31_000_000),
        GasOp("t2", FIO, "t2", Fullerite.C320.typeId, NOW - 52 * MIN, NOW - 37 * MIN, 352, 1760.0, 12_700_000),
        GasOp("t3", DEC, "t3", Fullerite.C320.typeId, NOW - 33 * MIN, NOW - 18 * MIN, 336, 1680.0, 12_100_000),
        GasOp("t4", FIO, "t4", Fullerite.C320.typeId, NOW - 16 * MIN, null, liveEstimate.units, liveEstimate.m3, liveEstimate.value),
    )
    private val adds = listOf(
        SessionAdd("a1", FIO, 12_000_000, "Sold the paste", NOW - 25 * MIN),
        SessionAdd("a2", DEC, 50_000_000, "Bounties from the Perimeter", NOW - 9 * MIN),
        SessionAdd("a3", DEC, -2_000_000, "Typo", NOW - 8 * MIN),
    )
    val mid = WingSession("s1", WingStatus.MINING, goal = 250_000_000, where = 30000142, title = "Gas huffing", startedBy = DEC, startedAt = NOW - 75 * MIN,
        contrib = mapOf("$FIO" to Contribution(timers = 2, isk = 4_000_000, units = 600, systems = listOf(30000144), mined = ops[1].value + ops[3].value, added = 12_000_000),
            "$DEC" to Contribution(timers = 2, isk = 1_500_000, units = 900, systems = listOf(30000142, 30000144), mined = ops[0].value + ops[2].value, added = 48_000_000)),
        ops = ops, adds = adds)
    val reached = mid.copy(goal = 100_000_000, ops = ops.take(3), contrib = mid.contrib.mapValues { it.value.copy(mined = ops.filter { o -> "${o.by}" == it.key && o.id != "t4" }.sumOf { o -> o.value }) })
}

class SessionSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)
    private val names = mapOf(30000142L to "Jita", 30000144L to "Perimeter")

    @Test fun sessionMidGoal() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter)) {
            SessionCard(SessionFixtures.mid, Pilot.Fiofka, NOW, names::get, live = mapOf("t4" to SessionFixtures.liveEstimate), confirmed = mapOf("t2" to 352L))
        }
    }

    @Test fun sessionGoalReached() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter)) {
            SessionCard(SessionFixtures.reached, Pilot.Fiofka, NOW, names::get)
        }
    }

    @Test fun addIskSheet() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter)) { AddIskForm({ _, _ -> }, initialAmount = "12.5m", initialNote = "Sold the paste", adds = SessionFixtures.mid.adds, now = NOW) }
    }

    @Test fun addIskEmptyAndInvalid() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
            AddIskForm({ _, _ -> })
            AddIskForm({ _, _ -> }, initialAmount = "lots")
        }
    }

    @Test fun compactCards() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SessionMini(SessionFixtures.mid, Pilot.Fiofka, {})
            SessionMini(SessionFixtures.reached, Pilot.Decxus, {})
            SessionMini(SessionFixtures.mid.copy(goal = null, ops = emptyList(), adds = emptyList()), Pilot.Fiofka, {})
        }
    }

    // ---- the pure parts ----

    @Test fun amountsAreTypedTheWayTheRestOfTheAppTypesThem() {
        assertEquals(12_500_000L, parseAmount("12.5m")); assertEquals(-2_000_000L, parseAmount("-2m")); assertEquals(-2_000_000L, parseAmount("−2M"))
        assertEquals(750_000L, parseAmount(" 750k ")); assertEquals(1_000_000L, parseAmount("1,000,000"))
        for (bad in listOf("", "lots", "0", "-0", "m", "20t")) assertNull(bad, parseAmount(bad))
        assertEquals("20m", formatAmount(20_000_000)); assertEquals("12.5m", formatAmount(12_500_000)); assertEquals("750k", formatAmount(750_000)); assertEquals("1234", formatAmount(1234)); assertEquals("-2m", formatAmount(-2_000_000))
        assertEquals(parseAmount("1.25b"), 1_250_000_000L); assertEquals(1_250_000_000L, parseAmount(formatAmount(1_250_000_000)))
    }

    @Test fun theGoalCountsGasAndAddsAndTheSitesAreNumberedInOrder() {
        val s = SessionFixtures.mid
        assertEquals(s.ops.sumOf { it.value } + 60_000_000L, s.sum.value)
        assertEquals(mapOf("t1" to "Site 1", "t2" to "Site 2", "t3" to "Site 3", "t4" to "Site 4"), siteNames(s.ops.reversed()))
        assertEquals(s.sum.value.toFloat() / 250_000_000, goalProgress(s))
        assertEquals(false, SessionFixtures.mid.reached); assertEquals(true, SessionFixtures.reached.reached)
        assertNull(goalProgress(s.copy(goal = null)))
        // The stripes: each pilot's gas in order, then what was added.
        assertEquals(listOf(s.of(FIO).mined, s.of(DEC).mined, 60_000_000L), stripes(s, Pilot.Fiofka).map { it.first })
    }

    @Test fun aGoalIsSuggestedFromTheFitAndTheGas() {
        // 15 minutes of 8 units a 25.5 s cycle: 35 cycles, 280 units of 36k, three sites, to two figures.
        assertEquals(30_000_000L, GasOps.suggestGoal(SessionFixtures.inputs, Fullerite.C320))
        assertEquals(3_400_000L, GasOps.suggestGoal(SessionFixtures.inputs.copy(prices = GasPrices(average = mapOf(Fullerite.C320.typeId to 4_000.0))), Fullerite.C320))
        assertNull(GasOps.suggestGoal(GasInputs(), Fullerite.C320)); assertNull(GasOps.suggestGoal(GasInputs(SessionFixtures.inputs.rate), Fullerite.C320))
    }
}
