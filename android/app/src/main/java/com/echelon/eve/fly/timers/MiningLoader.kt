package com.echelon.eve.fly.timers

import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.esi.eveNames
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.Ship
import com.echelon.eve.core.model.Skills
import com.echelon.eve.fly.RawFit
import com.echelon.eve.fly.rawFit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File

// Getting the numbers [MiningCalc] needs: the pilot's fit and skills (what the Fly screens already read) and the types'
// dogma from ESI (public, cached on disk), then a profile per pilot for the start sheet and the cockpit.

/** ESI's /universe/types/{id} as a [DogmaType]; null when it has no id or name. */
fun parseDogmaType(o: JsonObject): DogmaType? {
    val id = (o["type_id"] as? JsonPrimitive)?.longOrNull ?: return null
    val name = (o["name"] as? JsonPrimitive)?.contentOrNull ?: return null
    val attrs = (o["dogma_attributes"] as? JsonArray).orEmpty().mapNotNull { e ->
        val a = e as? JsonObject ?: return@mapNotNull null
        val aid = (a["attribute_id"] as? JsonPrimitive)?.intOrNull ?: return@mapNotNull null
        aid to ((a["value"] as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null)
    }.toMap()
    return DogmaType(id, name, (o["group_id"] as? JsonPrimitive)?.longOrNull ?: 0, (o["capacity"] as? JsonPrimitive)?.doubleOrNull ?: 0.0, attrs, (o["volume"] as? JsonPrimitive)?.doubleOrNull ?: 0.0)
}

/** Types by id: in memory, then in a file (a type's dogma changes only with a patch, so a month is plenty), then ESI. */
class DogmaCache(private val fetch: suspend (Long) -> JsonObject?, private val file: File?, private val clock: () -> Long = System::currentTimeMillis) {
    private val mutex = Mutex()
    private val memory = HashMap<Long, DogmaType>()
    private var loaded = false

    suspend fun get(id: Long): DogmaType? = getAll(listOf(id))[id]

    /** The types for [ids]; ones ESI would not describe are left out and tried again next time. */
    suspend fun getAll(ids: Collection<Long>): Map<Long, DogmaType> = mutex.withLock {
        if (!loaded) { load(); loaded = true }
        var fetched = false
        for (id in ids.distinct().filter { it !in memory }) {
            val t = runCatching { fetch(id)?.let(::parseDogmaType) }.getOrNull() ?: continue
            memory[id] = t; fetched = true
        }
        if (fetched) save()
        ids.mapNotNull { id -> memory[id]?.let { id to it } }.toMap()
    }

    private fun load() {
        val f = file?.takeIf { it.exists() } ?: return
        runCatching {
            val root = EchelonJson.parseToJsonElement(f.readText()) as JsonObject
            if (clock() - ((root["at"] as? JsonPrimitive)?.longOrNull ?: 0) > MONTH) return
            (root["types"] as? JsonObject)?.values?.forEach { v -> (v as? JsonObject)?.let(::decode)?.let { memory[it.id] = it } }
        }
    }

    private fun save() {
        val f = file ?: return
        runCatching {
            val body = buildJsonObject {
                put("at", clock())
                put("types", buildJsonObject { memory.values.forEach { t -> put(t.id.toString(), encode(t)) } })
            }
            f.parentFile?.mkdirs(); val tmp = File(f.path + ".tmp"); tmp.writeText(body.toString()); tmp.renameTo(f)
        }
    }

    private fun encode(t: DogmaType) = buildJsonObject {
        put("id", t.id); put("n", t.name); put("g", t.groupId); put("c", t.capacity); put("v", t.volume)
        put("a", buildJsonObject { t.attrs.forEach { (k, v) -> put(k.toString(), v) } })
    }

    private fun decode(o: JsonObject): DogmaType? {
        val id = (o["id"] as? JsonPrimitive)?.longOrNull ?: return null
        val attrs = (o["a"] as? JsonObject)?.mapNotNull { (k, v) -> k.toIntOrNull()?.let { it to ((v as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null) } }?.toMap().orEmpty()
        // A type saved before volumes were kept has no "v": it is read again from ESI rather than guessed.
        return DogmaType(id, (o["n"] as? JsonPrimitive)?.contentOrNull ?: return null, (o["g"] as? JsonPrimitive)?.longOrNull ?: 0, (o["c"] as? JsonPrimitive)?.doubleOrNull ?: 0.0, attrs, (o["v"] as? JsonPrimitive)?.doubleOrNull ?: return null)
    }

    companion object { const val MONTH = 30L * 24 * 3_600_000 }
}

/** The fit rows' type ids by slot class: [type, flag, quantity] with EVE's inventory flags. */
data class FitModules(val high: Map<Long, Int>, val low: Map<Long, Int>)

fun fitModules(items: JsonArray): FitModules {
    val high = LinkedHashMap<Long, Int>(); val low = LinkedHashMap<Long, Int>()
    items.forEach { row ->
        val r = row as? JsonArray ?: return@forEach
        val type = (r.getOrNull(0) as? JsonPrimitive)?.longOrNull ?: return@forEach
        val flag = (r.getOrNull(1) as? JsonPrimitive)?.intOrNull ?: return@forEach
        val qty = ((r.getOrNull(2) as? JsonPrimitive)?.intOrNull ?: 1).coerceAtLeast(1)
        // HiSlot0..7 = 27..34, LoSlot0..7 = 11..18. A charge shares its module's flag and is told apart later: it has no mining amount.
        when (flag) { in 27..34 -> high.merge(type, qty, Int::plus); in 11..18 -> low.merge(type, qty, Int::plus) }
    }
    return FitModules(high, low)
}

/** What the start sheet and the cockpit show for a pilot's mining: the profile, or why there is none. */
data class MiningUi(val profile: MiningProfile? = null, val note: String? = null, val loading: Boolean = false)

class MiningLoader(private val c: AppContainer, private val fitter: MiningFitter) {
    constructor(c: AppContainer) : this(c, MiningFitter(DogmaCache({ id -> c.eveNames.get("universe/types/$id") }, File(c.app.filesDir, "dogma-types.json"))))

    /** The types cache (dogma and unit volumes), shared so the gas estimate reads volumes without a second copy of the file. */
    val types: DogmaCache get() = fitter.cache

    private val _state = MutableStateFlow<Map<Pilot, MiningUi>>(emptyMap())
    /** The last profile read per pilot. */
    val state: StateFlow<Map<Pilot, MiningUi>> = _state.asStateFlow()

    suspend fun load(pilot: Pilot): MiningUi {
        val ui = runCatching { compute(pilot) }.getOrElse { MiningUi(note = "The mining numbers could not be worked out: ${it.message}") }
        _state.value = _state.value + (pilot to ui)
        return ui
    }

    private suspend fun compute(pilot: Pilot): MiningUi {
        val state = c.pilots.state(pilot)
        val mate = c.wing.of(pilot)
        val ownFit = state.private?.op("fit")?.takeIf { it.permission != false }?.value?.let(::rawFit)
        val ownShip = state.private?.op("ship")?.value?.let { runCatching { EchelonJson.decodeFromJsonElement(Ship.serializer(), it) }.getOrNull() }
        val (fit, shipType) = when {
            ownFit != null && ownShip != null -> ownFit to ownShip.shipTypeId
            mate?.fit != null && mate.ship != null && rawFit(mate.fit) != null -> rawFit(mate.fit)!! to mate.ship.shipTypeId
            else -> return MiningUi(note = "No fit has synced yet, so there is nothing to work a cycle out from.")
        }
        val skills: Skills? = state.private?.skills ?: state.public?.skills ?: mate?.skills
        val levels = skills?.skills?.associate { it.skillId to it.activeLevel }.orEmpty()
        return fitter.profile(fit, shipType, levels)
    }
}

/** A fit's rows and a pilot's skill levels to a [MiningUi], through the types' dogma. */
class MiningFitter(val cache: DogmaCache) {
    suspend fun profile(fit: RawFit, shipType: Long, levels: Map<Long, Int>): MiningUi {
        val mods = fitModules(fit.items)
        val types = cache.getAll(listOf(shipType) + mods.high.keys + mods.low.keys + Dogma.SKILLS)
        val ship = types[shipType] ?: return MiningUi(note = "EVE's ship data could not be loaded. Try again with a connection.")
        val high = mods.high.mapNotNull { (id, qty) -> types[id]?.let { it to qty } }
        val upgrades = mods.low.flatMap { (id, qty) -> val t = types[id]; if (t?.a(Dogma.MINING_AMOUNT_BONUS) != null && t.a(Dogma.MINING_AMOUNT) == null) List(qty) { t } else emptyList() }
        val p = MiningCalc.profile(ship, high, upgrades, levels, types.filterKeys { it in Dogma.SKILLS })
            ?: return MiningUi(note = "${ship.name} has no mining lasers, strip miners, harvesters or gas scoops fitted.")
        return MiningUi(p)
    }
}
