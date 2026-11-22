package com.echelon.eve.core.wing

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SolarSystem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.random.Random

private const val NOW = 1_800_000_000_000L
private val FIO = Pilot.Fiofka.id
private val DEC = Pilot.Decxus.id
private const val JITA = 30000142L
private const val PERIMETER = 30000144L
private const val AMARR = 30002187L

/** Live status, acknowledgements and sessions: frames as worker/wingroom.js sends them, and the channel's folding of them. */
class WingCoordinationTest {
    private lateinit var server: MockWebServer
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val channels = CopyOnWriteArrayList<WingChannel>()
    private val snapshot = """{"type":"state","id":"s1","from":0,"at":$NOW,"timers":[],
        "items":[{"type":"ping","id":"p1","from":$DEC,"at":${NOW - 60_000},"kind":"help","acks":{"$FIO":{"kind":"seen","at":${NOW - 30_000}}}},
                 {"type":"ping","id":"p2","from":$FIO,"at":${NOW - 50_000},"kind":"omw","acks":{"$DEC":{"kind":"onit","at":${NOW - 20_000}}}}],
        "presence":[],
        "statuses":[{"share":true,"activity":"mining","system":$JITA,"docked":false,"shipType":17478,"ship":"Retriever","destination":$AMARR,"route":[$JITA,$PERIMETER,$AMARR],"pilot":$DEC,"name":"Decxus","at":$NOW}],
        "session":{"id":"sx","activity":"mining","goal":500000000,"startedBy":$DEC,"startedAt":${NOW - 600_000},"contrib":{"$DEC":{"timers":2,"isk":120000000,"units":9000,"systems":[$JITA]}}},
        "sessions":[{"id":"old","activity":"hauling","startedBy":$FIO,"startedAt":${NOW - 86_400_000},"contrib":{},"endedAt":${NOW - 80_000_000},"endedBy":$FIO,"totals":{"isk":5,"units":0,"timers":1,"systems":3}}]}"""
    private lateinit var room: FakeRoom

    @Before fun setUp() { server = MockWebServer().apply { start() }; room = FakeRoom(snapshot) }
    @After fun tearDown() {
        channels.forEach { it.release(WingChannel.FOREGROUND) }
        room.sockets.forEach { runCatching { it.close(1000, null) } }
        scope.cancel(); server.close()
    }

    private fun channel(token: String? = "t".repeat(43)) = WingChannel(OkHttpClient(), server.url("/"), scope, identity = { token?.let { Pilot.Fiofka to it } },
        clock = { NOW }, backoff = Backoff(baseMs = 50, maxMs = 200, random = Random(1))).also { channels += it }
    private fun <T> await(block: suspend () -> T): T = runBlocking { withTimeout(5_000) { block() } }
    private fun connected(): WingChannel {
        server.enqueue(room.upgrade())
        val ch = channel(); ch.hold(WingChannel.FOREGROUND)
        await { ch.status.first { it == WingChannel.Status.Connected } }
        room.next() // presence
        return ch
    }

    @Test fun theSnapshotCarriesStatusesAnswersAndSessions() {
        val ch = connected()
        val dec = ch.statuses.value.getValue(DEC)
        assertEquals(listOf("mining", JITA, false, "Retriever", AMARR), listOf(dec.activity, dec.system, dec.docked, dec.ship, dec.destination))
        assertEquals(listOf(JITA, PERIMETER, AMARR), dec.route)
        assertEquals(WingAck.SEEN, ch.pings.value.first { it.id == "p1" }.acks.getValue(FIO).kind)
        assertEquals(WingAck.ONIT, ch.pings.value.first { it.id == "p2" }.acks.getValue(DEC).kind)
        val s = ch.session.value!!
        assertEquals(listOf("sx", "mining", 500_000_000L), listOf(s.id, s.activity, s.goal))
        assertEquals(120_000_000L, s.of(DEC).isk); assertEquals(0, s.of(FIO).timers)
        assertEquals(SessionTotals(120_000_000L, 9000, 2, 1), s.sum)
        assertEquals("old", ch.sessionHistory.value.single().id); assertEquals(3, ch.sessionHistory.value.single().sum.systems)
    }

