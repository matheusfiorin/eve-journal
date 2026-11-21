package com.echelon.eve.plan

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.plan.trade.TradeResult
import com.echelon.eve.plan.trade.sortedHauls
import com.echelon.eve.plan.trade.sortedSpreads
import kotlinx.coroutines.test.runTest
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test

/** Plan → Trade through the bridge on the fixture market; expected values are Node's for the same call. */
class TradeTest {
    companion object {
        private lateinit var bridge: PlannerBridge
        @BeforeClass @JvmStatic fun load() = runTest {
            bridge = PlanFixture.bridge()
            bridge.callRaw("build.esi", """{"prices":[{"type_id":34,"adjusted_price":4},{"type_id":35,"adjusted_price":9}],"systems":[{"solar_system_id":30000142,"cost_indices":[{"activity":"manufacturing","cost_index":0.05}]}]}""")
        }
        @AfterClass @JvmStatic fun close() = bridge.close()
    }

    @Test fun listsHaulsSpreadsAndBuildsLikeTheWeb() = runTest {
        val r = EchelonJson.decodeFromString(TradeResult.serializer(), bridge.callRaw("trade.plan", """{"from":30000142,"maxJumps":10,"cargo":5000,"budget":1e8,"me":{}}"""))
        assertTrue(r.ready)
        val h = r.hauls.single()
        assertEquals("Tritanium", h.name); assertEquals("Jita", h.from.systemName); assertEquals("Amarr", h.to.systemName)
        assertEquals(100000L, h.units); assertEquals(147500.0, h.profit, 1e-6); assertEquals(49166.666666666686, h.perJump, 1e-6); assertEquals(0, h.toA); assertEquals(3, h.ab)
        assertEquals(listOf("Rifter", null, null), r.spreads.map { it.name })
        assertEquals(0.16333333333333333, r.spreads[0].margin, 1e-12); assertEquals(98000.0, r.spreads[0].daily, 1e-6)
        assertEquals(131905.0, r.builds.single().profit, 1e-6)
        assertEquals(0.05, r.index, 1e-12)
        assertEquals(listOf("Jita", "Amarr"), r.brokers.map { it.hub })
        assertTrue(r.needOwners.isEmpty()) // no standings, so no owners to look up
        assertNull(r.recipesError)
    }

    @Test fun myOrdersAreCheckedLikeTheWeb() = runTest {
        val v = EchelonJson.decodeFromString(com.echelon.eve.plan.trade.OrdersView.serializer(), bridge.callRaw("orders.view", """{"now":${PlanFixture.NOW},
            "orders":[{"order_id":1,"type_id":34,"region_id":10000002,"location_id":60003760,"is_buy_order":false,"price":5.5,"volume_remain":500,"volume_total":1000,"issued":"2026-11-15T00:00:00Z","duration":30},
                      {"order_id":2,"type_id":34,"region_id":10000002,"location_id":60003760,"is_buy_order":true,"price":4.6,"volume_remain":10,"volume_total":10,"issued":"2026-11-17T00:00:00Z","duration":90}],
            "history":[{"type_id":35,"is_buy_order":false,"price":10,"volume_remain":0,"volume_total":200,"issued":"2026-11-10T00:00:00Z","duration":3,"state":"expired"}]}"""))
        assertEquals(listOf("outbid", "best"), v.live.map { it.state }); assertEquals(0.5, v.live[0].by!!, 1e-9); assertEquals("station", v.live[0].scope)
        assertEquals(27, v.live[0].daysLeft); assertEquals("Jita IV - Moon 4 - Caldari Navy Assembly Plant", v.live[0].place)
        assertEquals(1, v.history!!.summary.filled); assertEquals(2000.0, v.history!!.summary.sold, 1e-9); assertEquals("filled", v.history!!.rows.single().outcome)
    }

    @Test fun sortsLikeTheWeb() = runTest {
        val r = EchelonJson.decodeFromString(TradeResult.serializer(), bridge.callRaw("trade.plan", """{"from":30000142,"maxJumps":10,"cargo":5000,"me":{}}"""))
        assertEquals(r.spreads.sortedByDescending { it.margin }, sortedSpreads(r.spreads, "margin"))
        assertEquals(r.hauls, sortedHauls(r.hauls, ""))
    }
}
