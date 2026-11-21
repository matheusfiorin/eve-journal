package com.echelon.eve.core.js

import kotlinx.coroutines.test.runTest
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import kotlin.time.measureTime

/**
 * The bundled web planners running in QuickJS on the JVM (quickjs-kt's desktop build). Expected answers are the web's
 * own: the fixture map is e2e/fixtures.js UNIVERSE, and the paths were printed by route.js under Node.
 */
class PlannerBridgeTest {
    companion object {
        // Jita - Perimeter - Niarja - Amarr in high-sec, with low-sec Tama off Perimeter (e2e/fixtures.js).
        private const val FIXTURE = """{"version":"u1","universe":{"systems":{"30000142":["Jita",0.946,10000002,[30000144],0,[0,0,0],[0,0],20000020],"30000144":["Perimeter",0.95,10000002,[30000142,30003504,30002813],4,[1,0,1],[4,0],20000020],"30003504":["Niarja",0.5,10000043,[30000144,30002187],3,[3,1,4],[8,4],20000322],"30002187":["Amarr",1,10000043,[30003504],0,[5,1,7],[12,6],20000322],"30002813":["Tama",0.3,10000002,[30000144],5,[2,-1,-2],[4,-5],20000021]},"regions":{"10000002":"The Forge","10000043":"Domain"}},"meta":{}}"""
        private lateinit var bridge: PlannerBridge

        @BeforeClass @JvmStatic fun load() { bridge = PlannerBridge(File("src/main/assets/planners.js").readText()) }
        @AfterClass @JvmStatic fun close() = bridge.close()
    }

    @Test fun exposesEveryPlannerModule() = runTest {
        val modules = bridge.modules()
        assertEquals(setOf("route", "exploration", "industry", "mining", "market", "hauling", "sell", "fit", "jobs", "orders"), modules.keys)
        assertTrue("rankSystems" in modules.getValue("exploration"))
        assertTrue("planSell" in modules.getValue("sell"))
        assertTrue("route.path" in bridge.names())
    }

    @Test fun routesOnTheFixtureMapLikeTheWeb() = runTest {
        assertEquals(5, bridge.loadUniverse(FIXTURE))
        assertEquals(listOf(30000142L, 30000144L, 30003504L, 30002187L), bridge.path(30000142, 30002187))
        assertEquals(listOf(30002187L, 30003504L, 30000144L, 30002813L), bridge.path(30002187, 30002813, safe = false))
        assertEquals(mapOf(30000142L to 0, 30000144L to 1, 30003504L to 2, 30002813L to 2), bridge.within(30000142, 2))
        assertNull(bridge.path(30000142, 31000005)) // not on the map
    }

    @Test fun aNewEdenSizedMapLoadsAndRoutesQuickly() = runTest {
        // 8,000 systems (New Eden has about 8,400 with gates): a ring of constellations with long chords.
        val n = 8000
        val systems = (0 until n).joinToString(",") { i ->
            val links = listOf((i + 1) % n, (i + n - 1) % n) + if (i % 10 == 0) listOf((i + 500) % n, (i + n - 500) % n) else emptyList()
            "\"${30000000 + i}\":[\"S$i\",${if (i % 7 == 0) 0.3 else 0.8},${10000000 + i / 100},[${links.joinToString(",") { "${30000000 + it}" }}],0]"
        }
        val doc = "{\"version\":\"big\",\"universe\":{\"systems\":{$systems}},\"meta\":{}}"
        var loaded = 0
        val load = measureTime { loaded = bridge.loadUniverse(doc) }
        var path: List<Long>? = null
        val route = measureTime { path = bridge.path(30000000, 30004000, safe = false) }
        println("Planner bridge: ${doc.length / 1024} kB universe loaded in $load, a cross-map route in $route (${path?.size} systems)")
        assertEquals(n, loaded)
        assertEquals(8, path!!.size - 1) // 4,000 systems round the ring: eight 500-system chords (route.js under Node agrees)
        assertTrue("loading took $load", load.inWholeSeconds < 10)
        bridge.loadUniverse(FIXTURE)
    }
}
