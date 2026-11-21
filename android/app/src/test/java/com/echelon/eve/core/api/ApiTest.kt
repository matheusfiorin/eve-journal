package com.echelon.eve.core.api

import com.echelon.eve.core.auth.MemoryBlobStore
import com.echelon.eve.core.auth.SessionStore
import com.echelon.eve.core.auth.StoredSession
import com.echelon.eve.core.auth.testCipher
import com.echelon.eve.core.cache.DiskConditionalCache
import com.echelon.eve.core.cache.UniverseCache
import com.echelon.eve.core.data.MarketRepository
import com.echelon.eve.core.data.PilotRepository
import com.echelon.eve.core.data.SyncCoordinator
import com.echelon.eve.core.data.WingRepository
import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.CopyOnWriteArrayList

private val T_FIO = "f".repeat(43)
private val T_DEC = "d".repeat(43)
private const val FIO = 2124810474L
private const val DEC = 2124815118L

// Shapes copied from e2e/fixtures.js (privateRecord, wingRecord, splitMarket, universeDoc), trimmed.
private fun privateRecord(id: Long, name: String) = """{"characterId":$id,"name":"$name","expires":${System.currentTimeMillis() + 600000},"fetchedAt":"2026-11-21T10:00:00Z",
 "queue":[{"queue_position":0,"skill_id":3300,"finished_level":5,"start_date":"2026-11-20T10:00:00Z","finish_date":"2026-11-23T10:00:00Z"}],
 "operations":{"wallet":{"permission":true,"value":12500000.25,"fetched":"2026-11-21T10:00:00Z"},"location":{"permission":true,"value":{"solar_system_id":30000142,"station_id":60003760}},
 "orders":{"permission":false},"ship":{"permission":true,"value":{"ship_type_id":605,"ship_name":"Our first explorer","ship_item_id":1001}}},
 "skills":{"total_sp":125000,"unallocated_sp":5000,"skills":[{"skill_id":3300,"trained_skill_level":4,"active_skill_level":3,"skillpoints_in_skill":90510}]},"futureField":{"x":1}}"""
private const val UNIVERSE = """{"version":"u1","universe":{"systems":{"30000142":["Jita",0.946,10000002,[30000144],0,[0,0,0],[0,0],20000020],"30000144":["Perimeter",0.95,10000002,[30000142],4,[1,0,1],[4,0],20000020]},"regions":{"10000002":"The Forge"}},"meta":{"ores":[],"combat":{"sb":[15000]},"skills":{"industry":3380}}}"""
private const val MARKET = """{"meta":{"region":0,"updatedAt":1,"data":{"types":{"34":{"n":"Tritanium","v":0.01}}}},"universe":null,"universeVersion":"u1","regions":[{"region":10000002,"updatedAt":2,"data":{"name":"The Forge","types":{"34":{"d":5000000,"s":[[60003760,5,1000000]],"b":[]}}}}]}"""

/** A fake Worker: routes by path, counts calls, answers 304 to a matching ETag, 401 to unknown sessions. */
class FakeWorker : Dispatcher() {
    val calls = CopyOnWriteArrayList<String>()
    var marketTag = "W/\"m1\""
    var valid = mutableSetOf(T_FIO, T_DEC)
    var down = false
    private fun json(body: String, code: Int = 200) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()
    override fun dispatch(request: RecordedRequest): MockResponse {
        val path = request.url.encodedPath; val auth = request.headers["Authorization"]?.removePrefix("Bearer ")
        calls += "${request.method} ${request.url.encodedPath}${request.url.encodedQuery?.let { "?$it" } ?: ""}${if (auth != null) " as ${auth.take(1)}" else ""}"
        if (down) return MockResponse.Builder().code(502).addHeader("Content-Type", "text/html").body("<html>Bad gateway</html>").build()
        if (auth != null && auth !in valid) return json("""{"error":"This dashboard session expired. Connect the pilot again."}""", 401)
        return when (path) {
            "/api/public/pilots" -> json("""{"pilots":[{"characterId":$FIO,"name":"Fiofka","skills":{"total_sp":125000},"queue":[],"fetchedAt":null,"stale":false},{"characterId":$DEC,"name":"Decxus","skills":{"total_sp":2000000},"queue":[],"stale":true}]}""")
            "/api/session", "/api/sync" -> json(privateRecord(if (auth == T_FIO) FIO else DEC, if (auth == T_FIO) "Fiofka" else "Decxus"))
            "/api/wing" -> json("""{"pilots":[{"characterId":$DEC,"name":"Decxus","sharing":true,"shareLevel":2,"wallet":40000000,"ship":{"ship_type_id":587,"ship_name":"Rifter rush"},"jobs":[{"job_id":7,"activity_id":4,"blueprint_type_id":1234,"runs":3,"status":"active","start_date":"2026-11-21T08:00:00Z","end_date":"2026-11-21T16:00:00Z","station_id":60003760}]}]}""")
            "/api/market" -> if (request.headers["If-None-Match"] == marketTag) MockResponse.Builder().code(304).addHeader("ETag", marketTag).build() else json(MARKET).newBuilder().addHeader("ETag", marketTag).build()
            "/api/market/universe" -> json(UNIVERSE).newBuilder().addHeader("ETag", "\"u-u1\"").build()
            else -> json("""{"error":"Not found."}""", 404)
        }
    }
}

class ApiTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private val worker = FakeWorker()
    private lateinit var sessions: SessionStore
    private lateinit var api: EchelonApi

    @Before fun setUp() {
        server = MockWebServer().apply { dispatcher = worker; start() }
        sessions = SessionStore(MemoryBlobStore(), testCipher())
        api = EchelonApi(server.url("/").toString(), OkHttpClient(), DiskConditionalCache(tmp.newFolder("cond"))) { token -> kotlinx.coroutines.runBlocking { sessions.dropToken(token) } }
    }
    @After fun tearDown() = server.close()

    private suspend fun connectBoth() {
        sessions.put(StoredSession(FIO, T_FIO, System.currentTimeMillis() + 86_400_000))
        sessions.put(StoredSession(DEC, T_DEC, System.currentTimeMillis() + 86_400_000))
    }

    @Test fun parsesTheSessionPayloadAndIgnoresUnknownFields() = runTest {
        val p = api.session(T_FIO)
        assertEquals(FIO, p.characterId)
        assertEquals(12500000.25, p.op("wallet")!!.value.toString().toDouble(), 0.001)
        assertEquals(false, p.op("orders")!!.permission)
        assertEquals(3300L, p.queue.single().skillId)
        assertEquals(125000L, p.skills!!.totalSp)
    }

    @Test fun marketRevalidatesWithItsEtagAndServesTheStoredCopyOn304() = runTest {
        val first = api.market(null)
        assertTrue(first.changed)
        val second = api.market(null)
        assertFalse(second.changed)
        assertEquals(first.value, second.value)
        val market = server.takeRequest(); val again = server.takeRequest()
        assertNull(market.headers["If-None-Match"])
        assertEquals("W/\"m1\"", again.headers["If-None-Match"])
        // The stored copy survives a new client (a process restart): the cache is on disk.
        val fresh = EchelonApi(server.url("/").toString(), OkHttpClient(), DiskConditionalCache(java.io.File(tmp.root, "cond")))
        assertFalse(fresh.market(null).changed)
    }

    @Test fun a401DropsOnlyThatPilotsToken() = runTest {
        connectBoth()
        worker.valid = mutableSetOf(T_DEC)
        val repo = PilotRepository(api, sessions)
        repo.refresh()
        val fio = repo.state(Pilot.Fiofka); val dec = repo.state(Pilot.Decxus)
        assertEquals(Problem.Kind.Expired, fio.problem?.kind)
        assertFalse(sessions.has(FIO))
        assertTrue(sessions.has(DEC))
        assertNotNull(dec.private); assertNull(dec.problem)
        assertEquals(2_000_000L, dec.public?.skills?.totalSp)
    }

    @Test fun anOutageIsNotAnExpiredSessionAndKeepsTheDataOnScreen() = runTest {
        connectBoth()
        val repo = PilotRepository(api, sessions)
        repo.refresh()
        assertNotNull(repo.state(Pilot.Fiofka).private)
        worker.down = true
        repo.refresh()
        val fio = repo.state(Pilot.Fiofka)
        assertEquals(Problem.Kind.Outage, fio.problem?.kind)
        assertEquals("The backend returned 502. Try again later.", fio.problem?.message) // an HTML error page, not a parse error
        assertNotNull(fio.private)
        assertTrue(sessions.has(FIO))
    }

    @Test fun offlineIsAnOutage() = runTest {
        val dead = EchelonApi("http://127.0.0.1:1/", OkHttpClient())
        val e = runCatching { dead.publicPilots() }.exceptionOrNull()
        assertTrue(e is ApiError.Offline)
        assertEquals(Problem.Kind.Outage, Problem.of(e!!).kind)
    }

    @Test fun marketMergesTheUniverseAndCachesItByVersion() = runTest {
        val cache = UniverseCache(tmp.newFolder("universe"))
        val repo = MarketRepository(api, sessions, cache)
        repo.refresh()
        val data = repo.state.value.data!!
        assertEquals("Jita", data.systems.getValue(30000142).name)
        assertEquals(listOf(30000144L), data.systems.getValue(30000142).links)
        assertEquals("The Forge", data.regionName(10000002))
        // Static meta (skills) and live meta (types) side by side, as ui/marketdata.js merges them.
        assertNotNull(data.metaData["skills"]); assertNotNull(data.metaData["types"])
        assertEquals(listOf("u1"), cache.versions())
        // A second repository (a restart) gets the universe from disk: one universe download in total.
        MarketRepository(api, sessions, cache).refresh()
        assertEquals(1, worker.calls.count { it.startsWith("GET /api/market/universe") })
        cache.put("u2", UNIVERSE.replace("\"u1\"", "\"u2\""))
        assertEquals(listOf("u2"), cache.versions()) // older versions go
    }

    @Test fun syncSummarizesExpiredAndOutage() = runTest {
        connectBoth()
        worker.valid = mutableSetOf(T_DEC)
        val scope = TestScope(StandardTestDispatcher(testScheduler))
        val pilots = PilotRepository(api, sessions); val wing = WingRepository(api, sessions); val market = MarketRepository(api, sessions, UniverseCache(tmp.newFolder("u")))
        val sync = SyncCoordinator(scope, pilots, wing, market, sessions, selected = { Pilot.Decxus })
        sync.refresh().also { scope.testScheduler.advanceUntilIdle() }.join()
        assertEquals(listOf(Pilot.Fiofka), sync.state.value.expired)
        assertEquals(40_000_000.0, wing.of(Pilot.Decxus)?.wallet)
        assertTrue(worker.calls.any { it == "GET /api/wing as d" })
    }
}
