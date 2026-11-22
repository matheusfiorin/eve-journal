package com.echelon.eve.fly.wing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.Contribution
import com.echelon.eve.core.wing.Presence
import com.echelon.eve.core.wing.SessionTotals
import com.echelon.eve.core.wing.SharedPlan
import com.echelon.eve.core.wing.WingAck
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingEvent
import com.echelon.eve.core.wing.WingPing
import com.echelon.eve.core.wing.WingSession
import com.echelon.eve.core.wing.WingStatus
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.wing.WingIndicator
import com.echelon.eve.wing.WingIndicatorState
import com.echelon.eve.wing.WingIndicatorState.Link
import org.junit.Rule
import org.junit.Test

private const val NOW = 1_795_000_000_000L
private const val MIN = 60_000L
private val FIO = Pilot.Fiofka.id
private val DEC = Pilot.Decxus.id
private val NAMES = mapOf(30000142L to "Jita", 30000144L to "Perimeter", 30003504L to "Niarja", 30002187L to "Amarr", 30002053L to "Hek")

/** The Wing screen with live status, answers and a session; and the top-bar indicator in each state. */
class WingSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)

    private val pings = listOf(
        WingEvent(Pilot.Decxus, NOW - 4 * MIN, WingPing(WingPing.HELP, "Tackled at the Perimeter gate", 30000144), "p1", mapOf(FIO to WingAck(WingAck.SEEN, NOW - 3 * MIN))),
        WingEvent(Pilot.Fiofka, NOW - 9 * MIN, WingPing(WingPing.OMW), "p2", mapOf(DEC to WingAck(WingAck.ONIT, NOW - 8 * MIN))),
    )
    private val plans = listOf(WingEvent(Pilot.Decxus, NOW - 30 * MIN, SharedPlan("haul", "Jita → Amarr", "45 jumps, 0.8% risk", listOf(30000142, 30000144, 30003504, 30002187)), "s1", mapOf(FIO to WingAck(WingAck.CANT, NOW - 20 * MIN))))
    private val statuses = mapOf(
        DEC to WingStatus(system = 30000142, docked = false, shipType = 17478, ship = "Retriever", activity = WingStatus.MINING, destination = 30002187, route = listOf(30000142, 30000144, 30003504, 30002187), pilot = DEC, at = NOW - MIN),
        FIO to WingStatus(system = 30000144, docked = true, ship = "Procurer", activity = WingStatus.MINING, pilot = FIO, at = NOW),
    )
    private val session = WingSession("x", WingStatus.MINING, goal = 500_000_000, where = 30000142, startedBy = DEC, startedAt = NOW - 95 * MIN,
        contrib = mapOf("$FIO" to Contribution(timers = 3, isk = 84_000_000, units = 12_400, systems = listOf(30000144)), "$DEC" to Contribution(timers = 2, isk = 151_500_000, units = 20_100, systems = listOf(30000142, 30000144))))
    private val history = listOf(WingSession("h1", WingStatus.EXPLORING, title = "Relic sites in Hek", startedAt = NOW - 26 * 60 * MIN, endedAt = NOW - 23 * 60 * MIN, totals = SessionTotals(412_000_000, 0, 4, 11)))

    @Test fun flyingTogether() = paparazzi.echelon {
        WingScreen(WingUi(Pilot.Fiofka, WingChannel.Status.Connected, mapOf(DEC to Presence(DEC, true, 2)), feed(pings, plans), here = "Perimeter", systemName = NAMES::get, canSend = true,
            statuses = statuses, jumps = 1, jumpsToMateDestination = 2, sharing = true, activity = WingStatus.MINING, myRoute = listOf(30000144, 30000142),
            session = session, history = history), NOW, WingActions(), scroll = false)
    }

    @Test fun sameSystemNoSessionNotificationsOff() = paparazzi.echelon(pilot = PilotColors.Decxus) {
        val st = mapOf(FIO to WingStatus(system = 30002053, docked = false, ship = "Astero", activity = WingStatus.EXPLORING, pilot = FIO, at = NOW - 2 * MIN))
        WingScreen(WingUi(Pilot.Decxus, WingChannel.Status.Connected, mapOf(FIO to Presence(FIO, true)), emptyList(), systemName = NAMES::get, canSend = true,
            statuses = st, jumps = 0, sharing = false, activity = WingStatus.EXPLORING, goal = "300m", history = history, notificationsOff = true), NOW, WingActions(), scroll = false)
    }

    @Test fun indicator() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            WingIndicator(WingIndicatorState(Link.Live, Pilot.Decxus, mateOnline = true, jumps = 3, session = true))
            WingIndicator(WingIndicatorState(Link.Live, Pilot.Decxus, mateOnline = true, jumps = 0))
            WingIndicator(WingIndicatorState(Link.Live, Pilot.Fiofka, mateOnline = false))
            WingIndicator(WingIndicatorState(Link.Retrying, Pilot.Decxus, queued = 2))
            WingIndicator(WingIndicatorState(Link.Refused, Pilot.Decxus))
            WingIndicator(WingIndicatorState(Link.Off, null))
        }
    }
}
