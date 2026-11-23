package com.echelon.eve.fly.timers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SolarSystem
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.cockpit.CockpitActions
import com.echelon.eve.fly.cockpit.CockpitFixtures
import com.echelon.eve.fly.cockpit.CockpitScreen
import com.echelon.eve.fly.cockpit.Suggestion
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.theme.Spacing
import org.junit.Rule
import org.junit.Test

/** The sleeper timer, the fit-based mining numbers, the suggestion cards, the exact-alarm card and the rings as warnings close in. */
class SleeperSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)
    private val f = TimerFixtures
    private val now = f.NOW
    private val me = Pilot.Fiofka

    private val jSystem = 31001234L
    private val wormhole = f.systems + (jSystem to SolarSystem(jSystem, "J123456", -1.0, 11000003, emptyList(), 0, null))
    private val map = TimerMap(wormhole, here = jSystem, wingmateAt = null, regionName = { null })

    /** The user's real Venture: two Gas Cloud Scoop I, Gas Cloud Harvesting IV, Mining IV, Mining Frigate III. */
    private val venture = DogmaType(32880, "Venture", 25, 50.0, mapOf(1556 to 5000.0, 207 to 2.0, 1842 to 5.0, 3237 to -5.0, 3239 to 100.0))
    private val scoop = DogmaType(25266, "Gas Cloud Scoop I", 737, 0.0, mapOf(77 to 10.0, 73 to 30_000.0, 182 to 25544.0))
    private val ventureProfile = MiningCalc.profile(venture, listOf(scoop to 2), emptyList(), mapOf(Dogma.MINING to 4, Dogma.GAS_CLOUD_HARVESTING to 4, Dogma.MINING_FRIGATE to 3))!!
    private val mining = MiningUi(ventureProfile)

    /** In a wormhole: the Sleeper timer, its 15:00 and the 2 min warning, and what the Venture's scoops do. */
    @Test fun sleeperForm() = paparazzi.echelon {
        val groups = SystemBoard.of(emptyList(), now, jSystem, null, wormhole, emptyMap())
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PrimaryPanel { TimerForm(me, map.withMining(mining), emptyMap(), groups, null, onStart = {}) }
        }
    }

    /** The mining timer from the fit: the cycle in the length, repeat on, the hold-full timer offered. */
    @Test fun miningForm() = paparazzi.echelon {
        val groups = SystemBoard.of(emptyList(), now, jSystem, null, wormhole, emptyMap())
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PrimaryPanel { TimerForm(me, map.withMining(mining), emptyMap(), groups, null, onStart = {}, initialKind = TimerKind.Mining) }
        }
    }

    /** Known space: the plain gas timer, with no Sleepers in its words. */
    @Test fun knownSpaceGasForm() = paparazzi.echelon {
        val groups = SystemBoard.of(emptyList(), now, f.PERIMETER, null, f.systems, emptyMap())
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PrimaryPanel { TimerForm(me, f.map, emptyMap(), groups, null, onStart = {}) }
        }
    }

    @Test fun suggestionsAndTheExactAlarmCard() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SuggestionBody(Suggestion.Wormhole(jSystem, "J123456", now), mining, {}, {})
            SuggestionBody(Suggestion.Mining("Gas runner", now), mining, {}, {})
            ExactAlarmCard({}, {})
        }
    }

    private fun ring(t: WingTimer, at: Long) = @androidx.compose.runtime.Composable { TimerRing(t, me, at, selected = false, onClick = {}) }

    /** Left to right: calm (6:00 in), amber building (12:45), past the warning (13:40), the last seconds (14:50), then the end: warp out. */
    @Test fun ringsAsTheWarningCloses() = paparazzi.echelon {
        val t = newTimer("s", TimerKind.Sleeper, GasSleepers.DEFAULT_MS, me, now, label = "Sleepers")
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                ring(t, now + 6 * MIN)(); ring(t, now + 12 * MIN + 45 * SEC)(); ring(t, now + 13 * MIN + 40 * SEC)()
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                ring(t, now + 14 * MIN + 50 * SEC)(); ring(t, now + 15 * MIN + 2 * SEC)()
                ring(newTimer("g", TimerKind.Gas, 20 * MIN, me, now, label = "Gas site"), now + 20 * MIN + 2 * SEC)()
            }
        }
    }

    /** The cockpit in a wormhole: the suggestion card on top, and the line from the fit under the next timer. */
    @Test fun cockpitSleeper() = paparazzi.echelon {
        val sleeper = newTimer("s", TimerKind.Sleeper, GasSleepers.DEFAULT_MS, me, now - 11 * MIN - 30 * SEC, label = "Sleeper gas", system = TimerSystem(jSystem, "J123456"))
        CockpitScreen(
            CockpitFixtures.ui.copy(
                me = CockpitFixtures.me.copy(systemName = "J123456", sec = -1.0, region = "Wormhole space", systemId = jSystem), banner = null,
                timers = listOf(sleeper), suggestion = Suggestion.Wormhole(jSystem, "J123456", now), mining = mining, status = null,
            ), now, CockpitActions(),
        )
    }

    private fun TimerMap.withMining(m: MiningUi) = TimerMap(systems, here, wingmateAt, regionName, mining = m)
}
