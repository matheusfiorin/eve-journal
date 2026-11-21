package com.echelon.eve.plan

import com.echelon.eve.core.js.PlannerBridge
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.io.File

/**
 * The Plan tests' market: the web's e2e fixture (gate map, region-0 meta, two scanned regions) with times pinned,
 * written by scripts/android-plan-fixture.mjs. [bridge] has all three loaded, as PlanEngine.ready() leaves it.
 */
object PlanFixture {
    private val doc = Json.parseToJsonElement(PlanFixture::class.java.getResource("/plan-fixture.json")!!.readText()) as JsonObject
    val NOW: Long = doc.getValue("now").toString().toLong()

    suspend fun bridge(): PlannerBridge = PlannerBridge(File("src/main/assets/planners.js").readText()).also { b ->
        b.callRaw("universe.load", "{\"universe\":${doc.getValue("universe")}}")
        b.callRaw("market.meta", "{\"meta\":${doc.getValue("meta")}}")
        b.callRaw("market.book", "{\"regions\":${doc.getValue("regions")}}")
    }
}
