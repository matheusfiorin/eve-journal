package com.echelon.eve.core.wing

import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.random.Random

private val TOKEN = "t".repeat(43)
private const val NOW = 1_800_000_000_000L
private val FIO = Pilot.Fiofka.id
private val DEC = Pilot.Decxus.id

/**
 * A fake wing room: each connection gets the snapshot first, then the test can push frames. It records what the app
 * sent and the Authorization header of each upgrade.
 */
class FakeRoom(private val snapshot: String) {
    val received = LinkedBlockingQueue<String>()
    val auth = CopyOnWriteArrayList<String?>()
    val sockets = CopyOnWriteArrayList<WebSocket>()
    fun upgrade(): MockResponse = MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) { sockets += webSocket; webSocket.send(snapshot) }
        override fun onMessage(webSocket: WebSocket, text: String) { received += text }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, null) }
    }).build()
    fun next(): Map<String, String> = Json.parseToJsonElement(received.poll(5, TimeUnit.SECONDS) ?: error("nothing received")).jsonObject.mapValues { it.value.toString().trim('"') }
}

class WingChannelTest {
    private lateinit var server: MockWebServer
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val dropped = CopyOnWriteArrayList<String>()
    private val snapshot = """{"type":"state","id":"s1","from":0,"at":$NOW,
        "timers":[{"id":"gas1","kind":"gas","label":"Gas site","startedAt":${NOW - 180_000},"durationMs":900000,"owner":$DEC,"shared":true,"meta":{"site":"Barren Perimeter Reservoir"}},
                  {"id":"old","kind":"generic","label":"Long gone","startedAt":${NOW - 3 * 86_400_000L},"durationMs":60000,"owner":$FIO}],
        "items":[{"type":"ping","id":"p1","from":$DEC,"at":${NOW - 60_000},"kind":"omw"},
                 {"type":"plan.share","id":"pl1","from":$DEC,"at":${NOW - 30_000},"plan":{"kind":"haul","title":"Jita to Amarr","route":[30000142,30000144,30003504,30002187]}},
                 {"type":"something.new","id":"x","from":$DEC,"at":1}],
        "presence":[{"pilot":$DEC,"online":true,"timers":1,"at":$NOW}]}"""
    private lateinit var room: FakeRoom

    @Before fun setUp() { server = MockWebServer().apply { start() }; room = FakeRoom(snapshot) }
    private val channels = CopyOnWriteArrayList<WingChannel>()
    @After fun tearDown() {
        channels.forEach { it.release(WingChannel.FOREGROUND); it.release(WingChannel.TIMER_SERVICE) }
        room.sockets.forEach { runCatching { it.close(1000, null) } }
        scope.cancel(); server.close()
    }

    private fun channel(token: String? = TOKEN) = WingChannel(OkHttpClient(), server.url("/"), scope, identity = { token?.let { Pilot.Fiofka to it } },
        onUnauthorized = { dropped += it }, clock = { NOW }, backoff = Backoff(baseMs = 50, maxMs = 200, random = Random(1))).also { channels += it }

    private fun <T> await(block: suspend () -> T): T = runBlocking { withTimeout(5_000) { block() } }

    @Test fun connectsWithTheBearerTokenAndFoldsTheSnapshot() {
        server.enqueue(room.upgrade())
        val ch = channel()
        ch.hold(WingChannel.FOREGROUND)
        await { ch.status.first { it == WingChannel.Status.Connected } }
        await { ch.timers.first { it.isNotEmpty() } }
        val request = server.takeRequest()
        assertEquals("/api/wing/socket", request.url.encodedPath)
        assertEquals("Bearer $TOKEN", request.headers["Authorization"])
        // The day-old timer is the room's to expire; the wingmate's gas timer is shown with 12 minutes left.
        assertEquals(setOf("gas1"), ch.timers.value.keys)
        assertEquals(720_000L, ch.timers.value.getValue("gas1").remaining(NOW))
        assertEquals(Pilot.Decxus, ch.pings.value.single().from)
        assertEquals("omw", ch.pings.value.single().value.kind)
        assertEquals(listOf(30000142L, 30000144L, 30003504L, 30002187L), ch.plans.value.single().value.route)
        assertTrue(ch.presence.value.getValue(DEC).online)
        // On connect the app says it is here, with its own running timer count.
        val presence = room.next()
        assertEquals("presence", presence["type"]); assertEquals(FIO.toString(), presence["from"]); assertEquals("true", presence["online"])
    }

