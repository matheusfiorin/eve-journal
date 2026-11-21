package com.echelon.eve.core.auth

import com.echelon.eve.core.api.EchelonApi
import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.security.SecureRandom
import javax.crypto.spec.SecretKeySpec

/** A software AES key in place of the Keystore one: the same AES-GCM format, runnable on the JVM. */
fun testCipher(seed: Byte = 7) = AesGcmCipher { SecretKeySpec(ByteArray(32) { seed }, "AES") }

private val T1 = "a".repeat(43)
private val T2 = "b".repeat(43)
private const val NOW = 1_800_000_000_000L
private const val DAY = 86_400_000L

class PkceTest {
    @Test fun challengeMatchesTheWorkersChallenge() {
        // auth.js challenge('dBjftJeZ4CVP-mJ0dI8x1UaD0_Kl7dHxhyX8TVELpgw') under Node.
        assertEquals("OVCKnLGExZ1ngeUzZ0YHATHKiLpY0zuCB6PKGOxzNAM", Pkce.challengeOf("dBjftJeZ4CVP-mJ0dI8x1UaD0_Kl7dHxhyX8TVELpgw"))
    }

    @Test fun createdPairsAreUrlSafeAndFresh() {
        val a = Pkce.create(); val b = Pkce.create()
        assertEquals(43, a.verifier.length)
        assertTrue(Pkce.isVerifier(a.verifier))
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(a.challenge))
        assertEquals(Pkce.challengeOf(a.verifier), a.challenge)
        assertNotEquals(a.verifier, b.verifier)
    }

    @Test fun seededRandomGivesTheSamePair() {
        val r1 = SecureRandom.getInstance("SHA1PRNG").apply { setSeed(1L) }; val r2 = SecureRandom.getInstance("SHA1PRNG").apply { setSeed(1L) }
        assertEquals(Pkce.create(r1), Pkce.create(r2))
        assertFalse(Pkce.isVerifier("short"))
        assertFalse(Pkce.isVerifier("é".repeat(43)))
    }
}

class SessionStoreTest {
    private var now = NOW
    private val blob = MemoryBlobStore()
    private fun store(cipher: SessionCipher = testCipher()) = SessionStore(blob, cipher) { now }

    @Test fun storesPerPilotSessionsSealed() = runTest {
        val s = store()
        assertNull(s.put(StoredSession(Pilot.Fiofka.id, T1, NOW + DAY)))
        s.put(StoredSession(Pilot.Decxus.id, T2, NOW + DAY))
        assertEquals(T1, s.token(Pilot.Fiofka.id)); assertEquals(T2, s.token(Pilot.Decxus.id))
        // The blob is ciphertext: no token, no pilot id in the clear.
        val raw = blob.bytes!!.decodeToString(throwOnInvalidSequence = false)
        assertFalse(raw.contains(T1)); assertFalse(raw.contains(Pilot.Fiofka.id.toString()))
        // A new store over the same blob reads both back.
        val again = store(); again.load()
        assertEquals(setOf(Pilot.Fiofka.id, Pilot.Decxus.id), again.sessions.value.keys)
    }

    @Test fun replacingASessionReturnsTheOldTokenToRevoke() = runTest {
        val s = store()
        s.put(StoredSession(Pilot.Fiofka.id, T1, NOW + DAY))
        assertEquals(T1, s.put(StoredSession(Pilot.Fiofka.id, T2, NOW + DAY)))
        assertEquals(T2, s.token(Pilot.Fiofka.id))
    }

    @Test fun dropsOnlyTheTokenThatFailed() = runTest {
        val s = store()
        s.put(StoredSession(Pilot.Fiofka.id, T2, NOW + DAY)); s.put(StoredSession(Pilot.Decxus.id, T1, NOW + DAY))
        // A 401 for an older Fiofka token must not drop the session that replaced it, nor touch Decxus.
        assertFalse(s.drop(Pilot.Fiofka.id, T1))
        assertEquals(T2, s.token(Pilot.Fiofka.id))
        assertTrue(s.dropToken(T1))
        assertNull(s.token(Pilot.Decxus.id)); assertEquals(T2, s.token(Pilot.Fiofka.id))
    }

