package com.echelon.eve.fly.cockpit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.timers.MIN
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import org.junit.Rule
import org.junit.Test

/** The picture-in-picture window at the size Android gives a 16:9 PiP on a phone (about 240 × 135 dp). */
class CockpitPipSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi()
    private val now = CockpitFixtures.NOW
    private val pip = Modifier.size(240.dp, 135.dp)

    @Test fun pip() = paparazzi.echelon {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // A sleeper timer with two minutes left, the warning near: the ring runs hot.
            CockpitPipScreen(PipUi(Pilot.Fiofka, WingTimer("s", "sleeper", "Sleeper gas", now - 13 * MIN, 15 * MIN, owner = Pilot.Fiofka.id),
                systemName = "J123456", sec = -1.0, mate = Pilot.Decxus, mateOnline = true, mateWhere = "in space · Tama"), now, pip)
            // A mining cycle mid-way, the wingmate offline.
            CockpitPipScreen(PipUi(Pilot.Fiofka, WingTimer("m", "mining", "Mining cycle", now - 10_000, 26_000, owner = Pilot.Fiofka.id),
                systemName = "Tama", sec = 0.3, mate = Pilot.Decxus, mateOnline = false), now, pip)
            // Nothing running.
            CockpitPipScreen(PipUi(Pilot.Fiofka, null), now, pip)
        }
    }
}
