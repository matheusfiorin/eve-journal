package com.echelon.eve.core.wing

import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random

private val TOKEN = "t".repeat(43)
private const val NOW = 1_800_000_000_000L

/** Reconnect and battery: how the room's socket backs off, what keeps it open, and that it closes when nothing wants it. */
class WingReconnectTest {
    // ---- Backoff ----

    @Test fun backoffDoublesFromTheBaseToTheCapWithJitterAndNeverPastTheCap() {
        val b = Backoff(1_000, 60_000, Random(7))
        val steps = (0 until 12).map { 1_000L shl it }.map { minOf(it, 60_000L) }
        for (step in steps) {
            val d = b.next()
            assertTrue("$d is within ±20% of $step", d >= (step * 0.8).toLong() - 1 && d <= minOf(60_000L, (step * 1.2).toLong() + 1))
            assertTrue("never beyond the cap, whatever the jitter: $d", d <= 60_000)
        }
        repeat(200) { assertTrue(b.next() in 48_000..60_000) } // a dead room is tried about once a minute, for as long as it stays dead
    }

    @Test fun backoffJitterSpreadsTwoPhonesApart() {
        val a = Backoff(random = Random(1)); val b = Backoff(random = Random(2))
        val delays = (0 until 6).map { a.next() to b.next() }
        assertTrue("the two phones do not retry in step", delays.any { it.first != it.second })
        assertEquals("a phone keeps the same schedule only by chance", 0, delays.count { it.first == it.second })
    }

    @Test fun backoffStartsOverAfterReset() {
        val b = Backoff(1_000, 60_000, Random(3))
        repeat(8) { b.next() }
        assertEquals(8, b.attempts)
        b.reset(); assertEquals(0, b.attempts)
        assertTrue(b.next() in 800..1_200)
    }

    @Test fun anAbsurdNumberOfFailuresDoesNotOverflowTheShift() {
        val b = Backoff(1_000, 60_000, Random(3))
        repeat(1_000) { assertTrue(b.next() in 1..60_000) }
    }

    // ---- The channel ----

    private lateinit var server: MockWebServer
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val channels = CopyOnWriteArrayList<WingChannel>()
    private val sockets = CopyOnWriteArrayList<WebSocket>()
    private val closes = CopyOnWriteArrayList<Pair<Int, String>>()
    private val opened = CountDownLatch(1)

    @Before fun setUp() { server = MockWebServer().apply { start() } }
    @After fun tearDown() {
        channels.forEach { it.release(WingChannel.FOREGROUND); it.release(WingChannel.TIMER_SERVICE) }
        sockets.forEach { runCatching { it.cancel() } }
        scope.cancel(); server.close()
    }