    @Test fun statusAnswersAndSessionsGoOutAndComeBack() {
        val ch = connected()
        // Live status: sent without the room's own fields; shown at once as this pilot's.
        ch.publishStatus(Pilot.Fiofka, WingStatus(system = PERIMETER, docked = true, activity = WingStatus.HAULING, route = listOf(PERIMETER, JITA), destination = JITA))
        val st = room.next()
        assertEquals("status", st["type"])
        val body = Json.parseToJsonElement(st.getValue("status")).jsonObject
        assertEquals(setOf("share", "system", "docked", "activity", "destination", "route"), body.keys)
        assertEquals(2, body.getValue("route").jsonArray.size)
        assertEquals(PERIMETER, ch.statuses.value.getValue(FIO).system)
        // Stopping: {share:false}, and this pilot's status is gone here too.
        ch.publishStatus(Pilot.Fiofka, null)
        assertEquals("""{"share":false}""", room.next()["status"])
        assertFalse(FIO in ch.statuses.value)
        // An answer applies here at once; a later "seen" does not replace it.
        ch.ack(Pilot.Fiofka, "p1", WingAck.ONIT)
        room.next().let { assertEquals(listOf("ack", "p1", "onit"), listOf(it["type"], it["ref"], it["kind"])) }
        ch.ack(Pilot.Fiofka, "p1", WingAck.SEEN); room.next()
        assertEquals(WingAck.ONIT, ch.pings.value.first { it.id == "p1" }.acks.getValue(FIO).kind)
        // Sessions: the start, a contribution and the end go out in the room's shapes.
        ch.startSession(Pilot.Fiofka, SessionPlan(WingStatus.MINING, goal = 300_000_000, where = JITA))
        Json.parseToJsonElement(room.next().getValue("session")).jsonObject.let { assertEquals(setOf("activity", "goal", "where"), it.keys) }
        ch.reportContribution(Pilot.Fiofka, isk = 42, units = 7)
        assertEquals("""{"isk":42,"units":7}""", room.next()["contrib"])
        ch.endSession(Pilot.Fiofka)
        room.next().let { assertEquals("session.end", it["type"]); assertEquals("""{"id":"sx"}""", it["session"]) }
        // The wingmate's live frames.
        val ws = room.sockets.single()
        ws.send("""{"type":"status","id":"a","from":$DEC,"at":${NOW + 1},"status":{"share":true,"activity":"exploring","system":$AMARR,"pilot":$DEC,"name":"Decxus","at":${NOW + 1}}}""")
        ws.send("""{"type":"ack","id":"b","from":$DEC,"at":${NOW + 2},"ref":"p2","kind":"cant"}""")
        ws.send("""{"type":"session.end","id":"c","from":$FIO,"at":${NOW + 3},"session":{"id":"sx","activity":"mining","startedBy":$DEC,"startedAt":${NOW - 600_000},"contrib":{},"endedAt":${NOW + 3},"endedBy":$FIO,"totals":{"isk":9,"units":1,"timers":2,"systems":4}}}""")
        await { ch.session.first { it == null } }
        assertEquals(AMARR, ch.statuses.value.getValue(DEC).system)
        assertEquals(WingAck.CANT, ch.pings.value.first { it.id == "p2" }.acks.getValue(DEC).kind)
        assertEquals(listOf("sx", "old"), ch.sessionHistory.value.map { it.id })
        assertEquals(4, ch.sessionHistory.value.first().sum.systems)
        ws.send("""{"type":"status","id":"d","from":$DEC,"at":${NOW + 4},"status":null}""")
        await { ch.statuses.first { DEC !in it } }
    }

    @Test fun onlyTheLatestStatusWaitsInTheOutbox() {
        val ch = channel(token = null) // nobody signed in: everything queues
        ch.publishStatus(Pilot.Fiofka, WingStatus(system = JITA))
        ch.ping(Pilot.Fiofka, WingPing(WingPing.OMW))
        ch.publishStatus(Pilot.Fiofka, WingStatus(system = AMARR))
        ch.reportContribution(Pilot.Fiofka, isk = 1); ch.reportContribution(Pilot.Fiofka, isk = 2)
        assertEquals(3, ch.pending.value)
    }

