package com.echelon.eve.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull

// GET /api/market?v=2 and GET /api/market/universe?v=<version> (worker/index.js). With v=2 the market leaves out the
// static universe (gate map, NPC stations, ores, combat types, skill ids) and names its version; the universe document
// is fetched once per version and kept on disk (core.cache.UniverseCache). [MarketData.merged] puts them back together
// in the shape the web's planners expect (ui/marketdata.js withUniverse).

/** Region 0: item names, recipes, starter blueprints and the live risk/traffic meta. */
@Serializable
data class MarketMeta(val region: Int = 0, val updatedAt: Long = 0, val data: JsonObject = JsonObject(emptyMap()))

/** One scanned region's best prices per station: data.types[typeId] = {d, s:[[station, price, volume]], b:[…]}. */
@Serializable
data class MarketRegion(val region: Long, val updatedAt: Long, val data: JsonObject)

@Serializable
data class MarketSnapshot(
    val meta: MarketMeta? = null,
    /** Inline only from an older Worker; v=2 sends null and names [universeVersion]. */
    val universe: JsonElement? = null,
    val universeVersion: String? = null,
    val regions: List<MarketRegion> = emptyList(),
)

/** The static universe document. [universe] is the gate map; [meta] the static parts of region 0 (ores, combat, skills). */
@Serializable
data class UniverseDoc(val version: String, val universe: JsonObject? = null, val meta: JsonObject = JsonObject(emptyMap()))

/** A solar system from the gate map: systems[id] = [name, sec, region, links, belts, pos, p2, constellation]. */
data class SolarSystem(val id: Long, val name: String, val sec: Double, val region: Long, val links: List<Long>, val belts: Int, val constellation: Long?)

/** The market with its universe merged back in, plus typed views of the gate map. */
data class MarketData(val snapshot: MarketSnapshot, val universe: UniverseDoc?) {
    val gateMap: JsonObject? get() = (snapshot.universe as? JsonObject) ?: universe?.universe

    /** Region 0's data with the universe document's static parts under it, as the web merges them. */
    val metaData: JsonObject get() = JsonObject((universe?.meta ?: emptyMap()) + (snapshot.meta?.data ?: emptyMap()))

    val systems: Map<Long, SolarSystem> by lazy {
        val raw = gateMap?.get("systems") as? JsonObject ?: return@lazy emptyMap()
        raw.mapNotNull { (id, v) ->
            val a = v as? JsonArray ?: return@mapNotNull null
            val sid = id.toLongOrNull() ?: return@mapNotNull null
            sid to SolarSystem(sid, a[0].jsonPrimitive.content, a[1].jsonPrimitive.double, a[2].jsonPrimitive.long,
                a.getOrNull(3)?.jsonArray?.mapNotNull { (it as? JsonPrimitive)?.longOrNull } ?: emptyList(),
                a.getOrNull(4)?.jsonPrimitive?.longOrNull?.toInt() ?: 0, a.getOrNull(7)?.let { (it as? JsonPrimitive)?.longOrNull })
        }.toMap()
    }

    fun regionName(id: Long): String? = ((gateMap?.get("regions") as? JsonObject)?.get(id.toString()) as? JsonPrimitive)?.content
}
