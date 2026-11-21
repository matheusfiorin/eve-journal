package com.echelon.eve.core.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushTextTest {
    @Test fun wordsForTheWingRoomsDataMessages() {
        assertEquals(PushText("Decxus started a timer", "Gas site"), PushText.of(mapOf("type" to "timer.start", "from" to "2124815118", "label" to "Gas site")))
        assertEquals(PushText("Gas site is done", "Fiofka’s timer ended"), PushText.of(mapOf("type" to "timer.end", "from" to "2124810474", "label" to "Gas site")))
        assertEquals(PushText("Decxus", "Needs help"), PushText.of(mapOf("type" to "ping", "from" to "2124815118", "kind" to "help")))
        assertEquals(PushText("Your wingmate", "Tackled in Tama"), PushText.of(mapOf("type" to "ping", "kind" to "custom", "text" to "Tackled in Tama")))
        assertEquals(PushText("Hello", "From the room"), PushText.of(mapOf("title" to "Hello", "body" to "From the room")))
        assertNull(PushText.of(mapOf("type" to "presence")))
    }
}
