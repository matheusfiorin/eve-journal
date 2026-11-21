package com.echelon.eve.plan

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.plan.build.BuildResult
import kotlinx.coroutines.test.runTest
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test

/** Plan → Build through the bridge on the fixture market with small ESI lists; expected values are Node's. */
class BuildTest {
    companion object {
        private lateinit var bridge: PlannerBridge
        @BeforeClass @JvmStatic fun load() = runTest {
            bridge = PlanFixture.bridge()
            bridge.callRaw("build.esi", """{"prices":[{"type_id":34,"adjusted_price":4},{"type_id":35,"adjusted_price":9}],
                "systems":[{"solar_system_id":30000142,"cost_indices":[{"activity":"manufacturing","cost_index":0.05},{"activity":"researching_material_efficiency","cost_index":0.03}]},
                {"solar_system_id":30000144,"cost_indices":[{"activity":"manufacturing","cost_index":0.01}]}]}""")
        }
        @AfterClass @JvmStatic fun close() = bridge.close()
        const val ME = """{"name":"Fiofka","skills":{"skills":[{"skill_id":3380,"active_skill_level":3,"trained_skill_level":3}]},"wallet":20000000,"blueprints":[[2456,1,0,10,20,0,60003760]]"""
    }

    private suspend fun plan(args: String) = EchelonJson.decodeFromString(BuildResult.serializer(), bridge.callRaw("build.plan", args))

    @Test fun splitsTheWingAndUsesOwnedBlueprints() = runTest {
        val r = plan("""{"system":30000142,"budget":20000000,"me":$ME,"standings":[]},"mate":{"name":"Decxus","wallet":5000000}}""")
        assertTrue(r.ready)
        assertEquals(listOf("Drone", "Frigate"), r.categories)
        assertEquals(2, r.summary.fit); assertEquals(0.0925, r.summary.jobTax, 1e-12); assertEquals(1, r.summary.build)
        assertEquals(listOf("Hobgoblin I", "Rifter"), r.picks.map { it.name })
        val hob = r.picks[0]
        assertEquals(336400.0, hob.profitDay, 1e-6); assertEquals("Owned (ME 10/TE 20)", hob.owned); assertEquals("Fiofka", hob.plan); assertEquals(100, hob.runs)
        assertEquals(listOf("Buy materials", "Build", "Sell"), hob.legs.map { it.label })
        val rifter = r.picks[1]
        assertEquals("Decxus", rifter.plan); assertEquals(6, rifter.me); assertEquals(12.947724001604454, rifter.payback, 1e-9)
        assertEquals(listOf("Buy the blueprint", "Research to ME 6", "Buy materials", "Build", "Sell"), rifter.legs.map { it.label })
        assertEquals(3, rifter.legs[0].jumps)
        assertEquals(listOf("Fiofka", "Decxus"), r.wing.map { it.name })
        assertEquals(289010.0, r.wing[1].profitDay, 1e-6)
        assertEquals("Weeks 2–4 · expand", r.guide?.stage)
        assertEquals(listOf(2456L), r.library.me?.map { it.type })
        assertNull(r.library.mate) // Decxus does not share blueprints
        assertEquals(listOf(60003760L, 60008494L), r.needOwners)
    }

    @Test fun standingsLowerTheBrokerFee() = runTest {
        val r = plan("""{"system":30000142,"budget":20000000,"me":$ME,"standings":[[1000035,"npc_corp",5.0],[500001,"faction",2.0]]},"owners":{"60003760":[1000035,500001]}}""")
        val b = r.picks[0].broker!!
        assertTrue(b.applied); assertEquals(0.0284, b.fee, 1e-12)
        assertEquals(337872.0, r.picks[0].profitDay, 1e-6)
    }
}
