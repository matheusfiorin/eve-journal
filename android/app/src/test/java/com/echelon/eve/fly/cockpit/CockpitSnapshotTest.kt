package com.echelon.eve.fly.cockpit

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.ScreenOrientation
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.fly.timers.MIN
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.ui.format.SecBand
import com.echelon.eve.ui.theme.Spacing
import org.junit.Rule
import org.junit.Test

/** Fixed cockpit data: Fiofka just jumped into Tama (low-sec) mining, Decxus a few systems back with the app open. */
object CockpitFixtures {
    const val NOW = 1_795_000_000_000L
    val me = Whereabouts(Pilot.Fiofka, "Tama", 0.3, "The Citadel", null, 32880, "Venture", "Gas runner", online = true, at = NOW - 20_000, systemId = 30002813)
    val mate = Whereabouts(Pilot.Decxus, "Perimeter", 0.95, "The Forge", null, 32880, "Venture", "Decxus's Venture", at = NOW - 6 * MIN, systemId = 30000144)
    val timers = listOf(
        WingTimer("m", "mining", "Mining cycle", NOW - 100_000, 150_000, owner = Pilot.Fiofka.id),
        WingTimer("g", "gas", "Ghost site", NOW - 12 * MIN, 20 * MIN, owner = Pilot.Decxus.id),
    )
    val ui = CockpitUi(
        Pilot.Fiofka, me, readAt = NOW - 20_000, nextAt = NOW + 40_000,
        banner = CockpitEvent.Jumped("Perimeter", "Tama", 0.3, SecBand.Low),
        timers = timers,
        quick = QUICK_KINDS.map { QuickTimer.of(timers, Pilot.Fiofka, it) },
        mate = MateUi(Pilot.Decxus, appOpen = true, place = mate, lastPing = PingLine("On my way", "Perimeter", NOW - 4 * MIN)),
        plan = PlanLine("Jita → Amarr", listOf(30000142, 30000144, 30002187)),
        status = "“On my way” sent to Decxus.",
    )
}

class CockpitSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi()
    private val now = CockpitFixtures.NOW

    @Test fun cockpit() = paparazzi.echelon { CockpitScreen(CockpitFixtures.ui, now, CockpitActions()) }

    @Test fun cockpitWithALiveGasOperation() = paparazzi.echelon {
        val gas = com.echelon.eve.fly.timers.GasLive(com.echelon.eve.fly.wing.SessionFixtures.liveEstimate, "Gas site", confirmed = 232, owner = Pilot.Fiofka, timerId = "t4")
        CockpitScreen(CockpitFixtures.ui.copy(gas = gas, session = com.echelon.eve.fly.wing.SessionFixtures.mid, banner = null, plan = null, status = null,
            timers = listOf(WingTimer("t4", "sleeper", "Gas site", now - 16 * MIN, 20 * MIN, owner = Pilot.Fiofka.id))), now, CockpitActions())
    }

    @Test fun cockpitNullSecDocked() = paparazzi.echelon {
        CockpitScreen(CockpitFixtures.ui.copy(
            me = CockpitFixtures.me.copy(systemName = "EC-P8R", sec = -0.4, region = "Pure Blind", dockedAt = "a structure", systemId = 30004000),
            banner = CockpitEvent.Jumped("Tama", "EC-P8R", -0.4, SecBand.Null), timers = emptyList(), plan = null, status = null, sound = false,
            quick = QUICK_KINDS.map { QuickTimer.of(emptyList(), Pilot.Fiofka, it) },
        ), now, CockpitActions())
    }

    @Test fun cockpitNotConnected() = paparazzi.echelon {
        CockpitScreen(CockpitUi(Pilot.Decxus, problem = "Decxus is not connected on this phone. Connect them in Settings.",
            quick = QUICK_KINDS.map { QuickTimer.of(emptyList(), Pilot.Decxus, it) },
            mate = MateUi(Pilot.Fiofka, appOpen = false, note = "Fiofka shares their skills only, not where they are.")), now, CockpitActions())
    }

    @Test fun hubCard() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter)) {
            CockpitHubCard(CockpitFixtures.me, CockpitFixtures.timers[0], now, {})
            CockpitHubCard(null, null, now, {}, Modifier.padding(top = Spacing.md))
        }
    }
}

class CockpitLandscapeSnapshotTest {
    @get:Rule val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_8.copy(screenHeight = DeviceConfig.PIXEL_8.screenWidth, screenWidth = DeviceConfig.PIXEL_8.screenHeight, orientation = ScreenOrientation.LANDSCAPE),
        theme = "android:Theme.Material.NoActionBar", renderingMode = RenderingMode.NORMAL, maxPercentDifference = 0.1,
    )

    @Test fun cockpitLandscape() = paparazzi.echelon { CockpitScreen(CockpitFixtures.ui, CockpitFixtures.NOW, CockpitActions()) }
}

