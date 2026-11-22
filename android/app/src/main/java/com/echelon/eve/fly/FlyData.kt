package com.echelon.eve.fly

import com.echelon.eve.AppContainer
import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.core.model.IndustryJob
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.Ship
import com.echelon.eve.core.model.Skills
import com.echelon.eve.core.model.SolarSystem
import com.echelon.eve.core.model.WingPilot
import com.echelon.eve.fly.fit.FitGroups
import com.echelon.eve.fly.fit.FitUi
import com.echelon.eve.fly.jobs.JobsUi
import com.echelon.eve.fly.jobs.WingJobs
import com.echelon.eve.fly.live.LiveUi
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.fly.skills.QueueState
import com.echelon.eve.fly.skills.SkillsUi
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.time.Instant

// Loading for the Fly screens: each turns what the core already holds (pilot snapshots, the wing summary, the market's
// gate map) into a screen's state, asking ESI for names and the planner bridge for the web's logic.

/** One fit as the Worker keeps it (snapshot.operations.fit.value, or the wing summary's fit): the ship and its rows. */
data class RawFit(val shipItem: Long?, val items: JsonArray)

fun rawFit(value: JsonElement?): RawFit? {
    val o = value as? JsonObject ?: return null
    val items = o["items"] as? JsonArray ?: return null
    return RawFit((o["ship"] as? JsonPrimitive)?.longOrNull, items)
}

/** The type ids in a fit's rows ([type_id, flag, quantity]). */
fun fitTypes(fit: RawFit): Set<Long> = fit.items.mapNotNull { ((it as? JsonArray)?.getOrNull(0) as? JsonPrimitive)?.longOrNull }.toSet()

/** Calls fit.groups and fit.eft (fit.js) for one ship. */
suspend fun PlannerBridge.fit(ship: Long, title: String?, fit: RawFit, names: Map<Long, String>, charges: Set<Long>): Pair<FitGroups, String> {
    val chargeIds = buildJsonArray { charges.forEach { add(JsonPrimitive(it)) } }
    val groups = EchelonJson.decodeFromJsonElement(FitGroups.serializer(), call("fit.groups", buildJsonObject { put("items", fit.items); put("charges", chargeIds) }))
    val eft = call("fit.eft", buildJsonObject {
        put("ship", ship); title?.let { put("title", it) }; put("items", fit.items); put("charges", chargeIds)
        put("names", JsonObject(names.mapKeys { it.key.toString() }.mapValues { JsonPrimitive(it.value) }))
    }).jsonPrimitive.content
    return groups to eft
}

/** One pilot's input to jobs.wing: name, ESI jobs and skills (for slot counts). */
data class JobsInput(val name: String, val jobs: List<IndustryJob>, val skills: Skills?)

/** Encodes ESI records for the planners with every field: EchelonJson leaves defaults out, and jobs.js reads `status`. */
private val Full = kotlinx.serialization.json.Json(EchelonJson) { encodeDefaults = true }

/** Calls jobs.wing (jobs.js wingJobs). */
suspend fun PlannerBridge.wingJobs(pilots: List<JobsInput>, now: Long): WingJobs = EchelonJson.decodeFromJsonElement(WingJobs.serializer(), call("jobs.wing", buildJsonObject {
    put("now", now)
    put("pilots", buildJsonArray {
        pilots.forEach { p -> add(buildJsonObject {
            put("name", p.name)
            put("jobs", Full.encodeToJsonElement(ListSerializer(IndustryJob.serializer()), p.jobs))
            p.skills?.let { put("skills", Full.encodeToJsonElement(Skills.serializer(), it)) }
        }) }
    })
}))

/** Jobs of one pilot: their own snapshot when connected here, else what they share with the wing. */
fun jobsOf(state: PilotState?, wing: WingPilot?): List<IndustryJob>? {
    state?.private?.op("jobs")?.takeIf { it.permission != false && it.hasValue }?.value?.let { v ->
        return runCatching { EchelonJson.decodeFromJsonElement(ListSerializer(IndustryJob.serializer()), v) }.getOrNull()
    }
    return wing?.jobs
}

class FlyLoader(private val c: AppContainer) {
    private val names get() = c.fly.names

    private fun system(id: Long?): SolarSystem? = id?.let { c.market.state.value.data?.systems?.get(it) }

    private fun place(pilot: Pilot, systemId: Long?, station: Long?, structure: Long?, ship: Ship?, shipTypeOverride: Long? = null, shipName: String? = null): Whereabouts {
        val sys = system(systemId)
        val type = shipTypeOverride ?: ship?.shipTypeId
        return Whereabouts(
            pilot, systemName = sys?.name ?: systemId?.let { names.name(it) }, sec = sys?.sec, region = sys?.let { c.market.state.value.data?.regionName(it.region) },
            dockedAt = station?.let { names.name(it) ?: "a station" } ?: structure?.let { "a structure" },
            shipType = type, shipTypeName = type?.let { names.name(it) }, shipName = shipName ?: ship?.shipName, systemId = systemId,
        )
    }

