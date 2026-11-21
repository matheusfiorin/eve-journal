package com.echelon.eve.plan

import com.echelon.eve.core.api.EchelonApi
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * A pilot's small settings in the wing journal, as the website keeps them (ui/syncplan.js): kind `pref`, id
 * `<name>:<characterId>` (explored, haul), one record per pilot that only that pilot may write. These two calls are
 * the transport; each setting brings its own merge rule.
 */
class PrefJournal(private val api: EchelonApi) {
    /** A server copy: the record (null when there is none yet) and its rev, the base for the next write. */
    data class Copy(val record: JsonObject?, val rev: Int)

    sealed interface Push {
        data class Applied(val rev: Int) : Push
        /** Someone wrote first: their copy, to merge and send again. */
        data class Conflict(val copy: Copy) : Push
        data object Refused : Push
    }

    /** Reads every page of the caller's journal and returns the record [id] (`explored:<pilot>` and the like). */
    suspend fun pull(token: String, id: String): Copy {
        var since = 0L
        var found = Copy(null, 0)
        repeat(20) {
            val page = api.journalPull(token, since)
            (page["records"] as? JsonArray)?.forEach { r ->
                val o = r as? JsonObject ?: return@forEach
                if (o["kind"]?.jsonPrimitive?.contentOrNull == "pref" && o["id"]?.jsonPrimitive?.contentOrNull == id)
                    found = Copy(o["record"] as? JsonObject, o["rev"]?.jsonPrimitive?.intOrNull ?: 0)
            }
            if (page["more"]?.jsonPrimitive?.booleanOrNull != true) return found
            since = page["rev"]?.jsonPrimitive?.longOrNull ?: return found
        }
        return found
    }

    /** Writes [record] over the copy at [base] (0 for the first write). */
    suspend fun push(token: String, id: String, base: Int, record: JsonObject): Push {
        val out = api.post<JsonObject>("/api/journal", token, buildJsonObject {
            put("changes", buildJsonArray { add(buildJsonObject { put("kind", "pref"); put("id", id); put("base", base); put("record", record) }) })
        })
        (out["applied"] as? JsonArray)?.firstOrNull()?.let { a -> return Push.Applied((a as? JsonObject)?.get("rev")?.jsonPrimitive?.intOrNull ?: base) }
        (out["conflicts"] as? JsonArray)?.firstOrNull()?.let { c -> val o = c as JsonObject; return Push.Conflict(Copy(o["record"] as? JsonObject, o["rev"]?.jsonPrimitive?.intOrNull ?: base)) }
        return Push.Refused
    }
}
