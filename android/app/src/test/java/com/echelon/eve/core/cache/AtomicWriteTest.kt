package com.echelon.eve.core.cache

import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AtomicWriteTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun successiveWritesReplaceTheSavedDocument() {
        val target = File(tmp.root, "snapshot.json")
        atomicWrite(target, "first")
        assertEquals("first", target.readText())
        atomicWrite(target, "second")
        assertEquals("second", target.readText())
        assertFalse(File(tmp.root, "snapshot.json.tmp").exists())
    }

    @Test fun anUnreplaceableTargetReportsFailureAndKeepsItsContents() {
        // A non-empty directory reliably rejects file replacement without depending on OS access permissions.
        val target = tmp.newFolder("occupied")
        val saved = File(target, "saved.json").apply { writeText("keep") }
        assertThrows(IOException::class.java) { atomicWrite(target, "replacement") }
        assertEquals("keep", saved.readText())
    }
}
