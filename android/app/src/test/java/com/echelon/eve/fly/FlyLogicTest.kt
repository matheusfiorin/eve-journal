package com.echelon.eve.fly

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.core.model.IndustryJob
import com.echelon.eve.core.model.Skill
import com.echelon.eve.core.model.SkillQueueItem
import com.echelon.eve.core.model.Skills
import com.echelon.eve.fly.skills.QueueState
import kotlinx.coroutines.test.runTest
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.time.Instant

/**
 * The Fly feature's use of the web's fit.js and jobs.js through the bridge, and the skill queue reading. Expected values
 * are what the same calls print under Node (android/js/planners.js run by node on the same inputs).
 */
class FlyLogicTest {
    companion object {
        private lateinit var bridge: PlannerBridge
        @BeforeClass @JvmStatic fun load() { bridge = PlannerBridge(File("src/main/assets/planners.js").readText()) }
        @AfterClass @JvmStatic fun close() = bridge.close()
    }

    private val fitJson = """{"ship":1000,"items":[[1,"HiSlot0",1],[2,"HiSlot0",100],[3,"MedSlot0",1],[4,"DroneBay",3],[4,"DroneBay",2],[5,"Cargo",10],[6,"Implant",1]]}"""

    @Test fun aFitComesOutAsTheWebsEftWithChargesOnTheirModules() = runTest {
        val fit = rawFit(EchelonJson.parseToJsonElement(fitJson))!!
        assertEquals(1000L, fit.shipItem)
        assertEquals(setOf(1L, 2L, 3L, 4L, 5L, 6L), fitTypes(fit))
        val names = mapOf(1L to "Gun", 2L to "Ammo", 3L to "Prop", 4L to "Drone", 5L to "Ore", 32880L to "Venture")
        val (groups, eft) = bridge.fit(32880, "Miner", fit, names, charges = setOf(2L))
        assertEquals("[Venture, Miner]\nProp\n\nGun, Ammo\n\nDrone x5\n\nOre x10", eft)
        assertEquals(2L, groups.groups.getValue("high").single().charge)
        assertEquals(5L, groups.groups.getValue("drones").single().qty)
        assertEquals(1L, groups.counts["high"])
        assertEquals(listOf("high", "High slots"), groups.slots.first())
        // Without the charge known, the ammo takes a slot line of its own.
        assertEquals(2, bridge.fit(32880, null, fit, names, emptySet()).first.groups.getValue("high").size)
    }

    @Test fun rawFitRejectsOtherShapes() {
        assertNull(rawFit(null))
        assertNull(rawFit(EchelonJson.parseToJsonElement("[1,2]")))
        assertNull(rawFit(EchelonJson.parseToJsonElement("""{"ship":1}""")))
    }

    private fun job(id: Long, activity: Int, start: String, end: String, status: String = "active") = IndustryJob(id, activity, 900L + id, 800L + id, runs = 2, status = status, startDate = start, endDate = end)

    @Test fun wingJobsPutsReadyFirstAndCountsSlots() = runTest {
        val now = Instant.parse("2026-11-21T12:00:00Z").toEpochMilli()
        val skills = Skills(skills = listOf(Skill(3387, 4, 4), Skill(3406, 1, 1)))
        val w = bridge.wingJobs(listOf(
            JobsInput("Fiofka", listOf(job(1, 1, "2026-11-21T10:00:00Z", "2026-11-21T11:00:00Z"), job(2, 5, "2026-11-21T11:00:00Z", "2026-11-21T13:00:00Z")), skills),
            JobsInput("Decxus", listOf(job(3, 8, "2026-11-21T11:30:00Z", "2026-11-21T12:30:00Z"), job(4, 1, "2026-11-20T00:00:00Z", "2026-11-22T00:00:00Z", "paused")), null),
        ), now)
        assertEquals(listOf(1L, 3L, 2L, 4L), w.list.map { it.job.jobId })
        assertEquals(1, w.ready)
        assertEquals(2, w.running)
        assertEquals(3L, w.next?.job?.jobId)
        assertEquals(30 * 60_000L, w.next?.remaining)
        assertEquals(0.5, w.list.first { it.job.jobId == 2L }.progress, 1e-9)
        assertEquals("Copying", w.list.first { it.job.jobId == 2L }.activity)
        val f = w.usage.first { it.pilot == "Fiofka" }
        assertEquals(5, f.total?.build); assertEquals(2, f.total?.science); assertEquals(1, f.science); assertEquals(0, f.build)
        assertNull(w.usage.first { it.pilot == "Decxus" }.total)
    }

    @Test fun jobsOfPrefersTheOwnSnapshot() {
        assertNull(jobsOf(null, null))
    }

    private fun q(id: Long, level: Int, pos: Int, start: String?, end: String?) = SkillQueueItem(id, level, pos, start, end)

    @Test fun theQueueReadsLikeTheWeb() {
        val now = Instant.parse("2026-11-21T12:00:00Z").toEpochMilli()
        val s = QueueState.of(listOf(
            q(3, 2, 2, "2026-11-22T00:00:00Z", "2026-11-23T00:00:00Z"),
            q(1, 4, 0, "2026-11-20T00:00:00Z", "2026-11-21T06:00:00Z"), // finished this morning: gone
            q(2, 5, 1, "2026-11-21T06:00:00Z", "2026-11-22T00:00:00Z"),
        ), now)
        assertEquals(listOf(2L, 3L), s.entries.map { it.skillId })
        assertEquals(2L, s.training?.skillId)
        assertEquals(Instant.parse("2026-11-23T00:00:00Z").toEpochMilli(), s.ends)
        assertFalse(s.idle)
        // A paused queue (no dates) trains nothing.
        val paused = QueueState.of(listOf(q(5, 1, 0, null, null)), now)
        assertTrue(paused.idle); assertNull(paused.ends); assertEquals(1, paused.entries.size)
    }
}
