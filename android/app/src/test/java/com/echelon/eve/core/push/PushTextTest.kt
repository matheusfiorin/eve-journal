package com.echelon.eve.core.push

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val WING = PushText.OPEN_WING
private const val COCKPIT = PushText.OPEN_COCKPIT

class PushTextTest {
    @Test fun wordsForTheWingRoomsDataMessages() {
        assertEquals(PushText("Decxus started a timer", "Gas site", open = COCKPIT), PushText.of(mapOf("type" to "timer.start", "from" to "2124815118", "label" to "Gas site")))
        assertEquals(PushText("Gas site is done", "Fiofka’s timer ended", open = COCKPIT), PushText.of(mapOf("type" to "timer.end", "from" to "2124810474", "label" to "Gas site")))
        assertEquals(PushText("Decxus", "Needs help", open = WING), PushText.of(mapOf("type" to "ping", "from" to "2124815118", "kind" to "help")))
        assertEquals(PushText("Your wingmate", "Tackled in Tama", open = WING), PushText.of(mapOf("type" to "ping", "kind" to "custom", "text" to "Tackled in Tama")))
        assertEquals(PushText("Hello", "From the room", open = WING), PushText.of(mapOf("title" to "Hello", "body" to "From the room")))
        assertNull(PushText.of(mapOf("type" to "presence")))
        assertNull("a status never pushes, so there is nothing to word", PushText.of(mapOf("type" to "status", "system" to "30000142")))
    }

    @Test fun aPlainNotificationFromTheConsoleStillShows() {
        assertEquals(PushText("Heads up", "Body", open = WING), PushText.ofMessage(emptyMap(), "Heads up", "Body"))
        assertEquals(PushText("Echelon", "Only a body", open = WING), PushText.ofMessage(emptyMap(), null, "Only a body"))
        assertNull(PushText.ofMessage(mapOf("type" to "from.the.future"), null, null))
    }

    // The room's own output (tests/wingcompat.test.js records it into push-data.json and fails when it changes) in, notifications out.
    private val expected = mapOf(
        "timer.start" to PushText("Fiofka started a timer", "Gas site", open = COCKPIT),
        "ping.help" to PushText("Fiofka", "Needs help", open = WING),
        "ping.custom" to PushText("Fiofka", "Bring paste", open = WING),
        "plan.share" to PushText("Fiofka sent a plan", "Jita to Amarr", updates = true, open = WING),
        "session.start" to PushText("Fiofka started a mining session", "Open the Wing screen to join in", updates = true, open = WING),
        "ack.onit" to PushText("Decxus: On it", "Answering your call", updates = true, open = WING),
        "ack.cant" to PushText("Decxus: Can’t make it", "Answering “Bring paste”", updates = true, open = WING),
        "ack.plan" to PushText("Decxus: On it", "Answering “Jita to Amarr”", updates = true, open = WING),
        "session.end" to PushText("Fiofka ended the session", "The summary is on the Wing screen", updates = true, open = WING),
        "timer.end" to PushText("Gas site is done", "Fiofka’s timer ended", open = COCKPIT),
    )

    @Test fun everyPushTheRoomSendsBecomesTheRightNotificationAndDeepLink() {
        val sent = Json.parseToJsonElement(javaClass.getResourceAsStream("/wing/push-data.json")!!.bufferedReader().readText()).jsonObject
        assertEquals("a push the room sends has no expectation here, or the other way round", expected.keys, sent.keys)
        for ((name, data) in sent) {
            val text = PushText.ofMessage(data.jsonObject.mapValues { it.value.jsonPrimitive.content }, null, null)
            assertEquals(name, expected.getValue(name), text)
            // Every notification opens a sub-screen the shell knows (Destination/key as MainActivity reads it).
            assertTrue(name, text!!.open in listOf("Fly/wing", "Fly/cockpit"))
        }
    }

    @Test fun noPushIsReadForALocationEvenIfOneWereSent() {
        val withSystem = mapOf("type" to "ping", "pilot" to "2124810474", "ping" to "help", "system" to "30000142", "route" to "30000142,30002187", "destination" to "30002187")
        assertEquals(PushText("Fiofka", "Needs help", open = WING), PushText.of(withSystem))
        assertTrue(PushText.of(withSystem)!!.let { "30000142" !in it.title + it.body && "Jita" !in it.title + it.body })
    }
}
