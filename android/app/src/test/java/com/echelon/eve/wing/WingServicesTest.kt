package com.echelon.eve.wing

import com.echelon.eve.core.model.LiveStatus
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.push.PushText
import com.echelon.eve.core.wing.Contribution
import com.echelon.eve.core.wing.Presence
import com.echelon.eve.core.wing.WingAck
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingMessage
import com.echelon.eve.core.wing.WingPing
import com.echelon.eve.core.wing.WingSession
import com.echelon.eve.core.wing.WingStatus
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private val FIO = Pilot.Fiofka.id
private val DEC = Pilot.Decxus.id
private const val JITA = 30000142L
private const val PERIMETER = 30000144L
private const val AMARR = 30002187L

class WingServicesTest {
    @Test fun theStatusSaysWhereAndInFollowModeWhatIsLeftOfTheRoute() {
        val w = Whereabouts.of(LiveStatus(system = PERIMETER, station = 60003760, shipType = 648, shipName = "Mule"), "Badger")
        assertEquals(Whereabouts(PERIMETER, true, 648, "Badger"), w)
        assertEquals("Mule", Whereabouts.of(LiveStatus(system = JITA, shipName = "Mule")).ship)
        assertNull("no system, no docked", Whereabouts.of(LiveStatus()).docked)
        val s = StatusPublisher.status(w, WingStatus.HAULING, listOf(JITA, PERIMETER, 30003504, AMARR))
        assertEquals(listOf(PERIMETER, 30003504L, AMARR), s.route)
        assertEquals(AMARR, s.destination)
        assertEquals(WingStatus.HAULING, s.activity)
        // Arrived: nothing left to follow.
        assertEquals(WingStatus(system = AMARR, activity = WingStatus.IDLE), StatusPublisher.status(Whereabouts(AMARR), WingStatus.IDLE, listOf(JITA, AMARR)))
        // Off the route: all of it is still ahead (a destination set from elsewhere).
        assertEquals(listOf(AMARR), StatusPublisher.status(Whereabouts(30000001), WingStatus.IDLE, listOf(AMARR)).route)
    }

    @Test fun aSessionCountsFromWhereThePilotStoodWhenTheirPhoneFirstSawIt() {
        val settings = MemoryWingSettings()
        val s = WingSession("s1", "mining", startedAt = 1)
        assertEquals(0L to 0L, SessionReporter.contribution(settings, s, Pilot.Fiofka, Ledger(1_000_000.0, 500)))
        assertEquals(-250_000L to 1500L, SessionReporter.contribution(settings, s, Pilot.Fiofka, Ledger(750_000.4, 2000)))
        // A trimmed ledger never makes units go negative; an unknown wallet reports no ISK.
        assertEquals(null to 0L, SessionReporter.contribution(settings, s, Pilot.Fiofka, Ledger(null, 10)))
        assertNull(SessionReporter.contribution(settings, s, Pilot.Decxus, Ledger()))
        assertEquals("each pilot has their own baseline", 0L to 0L, SessionReporter.contribution(settings, s, Pilot.Decxus, Ledger(5.0, 5)))
        val ledger = Ledger.of(Json.parseToJsonElement("123.5"), Json.parseToJsonElement("""[{"date":"2026-11-22","quantity":1000,"solar_system_id":1,"type_id":2},{"quantity":250},{"x":1}]"""))
        assertEquals(Ledger(123.5, 1250), ledger)
    }

    @Test fun settingsKeepOnlyKnownActivitiesAndAShortRoute() {
        val s = MemoryWingSettings()
        s.setActivity("afk"); assertEquals(WingStatus.IDLE, s.activity.value)
        s.setActivity(WingStatus.RATTING); assertEquals(WingStatus.RATTING, s.activity.value)
        s.setRoute((1L..100L).toList()); assertEquals(60, s.route.value.size)
        repeat(12) { s.setBaseline("k$it", Baseline(1.0, 1)) }
        assertNull("old baselines are dropped", s.baseline("k0")); assertEquals(Baseline(1.0, 1), s.baseline("k11"))
    }