    /** GET /api/live for [pilot], with names resolved; the wingmate from the wing summary. */
    suspend fun live(pilot: Pilot): LiveUi {
        val token = c.sessions.token(pilot.id)
        val mate = c.wing.of(pilot.wingmate)
        val (matePlace, mateNote) = when {
            mate == null -> null to "${pilot.wingmate.displayName} does not share with the wing."
            mate.location == null -> null to (if (mate.shareLevel < 2) "${pilot.wingmate.displayName} shares their skills only, not where they are." else "${pilot.wingmate.displayName}’s location has not synced yet.")
            else -> {
                names.resolve(listOfNotNull(mate.location.stationId, mate.ship?.shipTypeId, mate.location.solarSystemId.takeIf { system(it) == null }))
                place(pilot.wingmate, mate.location.solarSystemId, mate.location.stationId, mate.location.structureId, mate.ship)
                    .copy(at = mate.fetchedAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }) to null
            }
        }
        if (token == null) return LiveUi(problem = "${pilot.displayName} is not connected on this phone. Connect them in Settings.", wingmate = matePlace, wingmateNote = mateNote)
        return try {
            val l = c.api.live(token)
            names.resolve(listOfNotNull(l.station, l.shipType, l.system?.takeIf { system(it) == null }))
            val at = l.at?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: System.currentTimeMillis()
            val me = place(pilot, l.system, l.station, l.structure, null, l.shipType, l.shipName).copy(
                online = l.online?.online,
                lastSeen = l.online?.lastLogout?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }, at = at,
            )
            LiveUi(me = me, wingmate = matePlace, wingmateNote = mateNote)
        } catch (e: ApiError) {
            val msg = if (e is ApiError.Http && e.status == 429) "EVE’s live location can be read a few times a minute. Try again in a moment." else e.message ?: "The backend did not answer."
            LiveUi(problem = msg, wingmate = matePlace, wingmateNote = mateNote, rateLimited = e is ApiError.Http && e.status == 429)
        }
    }

    /** The current fit of [pilot]: their own snapshot when connected here, else the wing's shared fit (level 3). */
    suspend fun fit(pilot: Pilot): FitUi {
        val state = c.pilots.state(pilot)
        val mate = c.wing.of(pilot)
        val own = state.private?.op("fit")
        val ownShip = state.private?.op("ship")?.value?.let { runCatching { EchelonJson.decodeFromJsonElement(Ship.serializer(), it) }.getOrNull() }
        val ownFit = own?.takeIf { it.permission != false }?.value?.let(::rawFit)
        val (fit, ship, fromWing) = when {
            ownFit != null && ownShip != null -> Triple(ownFit, ownShip, false)
            mate?.fit != null && mate.ship != null && rawFit(mate.fit) != null -> Triple(rawFit(mate.fit)!!, mate.ship, true)
            else -> return FitUi(pilot, note = missing(state, own, "the current fit") ?: if (mate != null && mate.shareLevel < 3 && !state.connected) "${pilot.displayName} shares with the wing, but not their fit." else "No fit has synced yet.")
        }
        val types = fitTypes(fit)
        names.resolve(types + ship.shipTypeId)
        val charges = names.charges(types)
        val (groups, eft) = c.planners.fit(ship.shipTypeId, ship.shipName, fit, names.names.value, charges)
        return FitUi(pilot, ship.shipTypeId, ship.shipName, groups, names.names.value, eft, fromWing = fromWing)
    }

    /** The skill queue of [pilot]: private when connected here, else the public snapshot every pilot shares. */
    suspend fun skills(pilot: Pilot, now: Long): SkillsUi {
        val state = c.pilots.state(pilot)
        val (queue, skills, shared) = when {
            state.private != null -> Triple(state.private.queue, state.private.skills, false)
            state.public != null -> Triple(state.public.queue, state.public.skills, true)
            else -> return SkillsUi(pilot, note = state.problem?.message ?: "${pilot.displayName}’s training has not loaded yet. Pull down on the Fly hub to sync.")
        }
        names.resolve(queue.map { it.skillId })
        return SkillsUi(pilot, QueueState.of(queue, now), names.names.value, skills?.totalSp, shared = shared)
    }

    /** Both pilots' jobs through jobs.wing, with product names; [JobsUi.notes] says whose jobs are missing and why. */
    suspend fun jobs(now: Long): JobsUi {
        val notes = mutableListOf<String>()
        val inputs = Pilot.entries.mapNotNull { p ->
            val state = c.pilots.state(p)
            val list = jobsOf(state, c.wing.of(p))
            if (list == null) { notes += missing(state, state.private?.op("jobs"), "industry jobs") ?: "${p.displayName}’s jobs have not synced yet."; null }
            else JobsInput(p.displayName, list, state.private?.skills ?: state.public?.skills ?: c.wing.of(p)?.skills)
        }
        if (inputs.isEmpty()) return JobsUi(notes = notes)
        val w = c.planners.wingJobs(inputs, now)
        names.resolve(w.list.map { it.job.productTypeId ?: it.job.blueprintTypeId })
        return JobsUi(w, names.names.value, notes, computedAt = now)
    }
}
