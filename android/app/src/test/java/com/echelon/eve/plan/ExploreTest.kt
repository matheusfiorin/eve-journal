package com.echelon.eve.plan

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.plan.explore.ExploreResult
import com.echelon.eve.plan.explore.Marks
import kotlinx.coroutines.test.runTest
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File

/**
 * Plan → Explore through the bridge on the e2e fixture map (e2e/fixtures.js UNIVERSE and its meta). Expected values
 * are what the same explore.rank call prints under Node.
 */
class ExploreTest {
    companion object {
        const val UNIVERSE = """{"systems":{"30000142":["Jita",0.946,10000002,[30000144],0,[0,0,0],[0,0],20000020],"30000144":["Perimeter",0.95,10000002,[30000142,30003504,30002813],4,[1,0,1],[4,0],20000020],"30003504":["Niarja",0.5,10000043,[30000144,30002187],3,[3,1,4],[8,4],20000322],"30002187":["Amarr",1,10000043,[30003504],0,[5,1,7],[12,6],20000322],"30002813":["Tama",0.3,10000002,[30000144],5,[2,-1,-2],[4,-5],20000021]},"regions":{"10000002":"The Forge","10000043":"Domain"}}"""
        const val META = """{"traffic":{"at":1795278914922,"since":1794827200000,"s":{"30000142":50000,"30000144":20000,"30002187":40000,"30002813":900,"30003504":300}},"risk":{"at":1795278914922,"since":1795019714922,"s":{"30003504":[12,40]}},"activity":{"30000144":[0,0,1500],"30003504":[3,10,120]},"skills":{"accounting":16622,"brokerRelations":3446,"industry":3380,"massProduction":3387,"science":3402,"labOperation":3406,"metallurgy":3409,"advancedIndustry":3388,"astrometrics":3412,"hacking":21718,"archaeology":13278,"gallenteFrigate":3328,"caldariFrigate":3330}}"""
        const val NOW = 1_795_000_000_000L
        private lateinit var bridge: PlannerBridge
        @BeforeClass @JvmStatic fun load() { bridge = PlannerBridge(File("src/main/assets/planners.js").readText()) }
        @AfterClass @JvmStatic fun close() = bridge.close()
    }

    @Test fun ranksLikeTheWeb() = runTest {
        bridge.loadUniverse(UNIVERSE)
        bridge.callRaw("market.meta", "{\"meta\":$META}")
        val args = """{"from":30000142,"maxJumps":5,"bands":["hi","low"],"tolerance":"normal","loop":2,"now":$NOW,"marks":[[30000144,${NOW - 3_600_000}]],
            "skills":{"skills":[{"skill_id":3330,"active_skill_level":2,"trained_skill_level":2},{"skill_id":3412,"active_skill_level":3,"trained_skill_level":3}]}}"""
        val r = EchelonJson.decodeFromString(ExploreResult.serializer(), bridge.callRaw("explore.rank", args))
        assertEquals(listOf("Tama", "Niarja", "Jita", "Amarr", "Perimeter"), r.rows.map { it.system.name })
        assertEquals(listOf(100, 13, 3, 3, 1), r.rows.map { it.score })
        assertEquals(listOf(2, 2, 0, 3, 1), r.rows.map { it.jumps })
        // Perimeter was marked scanned an hour ago, so it sinks to the bottom.
        assertTrue(r.rows.last().visited != null)
        assertEquals(1, r.visited)
        assertEquals(listOf("Tama", "Niarja"), r.loop!!.stops.map { it.name })
        assertEquals(6, r.loop!!.jumps); assertEquals(30, r.loop!!.minutes); assertEquals(0.994786, r.loop!!.survival, 1e-6)
        assertEquals("Heron", r.explorer!!.ship); assertEquals(2, r.explorer!!.level)
        assertEquals(listOf("Hacking", "Archaeology", "Caldari Frigate", "CPU Management"), r.train.map { it.name })
        assertEquals(48.0, r.trafficHours, 1e-9)
    }

    @Test fun anUnknownStartIsReported() = runTest {
        bridge.loadUniverse(UNIVERSE)
        bridge.callRaw("market.meta", "{\"meta\":$META}")
        assertEquals("unknown-system", EchelonJson.decodeFromString(ExploreResult.serializer(), bridge.callRaw("explore.rank", "{\"from\":1}")).error)
    }

    @Test fun marksMergeLikeTheWeb() {
        val day = 86_400_000L
        val here = mapOf(30000142L to NOW - day, 30000144L to NOW - 5 * day, 30002187L to NOW - 100 * day, 123L to NOW)
        val there = mapOf(30000142L to NOW - 2 * day, 30000144L to NOW - day)
        // Newest scan per system; older than 90 days and ids that are not systems are dropped.
        assertEquals(mapOf(30000142L to NOW - day, 30000144L to NOW - day), Marks.merge(here, there, NOW))
        val many = (0 until 1200).associate { (30000000L + it) to NOW - it * 1000L }
        assertEquals(1000, Marks.age(many, NOW).size)
        assertTrue(30000000L in Marks.age(many, NOW))
        val rec = Marks.record(Pilot.Fiofka, mapOf(30000142L to 5L))
        assertEquals("""{"id":"explored:2124810474","marks":{"30000142":5}}""", rec.toString())
        assertEquals(mapOf(30000142L to 5L), Marks.of(rec))
    }
}
