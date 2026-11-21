package com.echelon.eve.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

// The Worker's JSON, as worker/index.js sends it. Unknown fields are ignored (see Json in core.api), so a newer Worker
// never breaks an older app; fields the app does not model yet stay reachable as JsonElement.

/** The two pilots the Worker serves (worker/index.js ALLOWED). */
enum class Pilot(val id: Long, val displayName: String) {
    Fiofka(2124810474L, "Fiofka"), Decxus(2124815118L, "Decxus");
    /** The other pilot of the wing. */
    val wingmate: Pilot get() = if (this == Fiofka) Decxus else Fiofka
    companion object {
        fun of(id: Long?): Pilot? = entries.firstOrNull { it.id == id }
        val ids: Set<Long> = entries.map { it.id }.toSet()
    }
}

@Serializable
data class SkillQueueItem(
    @SerialName("skill_id") val skillId: Long,
    @SerialName("finished_level") val finishedLevel: Int,
    @SerialName("queue_position") val queuePosition: Int = 0,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("finish_date") val finishDate: String? = null,
)

@Serializable
data class Skill(
    @SerialName("skill_id") val skillId: Long,
    @SerialName("trained_skill_level") val trainedLevel: Int = 0,
    @SerialName("active_skill_level") val activeLevel: Int = 0,
    @SerialName("skillpoints_in_skill") val skillpoints: Long = 0,
)

@Serializable
data class Skills(
    @SerialName("total_sp") val totalSp: Long = 0,
    @SerialName("unallocated_sp") val unallocatedSp: Long = 0,
    val skills: List<Skill> = emptyList(),
)

/**
 * One ESI-backed field of the private snapshot (snapshot.operations.<key>): `permission` false means the pilot has not
 * granted that scope (they Reconnect to fix it); `error` is a sync problem; `value` is the data.
 */
@Serializable
data class Operation(val permission: Boolean? = null, val value: JsonElement? = null, val error: String? = null, val fetched: String? = null) {
    val hasValue: Boolean get() = value != null && value !is JsonNull
}

@Serializable
data class Location(@SerialName("solar_system_id") val solarSystemId: Long, @SerialName("station_id") val stationId: Long? = null, @SerialName("structure_id") val structureId: Long? = null) {
    val docked: Boolean get() = stationId != null || structureId != null
}

@Serializable
data class Ship(@SerialName("ship_type_id") val shipTypeId: Long, @SerialName("ship_name") val shipName: String = "", @SerialName("ship_item_id") val shipItemId: Long? = null)

@Serializable
data class IndustryJob(
    @SerialName("job_id") val jobId: Long,
    @SerialName("activity_id") val activityId: Int,
    @SerialName("blueprint_type_id") val blueprintTypeId: Long,
    @SerialName("product_type_id") val productTypeId: Long? = null,
    val runs: Int = 1,
    @SerialName("licensed_runs") val licensedRuns: Int? = null,
    val status: String = "active",
    @SerialName("start_date") val startDate: String,
    @SerialName("end_date") val endDate: String,
    @SerialName("station_id") val stationId: Long? = null,
    val cost: Double? = null,
)

/** The asset summary the Worker keeps: [types] is [typeId, quantity] pairs, largest first. */
@Serializable
data class AssetSummary(val items: Int = 0, val locations: Int = 0, val truncated: Boolean = false, val types: List<List<Long>> = emptyList())

/** GET /api/session (and POST /api/sync): the pilot's own private snapshot (privatePayload in worker/index.js). */
@Serializable
data class PrivatePilot(
    val characterId: Long,
    val name: String,
    /** When this session expires (epoch ms); the Worker slides it forward on each day of use. */
    val expires: Long,
    val fetchedAt: String? = null,
    val queue: List<SkillQueueItem> = emptyList(),
    val skills: Skills? = null,
    val operations: Map<String, Operation> = emptyMap(),
    val sellStation: Long? = null,
    val lastError: String? = null,
) {
    fun op(key: String): Operation? = operations[key]
}

/** GET /api/public/pilots: what anyone may see (skill total and queue), for pilots not connected on this device. */
@Serializable
data class PublicPilot(
    val characterId: Long,
    val name: String,
    val skills: Skills? = null,
    val queue: List<SkillQueueItem> = emptyList(),
    val fetchedAt: String? = null,
    val stale: Boolean = false,
)

@Serializable
data class PublicPilots(val pilots: List<PublicPilot>)

/**
 * GET /api/wing: each pilot who shares with the wing (and the caller). Consent level 2 adds ship, location, trail,
 * jobs and the mining ledger; level 3 adds the fit, hangar stacks, blueprints and planets. Missing means not shared.
 */
@Serializable
data class WingPilot(
    val characterId: Long,
    val name: String,
    val sharing: Boolean = false,
    val shareLevel: Int = 0,
    val lastError: String? = null,
    val fetchedAt: String? = null,
    val skills: Skills? = null,
    val wallet: Double? = null,
    val assets: AssetSummary? = null,
    val ship: Ship? = null,
    val location: Location? = null,
    val mining: JsonElement? = null,
    val trail: JsonElement? = null,
    val jobs: List<IndustryJob>? = null,
    val fit: JsonElement? = null,
    val stacks: JsonObject? = null,
    val blueprints: JsonElement? = null,
    val planets: JsonElement? = null,
)

@Serializable
data class WingSummary(val pilots: List<WingPilot>)

/** GET /api/live: the pilot's location, ship and online state read from ESI just now. */
@Serializable
data class LiveStatus(
    val system: Long? = null,
    val station: Long? = null,
    val structure: Long? = null,
    val shipType: Long? = null,
    val shipItem: Long? = null,
    val shipName: String? = null,
    /** Null when the pilot hasn't granted esi-location.read_online.v1. */
    val online: LiveOnline? = null,
    /** ISO-8601 time the Worker read ESI (worker/index.js liveRead). */
    val at: String? = null,
)

/** ESI /online/ as GET /api/live passes it on; login and logout are ISO-8601 strings. */
@Serializable
data class LiveOnline(val online: Boolean = false, val lastLogin: String? = null, val lastLogout: String? = null)

/** POST /api/mobile/redeem's answer: the new session for [pilot], valid until [expires] (epoch ms). */
@Serializable
data class Redeemed(val session: String, val pilot: Long, val expires: Long)
