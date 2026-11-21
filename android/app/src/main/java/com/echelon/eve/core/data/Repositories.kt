package com.echelon.eve.core.data

import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.api.EchelonApi
import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.api.Problem
import com.echelon.eve.core.auth.SessionStore
import com.echelon.eve.core.cache.UniverseCache
import com.echelon.eve.core.model.MarketData
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.PrivatePilot
import com.echelon.eve.core.model.PublicPilot
import com.echelon.eve.core.model.UniverseDoc
import com.echelon.eve.core.model.WingPilot
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * One wing pilot as the app knows them: connected on this phone (with their private snapshot) or not (with the public
 * snapshot only). [problem] says why private data is missing: an expired sign-in or an outage.
 */
data class PilotState(
    val pilot: Pilot,
    val connected: Boolean = false,
    val private: PrivatePilot? = null,
    val public: PublicPilot? = null,
    val problem: Problem? = null,
    val refreshing: Boolean = false,
) {
    val id: Long get() = pilot.id
    val name: String get() = pilot.displayName
}

/**
 * What the top bar's sync line says (ui/pilots.js syncStatus): syncing, synced at a time, a sign-in that expired, or
 * EVE/the backend not answering with the time of the data on screen.
 */
data class SyncState(val syncing: Boolean = false, val lastSyncedAt: Long? = null, val dataFrom: Long? = null, val expired: List<Pilot> = emptyList(), val outage: Problem? = null) {
    val ok: Boolean get() = expired.isEmpty() && outage == null
}

/** Pilots: both wing pilots, merged from the public snapshot and each connected pilot's private one. */
class PilotRepository(private val api: EchelonApi, private val sessions: SessionStore, private val clock: () -> Long = System::currentTimeMillis) {
    private val _pilots = MutableStateFlow(Pilot.entries.map { PilotState(it) })
    val pilots: StateFlow<List<PilotState>> = _pilots.asStateFlow()

    fun state(pilot: Pilot): PilotState = _pilots.value.first { it.pilot == pilot }

    /** Reloads everything; [force] asks the Worker to sync from ESI first (POST /api/sync) instead of reading the snapshot. */
    suspend fun refresh(force: Boolean = false) = coroutineScope {
        _pilots.update { list -> list.map { it.copy(refreshing = true, connected = sessions.has(it.id)) } }
        val shared = async { runCatching { api.publicPilots() }.getOrNull() }
        val results = Pilot.entries.map { p -> async { p to loadPrivate(p, force) } }.awaitAll().toMap()
        val publics = shared.await()
        _pilots.value = Pilot.entries.map { p ->
            val (record, problem) = results.getValue(p)
            PilotState(p, connected = sessions.has(p.id), private = record, public = publics?.firstOrNull { it.characterId == p.id } ?: state(p).public, problem = problem)
        }
    }

    private suspend fun loadPrivate(p: Pilot, force: Boolean): Pair<PrivatePilot?, Problem?> {
        val token = sessions.token(p.id) ?: return null to null
        return try {
            val record = if (force) api.sync(token) else api.session(token)
            if (record.characterId != p.id) { sessions.drop(p.id, token); return null to Problem(Problem.Kind.Expired, "The backend returned a different pilot. Connect again.") }
            sessions.extend(p.id, token, record.expires)
            record to null
        } catch (e: ApiError) {
            // Keep what was on screen during an outage; an expired sign-in has nothing to keep.
            (if (e is ApiError.Expired) null else state(p).private) to Problem.of(e)
        }
    }

    /** Ends [pilot]'s session everywhere (POST /api/disconnect: revokes the EVE grant too) and forgets it here. */
    suspend fun disconnect(pilot: Pilot) {
        val token = sessions.token(pilot.id)
        if (token != null) runCatching { api.disconnect(token) }
        sessions.drop(pilot.id, token)
        _pilots.update { list -> list.map { if (it.pilot == pilot) PilotState(pilot, public = it.public) else it } }
    }

    /** Forgets [pilot] on this phone only: the session is revoked, the pilot stays connected on other devices. */
    suspend fun signOutHere(pilot: Pilot) {
        val token = sessions.token(pilot.id) ?: return
        sessions.drop(pilot.id, token)
        api.revoke(token)
        _pilots.update { list -> list.map { if (it.pilot == pilot) PilotState(pilot, public = it.public) else it } }
    }
}

/** The wing summary (GET /api/wing), read with any connected pilot's session, the selected one first. */
class WingRepository(private val api: EchelonApi, private val sessions: SessionStore) {
    private val _wing = MutableStateFlow<List<WingPilot>>(emptyList())
    val wing: StateFlow<List<WingPilot>> = _wing.asStateFlow()
    private val _problem = MutableStateFlow<Problem?>(null)
    val problem: StateFlow<Problem?> = _problem.asStateFlow()

    suspend fun refresh(prefer: Pilot?) {
        val token = (listOfNotNull(prefer) + Pilot.entries).firstNotNullOfOrNull { sessions.token(it.id) } ?: run { _wing.value = emptyList(); return }
        try { _wing.value = api.wing(token); _problem.value = null } catch (e: ApiError) { _problem.value = Problem.of(e) }
    }

    fun of(pilot: Pilot): WingPilot? = _wing.value.firstOrNull { it.characterId == pilot.id }
}

/** The market (?v=2, revalidated with its ETag) and its universe document (cached on disk per version). */
class MarketRepository(private val api: EchelonApi, private val sessions: SessionStore, private val universeCache: UniverseCache) {
    data class State(val data: MarketData? = null, val universeJson: String? = null, val loading: Boolean = false, val problem: Problem? = null, val updatedAt: Long? = null)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()
    private val mutex = Mutex()
    private var universe: Pair<UniverseDoc, String>? = null

    suspend fun refresh() = mutex.withLock {
        _state.update { it.copy(loading = true) }
        try {
            val token = Pilot.entries.firstNotNullOfOrNull { sessions.token(it.id) }
            val got = api.market(token)
            // An unchanged market with the universe already in hand needs no work at all.
            if (!got.changed && _state.value.data != null) { _state.update { it.copy(loading = false, problem = null) }; return@withLock }
            val version = got.value.universeVersion
            val doc = if (got.value.universe == null && version != null) universeFor(version) else null
            _state.value = State(MarketData(got.value, doc?.first), doc?.second, updatedAt = System.currentTimeMillis())
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, problem = Problem.of(if (e is ApiError) e else ApiError.Invalid("The market data could not be read.", e))) }
        }
    }

    private suspend fun universeFor(version: String): Pair<UniverseDoc, String> {
        universe?.takeIf { it.first.version == version }?.let { return it }
        val text = universeCache.get(version)?.takeIf { runCatching { decode(it).version == version }.getOrDefault(false) }
            ?: api.universeText(version).also { universeCache.put(version, it) }
        return (decode(text) to text).also { universe = it }
    }

    private fun decode(text: String) = EchelonJson.decodeFromString(UniverseDoc.serializer(), text)
}
