package com.echelon.eve.core.auth

import android.content.Context
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** One pilot's backend session: an opaque 43-character token and when it expires (epoch ms). */
@Serializable
data class StoredSession(val pilot: Long, val token: String, val expires: Long)

/** A sign-in that was started on this phone and has not come back yet: its PKCE verifier and when it began. */
@Serializable
data class PendingSignIn(val pilot: Long, val verifier: String, val at: Long)

@Serializable
internal data class Vault(val sessions: List<StoredSession> = emptyList(), val pending: List<PendingSignIn> = emptyList())

/** Where the sealed blob lives: DataStore on a device, memory in tests. */
interface BlobStore {
    suspend fun read(): ByteArray?
    suspend fun write(bytes: ByteArray?)
}

class MemoryBlobStore(var bytes: ByteArray? = null) : BlobStore {
    override suspend fun read() = bytes
    override suspend fun write(bytes: ByteArray?) { this.bytes = bytes }
}

private val Context.vaultStore: DataStore<Preferences> by preferencesDataStore("echelon-vault")

/** The sealed blob as one base64 preference: DataStore gives atomic writes and a single reader. */
class DataStoreBlobStore(private val context: Context) : BlobStore {
    private val key = stringPreferencesKey("vault")
    override suspend fun read(): ByteArray? = context.vaultStore.data.first()[key]?.let { runCatching { Base64.decode(it, Base64.NO_WRAP) }.getOrNull() }
    override suspend fun write(bytes: ByteArray?) { context.vaultStore.edit { if (bytes == null) it.remove(key) else it[key] = Base64.encodeToString(bytes, Base64.NO_WRAP) } }
}

/**
 * Per-pilot sessions, sealed with [cipher] (an Android Keystore AES-GCM key) and kept in [blob]. Mirrors backend.js:
 * one session per pilot, only the two wing pilots, a token is dropped only if it is still the one that failed, the
 * expiry only moves forward and never beyond 31 days, and expired sessions go quietly on load.
 *
 * It also keeps pending sign-ins (the PKCE verifier) so a sign-in survives the app being killed while the Custom Tab
 * is open; they are good for 30 minutes and used once.
 */
class SessionStore(private val blob: BlobStore, private val cipher: SessionCipher, private val clock: () -> Long = System::currentTimeMillis) {
    private val mutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }
    private var vault = Vault()
    private var loaded = false
    private val _sessions = MutableStateFlow<Map<Long, StoredSession>>(emptyMap())
    /** The live sessions by pilot id. */
    val sessions: StateFlow<Map<Long, StoredSession>> = _sessions.asStateFlow()

    suspend fun load() = mutex.withLock { ensure() }

    fun token(pilot: Long): String? = _sessions.value[pilot]?.takeIf { it.expires > clock() }?.token
    fun has(pilot: Long): Boolean = token(pilot) != null

    /** Stores a session from a redeemed sign-in; returns the token it replaced (to revoke at the Worker), if any. */
    suspend fun put(session: StoredSession): String? = mutex.withLock {
        ensure()
        require(session.pilot in Pilot.ids) { "Unknown pilot." }
        require(TOKEN.matches(session.token)) { "The session token is malformed." }
        require(session.expires > clock() && session.expires <= clock() + MAX_SESSION_MS) { "The session expiry is out of range." }
        val old = vault.sessions.firstOrNull { it.pilot == session.pilot }
        save(vault.copy(sessions = vault.sessions.filter { it.pilot != session.pilot } + session))
        old?.token?.takeIf { it != session.token }
    }

    /** Drops [pilot]'s session, but only if it is still [token] (null drops whatever is there). Returns whether it did. */
    suspend fun drop(pilot: Long, token: String? = null): Boolean = mutex.withLock {
        ensure()
        val s = vault.sessions.firstOrNull { it.pilot == pilot } ?: return@withLock false
        if (token != null && s.token != token) return@withLock false
        save(vault.copy(sessions = vault.sessions - s)); true
    }

    /** Drops whichever pilot holds [token] (a 401 knows the token, not always the pilot). */
    suspend fun dropToken(token: String): Boolean = vault.sessions.firstOrNull { it.token == token }?.let { drop(it.pilot, token) } ?: false

    /** The Worker slid the session forward: remember the later expiry, if the token is unchanged and the date is sane. */
    suspend fun extend(pilot: Long, token: String, expires: Long) = mutex.withLock {
        ensure()
        val s = vault.sessions.firstOrNull { it.pilot == pilot && it.token == token } ?: return@withLock
        if (expires > s.expires && expires <= clock() + MAX_SESSION_MS) save(vault.copy(sessions = vault.sessions.map { if (it === s) s.copy(expires = expires) else it }))
    }

    suspend fun begin(pending: PendingSignIn) = mutex.withLock {
        ensure()
        save(vault.copy(pending = vault.pending.filter { it.pilot != pending.pilot } + pending))
    }

    /** Takes (and removes) the pending sign-in for [pilot]; null if there is none or it is older than 30 minutes. */
    suspend fun takePending(pilot: Long): PendingSignIn? = mutex.withLock {
        ensure()
        val p = vault.pending.firstOrNull { it.pilot == pilot } ?: return@withLock null
        save(vault.copy(pending = vault.pending - p))
        p.takeIf { clock() - it.at in 0 until PENDING_MS }
    }

    private suspend fun ensure() {
        if (loaded) return
        loaded = true
        vault = runCatching { blob.read()?.let { json.decodeFromString(Vault.serializer(), cipher.open(it, AAD).decodeToString()) } }.getOrNull() ?: Vault()
        val now = clock()
        val clean = Vault(vault.sessions.filter { it.expires > now && it.pilot in Pilot.ids && TOKEN.matches(it.token) }, vault.pending.filter { now - it.at in 0 until PENDING_MS })
        if (clean != vault) save(clean) else publish()
    }

    private suspend fun save(next: Vault) {
        vault = next
        blob.write(if (next.sessions.isEmpty() && next.pending.isEmpty()) null else cipher.seal(json.encodeToString(Vault.serializer(), next).encodeToByteArray(), AAD))
        publish()
    }

    private fun publish() { _sessions.value = vault.sessions.associateBy { it.pilot } }

    companion object {
        val TOKEN = Regex("^[A-Za-z0-9_-]{43}$")
        const val MAX_SESSION_MS = 31L * 86_400_000
        const val PENDING_MS = 30L * 60_000
        private val AAD = "echelon:sessions:v1".encodeToByteArray()
    }
}
