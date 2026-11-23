package com.echelon.eve.fly.timers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.ui.theme.Spacing
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** The live gas hero in its states: ticking up, the hold nearly full with the Sleepers close, and no price known. */
class GasSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)

    private val rate = GasRate(listOf(GasModule(2, 25_500, 20.0)), 5000.0)
    private val jita = GasInputs(rate, prices = GasPrices(jitaBuy = mapOf(Fullerite.C320.typeId to 36_000.0)))
    private val average = GasInputs(rate, prices = GasPrices(average = mapOf(Fullerite.C540.typeId to 52_000.0)))

    @Test fun liveOperation() = paparazzi.echelon {
        val e = GasOps.estimate(Fullerite.C320, 8 * MIN, jita, timerLeftMs = 12 * MIN)!!
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            GasHero(GasLive(e, "Gas site", confirmed = 232, owner = Pilot.Fiofka), onPick = {})
            // A different gas priced from ESI's average, the hold small enough to matter.
            GasHero(GasLive(GasOps.estimate(Fullerite.C540, 20 * MIN, average, timerLeftMs = 40 * MIN)!!, "Instrumental site", owner = Pilot.Fiofka))
        }
    }

    @Test fun holdAlmostFullSleepersClose() = paparazzi.echelon {
        val small = GasInputs(GasRate(listOf(GasModule(2, 25_500, 20.0)), 1500.0), prices = jita.prices)
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            GasHero(GasLive(GasOps.estimate(Fullerite.C320, 13 * MIN + 20_000, jita, timerLeftMs = 100_000)!!, "Gas site"))
            GasHero(GasLive(GasOps.estimate(Fullerite.C320, 32 * 25_500, small, timerLeftMs = 6 * MIN)!!, "Gas site"), running = true)
        }
    }

    @Test fun noPriceYet() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter)) { GasHero(GasLive(GasOps.estimate(Fullerite.C84, 5 * MIN, GasInputs(rate), timerLeftMs = 10 * MIN)!!, "Gas site")) }
    }

    @Test fun gasChipsInTheStartForm() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter)) { GasChips(Fullerite.C320, {}) }
    }

    @Test fun theOneLineSummaryAndTheNextClock() {
        val e = GasOps.estimate(Fullerite.C320, 8 * MIN, jita, timerLeftMs = 12 * MIN)!!
        assertEquals("Fullerite-C320 · +144 units · ≈5.2M", gasLine(e))
        assertEquals("Sleepers in 12:00", nextText(e))
        assertEquals("Hold full in 45 min", nextText(e.copy(timerEndInMs = 60 * MIN, holdFullInMs = 45 * MIN)))
        assertEquals("no price", valueText(GasOps.estimate(Fullerite.C320, 8 * MIN, GasInputs(rate))!!))
    }

    @Test fun theLiveViewPicksTheNewestRunningGasTimerOfThePilot() {
        val t0 = 1_795_000_000_000L
        fun t(id: String, owner: Pilot, start: Long, len: Long = 15 * MIN, kind: String = "sleeper") = com.echelon.eve.core.wing.WingTimer(id, kind, "Gas", start, len, null, owner.id).withGas(Fullerite.C320)
        val timers = listOf(t("old", Pilot.Fiofka, t0 - 40 * MIN), t("mine", Pilot.Fiofka, t0 - 5 * MIN), t("theirs", Pilot.Decxus, t0 - MIN), t("mining", Pilot.Fiofka, t0 - MIN, kind = "mining"))
        val g = GasOps.live(Pilot.Fiofka, timers, jita, emptyList(), t0)!!
        assertEquals("mine", g.timerId); assertEquals(Pilot.Fiofka, g.owner)
        assertEquals(null, GasOps.live(Pilot.Fiofka, timers.filter { it.id == "old" }, jita, emptyList(), t0))
        assertEquals(null, GasOps.live(Pilot.Fiofka, timers, GasInputs(), emptyList(), t0))
    }
}
