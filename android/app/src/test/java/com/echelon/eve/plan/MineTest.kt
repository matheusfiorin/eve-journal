package com.echelon.eve.plan

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.plan.mine.MineResult
import kotlinx.coroutines.test.runTest
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test

/** Plan → Mine through the bridge on the fixture market; expected values are Node's for the same call. */
class MineTest {
    companion object {
        private lateinit var bridge: PlannerBridge
        @BeforeClass @JvmStatic fun load() = runTest { bridge = PlanFixture.bridge() }
        @AfterClass @JvmStatic fun close() = bridge.close()
    }

    @Test fun ranksBeltsLikeTheWeb() = runTest {
        val args = """{"from":30000142,"maxJumps":5,"lowsec":true,
            "me":{"name":"Fiofka","skills":{"skills":[{"skill_id":3386,"active_skill_level":4,"trained_skill_level":4},{"skill_id":32918,"active_skill_level":1,"trained_skill_level":1}]},
                "location":30000142,"ship":32880,"ledger":{"permission":true,"value":[{"date":"2026-11-20","quantity":1000,"solar_system_id":30000144,"type_id":1230}]}},
            "mate":{"name":"Decxus","location":30002813}}"""
        val r = EchelonJson.decodeFromString(MineResult.serializer(), bridge.callRaw("mine.plan", args))
        val me = r.me!!
        assertEquals("Venture", me.ship.name); assertTrue(me.ship.current); assertEquals(302.4, me.ship.rate, 1e-9)
        assertEquals(listOf("Tama", "Perimeter", "Niarja"), me.sites.map { it.system.name })
        assertEquals(5630797.47, me.sites[0].iskHour, 0.01)
        assertEquals("Kernite", me.sites[0].ores[0].name); assertEquals("raw", me.sites[0].ores[0].how); assertEquals(385.4167, me.sites[0].ores[0].perM3, 1e-4)
        assertEquals("same", r.together?.kind); assertEquals("Tama", r.together?.system?.name)
        assertEquals(listOf("Covetor", "Retriever", "Procurer", "Venture"), r.ships.map { it.name })
        assertFalse(r.ships[0].flyable); assertEquals("Mining Barge I", r.ships[0].needs)
        assertEquals(listOf("Astrogeology", "Mining Barge", "Reprocessing"), r.train.map { it.name })
        assertEquals(listOf("Kernite", "Pyroxeres", "Veldspar"), r.ores.map { it.name })
        assertEquals("ok", r.ledgers.me?.state); assertEquals(100.0, r.ledgers.me!!.m3, 1e-9); assertEquals(19425.0, r.ledgers.me!!.isk, 1e-6)
        assertEquals("not-shared", r.ledgers.mate?.state)
        assertEquals(3, r.mate?.sites?.size)
    }
}
