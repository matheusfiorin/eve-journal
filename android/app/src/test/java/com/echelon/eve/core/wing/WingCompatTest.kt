package com.echelon.eve.core.wing

import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import com.echelon.eve.core.wing.legacy.SharedPlan as OldPlan
import com.echelon.eve.core.wing.legacy.WingCodec as OldCodec
import com.echelon.eve.core.wing.legacy.WingMessage as OldMessage
import com.echelon.eve.core.wing.legacy.WingPing as OldPing
import com.echelon.eve.core.wing.legacy.WingTimer as OldTimer

private val FIO = Pilot.Fiofka.id
private val DEC = Pilot.Decxus.id
private const val NOW = 1_800_000_000_000L

/**
 * The wing room across app versions. [legacy.WingCodec] is the protocol exactly as merged in PR #4; the JSON files under
 * src/test/resources/wing are shared with tests/wingcompat.test.js, which proves the room still produces (room-frames.json,
 * push-data.json) and accepts (v1-client-frames.json) exactly these frames. So: the old app against today's room, and today's
 * app against a room that is older or newer than it.
 */
class WingCompatTest {
    private fun resource(name: String) = Json.parseToJsonElement(javaClass.getResourceAsStream("/wing/$name")!!.bufferedReader().readText()).jsonObject
    private val frames = resource("room-frames.json")
    private fun frame(name: String) = frames.getValue(name).toString()
    private val siteMeta = JsonObject(mapOf("site" to JsonPrimitive("Barren Perimeter Reservoir")))

    // ---- the app from PR #4 against today's room ----

    @Test fun theOldAppsFramesAreExactlyWhatTheRoomIsTestedWith() {
        // tests/wingcompat.test.js feeds these to the room; they must be exactly what the old app writes.
        val v1 = resource("v1-client-frames.json")
        val sent = mapOf(
            "timer.upsert" to OldMessage.TimerUpsert("c1", FIO, NOW, OldTimer("gas1", "gas", "Gas site", NOW, 900_000, owner = FIO, meta = siteMeta)),
            "timer.upsert.paused" to OldMessage.TimerUpsert("c2", FIO, NOW, OldTimer("gas1", "gas", "Gas site", NOW, 900_000, pausedAt = NOW + 60_000, owner = FIO)),
            "timer.remove" to OldMessage.TimerRemove("c3", FIO, NOW, "gas1"),
            "plan.share" to OldMessage.PlanShare("c4", FIO, NOW, OldPlan("haul", "Jita to Amarr", route = listOf(30000142, 30000144, 30002187))),
            "ping" to OldMessage.Ping("c5", FIO, NOW, OldPing(OldPing.CUSTOM, "Bring paste", 30000142)),
            "ping.plain" to OldMessage.Ping("c6", FIO, NOW, OldPing(OldPing.UNDOCK)),
            "presence" to OldMessage.PresenceUpdate("c7", FIO, NOW, true, 1),
        )
        assertEquals(v1.keys, sent.keys)
        for ((name, m) in sent) assertEquals(name, v1.getValue(name), Json.parseToJsonElement(OldCodec.encode(m)))
    }

    @Test fun theOldAppReadsTheRoomsSnapshotAndLiveFrames() {
        val state = OldCodec.decode(frame("state_rich")) as OldMessage.State
        assertEquals(listOf("gas2"), state.timers.map { it.id })
        assertEquals(2, state.presence.size)
        assertEquals(OldPing("help", "Tackled", 30000142), state.items.filterIsInstance<OldMessage.Ping>().single().ping)
        val plan = state.items.filterIsInstance<OldMessage.PlanShare>().single().plan
        assertEquals("Jita to Amarr", plan.title); assertEquals(listOf(30000142L, 30000144L, 30002187L), plan.route)
        // The first release's fields are still there, whatever was added.
        for (k in listOf("type", "from", "at", "timers", "items", "presence")) assertTrue("state.$k", k in frames.getValue("state_rich").jsonObject)
        // Live frames it knows are read as before...
        assertEquals("gas1", (OldCodec.decode(frame("timer.upsert")) as OldMessage.TimerUpsert).timer.id)
        assertEquals("gas1", (OldCodec.decode(frame("timer.remove")) as OldMessage.TimerRemove).timerId)
        assertEquals("help", (OldCodec.decode(frame("ping")) as OldMessage.Ping).ping.kind)
        assertEquals(2, (OldCodec.decode(frame("presence")) as OldMessage.PresenceUpdate).list!!.size)
        assertEquals("Jita to Amarr", (OldCodec.decode(frame("plan.share")) as OldMessage.PlanShare).plan.title)
        // ...and the ones added later are skipped without a crash, as an app that never heard of them must.
        for (later in listOf("status", "status_clear", "ack", "session.start", "session.update", "session.end")) assertNull(later, OldCodec.decode(frame(later)))
        assertTrue("the room's refusal of a type is harmless", OldCodec.decode(frame("error")) is OldMessage.Error)
        // Snapshots taken during and after a session read alike.
        assertEquals(2, (OldCodec.decode(frame("state_after")) as OldMessage.State).items.size)
    }

