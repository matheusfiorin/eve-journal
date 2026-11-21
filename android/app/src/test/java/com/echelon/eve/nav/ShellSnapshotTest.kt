package com.echelon.eve.nav

import com.echelon.eve.core.api.Problem
import com.echelon.eve.core.auth.AuthManager
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.data.SyncState
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.PrivatePilot
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.testing.echelon
import org.junit.Rule
import org.junit.Test
import java.time.ZoneOffset

/** Fixed data for the shell's goldens: Fiofka connected and flying, Decxus not connected here. */
object ShellFixtures {
    const val AT = 1_795_000_000_000L // 2026-11-18 09:46 UTC
    val zone: ZoneOffset = ZoneOffset.UTC
    val fiofka = PilotState(Pilot.Fiofka, connected = true, private = PrivatePilot(Pilot.Fiofka.id, "Fiofka", expires = AT + 30 * 86_400_000L, fetchedAt = "2026-11-18T09:40:00Z"))
    val decxus = PilotState(Pilot.Decxus)
    val state = ShellState(pilots = listOf(fiofka, decxus), selected = Pilot.Fiofka, sync = SyncState(lastSyncedAt = AT, dataFrom = AT - 360_000), version = "0.1.0", backendHost = "eve-journal-api.eve-pilots-f6933080.workers.dev")
}

class ShellSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi()
    private val s = ShellFixtures.state

    @Test fun plan() = paparazzi.echelon { EchelonShell(s, ShellActions(), start = PlanRoute, zone = ShellFixtures.zone) }
    @Test fun fly() = paparazzi.echelon { EchelonShell(s, ShellActions(), start = FlyRoute, zone = ShellFixtures.zone) }
    @Test fun corp() = paparazzi.echelon { EchelonShell(s, ShellActions(), start = CorpRoute, zone = ShellFixtures.zone) }

    @Test fun decxusWithAnExpiredSignIn() = paparazzi.echelon(pilot = com.echelon.eve.ui.theme.PilotColors.Decxus) {
        val dec = PilotState(Pilot.Decxus, connected = false, problem = Problem(Problem.Kind.Expired, "This dashboard session expired."))
        EchelonShell(s.copy(pilots = listOf(ShellFixtures.fiofka, dec), selected = Pilot.Decxus, sync = s.sync.copy(expired = listOf(Pilot.Decxus))), ShellActions(), start = PlanRoute, zone = ShellFixtures.zone)
    }

    @Test fun subScreen() = paparazzi.echelon { EchelonShell(s, ShellActions(), start = SubRoute(Destination.Fly.name, "timers"), zone = ShellFixtures.zone) }
}

class SettingsSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi()
    @Test fun settings() = paparazzi.echelon { SettingsScreen(ShellFixtures.state, ShellActions(), onBack = {}, zone = ShellFixtures.zone) }
}

class WelcomeSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi()
    private val fresh = ShellState(selected = null)

    @Test fun whoIsFlying() = paparazzi.echelon { WelcomeScreen(fresh, ShellActions()) }
    @Test fun connect() = paparazzi.echelon { WelcomeScreen(fresh, ShellActions(), initialChosen = Pilot.Decxus) }
    @Test fun connectWaiting() = paparazzi.echelon { WelcomeScreen(fresh.copy(auth = AuthManager.State.Waiting(Pilot.Fiofka)), ShellActions(), initialChosen = Pilot.Fiofka) }
}