    private val snapshot = """{"type":"state","id":"s","from":0,"at":$NOW,"timers":[],"items":[],"presence":[]}"""
    private fun upgrade(snapshot: String? = this.snapshot, dropAfterMs: Long? = null) = MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            sockets += webSocket; opened.countDown()
            snapshot?.let { webSocket.send(it) }
            dropAfterMs?.let { ms -> Thread { Thread.sleep(ms); webSocket.close(1012, "restarting") }.start() }
        }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { closes += code to reason; webSocket.close(code, null) }
    }).build()

    private fun channel(backoff: Backoff = Backoff(50, 200, Random(1)), uptime: () -> Long = { System.nanoTime() / 1_000_000 }, heartbeatMs: Long = WingChannel.HEARTBEAT_MS, stableMs: Long = WingChannel.STABLE_MS) =
        WingChannel(OkHttpClient(), server.url("/"), scope, identity = { Pilot.Fiofka to TOKEN }, clock = { NOW }, backoff = backoff, heartbeatMs = heartbeatMs, stableMs = stableMs, uptime = uptime).also { channels += it }

    private fun <T> await(block: suspend () -> T): T = runBlocking { withTimeout(5_000) { block() } }

    @Test fun theSocketHasAHeartbeatSoADeadConnectionIsFoundAndRetried() {
        val ch = channel()
        assertEquals(25_000, ch.socketClient.pingIntervalMillis)
        assertEquals("the heartbeat is the channel's own; the app's shared client is not changed", 0, OkHttpClient().pingIntervalMillis)
        // A beating connection stays up: the pongs come back, nothing is retried.
        server.enqueue(upgrade())
        val quick = channel(heartbeatMs = 100)
        quick.hold(WingChannel.FOREGROUND)
        await { quick.status.first { it == WingChannel.Status.Connected } }
        Thread.sleep(600)
        assertEquals(WingChannel.Status.Connected, quick.status.value)
        assertEquals(1, server.requestCount)
    }

    @Test fun closesWhenNothingHoldsItAndTheRoomIsToldGoodbye() {
        server.enqueue(upgrade())
        val ch = channel()
        ch.hold(WingChannel.FOREGROUND); ch.hold(WingChannel.TIMER_SERVICE)
        await { ch.status.first { it == WingChannel.Status.Connected } }
        ch.release(WingChannel.FOREGROUND)
        assertEquals("the timer service still wants the room", WingChannel.Status.Connected, ch.status.value)
        ch.release(WingChannel.TIMER_SERVICE)
        assertEquals(WingChannel.Status.Idle, ch.status.value)
        val deadline = System.currentTimeMillis() + 3_000
        while (closes.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(20)
        assertEquals(listOf(1000 to "app closed"), closes.toList())
        Thread.sleep(400)
        assertEquals("and it does not come back", 1, server.requestCount)
    }

    @Test fun releasingWhileTheLinkIsStillBeingMadeCancelsIt() {
        // The room never answers the upgrade: the channel is Connecting. Letting go must not leave a socket behind that connects later.
        server.enqueue(MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {}).headersDelay(1, TimeUnit.SECONDS).build())
        val ch = channel()
        ch.hold(WingChannel.FOREGROUND)
        assertEquals(WingChannel.Status.Connecting, ch.status.value)
        ch.release(WingChannel.FOREGROUND)
        assertEquals(WingChannel.Status.Idle, ch.status.value)
        Thread.sleep(1_800)
        assertEquals(WingChannel.Status.Idle, ch.status.value)
        assertTrue("one try at most, and no second", server.requestCount <= 1)
    }

    @Test fun releasingDuringAnOutageStopsTheRetries() {
        repeat(5) { server.enqueue(MockResponse.Builder().code(503).build()) }
        val ch = channel(Backoff(100, 100, Random(1)))
        ch.hold(WingChannel.FOREGROUND)
        await { ch.status.first { it is WingChannel.Status.Retrying } }
        ch.release(WingChannel.FOREGROUND)
        assertEquals(WingChannel.Status.Idle, ch.status.value)
        val seen = server.requestCount
        Thread.sleep(500)
        assertEquals("no timer left running with nothing holding the socket", seen, server.requestCount)
    }

    @Test fun retriesAreSpacedByTheBackoffNotTight() {
        repeat(4) { server.enqueue(MockResponse.Builder().code(503).build()) }
        val ch = channel(Backoff(100, 400, Random(5)))
        ch.hold(WingChannel.FOREGROUND)
        Thread.sleep(700)
        // 100, 200, 400... with jitter: in 700 ms there can be at most 4 tries (0, ~100, ~300, ~700), never a tight loop.
        assertTrue("tries: ${server.requestCount}", server.requestCount in 2..4)
        val reason = (ch.status.value as? WingChannel.Status.Retrying)?.reason
        assertTrue(reason, ch.status.value is WingChannel.Status.Retrying || ch.status.value == WingChannel.Status.Connecting)
        assertFalse(reason == null && ch.status.value is WingChannel.Status.Retrying)
    }

    @Test fun aRoomThatAcceptsAndDropsAtOnceIsNotHammered() {
        // Each connection lives 30 ms (shorter than the stable time), so the delays keep growing instead of starting over.
        repeat(4) { server.enqueue(upgrade(dropAfterMs = 30)) }
        val backoff = Backoff(100, 100_000, Random(2))
        val ch = channel(backoff, stableMs = 10_000)
        ch.hold(WingChannel.FOREGROUND)
        Thread.sleep(1_500)
        assertTrue("attempts kept counting up: ${backoff.attempts}", backoff.attempts >= 3)
        assertTrue("and the tries were spread out: ${server.requestCount}", server.requestCount <= 5)
    }

    @Test fun aConnectionThatLastedStartsTheBackoffOver() {
        val now = AtomicLong(0)
        server.enqueue(upgrade(dropAfterMs = 200)); server.enqueue(upgrade())
        val backoff = Backoff(50, 100_000, Random(2))
        repeat(5) { backoff.next() } // an earlier outage had pushed the delay up
        val ch = channel(backoff, uptime = { now.get() }, stableMs = 10_000)
        ch.hold(WingChannel.FOREGROUND)
        await { ch.status.first { it == WingChannel.Status.Connected } }
        now.addAndGet(60_000) // it stayed up a minute before the room restarted
        await { ch.status.first { it is WingChannel.Status.Retrying } }
        assertTrue("the wait is the first step again, not the sixth: ${(ch.status.value as WingChannel.Status.Retrying).inMs}", (ch.status.value as WingChannel.Status.Retrying).inMs <= 60)
        await { ch.status.first { it == WingChannel.Status.Connected } }
        assertEquals(2, server.requestCount)
    }

    @Test fun letGoAndWantedAgainStartsFresh() {
        repeat(3) { server.enqueue(MockResponse.Builder().code(503).build()) }
        val backoff = Backoff(50, 100_000, Random(2))
        val ch = channel(backoff)
        ch.hold(WingChannel.FOREGROUND)
        await { ch.status.first { it is WingChannel.Status.Retrying } }
        ch.release(WingChannel.FOREGROUND)
        assertEquals("backgrounding ends an old outage's story", 0, backoff.attempts)
    }

    @Test fun aRefusedSessionDoesNotRetryAtAll() {
        server.enqueue(MockResponse.Builder().code(401).build())
        val ch = channel()
        ch.hold(WingChannel.FOREGROUND)
        await { ch.status.first { it == WingChannel.Status.Unauthorized } }
        Thread.sleep(400)
        assertEquals(1, server.requestCount)
    }
}
