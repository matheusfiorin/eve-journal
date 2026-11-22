package com.echelon.eve.wing

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.Backoff
import com.echelon.eve.core.wing.FakeRoom
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/** The publisher against a fake room: nothing until the pilot opts in, then their status, a change at once, and a clear. */
class StatusPublisherTest {
    private val server = MockWebServer().apply { start() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // The room still holds a status of Fiofka's from an earlier run.
    private val room = FakeRoom("""{"type":"state","id":"s","from":0,"at":1,"timers":[],"items":[],"presence":[],"statuses":[{"share":true,"activity":"idle","system":30000142,"pilot":${Pilot.Fiofka.id},"at":1}]}""")
    private lateinit var channel: WingChannel

    @After fun tearDown() { channel.release(WingChannel.FOREGROUND); room.sockets.forEach { runCatching { it.close(1000, null) } }; scope.cancel(); server.close() }

    private fun frame(): Map<String, String>? = room.received.poll(3, TimeUnit.SECONDS)?.let { Json.parseToJsonElement(it).jsonObject.mapValues { e -> e.value.toString().trim('"') } }
    private fun nextStatus(): String { while (true) { val f = frame() ?: error("no status sent"); if (f["type"] == "status") return f.getValue("status") } }

    @Test fun optInPublishesChangesAndOptOutClears() {
        server.enqueue(room.upgrade())
        channel = WingChannel(OkHttpClient(), server.url("/"), scope, identity = { Pilot.Fiofka to "t".repeat(43) }, backoff = Backoff(50, 200, Random(1)))
        val settings = MemoryWingSettings()
        StatusPublisher(scope, channel, settings, MutableStateFlow(Pilot.Fiofka), where = { Whereabouts(30000144, false, 648, "Badger") }, everyMs = 60_000).start()
        channel.hold(WingChannel.FOREGROUND)
        runBlocking { withTimeout(5_000) { channel.status.first { it == WingChannel.Status.Connected } } }
        // Not sharing, but the room still had a status: it is cleared.
        assertEquals("""{"share":false}""", nextStatus())
        settings.setShareStatus(true)
        Json.parseToJsonElement(nextStatus()).jsonObject.let { assertEquals(listOf("30000144", "false", "Badger", "idle"), listOf("system", "docked", "ship", "activity").map { k -> it.getValue(k).jsonPrimitive.content }) }
        settings.setActivity(WingStatus.HAULING)
        settings.follow(listOf(30000144, 30000142))
        val followed = generateSequence { runCatching { nextStatus() }.getOrNull() }.map { Json.parseToJsonElement(it).jsonObject }.first { it["destination"] != null }
        assertEquals("hauling", followed.getValue("activity").jsonPrimitive.content)
        assertEquals("30000142", followed.getValue("destination").jsonPrimitive.content)
        settings.setShareStatus(false)
        assertEquals("""{"share":false}""", generateSequence { runCatching { nextStatus() }.getOrNull() }.first { it.contains("share\":false") })
        assertNull(channel.statuses.value[Pilot.Fiofka.id])
    }

    private fun WingSettings.follow(route: List<Long>) { setRoute(route); setShareRoute(true) }
}