    @Test fun refusesBadSessions() = runTest {
        val s = store()
        assertThrows(IllegalArgumentException::class.java) { kotlinx.coroutines.runBlocking { s.put(StoredSession(123, T1, NOW + DAY)) } }
        assertThrows(IllegalArgumentException::class.java) { kotlinx.coroutines.runBlocking { s.put(StoredSession(Pilot.Fiofka.id, "short", NOW + DAY)) } }
        assertThrows(IllegalArgumentException::class.java) { kotlinx.coroutines.runBlocking { s.put(StoredSession(Pilot.Fiofka.id, T1, NOW - 1)) } }
        assertThrows(IllegalArgumentException::class.java) { kotlinx.coroutines.runBlocking { s.put(StoredSession(Pilot.Fiofka.id, T1, NOW + 40 * DAY)) } }
    }

    @Test fun expiryOnlyMovesForwardWithinBounds() = runTest {
        val s = store()
        s.put(StoredSession(Pilot.Fiofka.id, T1, NOW + DAY))
        s.extend(Pilot.Fiofka.id, T1, NOW + 10 * DAY); assertEquals(NOW + 10 * DAY, s.sessions.value.getValue(Pilot.Fiofka.id).expires)
        s.extend(Pilot.Fiofka.id, T1, NOW + 2 * DAY); assertEquals(NOW + 10 * DAY, s.sessions.value.getValue(Pilot.Fiofka.id).expires)
        s.extend(Pilot.Fiofka.id, T1, NOW + 60 * DAY); assertEquals(NOW + 10 * DAY, s.sessions.value.getValue(Pilot.Fiofka.id).expires)
        s.extend(Pilot.Fiofka.id, T2, NOW + 20 * DAY); assertEquals(NOW + 10 * DAY, s.sessions.value.getValue(Pilot.Fiofka.id).expires)
    }

    @Test fun expiredSessionsGoQuietlyOnLoad() = runTest {
        store().apply { put(StoredSession(Pilot.Fiofka.id, T1, NOW + DAY)); put(StoredSession(Pilot.Decxus.id, T2, NOW + 3 * DAY)) }
        now = NOW + 2 * DAY
        val later = store(); later.load()
        assertEquals(setOf(Pilot.Decxus.id), later.sessions.value.keys)
        assertFalse(later.has(Pilot.Fiofka.id))
    }

    @Test fun aBlobThatNoLongerOpensMeansNoSessions() = runTest {
        store().put(StoredSession(Pilot.Fiofka.id, T1, NOW + DAY))
        val other = store(testCipher(9)); other.load() // the Keystore key was lost: a different key
        assertTrue(other.sessions.value.isEmpty())
        blob.bytes = byteArrayOf(1, 2, 3)
        val broken = store(); broken.load()
        assertTrue(broken.sessions.value.isEmpty())
    }

    @Test fun pendingSignInsAreSingleUseAndExpire() = runTest {
        val s = store()
        s.begin(PendingSignIn(Pilot.Fiofka.id, "v".repeat(43), NOW))
        assertEquals("v".repeat(43), s.takePending(Pilot.Fiofka.id)?.verifier)
        assertNull(s.takePending(Pilot.Fiofka.id))
        s.begin(PendingSignIn(Pilot.Decxus.id, "w".repeat(43), NOW))
        now = NOW + 31 * 60_000
        assertNull(s.takePending(Pilot.Decxus.id))
    }

    @Test fun cipherBindsTheBlobToItsPurpose() {
        val c = testCipher()
        val sealed = c.seal("hello".encodeToByteArray(), "a".encodeToByteArray())
        assertArrayEquals("hello".encodeToByteArray(), c.open(sealed, "a".encodeToByteArray()))
        assertThrows(Exception::class.java) { c.open(sealed, "b".encodeToByteArray()) }
        assertNotEquals(sealed.toList(), c.seal("hello".encodeToByteArray(), "a".encodeToByteArray()).toList()) // a fresh IV each time
    }
}