    // ---- today's app against a room that is older or newer ----

    private fun channel() = WingChannel(OkHttpClient(), "http://localhost/".toHttpUrl(), CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), identity = { null }, clock = { NOW })

    @Test fun theCurrentAppReadsTodaysFramesIncludingTheNewOnes() {
        val ch = channel()
        val state = WingCodec.decode(frame("state_rich")) as WingMessage.State
        assertEquals(WingCodec.PROTOCOL, state.proto)
        assertEquals("the room and the app agree on the revision", frames.getValue("state_rich").jsonObject.getValue("proto").jsonPrimitive.int, WingCodec.PROTOCOL)
        ch.apply(state)
        assertEquals(WingStatus.MINING, ch.statuses.value.getValue(FIO).activity)
        assertEquals(listOf(30000142L, 30000144L, 30002187L), ch.statuses.value.getValue(FIO).route)
        assertEquals(DEC, ch.session.value!!.startedBy)
        assertEquals(1_200_000L, ch.session.value!!.of(DEC).isk)
        assertEquals(WingAck.ONIT, ch.pings.value.single().acks.getValue(DEC).kind)
        for (later in listOf("status", "ack", "session.start", "session.update", "session.end", "status_clear")) assertNotNull(later, WingCodec.decode(frame(later)))
        ch.apply(WingCodec.decode(frame("session.end"))!!)
        assertNull(ch.session.value); assertEquals(1, ch.sessionHistory.value.size)
        assertEquals(50_000_000L, ch.sessionHistory.value.single().goal)
    }

    @Test fun anOlderRoomsSnapshotHasNoStatusesOrSessionsAndThatIsFine() {
        // What the room from PR #4 sends: timers, items, presence and nothing else.
        val old = """{"type":"state","from":0,"at":$NOW,"timers":[{"id":"gas1","kind":"gas","label":"Gas","startedAt":${NOW - 1000},"durationMs":900000,"owner":$DEC,"shared":true,"meta":{}}],
            "items":[{"type":"ping","id":"p1","from":$DEC,"at":$NOW,"kind":"omw"},{"type":"plan.share","id":"pl1","from":$DEC,"at":$NOW,"plan":{"kind":"sell","title":"Sell","summary":"","route":[]}}],
            "presence":[{"pilot":$DEC,"name":"Decxus","online":true,"timers":1}]}"""
        val state = WingCodec.decode(old) as WingMessage.State
        assertEquals("a room that sends no revision is revision 1", 1, state.proto)
        val ch = channel(); ch.apply(state)
        assertEquals(setOf("gas1"), ch.timers.value.keys)
        assertEquals(emptyMap<Long, WingStatus>(), ch.statuses.value); assertNull(ch.session.value); assertEquals(emptyList<WingSession>(), ch.sessionHistory.value)
        assertEquals(1, ch.pings.value.size); assertEquals(emptyMap<Long, WingAck>(), ch.pings.value.single().acks); assertEquals(1, ch.plans.value.size)
        // The old room answers a type it does not know (a status, say) with an error frame: it is read and changes nothing.
        val error = WingCodec.decode("""{"type":"error","from":0,"at":$NOW,"code":"unknown_type"}""") as WingMessage.Error
        assertEquals("unknown_type", error.message)
        ch.apply(error); assertEquals(setOf("gas1"), ch.timers.value.keys)
    }

    @Test fun aNewerRoomMayAddTypesFieldsAndValuesWithoutBreakingThisApp() {
        val future = """{"type":"state","from":0,"at":$NOW,"proto":3,"shiny":true,
            "timers":[{"id":"t1","kind":"warp.drive","label":"X","startedAt":${NOW - 10},"durationMs":60000,"owner":$FIO,"shared":true,"meta":{"a":[1,2]},"colour":"red"},{"id":"broken"},"junk"],
            "items":[{"type":"hologram","id":"h1","from":$DEC,"at":$NOW},
                     {"type":"ping","id":"p1","from":$DEC,"at":$NOW,"kind":"beer","text":"Pub?","mood":"keen","acks":{"$FIO":{"kind":"maybe","at":$NOW,"note":"x"},"zz":{"kind":"seen"},"$DEC":5}},
                     {"type":"plan.share","id":"pl1","from":$DEC,"at":$NOW,"plan":{"kind":"mine","title":"Belt","route":[1,2],"waypoints":{}}}],
            "presence":[{"pilot":$DEC,"online":true,"timers":2,"battery":50}],
            "statuses":[{"share":true,"activity":"diving","system":30000142,"mood":"ok","pilot":$DEC,"name":"Decxus","at":$NOW},{"share":"maybe"},7],
            "session":{"id":"s1","activity":"diving","startedAt":$NOW,"startedBy":$DEC,"crew":[1],"contrib":{"$DEC":{"isk":5,"fuel":9}}},
            "sessions":[{"id":"s0","activity":"mining","startedAt":1,"endedAt":2,"totals":{"isk":1,"gems":2}},"junk"]}"""
        val state = WingCodec.decode(future) as WingMessage.State
        assertEquals(3, state.proto)
        val ch = channel(); ch.apply(state)
        assertEquals("the malformed timers are skipped, the rest is kept", setOf("t1"), ch.timers.value.keys)
        assertEquals("beer", ch.pings.value.single().value.kind)
        assertEquals(1, ch.plans.value.size)
        assertEquals("an answer of a kind this app never heard of is kept as it is; a wrong shape is dropped", setOf(FIO), ch.pings.value.single().acks.keys)
        assertEquals("diving", ch.statuses.value.getValue(DEC).activity)
        assertEquals("diving", ch.session.value!!.activity); assertEquals(5L, ch.session.value!!.of(DEC).isk)
        assertEquals(listOf("s0"), ch.sessionHistory.value.map { it.id })
        // Live frames of types from the future are skipped before they reach the channel's state.
        for (later in listOf("""{"type":"teleport","id":"x","from":$DEC,"at":$NOW}""", """{"type":"status.v2","from":$DEC,"status":{}}""", """{"type":"session.pause","session":{"id":"s1","activity":"mining"}}""", """{"type":"ack","from":$DEC}""", """{"type":"timer.upsert"}""", "[]", ""))
            assertNull(later, WingCodec.decode(later))
        // A known type that arrives with something this app cannot read is skipped, not thrown.
        assertNull(WingCodec.decode("""{"type":"status","from":$DEC,"status":{"system":"Jita","activity":7}}"""))
    }

    @Test fun theCurrentAppWritesTheFramesOfTheFirstReleaseUnchanged() {
        // Frames both revisions have are written the way PR #4 wrote them, field for field, so an old room or an old wingmate is not confused.
        val v1 = resource("v1-client-frames.json")
        fun same(name: String, m: WingMessage) = assertEquals(name, v1.getValue(name), Json.parseToJsonElement(WingCodec.encode(m)))
        same("ping", WingMessage.Ping("c5", FIO, NOW, WingPing(WingPing.CUSTOM, "Bring paste", 30000142)))
        same("ping.plain", WingMessage.Ping("c6", FIO, NOW, WingPing(WingPing.UNDOCK)))
        same("presence", WingMessage.PresenceUpdate("c7", FIO, NOW, true, 1))
        same("timer.remove", WingMessage.TimerRemove("c3", FIO, NOW, "gas1"))
        same("plan.share", WingMessage.PlanShare("c4", FIO, NOW, SharedPlan("haul", "Jita to Amarr", route = listOf(30000142, 30000144, 30002187))))
        val timer = WingTimer("gas1", "gas", "Gas site", NOW, 900_000, owner = FIO, meta = siteMeta)
        same("timer.upsert", WingMessage.TimerUpsert("c1", FIO, NOW, timer))
        same("timer.upsert.paused", WingMessage.TimerUpsert("c2", FIO, NOW, timer.copy(pausedAt = NOW + 60_000, meta = JsonObject(emptyMap()))))
    }
}
