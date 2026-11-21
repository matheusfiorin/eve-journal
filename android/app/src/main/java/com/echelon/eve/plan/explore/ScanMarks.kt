package com.echelon.eve.plan.explore

import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.api.EchelonApi
import com.echelon.eve.core.auth.SessionStore
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.plan.PrefJournal
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File

/**
 * Systems a pilot marked as scanned, synced with the website through the journal: one `pref` record per pilot,
 * id `explored:<characterId>`, record `{id, marks:{systemId: ms}}` (ui/syncplan.js). Merging keeps the newest mark per
 * system, drops marks older than 90 days and keeps the newest 1000, the same rule as the web (mergePref, ageMarks).
 */
object Marks {
    const val DAYS = 90L
    const val MAX = 1000
    private const val DAY = 86_400_000L

    fun age(marks: Map<Long, Long>, now: Long): Map<Long, Long> {
        val cut = now - DAYS * DAY
        return marks.filter { (id, at) -> id in 10_000_000..99_999_999 && at > cut }.entries.sortedByDescending { it.value }.take(MAX).associate { it.key to it.value }
    }

    fun merge(here: Map<Long, Long>, there: Map<Long, Long>, now: Long): Map<Long, Long> {
        val out = there.toMutableMap()
        here.forEach { (id, at) -> out[id] = maxOf(at, out[id] ?: 0) }
        return age(out, now)
    }

    fun of(record: JsonObject?): Map<Long, Long> = (record?.get("marks") as? JsonObject)?.mapNotNull { (k, v) ->
        val id = k.toLongOrNull() ?: return@mapNotNull null
        val at = (v as? JsonPrimitive)?.longOrNull ?: return@mapNotNull null
        id to at
    }?.toMap().orEmpty()

    fun record(pilot: Pilot, marks: Map<Long, Long>) = buildJsonObject {
        put("id", "explored:${pilot.id}")
        put("marks", JsonObject(marks.entries.associate { it.key.toString() to JsonPrimitive(it.value) }))
    }
}

/** This phone's copy of each pilot's marks and the server copy it last agreed on (its rev), kept in a small file. */
@Serializable
private data class Saved(val marks: Map<Long, Long> = emptyMap(), val rev: Int = 0, val agreed: Map<Long, Long> = emptyMap())

class ScanMarks(
    api: EchelonApi,
    private val sessions: SessionStore,
    private val dir: File?,
    private val clock: () -> Long = System::currentTimeMillis,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val journal = PrefJournal(api)
    private val mutex = Mutex()
    private val saved = mutableMapOf<Pilot, Saved>()
    private val _marks = MutableStateFlow<Map<Pilot, Map<Long, Long>>>(emptyMap())
    /** Each pilot's marks (system id → when it was scanned). */
    val marks: StateFlow<Map<Pilot, Map<Long, Long>>> = _marks.asStateFlow()

    private fun file(p: Pilot) = dir?.let { File(it, "explored-${p.id}.json") }

    private suspend fun load(p: Pilot): Saved = saved[p] ?: withContext(io) {
        runCatching { file(p)?.takeIf { it.exists() }?.readText()?.let { json.decodeFromString(Saved.serializer(), it) } }.getOrNull() ?: Saved()
    }.also { saved[p] = it; _marks.update { m -> m + (p to Marks.age(it.marks, clock())) } }

    private suspend fun store(p: Pilot, s: Saved) {
        saved[p] = s
        _marks.update { m -> m + (p to Marks.age(s.marks, clock())) }
        withContext(io) { runCatching { file(p)?.let { f -> f.parentFile?.mkdirs(); f.writeText(json.encodeToString(Saved.serializer(), s)) } } }
    }

    suspend fun read(p: Pilot): Map<Long, Long> = mutex.withLock { Marks.age(load(p).marks, clock()) }

    /** Marks [system] as scanned now for [p], then syncs. */
    suspend fun mark(p: Pilot, system: Long) {
        mutex.withLock { val s = load(p); store(p, s.copy(marks = Marks.age(s.marks + (system to clock()), clock()))) }
        sync(p)
    }

    /**
     * Pulls the pilot's record, merges, and pushes the merge when it differs from the server's copy. A conflict (the
     * website wrote in between) is merged once more and sent again. Returns false when the pilot isn't connected here
     * or the backend could not be reached; the marks stay on the phone either way.
     */
    suspend fun sync(p: Pilot): Boolean = mutex.withLock {
        val token = sessions.token(p.id) ?: return@withLock false
        val id = "explored:${p.id}"
        try {
            var s = load(p)
            var copy = journal.pull(token, id)
            repeat(2) {
                val remote = Marks.of(copy.record)
                val merged = Marks.merge(s.marks, remote, clock())
                if (copy.record != null && merged == Marks.age(remote, clock())) { store(p, Saved(merged, copy.rev, merged)); return@withLock true }
                if (merged.isEmpty() && copy.record == null) { store(p, Saved(merged, 0, emptyMap())); return@withLock true }
                when (val r = journal.push(token, id, copy.rev, Marks.record(p, merged))) {
                    is PrefJournal.Push.Applied -> { store(p, Saved(merged, r.rev, merged)); return@withLock true }
                    is PrefJournal.Push.Conflict -> { s = s.copy(marks = merged); copy = r.copy }
                    PrefJournal.Push.Refused -> return@withLock false
                }
            }
            false
        } catch (e: ApiError) { false }
    }
}