/** The sign-in against a mocked Worker (the real /api/mobile/redeem is built separately). */
class AuthManagerTest {
    private lateinit var server: MockWebServer
    private var now = NOW
    private lateinit var store: SessionStore
    private lateinit var auth: AuthManager

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        store = SessionStore(MemoryBlobStore(), testCipher()) { now }
        val api = EchelonApi(server.url("/").toString(), OkHttpClient()) { token -> kotlinx.coroutines.runBlocking { store.dropToken(token) } }
        auth = AuthManager(api, store) { now }
    }
    @After fun tearDown() = server.close()

    private fun redeemOk(pilot: Long = Pilot.Fiofka.id, token: String = T1) =
        server.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body("""{"session":"$token","pilot":$pilot,"expires":${NOW + 30 * DAY}}""").build())

    @Test fun startOpensTheWorkersAuthStartWithAChallenge() = runTest {
        val pkce = Pkce.create()
        val url = auth.start(Pilot.Fiofka, pkce).toHttpUrl()
        assertEquals("/auth/start", url.encodedPath)
        assertEquals(Pilot.Fiofka.id.toString(), url.queryParameter("pilot"))
        assertEquals("android", url.queryParameter("client"))
        assertEquals(pkce.challenge, url.queryParameter("challenge"))
        assertEquals(AuthManager.State.Waiting(Pilot.Fiofka), auth.state.value)
    }

    @Test fun callbackRedeemsTheCodeWithTheVerifierAndStoresTheSession() = runTest {
        val pkce = Pkce.create()
        auth.start(Pilot.Fiofka, pkce)
        redeemOk()
        val result = auth.complete("K123", Pilot.Fiofka.id.toString())
        assertEquals(AuthManager.State.Connected(Pilot.Fiofka), result)
        assertEquals(T1, store.token(Pilot.Fiofka.id))
        val request = server.takeRequest()
        assertEquals("/api/mobile/redeem", request.url.encodedPath)
        assertEquals("POST", request.method)
        val body = Json.parseToJsonElement(request.body!!.utf8()).jsonObject
        assertEquals("K123", body["code"]!!.jsonPrimitive.content)
        assertEquals(pkce.verifier, body["verifier"]!!.jsonPrimitive.content)
        // The challenge the Worker saw at /auth/start is what the verifier hashes to.
        assertEquals(pkce.challenge, Pkce.challengeOf(body["verifier"]!!.jsonPrimitive.content))
    }

    @Test fun aCallbackThisPhoneDidNotStartIsRefused() = runTest {
        val result = auth.complete("K123", Pilot.Fiofka.id.toString())
        assertTrue(result is AuthManager.State.Failed)
        assertEquals(0, server.requestCount)
        assertNull(store.token(Pilot.Fiofka.id))
    }

    @Test fun eachCallbackIsTriedOnce() = runTest {
        auth.start(Pilot.Fiofka)
        server.enqueue(MockResponse.Builder().code(400).addHeader("Content-Type", "application/json").body("""{"error":"Invalid code."}""").build())
        val first = auth.complete("K123", Pilot.Fiofka.id.toString())
        assertEquals("That sign-in link has expired or was already used. Start again.", (first as AuthManager.State.Failed).message)
        assertTrue(auth.complete("K123", Pilot.Fiofka.id.toString()) is AuthManager.State.Failed)
        assertEquals(1, server.requestCount)
    }

    @Test fun refusesAnAnswerForAnotherPilotAndStaleSignIns() = runTest {
        auth.start(Pilot.Fiofka)
        redeemOk(pilot = Pilot.Decxus.id)
        assertTrue(auth.complete("K1", Pilot.Fiofka.id.toString()) is AuthManager.State.Failed)
        assertTrue(store.sessions.value.isEmpty())
        auth.start(Pilot.Decxus)
        now += 31 * 60_000
        assertTrue(auth.complete("K2", Pilot.Decxus.id.toString()) is AuthManager.State.Failed)
        assertTrue(auth.complete("K3", "999") is AuthManager.State.Failed)
    }

    @Test fun reconnectingRevokesTheReplacedSession() = runTest {
        store.put(StoredSession(Pilot.Fiofka.id, T1, NOW + DAY))
        auth.start(Pilot.Fiofka)
        redeemOk(token = T2)
        server.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body("""{"revoked":true}""").build())
        assertEquals(AuthManager.State.Connected(Pilot.Fiofka), auth.complete("K", Pilot.Fiofka.id.toString()))
        server.takeRequest()
        val revoke = server.takeRequest()
        assertEquals("/api/session/revoke", revoke.url.encodedPath)
        assertEquals("Bearer $T1", revoke.headers["Authorization"])
        assertEquals(T2, store.token(Pilot.Fiofka.id))
    }
}