    @Test fun lateOrStaleSessionFramesDoNotUndoNewerOnes() {
        val ch = channel(token = null)
        val newer = WingSession("new", "pvp", startedAt = NOW)
        ch.apply(WingMessage.SessionEvent("1", FIO, NOW, "start", newer))
        // The room ended a forgotten session as it started this one: it goes to history, the new one stays.
        ch.apply(WingMessage.SessionEvent("2", FIO, NOW, "end", WingSession("forgotten", "mining", startedAt = NOW - 2 * 86_400_000, endedAt = NOW)))
        assertEquals("new", ch.session.value?.id)
        ch.apply(WingMessage.SessionEvent("3", FIO, NOW, "start", WingSession("older", "mining", startedAt = NOW - 1000)))
        assertEquals("new", ch.session.value?.id)
        ch.apply(WingMessage.SessionEvent("4", FIO, NOW, "end", newer.copy(endedAt = NOW + 5)))
        ch.apply(WingMessage.SessionEvent("5", FIO, NOW, "update", newer))
        assertNull("an update after the end does not bring it back", ch.session.value)
    }

    @Test fun codecReadsTheNewTypesAndSkipsBrokenOnes() {
        val s = WingCodec.decode("""{"type":"session.update","id":"u","from":$DEC,"at":1,"session":{"id":"x","activity":"ratting","startedAt":5,"contrib":{"$FIO":{"timers":1,"isk":-20,"units":0,"systems":[]}}}}""") as WingMessage.SessionEvent
        assertEquals("update", s.phase); assertEquals(-20L, s.session.of(FIO).isk)
        assertEquals("session.update", WingCodec.typeOf(s))
        assertNull(WingCodec.decode("""{"type":"session.start","id":"u","from":$DEC,"at":1,"session":{"nope":1}}"""))
        assertNull(WingCodec.decode("""{"type":"ack","id":"a","from":$DEC,"at":1,"kind":"seen"}"""))
        assertNull((WingCodec.decode("""{"type":"status","id":"a","from":$DEC,"at":1,"status":{"share":false}}""") as WingMessage.StatusUpdate).status)
        val plan = WingCodec.decode("""{"type":"plan.share","id":"pl","from":$DEC,"at":1,"plan":{"kind":"haul","title":"T"},"acks":{"$FIO":{"kind":"onit","at":3},"bad":{"kind":"x"}}}""") as WingMessage.PlanShare
        assertEquals(mapOf(FIO to WingAck("onit", 3)), plan.acks)
        // An old room's snapshot (no statuses, session or sessions) still reads.
        val old = WingCodec.decode("""{"type":"state","id":"s","from":0,"at":1,"timers":[],"items":[],"presence":[]}""") as WingMessage.State
        assertTrue(old.statuses.isEmpty()); assertNull(old.session); assertTrue(old.sessions.isEmpty())
    }

    @Test fun jumpsByGateLinks() {
        fun sys(id: Long, vararg links: Long) = id to SolarSystem(id, "S$id", 0.5, 1, links.toList(), 0, null)
        val map = mapOf(sys(1, 2), sys(2, 1, 3), sys(3, 2, 4), sys(4, 3), sys(9))
        assertEquals(0, jumpsBetween(map, 1, 1)); assertEquals(3, jumpsBetween(map, 1, 4)); assertEquals(1, jumpsBetween(map, 3, 2))
        assertNull(jumpsBetween(map, 1, 9)); assertNull(jumpsBetween(map, 1, 77)); assertNull(jumpsBetween(map, null, 1))
        assertNull("beyond the cap", jumpsBetween(map, 1, 4, max = 2))
        assertEquals(listOf(3L, 4L), routeLeft(listOf(1, 2, 3, 4), 2)); assertEquals(listOf(1L, 2L), routeLeft(listOf(1, 2), 7)); assertEquals(emptyList<Long>(), routeLeft(listOf(1, 2), 2))
    }
}
