package com.echelon.eve.core.wing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Frames exactly as worker/wingroom.js sends them, so the app and the room can't drift apart. */
class WingContractTest {
    @Test fun roomPresenceBroadcastIsTheWholeList() {
        val m = WingCodec.decode("""{"type":"presence","from":0,"at":1,"presence":[{"pilot":2124810474,"name":"Fiofka","online":true,"timers":1},{"pilot":2124815118,"name":"Decxus","online":true,"timers":0}]}""")
        assertTrue(m is WingMessage.PresenceUpdate)
        val list = (m as WingMessage.PresenceUpdate).list!!
        assertEquals(listOf(2124810474L, 2124815118L), list.map { it.pilot })
        assertEquals(1, list[0].timers)
    }
    @Test fun roomErrorsCarryACode() {
        val m = WingCodec.decode("""{"type":"error","from":0,"at":1,"code":"not your timer"}""") as WingMessage.Error
        assertEquals("not your timer", m.message)
    }
    @Test fun roomPingAndTimerFrames() {
        val p = WingCodec.decode("""{"type":"ping","id":"a","from":2124815118,"at":5,"kind":"undock","text":"going"}""") as WingMessage.Ping
        assertEquals("undock", p.ping.kind)
        val t = WingCodec.decode("""{"type":"timer.upsert","id":"b","from":2124810474,"at":5,"timer":{"id":"t1","kind":"gas","label":"Gas site","startedAt":1,"durationMs":900000,"owner":2124810474,"shared":true,"meta":{}}}""") as WingMessage.TimerUpsert
        assertEquals(900000L, t.timer.durationMs)
        val r = WingCodec.decode("""{"type":"timer.remove","id":"c","from":2124810474,"at":6,"timer":{"id":"t1","owner":2124810474}}""") as WingMessage.TimerRemove
        assertEquals("t1", r.timerId)
    }
}
