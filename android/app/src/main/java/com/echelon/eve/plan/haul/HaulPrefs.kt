package com.echelon.eve.plan.haul

import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.api.EchelonApi
import com.echelon.eve.core.auth.SessionStore
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.plan.PrefJournal
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import java.io.File

/**
 * The Haul plan as the website saves it (ui/prefs.js haulSave): stop names, cargo value, volume and avoided systems as
 * the form's text, and when a person last changed it. [updatedAt] moves only on a person's change, so a phone showing
 * its defaults never wins over a newer plan from another device.
 */
@Serializable
data class HaulPlan(val stops: List<String> = emptyList(), val value: String = "", val volume: String = "", val avoid: String = "", val updatedAt: Long = 0) {
    companion object {
        /** The saved one last wins; on a tie the server's, so every device settles on the same plan (mergePref). */
        fun merge(here: HaulPlan, there: HaulPlan?): HaulPlan = if (there != null && there.updatedAt >= here.updatedAt) there else here
    }
}

/** Each pilot's Haul plan on this phone, synced with the website through the journal (pref `haul:<characterId>`). */
class HaulPrefs(api: EchelonApi, private val sessions: SessionStore, private val dir: File?, private val io: CoroutineDispatcher = Dispatchers.IO) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val journal = PrefJournal(api)
    private val mutex = Mutex()
    private val cache = mutableMapOf<Pilot, Pair<HaulPlan, Int>>()

    private fun file(p: Pilot) = dir?.let { File(it, "haul-${p.id}.json") }

    @Serializable private data class Saved(val plan: HaulPlan = HaulPlan(), val rev: Int = 0)

    private suspend fun load(p: Pilot): Pair<HaulPlan, Int> = cache[p] ?: withContext(io) {
        runCatching { file(p)?.takeIf { it.exists() }?.readText()?.let { json.decodeFromString(Saved.serializer(), it) } }.getOrNull() ?: Saved()
    }.let { (it.plan to it.rev).also { v -> cache[p] = v } }

    private suspend fun store(p: Pilot, plan: HaulPlan, rev: Int) {
        cache[p] = plan to rev
        withContext(io) { runCatching { file(p)?.let { f -> f.parentFile?.mkdirs(); f.writeText(json.encodeToString(Saved.serializer(), Saved(plan, rev))) } } }
    }

    suspend fun read(p: Pilot): HaulPlan = mutex.withLock { load(p).first }

    /** Saves [plan]; [touched] (a person changed the form) stamps it newest. Then syncs. */
    suspend fun save(p: Pilot, plan: HaulPlan, touched: Boolean): HaulPlan {
        val saved = mutex.withLock {
            val (was, rev) = load(p)
            if (was.copy(updatedAt = 0) == plan.copy(updatedAt = 0)) return@withLock was
            plan.copy(updatedAt = if (touched) System.currentTimeMillis() else was.updatedAt).also { store(p, it, rev) }
        }
        return sync(p) ?: saved
    }

    /** Merges with the pilot's copy on the backend and returns the plan to show (null: not connected or offline). */
    suspend fun sync(p: Pilot): HaulPlan? = mutex.withLock {
        val token = sessions.token(p.id) ?: return@withLock null
        val id = "haul:${p.id}"
        try {
            val (here, _) = load(p)
            var copy = journal.pull(token, id)
            repeat(2) {
                val there = copy.record?.let { runCatching { json.decodeFromJsonElement(HaulPlan.serializer(), it) }.getOrNull() }
                val merged = HaulPlan.merge(here, there)
                if (merged == there) { store(p, merged, copy.rev); return@withLock merged }
                // Like the web (syncplan.js prefStep): a plan nobody changed is never sent, so defaults can't overwrite another device's plan.
                if (merged.updatedAt == 0L) return@withLock merged
                val record = JsonObject(mapOf("id" to kotlinx.serialization.json.JsonPrimitive(id)) + json.encodeToJsonElement(merged).jsonObject)
                when (val r = journal.push(token, id, copy.rev, record)) {
                    is PrefJournal.Push.Applied -> { store(p, merged, r.rev); return@withLock merged }
                    is PrefJournal.Push.Conflict -> copy = r.copy
                    PrefJournal.Push.Refused -> return@withLock merged
                }
            }
            load(p).first
        } catch (e: ApiError) { null }
    }
}
