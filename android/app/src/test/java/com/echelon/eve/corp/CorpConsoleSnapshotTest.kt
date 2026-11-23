package com.echelon.eve.corp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.ui.theme.Echelon
import org.junit.Rule
import org.junit.Test

/** A corporation in a mixed state: a healthy tower, a low one, a reinforced one, a structure low and one under attack. */
object ConsoleFixture {
    private val t = CorpFixture.snap.starbases.value!!.single()
    private val s = CorpFixture.snap.structures.value!!.single()
    val busy = CorpFixture.snap.copy(
        starbases = Section(listOf(
            t.copy(id = 1, fuelHoursLeft = 612.0, fuelBlocks = 12240),
            t.copy(id = 2, type = 12236, size = "large", fuelHoursLeft = 9.0, fuelBlocks = 360, system = 30002813),
            t.copy(id = 3, state = "reinforced", fuelHoursLeft = null, fuelBlocks = 4000, reinforcedUntil = "2026-11-19T10:00:00Z"),
            t.copy(id = 4, size = "small", fuelHoursLeft = 140.0, fuelBlocks = 1400),
        ), null, false, null),
        structures = Section(listOf(
            s.copy(id = 10, fuelDaysLeft = 24.0, name = "Perimeter - Keepstar"),
            s.copy(id = 11, fuelDaysLeft = 1.4, name = "Tama Forge", system = 30002813),
            s.copy(id = 12, fuelDaysLeft = 12.0, state = "armor_reinforce", name = "Jita Trade Hub", stateTimerEnd = "2026-11-19T09:00:00Z"),
        ), null, false, null),
    )
    val names = CorpNames(CorpFixture.names.systems, CorpFixture.names.types + mapOf(12236L to "Amarr Control Tower"))
    val info = CorpInfo("Formation Logistics", "FRMN")
}

class CorpConsoleSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)
    private val now = CorpFixture.NOW
    private val busy = Load.Ready(ConsoleFixture.busy)

    @Test fun overview() = paparazzi.echelon { CorpOverviewScreen(busy, ConsoleFixture.info, ConsoleFixture.names, now, {}, { _, _ -> }, scroll = false) }
    @Test fun overviewHealthy() = paparazzi.echelon { CorpOverviewScreen(Load.Ready(CorpFixture.snap), ConsoleFixture.info, CorpFixture.names, now, {}, { _, _ -> }, scroll = false) }
    @Test fun overviewLocked() = paparazzi.echelon {
        val locked = ConsoleFixture.busy.copy(starbases = Section(null, null, false, "needs role Director or Station Manager"), structures = Section(null, null, false, "needs role Station Manager"),
            wallets = Section(null, null, false, "needs role Accountant"))
        CorpOverviewScreen(Load.Ready(locked), null, CorpFixture.names, now, {}, { _, _ -> }, scroll = false)
    }
    @Test fun overviewCard() = paparazzi.echelon {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CorpOverviewCard(busy, ConsoleFixture.info, now, {})
            CorpOverviewCard(Load.Ready(CorpFixture.snap), ConsoleFixture.info, now, {})
            CorpOverviewCard(Load.Failed("No corporation data yet.", missing = true), null, now, {})
        }
    }
    @Test fun refuel14() = paparazzi.echelon { RefuelScreen(busy, ConsoleFixture.names, now, 14, {}, FuelBlock.Helium, {}, copied = false, onCopy = {}, onRetry = {}, scroll = false) }
    @Test fun refuel30Copied() = paparazzi.echelon { RefuelScreen(busy, ConsoleFixture.names, now, 30, {}, FuelBlock.Oxygen, {}, copied = true, onCopy = {}, onRetry = {}, scroll = false) }
    @Test fun starbasesFocused() = paparazzi.echelon { StarbasesScreen(busy, ConsoleFixture.names, now, {}, scroll = false, focus = 2L) }
    @Test fun structuresPulse() = paparazzi.echelon { StructuresScreen(busy, ConsoleFixture.names, now, {}, scroll = false) }
    @Test fun alertSettings() = paparazzi.echelon { Column(Modifier.padding(16.dp)) { CorpAlertSettingsCard(mapOf(AlertKind.StructureFuel to false)) { _, _ -> } } }

    @Test fun gauges() = paparazzi.echelon {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            val c = Echelon.colors
            listOf(0f to c.danger, .03f to c.danger, .1f to c.warn, .35f to c.ok, .7f to c.ok, 1f to c.ok).forEach { (f, col) -> LiquidGauge(f, col, mark = .033f) }
        }
    }
}
