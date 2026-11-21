package com.echelon.eve.plan

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.plan.sell.Gathered
import com.echelon.eve.plan.sell.SellData
import com.echelon.eve.plan.sell.SellForm
import com.echelon.eve.plan.sell.SellResult
import com.echelon.eve.plan.sell.TypeInfo
import com.echelon.eve.plan.sell.lotsOf
import com.echelon.eve.plan.sell.qtyOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test

/** Plan → Sell through the bridge on the fixture market with hand-made buy orders; expected values are Node's. */
class SellTest {
    companion object {
        private lateinit var bridge: PlannerBridge
        @BeforeClass @JvmStatic fun load() = runTest { bridge = PlanFixture.bridge() }
        @AfterClass @JvmStatic fun close() = bridge.close()
        const val FIOFKA = """{"id":2124810474,"name":"Fiofka","own":true,"connected":true,"ship":{"ship_type_id":32880,"ship_name":"Miner","ship_item_id":99},
            "location":{"solar_system_id":30000142,"station_id":60003760},"fit":{"ship":99,"items":[[34,"Cargo",100000]]},"stacks":{"60003760":[[35,1000]]}}"""
    }

    private suspend fun gather() = EchelonJson.decodeFromString(Gathered.serializer(),
        bridge.callRaw("sell.gather", """{"pilots":[$FIOFKA,{"id":2124815118,"name":"Decxus","own":false,"shareLevel":2}],"pasted":[[36,50]]}"""))

    @Test fun gathersHoldsHangarsAndPastedItems() = runTest {
        val g = gather()
        assertEquals(listOf("Miner"), g.ships.map { it.name })
        assertEquals("Jita IV - Moon 4 - Caldari Navy Assembly Plant", g.pickupName)
        assertEquals(listOf("s:2124810474:34", "h:60003760:35", "h:60003760:36"), g.rows.map { it.key })
        assertTrue(g.rows.last().pasted)
        assertEquals(listOf("Decxus has not shared a ship with the wing."), g.notes.map { it.text })
        // The form: a row left out, a quantity cut down and one above what is there.
        val f = SellForm(skip = setOf("h:60003760:36"), qty = mapOf("s:2124810474:34" to "60000", "h:60003760:35" to "5000"))
        assertEquals(60000L, qtyOf(g.rows[0], f)); assertEquals(1000L, qtyOf(g.rows[1], f))
        val (lots, unsized) = lotsOf(g, f, mapOf(34L to TypeInfo("Tritanium", 0.01, 0.0)))
        assertEquals(listOf(34L), lots.map { it.first.type }); assertEquals(1, unsized)
    }

    @Test fun plansLikeTheWeb() = runTest {
        val quotes = """{"34":[{"order":1,"loc":60008494,"system":30002187,"region":10000043,"price":6,"volume":50000,"minVolume":1,"range":"station"},
            {"order":2,"loc":60003760,"system":30000142,"region":10000002,"price":4.5,"volume":1000000,"minVolume":1,"range":"station"}],
            "35":[{"order":3,"loc":60003760,"system":30000142,"region":10000002,"price":9,"volume":500,"minVolume":1,"range":"region"}]}"""
        val r = EchelonJson.decodeFromString(SellResult.serializer(), bridge.callRaw("sell.plan", """{"lots":[{"type":34,"qty":100000,"m3":0.01,"from":{"kind":"ship","pilot":2124810474}},
            {"type":35,"qty":1000,"m3":0.01,"from":{"kind":"hangar","station":60003760}}],"ships":[{"pilot":2124810474,"name":"Miner","shipType":32880,"capacity":5000,"system":30000142,"station":60003760}],
            "quotes":$quotes,"options":{"perJump":100000,"maxJumps":5},"now":${PlanFixture.NOW}}"""))
        assertEquals(listOf("here", "most"), r.plans.map { it.key })
        val here = r.plans[0]
        assertEquals(listOf("best"), here.also); assertEquals(420412.5, here.net, 1e-6); assertEquals(0, here.jumps)
        val most = r.plans[1]
        assertEquals(3, most.jumps); assertEquals(489787.5, most.net, 1e-6)
        assertEquals(listOf("Jita IV - Moon 4 - Caldari Navy Assembly Plant", "Amarr VIII (Oris) - Emperor Family Academy"), most.ships[0].stops.map { it.name })
        assertEquals(50000L, most.ships[0].stops[1].sales.single().qty)
        assertEquals("no buyer on route", here.unsold.single().reason)
        assertEquals("thin", r.notes.single().kind)
    }

    @Test fun regionsAndPasteLikeTheWeb() = runTest {
        assertEquals("[10000002,10000043]", bridge.callRaw("sell.regions", """{"starts":[30000142],"maxJumps":0}"""))
        assertEquals("""{"rows":[{"name":"Tritanium","qty":1000},{"name":"Pyerite","qty":5}],"bad":["bad line"]}""",
            bridge.callRaw("sell.parse", """{"text":"Tritanium\t1,000\n5 x Pyerite\nbad line"}"""))
    }

    @Test fun anEsiOrderBecomesAQuote() {
        val o = EchelonJson.parseToJsonElement("""{"order_id":7,"location_id":60003760,"system_id":30000142,"price":4.2,"volume_remain":900,"min_volume":10,"range":"5","is_buy_order":true}""") as JsonObject
        assertEquals("""{"order":7,"loc":60003760,"system":30000142,"region":10000002,"price":4.2,"volume":900,"minVolume":10,"range":5}""", SellData.quote(o, 10000002).toString())
        val s = EchelonJson.parseToJsonElement("""{"order_id":8,"location_id":1,"system_id":2,"price":1,"volume_remain":1,"range":"station"}""") as JsonObject
        assertEquals("""{"order":8,"loc":1,"system":2,"region":3,"price":1,"volume":1,"minVolume":1,"range":"station"}""", SellData.quote(s, 3).toString())
    }
}
