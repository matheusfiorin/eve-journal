package com.echelon.eve.core.model

import com.echelon.eve.core.api.EchelonJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The exact shape worker/index.js liveRead returns, so the app and the backend can't drift apart again. */
class LiveStatusTest {
    @Test fun decodesTheWorkerPayload() {
        val json = """{"system":30000142,"station":60003760,"structure":null,"shipType":16236,"shipItem":1001,"shipName":"Hauler one",
            "online":{"online":true,"lastLogin":"2026-11-21T10:00:00Z","lastLogout":null},"at":"2026-11-21T10:05:00.000Z"}"""
        val live = EchelonJson.decodeFromString(LiveStatus.serializer(), json)
        assertEquals(16236L, live.shipType); assertEquals(1001L, live.shipItem)
        assertEquals(true, live.online?.online); assertEquals("2026-11-21T10:05:00.000Z", live.at)
    }
    @Test fun onlineIsNullWithoutTheScope() {
        val live = EchelonJson.decodeFromString(LiveStatus.serializer(), """{"system":30000142,"online":null,"at":"2026-11-21T10:05:00.000Z"}""")
        assertNull(live.online)
    }
}
