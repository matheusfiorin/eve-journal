package com.echelon.eve.core.api

import com.echelon.eve.core.cache.ConditionalCache
import com.echelon.eve.core.cache.MemoryConditionalCache
import com.echelon.eve.core.model.LiveStatus
import com.echelon.eve.core.model.MarketSnapshot
import com.echelon.eve.core.model.PrivatePilot
import com.echelon.eve.core.model.PublicPilot
import com.echelon.eve.core.model.PublicPilots
import com.echelon.eve.core.model.Redeemed
import com.echelon.eve.core.model.WingPilot
import com.echelon.eve.core.model.WingSummary
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** One JSON configuration for everything the Worker sends: unknown fields are fine, so a newer Worker never breaks us. */
val EchelonJson = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

/** A conditional GET's outcome: the body (fresh or from the stored copy on a 304) and whether it changed. */
data class Conditional<T>(val value: T, val changed: Boolean, val etag: String?)

/**
 * The Worker's HTTP API (worker/index.js), as backend.js speaks it. Sessions go as `Authorization: Bearer`. A 401 on a
 * session calls [onUnauthorized] with exactly the token that failed, so the store drops that pilot's session only if it
 * is still the same token (another sign-in may have replaced it meanwhile). Errors are [ApiError]s.
 *
 * Typed calls cover the shell's needs; feature code reaches the rest through [get] / [post] with its own models.
 */
class EchelonApi(
    baseUrl: String,
    private val client: OkHttpClient,
    private val cache: ConditionalCache = MemoryConditionalCache(),
    private val json: Json = EchelonJson,
    private val onUnauthorized: (token: String) -> Unit = {},
) {
    val base: HttpUrl = baseUrl.toHttpUrl().also { require(it.isHttps || it.host == "localhost" || it.host == "127.0.0.1") { "The backend URL must use HTTPS." } }

    fun url(path: String): HttpUrl = base.resolve(path) ?: throw IllegalArgumentException("Bad path $path")

    // Public
    suspend fun publicPilots(): List<PublicPilot> = get<PublicPilots>("/api/public/pilots").pilots

    /** The static universe document for [version], as text (it is cached on disk as is and parsed where needed). */
    suspend fun universeText(version: String): String = request(Request.Builder().url(url("/api/market/universe").newBuilder().addQueryParameter("v", version).build()).build(), null).text

    // Sessions
    suspend fun session(token: String): PrivatePilot = get("/api/session", token)
    suspend fun sync(token: String): PrivatePilot = post("/api/sync", token, null)
    suspend fun wing(token: String): List<WingPilot> = get<WingSummary>("/api/wing", token).pilots
    suspend fun live(token: String): LiveStatus = get("/api/live", token)
    suspend fun disconnect(token: String): JsonObject = post("/api/disconnect", token, null)
    suspend fun forget(token: String): JsonObject = post("/api/forget", token, JsonObject(emptyMap()))
    /** Ends one session at the Worker. Best effort: an unreachable Worker leaves it to expire on its own. */
    suspend fun revoke(token: String): Boolean = runCatching { post<JsonObject>("/api/session/revoke", token, null, dropOn401 = false); true }.getOrDefault(false)

    /** The mobile sign-in's last step (the Worker's /api/mobile/redeem): a one-time code and the PKCE verifier. */
    suspend fun redeem(code: String, verifier: String): Redeemed =
        post("/api/mobile/redeem", null, buildJsonObject { put("code", code); put("verifier", verifier) })

    /**
     * GET /api/market?v=2 with If-None-Match. Any signed-in pilot unlocks the regions the pilots fly in; without one the
     * Worker serves the trade hubs, so the stored copy is kept per signed-in state. An unchanged market is a 304 and
     * comes back from the stored copy with changed = false.
     */
    suspend fun market(token: String?): Conditional<MarketSnapshot> {
        val key = "market:v2:${if (token != null) "private" else "public"}"
        val got = conditional(Request.Builder().url(url("/api/market?v=2")), token, key)
        return Conditional(decode(MarketSnapshot.serializer(), got.value), got.changed, got.etag)
    }

    /** The journal sync protocol (ui/syncplan.js): records after a rev; changes against the rev each was based on. */
    suspend fun journalPull(token: String, since: Long): JsonObject = get("/api/journal?since=$since&prefs=1", token)
    suspend fun journalPush(token: String, changes: JsonElement): JsonObject = post("/api/journal", token, buildJsonObject { put("changes", changes) })

    // Generic access for feature packages: /api/corp, /api/assets, /api/waypoints, /api/sell-station, /api/contract-items …
    suspend inline fun <reified T> get(path: String, token: String? = null): T = decode(serializer<T>(), request(Request.Builder().url(url(path)).build(), token).text)
    suspend inline fun <reified T> post(path: String, token: String?, body: JsonElement?, dropOn401: Boolean = true): T =
        decode(serializer<T>(), request(Request.Builder().url(url(path)).post((body?.toString() ?: "").toRequestBody(JSON)).build(), token, dropOn401).text)

    // Plumbing

    class Raw(val status: Int, val text: String, val etag: String?)

    @PublishedApi internal fun <T> decode(s: KSerializer<T>, text: String): T =
        try { json.decodeFromString(s, text) } catch (e: SerializationException) { throw ApiError.Invalid("The backend sent an answer this app doesn’t understand.", e) } catch (e: IllegalArgumentException) { throw ApiError.Invalid("The backend sent an answer this app doesn’t understand.", e) }

    private suspend fun conditional(builder: Request.Builder, token: String?, key: String): Conditional<String> {
        val stored = cache.get(key)
        if (stored != null) builder.header("If-None-Match", stored.etag)
        val raw = request(builder.build(), token, allow304 = stored != null)
        if (raw.status == 304 && stored != null) return Conditional(stored.body, false, stored.etag)
        if (raw.etag != null) cache.put(key, ConditionalCache.Entry(raw.etag, raw.text)) else cache.remove(key)
        return Conditional(raw.text, true, raw.etag)
    }

    @PublishedApi internal suspend fun request(request: Request, token: String?, dropOn401: Boolean = true, allow304: Boolean = false): Raw {
        val r = request.newBuilder().header("Accept", "application/json").apply { if (token != null) header("Authorization", "Bearer $token") }.build()
        val response = try { client.newCall(r).await() } catch (e: IOException) { throw ApiError.Offline(e) }
        response.use {
            val text = it.body.string()
            if (it.code == 304 && allow304) return Raw(304, "", it.header("ETag"))
            if (!it.isSuccessful) {
                // A proxy or Cloudflare error page is HTML, not JSON: report the status rather than a parse error.
                val message = if (it.header("Content-Type")?.contains("json", true) == true) runCatching { json.parseToJsonElement(text).let { e -> (e as? JsonObject)?.get("error")?.jsonPrimitive?.contentOrNull } }.getOrNull() else null
                if (it.code == 401 && token != null) { if (dropOn401) onUnauthorized(token); throw ApiError.Expired(message ?: "This pilot’s sign-in expired. Connect again.") }
                throw ApiError.Http(it.code, message ?: "The backend returned ${it.code}. Try again later.", it.header("Retry-After")?.toLongOrNull())
            }
            return Raw(it.code, text, it.header("ETag"))
        }
    }

    companion object { val JSON = "application/json".toMediaType() }
}

/** OkHttp's callback API as a cancellable suspend call. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) { if (cont.isActive) cont.resume(response) else response.close() }
    })
}