    @Test fun sendsTimersAndPingsAndAppliesLiveMessages() {
        server.enqueue(room.upgrade())
        val ch = channel()
        ch.hold(WingChannel.FOREGROUND)
        await { ch.status.first { it == WingChannel.Status.Connected } }
        room.next() // presence
        val timer = WingTimer("t2", "mining", "Cycle", NOW, 180_000, owner = FIO)
        assertTrue(ch.upsertTimer(timer))
        val sent = room.next()
        assertEquals("timer.upsert", sent["type"])
        assertEquals("t2", Json.parseToJsonElement(sent.getValue("timer")).jsonObject["id"]!!.jsonPrimitive.content)
        assertTrue("t2" in ch.timers.value)
        ch.ping(Pilot.Fiofka, WingPing(WingPing.UNDOCK))
        assertEquals("undock", room.next()["kind"])
        // The wingmate removes their gas timer and pings for help.
        room.sockets.single().send("""{"type":"timer.remove","id":"r1","from":$DEC,"at":$NOW,"timer":{"id":"gas1"}}""")
        room.sockets.single().send("""{"type":"ping","id":"p2","from":$DEC,"at":${NOW + 1},"kind":"help","text":"Tackled"}""")
        await { ch.pings.first { it.size == 2 } }
        assertFalse("gas1" in ch.timers.value)
        assertEquals("help", ch.pings.value.first().value.kind)
    }

    @Test fun queuesWhileDisconnectedAndReconnectsWithBackoff() {
        val ch = channel()
        ch.upsertTimer(WingTimer("queued", "cyno", "Cyno", NOW, 60_000, owner = FIO)) // no hold yet: queued
        server.enqueue(MockResponse.Builder().code(503).build()) // the first try fails
        server.enqueue(room.upgrade())
        ch.hold(WingChannel.TIMER_SERVICE)
        await { ch.status.first { it == WingChannel.Status.Connected } }
        assertEquals(2, server.requestCount)
        assertEquals("presence", room.next()["type"])
        assertEquals("timer.upsert", room.next()["type"]) // the queued timer goes out after the presence
        // The room drops the connection: the channel comes back by itself.
        server.enqueue(room.upgrade())
        room.sockets.first().close(1001, "going away")
        await { ch.status.first { it is WingChannel.Status.Retrying } }
        await { ch.status.first { it == WingChannel.Status.Connected } }
        assertEquals(3, server.requestCount)
    }

    @Test fun releasingTheLastHoldCloses() {
        server.enqueue(room.upgrade())
        val ch = channel()
        ch.hold(WingChannel.FOREGROUND); ch.onTimerServiceStarted()
        await { ch.status.first { it == WingChannel.Status.Connected } }
        ch.release(WingChannel.FOREGROUND)
        assertEquals(WingChannel.Status.Connected, ch.status.value) // the timer service still holds it
        ch.onTimerServiceStopped()
        assertEquals(WingChannel.Status.Idle, ch.status.value)
        Thread.sleep(300)
        assertEquals(1, server.requestCount) // and it does not come back on its own
    }

    @Test fun aRefusedSessionStopsRetryingAndDropsThatToken() {
        server.enqueue(MockResponse.Builder().code(401).body("""{"error":"This dashboard session expired."}""").build())
        val ch = channel()
        ch.hold(WingChannel.FOREGROUND)
        await { ch.status.first { it == WingChannel.Status.Unauthorized } }
        assertEquals(listOf(TOKEN), dropped)
        Thread.sleep(300)
        assertEquals(1, server.requestCount)
    }

    @Test fun nobodySignedInMeansNoConnection() {
        val ch = channel(token = null)
        ch.hold(WingChannel.FOREGROUND)
        Thread.sleep(200)
        assertEquals(WingChannel.Status.Idle, ch.status.value)
        assertEquals(0, server.requestCount)
    }

    @Test fun codecRoundTripsAndSkipsWhatItDoesNotKnow() {
        val m = WingMessage.TimerUpsert("i", FIO, NOW, WingTimer("a", "gas", "Gas", NOW, 1000, pausedAt = NOW + 10, owner = FIO))
        assertEquals(m, WingCodec.decode(WingCodec.encode(m)))
        val ping = WingMessage.Ping("p", DEC, NOW, WingPing(WingPing.CUSTOM, "Bring nanite paste", system = 30000142))
        assertEquals(ping, WingCodec.decode(WingCodec.encode(ping)))
        assertNull(WingCodec.decode("""{"type":"later.feature","id":"x"}"""))
        assertNull(WingCodec.decode("not json"))
        assertEquals(990L, (WingCodec.decode(WingCodec.encode(m)) as WingMessage.TimerUpsert).timer.remaining(NOW + 5000)) // paused keeps its time
    }
}