    @Test fun backgroundAlertsForTheWingmatesCallsAnswersSessionsAndArrival() {
        val names = mapOf(JITA to "Jita")
        val a = WingAlerts(names::get)
        val me = Pilot.Fiofka
        assertEquals(WingAlert(PushText("Decxus", "Need help · Jita"), "ping-p1"), a.of(WingMessage.Ping("p1", DEC, 1, WingPing(WingPing.HELP, system = JITA)), me, null))
        assertNull("my own call is not news", a.of(WingMessage.Ping("p2", FIO, 1, WingPing(WingPing.HELP)), me, null))
        assertNull("seen is silent", a.of(WingMessage.Ack("a", DEC, 1, "p1", WingAck.SEEN), me, null))
        assertEquals(PushText("Decxus: On it", "Answering your call", updates = true), a.of(WingMessage.Ack("a", DEC, 1, "p1", WingAck.ONIT), me, null)!!.text)
        assertEquals("Decxus started a mining session", a.of(WingMessage.SessionEvent("s", DEC, 1, "start", WingSession("x", "mining")), me, null)!!.text.title)
        assertNull(a.of(WingMessage.SessionEvent("s", DEC, 1, "update", WingSession("x", "mining")), me, null))
        val end = WingSession("x", "mining", contrib = mapOf("$FIO" to Contribution(timers = 2, systems = listOf(JITA)), "$DEC" to Contribution(timers = 1, systems = listOf(JITA, AMARR))))
        assertEquals("2 systems, 3 timers between you", a.of(WingMessage.SessionEvent("s", DEC, 1, "end", end), me, null)!!.text.body)
        // Arrival in my system: once, until they leave and come back.
        val mine = WingStatus(system = JITA)
        val there = WingMessage.StatusUpdate("u", DEC, 1, WingStatus(system = JITA, pilot = DEC))
        assertEquals(WingAlert(PushText("Decxus is in Jita", "You are in the same system", updates = true), "nearby"), a.of(there, me, mine))
        assertNull(a.of(there, me, mine))
        assertNull(a.of(WingMessage.StatusUpdate("u", DEC, 1, WingStatus(system = AMARR)), me, mine))
        assertEquals("nearby", a.of(there, me, mine)?.tag)
        assertNull("my own status is unknown: no nudge", WingAlerts().of(there, me, null))
    }

    @Test fun theIndicatorSaysTheLinkTheWingmateTheDistanceAndTheQueue() {
        val st = mapOf(FIO to WingStatus(system = JITA), DEC to WingStatus(system = AMARR))
        fun of(status: WingChannel.Status, online: Boolean = true, queued: Int = 0, jumps: Int? = 9) =
            WingIndicatorState.of(status, Pilot.Fiofka, mapOf(DEC to Presence(DEC, online)), st, { a, b -> if (a == JITA && b == AMARR) jumps else null }, queued, session = false)
        of(WingChannel.Status.Connected).let { assertEquals("Decxus · 9j", it.label); assertEquals(com.echelon.eve.ui.components.Tone.Ok, it.tone); assertEquals("Wing room connected, Decxus online, 9 jumps apart", it.description) }
        assertEquals("Decxus · here", of(WingChannel.Status.Connected, jumps = 0).label)
        assertEquals("Decxus · away", of(WingChannel.Status.Connected, online = false).label)
        assertEquals("Reconnecting · 2 queued", of(WingChannel.Status.Retrying(1000, "x"), queued = 2).label)
        assertEquals("Sign in again", of(WingChannel.Status.Unauthorized).label)
        assertEquals(com.echelon.eve.ui.components.Tone.Danger, of(WingChannel.Status.Unauthorized).tone)
        assertEquals("Offline", WingIndicatorState.of(WingChannel.Status.Idle, null, emptyMap(), emptyMap(), { _, _ -> 1 }, 0, false).label)
    }

    @Test fun pushTextReadsTheRoomsNewShapeAndTheOldOnes() {
        // What the room sends now: type, kind, the sender's id as pilot and their name as from.
        assertEquals(PushText("Decxus", "Needs help"), PushText.of(mapOf("type" to "ping", "kind" to "ping", "ping" to "help", "pilot" to "$DEC", "from" to "Decxus")))
        // What older rooms sent: no type, the name in from.
        assertEquals(PushText("Decxus", "On my way"), PushText.of(mapOf("kind" to "ping", "ping" to "omw", "from" to "Decxus")))
        assertEquals(PushText("Fiofka started a timer", "Timer"), PushText.of(mapOf("kind" to "timer.start", "label" to "", "from" to "Fiofka")))
        assertEquals(PushText("Decxus: Can’t make it", "Answering “tackled”", updates = true), PushText.of(mapOf("type" to "ack", "ack" to "cant", "text" to "tackled", "pilot" to "$DEC")))
        assertEquals(PushText("Decxus started a mining session", "Open the Wing screen to join in", updates = true), PushText.of(mapOf("type" to "session.start", "activity" to "mining", "pilot" to "$DEC")))
        assertEquals("Fiofka ended the session", PushText.of(mapOf("type" to "session.end", "from" to "Fiofka"))?.title)
    }
}
