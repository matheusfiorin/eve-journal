package com.echelon.eve.plan.goals

import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.api.EchelonApi
import com.echelon.eve.core.auth.SessionStore
import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.UUID

// The wing's shared goals, as the website keeps them in the journal (kind `goal`, owned by the wing, ui/screens/wing.js
// and model.js validateBackup). A record is kept as the JSON it came as, so fields a newer website build added survive
// an edit made on the phone; these helpers read and change only the fields the app knows.

data class Step(val text: String, val done: Boolean)

/** One goal as the screen reads it; [record] is the full JSON and [rev] the server version it was read at. */
data class Goal(val record: JsonObject, val rev: Int) {
    private fun s(k: String) = (record[k] as? JsonPrimitive)?.contentOrNull
    val id: String get() = s("id") ?: ""
    val title: String get() = s("title") ?: ""
    val pilot: String get() = s("pilot") ?: "Both pilots"
    val done: Boolean get() = (record["done"] as? JsonPrimitive)?.booleanOrNull ?: false
    val category: String get() = s("category") ?: "Other"
    val due: String? get() = s("due")?.takeIf { it.isNotEmpty() }
    val notes: String? get() = s("notes")?.takeIf { it.isNotEmpty() }
    val target: Double? get() = (record["target"] as? JsonPrimitive)?.doubleOrNull
    val result: Double? get() = (record["result"] as? JsonPrimitive)?.doubleOrNull
    val updatedAt: Long get() = (record["updatedAt"] as? JsonPrimitive)?.longOrNull ?: 0
    val steps: List<Step> get() = (record["steps"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let { o -> Step((o["text"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null, (o["done"] as? JsonPrimitive)?.booleanOrNull ?: false) } }.orEmpty()
    /** The web's owner(): a goal named for one of the pilots is theirs, anything else is the wing's. */
    val owner: Pilot? get() = Pilot.entries.firstOrNull { it.displayName == pilot }
}

/** The form's fields, as text (the web's goal form). */
data class GoalFields(
    val title: String = "", val pilot: String = "Both pilots", val category: String = "Exploration", val due: String = "",
    val target: String = "", val result: String = "", val steps: String = "", val notes: String = "",
) {
    companion object {
        fun of(g: Goal) = GoalFields(g.title, g.pilot, g.category, g.due ?: "", g.target?.let { fmt(it) } ?: "", g.result?.let { fmt(it) } ?: "", g.steps.joinToString("\n") { it.text }, g.notes ?: "")
        private fun fmt(v: Double) = if (v == Math.floor(v) && Math.abs(v) < 1e15) v.toLong().toString() else v.toString()
    }
}

object GoalRules {
    val CATEGORIES = listOf("Exploration", "Training", "Ships", "Industry", "Combat", "Other")
    private val DATE = Regex("""^\d{4}-\d{2}-\d{2}$""")

    /** model.js editedAt: now, or one past the prior stamp if the clock is behind it. */
    fun editedAt(prior: Long?, now: Long) = maxOf(now, (prior ?: 0) + 1)

    /** Why the form can't be saved, in the web's terms (validateBackup's limits), or null. */
    fun problem(f: GoalFields): String? = when {
        f.title.isBlank() -> "Give the goal a title."
        f.title.length > 160 -> "Keep the title under 160 characters."
        f.due.isNotEmpty() && (!DATE.matches(f.due) || runCatching { java.time.LocalDate.parse(f.due) }.isFailure) -> "Write the target date as YYYY-MM-DD."
        f.target.isNotEmpty() && f.target.replace(",", "").toDoubleOrNull().let { it == null || Math.abs(it) >= 1e15 } -> "The target must be a number under a quadrillion ISK."
        f.result.isNotEmpty() && f.result.replace(",", "").toDoubleOrNull().let { it == null || Math.abs(it) >= 1e15 } -> "The result must be a number under a quadrillion ISK."
        f.steps.lines().count { it.isNotBlank() } > 30 -> "Use at most 30 steps."
        f.steps.lines().any { it.trim().length > 160 } -> "Keep each step under 160 characters."
        f.notes.length > 4000 -> "Keep the notes under 4,000 characters."
        else -> null
    }

    /**
     * A new goal, or [prior] with the form's fields. Fields this app doesn't know stay; a step keeps its tick when its
     * text is unchanged; done is never changed by the form.
     */
    fun apply(prior: Goal?, f: GoalFields, now: Long, newId: () -> String = { UUID.randomUUID().toString() }): JsonObject {
        val ticks = prior?.steps?.groupBy { it.text }?.mapValues { (_, v) -> v.first().done }.orEmpty()
        val steps = f.steps.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val number = { v: String -> v.replace(",", "").trim().takeIf { it.isNotEmpty() }?.toDoubleOrNull() }
        val base = prior?.record?.toMutableMap() ?: mutableMapOf()
        for (k in listOf("due", "category", "notes", "target", "result", "steps")) base.remove(k)
        base["id"] = JsonPrimitive(prior?.id ?: newId())
        base["title"] = JsonPrimitive(f.title.trim())
        base["pilot"] = JsonPrimitive(f.pilot)
        base["done"] = JsonPrimitive(prior?.done ?: false)
        if (f.due.isNotEmpty()) base["due"] = JsonPrimitive(f.due)
        if (f.category.isNotEmpty()) base["category"] = JsonPrimitive(f.category)
        if (f.notes.isNotBlank()) base["notes"] = JsonPrimitive(f.notes.trim())
        number(f.target)?.let { base["target"] = JsonPrimitive(it) }
        number(f.result)?.let { base["result"] = JsonPrimitive(it) }
        if (steps.isNotEmpty()) base["steps"] = buildJsonArray { steps.forEach { t -> add(buildJsonObject { put("text", t); put("done", ticks[t] ?: false) }) } }
        base["updatedAt"] = JsonPrimitive(editedAt(prior?.updatedAt, now))
        return JsonObject(base)
    }

    fun withDone(g: Goal, done: Boolean, now: Long) = JsonObject(g.record + mapOf("done" to JsonPrimitive(done), "updatedAt" to JsonPrimitive(editedAt(g.updatedAt, now))))

    fun withStep(g: Goal, index: Int, done: Boolean, now: Long): JsonObject {
        val steps = (g.record["steps"] as? JsonArray)?.mapIndexed { i, s -> if (i == index && s is JsonObject) JsonObject(s + ("done" to JsonPrimitive(done))) else s } ?: return g.record
        return JsonObject(g.record + mapOf("steps" to JsonArray(steps), "updatedAt" to JsonPrimitive(editedAt(g.updatedAt, now))))
    }

    /** ui/syncplan.js applyRemote: both sides changed it, so this phone's version stays as a copy with a new id. */
    fun conflictCopy(mine: JsonObject, now: Long, newId: () -> String = { UUID.randomUUID().toString() }): JsonObject {
        val title = (mine["title"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        return JsonObject(mine + mapOf("id" to JsonPrimitive(newId()), "title" to JsonPrimitive("${title.take(140)} (conflict copy)"),
            "updatedAt" to JsonPrimitive(editedAt((mine["updatedAt"] as? JsonPrimitive)?.longOrNull, now))))
    }
}

/**
 * The wing's goals, read from and written to the journal with any connected pilot's session (goals belong to the wing).
 * Each write is sent at the rev the goal was read at; when the website wrote first, its version keeps the id and this
 * phone's version is saved as a conflict copy, so nothing is lost.
 */
class GoalStore(private val api: EchelonApi, private val sessions: SessionStore, private val clock: () -> Long = System::currentTimeMillis) {
    private val mutex = Mutex()
    private val _goals = MutableStateFlow<List<Goal>?>(null)
    val goals: StateFlow<List<Goal>?> = _goals.asStateFlow()
    private val _problem = MutableStateFlow<String?>(null)
    val problem: StateFlow<String?> = _problem.asStateFlow()

    private fun token(prefer: Pilot?): String? = (listOfNotNull(prefer) + Pilot.entries).firstNotNullOfOrNull { sessions.token(it.id) }

    /** Reads every goal (all pages). */
    suspend fun refresh(prefer: Pilot?) = mutex.withLock {
        val token = token(prefer) ?: run { _problem.value = "Connect a pilot in Settings to see the wing’s goals."; return@withLock }
        try {
            val byId = linkedMapOf<String, Goal?>()
            var since = 0L
            var pages = 0
            while (pages++ < 20) {
                val page = api.journalPull(token, since)
                (page["records"] as? JsonArray)?.forEach { r ->
                    val o = r as? JsonObject ?: return@forEach
                    if ((o["kind"] as? JsonPrimitive)?.contentOrNull != "goal") return@forEach
                    val id = (o["id"] as? JsonPrimitive)?.contentOrNull ?: return@forEach
                    // A delete comes as record null: it removes the goal.
                    byId[id] = (o["record"] as? JsonObject)?.let { Goal(it, (o["rev"] as? JsonPrimitive)?.intOrNull ?: 0) }
                }
                if ((page["more"] as? JsonPrimitive)?.booleanOrNull != true) break
                since = (page["rev"] as? JsonPrimitive)?.longOrNull ?: break
            }
            _goals.value = byId.values.filterNotNull()
            _problem.value = null
        } catch (e: ApiError) { _problem.value = e.message }
    }

    /** Saves [record] over [prior] (null for a new goal). Returns a message for the person. */
    suspend fun save(prefer: Pilot?, prior: Goal?, record: JsonObject): String = write(prefer, prior?.id ?: idOf(record), prior?.rev ?: 0, record)

    suspend fun delete(prefer: Pilot?, g: Goal): String = write(prefer, g.id, g.rev, null)

    private fun idOf(r: JsonObject) = (r["id"] as JsonPrimitive).content

    private suspend fun write(prefer: Pilot?, id: String, base: Int, record: JsonObject?): String {
        val token = token(prefer) ?: return "Connect a pilot in Settings to change the wing’s goals."
        return try {
            val out = mutex.withLock {
                api.post<JsonObject>("/api/journal", token, buildJsonObject {
                    put("changes", buildJsonArray { add(buildJsonObject { put("kind", "goal"); put("id", id); put("base", base); put("record", record ?: JsonNull as JsonElement) }) })
                })
            }
            val conflict = (out["conflicts"] as? JsonArray)?.firstOrNull() as? JsonObject
            val message = when {
                (out["applied"] as? JsonArray)?.isNotEmpty() == true -> if (record == null) "Goal deleted." else "Goal saved. It syncs to your wingmate."
                conflict != null && record != null -> {
                    // The other side changed it first: theirs keeps the id, this edit becomes a copy.
                    val copy = GoalRules.conflictCopy(record, clock())
                    api.post<JsonObject>("/api/journal", token, buildJsonObject { put("changes", buildJsonArray { add(buildJsonObject { put("kind", "goal"); put("id", idOf(copy)); put("base", 0); put("record", copy) }) }) })
                    "Your wingmate changed this goal at the same time. Theirs is kept, and yours is saved as a conflict copy."
                }
                conflict != null -> "Your wingmate changed this goal just now, so it was not deleted."
                else -> "The backend didn’t take the change."
            }
            refresh(prefer)
            message
        } catch (e: ApiError) { e.message ?: "The backend didn’t answer." }
    }
}
