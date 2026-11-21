package com.echelon.eve.core.js

import android.content.Context
import com.dokar.quickjs.QuickJs
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import java.util.concurrent.Executors
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

/**
 * The web's planners (route.js, exploration.js, industry.js, mining.js, market.js, hauling.js, sell.js) running in
 * QuickJS, so the app reuses their tested logic instead of a Kotlin port. The bundle (assets/planners.js, built by
 * scripts/bundle-android.mjs from android/js/planners.js) defines `EchelonPlanners.call(name, args)`: JSON in, JSON
 * out. One engine, one thread: calls are serialised, and the universe stays loaded inside the engine between them.
 *
 * Typed helpers cover the scaffold's needs; feature code calls [call] with its own names after adding them to the
 * entry's `api` table.
 */
class PlannerBridge(private val script: String, private val dispatcher: CoroutineDispatcher = defaultDispatcher()) : AutoCloseable {
    private val mutex = Mutex()
    private var engine: QuickJs? = null
    private val json = Json { ignoreUnknownKeys = true }

    private suspend fun js(): QuickJs = engine ?: QuickJs.create(dispatcher).also {
        // Planner loops are bounded, but a bad input must never hang the app.
        it.evaluationTimeoutMillis = 20_000
        it.memoryLimit = 256L * 1024 * 1024
        it.maxStackSize = 1024L * 1024
        it.evaluate<Any?>(script, "planners.js")
        engine = it
    }

    /** Calls `EchelonPlanners.call(name, args)`; [args] is a JSON object's text. Returns the result as JSON text. */
    suspend fun callRaw(name: String, args: String = "{}"): String = withContext(dispatcher) {
        mutex.withLock {
            // JSON is a JavaScript expression, so the arguments go in as a literal: no second parse, no escaping.
            js().evaluate<String>("EchelonPlanners.call(${JsonPrimitive(name)}, $args)", "call.js")
        }
    }

    suspend fun call(name: String, args: JsonElement = JsonObject(emptyMap())): JsonElement = json.parseToJsonElement(callRaw(name, args.toString()))

    /** The planner calls the bundle exposes, and each module's exports (for diagnostics and tests). */
    suspend fun names(): List<String> = withContext(dispatcher) { mutex.withLock { json.decodeFromString<List<String>>(js().evaluate<String>("EchelonPlanners.names()")) } }
    suspend fun modules(): Map<String, List<String>> = withContext(dispatcher) { mutex.withLock { json.decodeFromString<Map<String, List<String>>>(js().evaluate<String>("EchelonPlanners.modules()")) } }

    /**
     * Loads the gate map (the universe document's `universe` part, or the whole document) once; later calls reuse it.
     * [universeJson] goes in as text, so the 1 MB document is never parsed on the Kotlin side for this.
     */
    suspend fun loadUniverse(universeJson: String): Int {
        val out = callRaw("universe.load", "{\"universe\":${gateMapOf(universeJson)}}")
        return json.parseToJsonElement(out).jsonObject.getValue("systems").jsonPrimitive.int
    }

    /** The jump list from [from] to [to] (system ids, both ends included), or null when there is no gate route. */
    suspend fun path(from: Long, to: Long, safe: Boolean = true): List<Long>? =
        (call("route.path", buildJsonObject { put("from", from); put("to", to); put("safe", safe) }) as? JsonArray)?.map { it.jsonPrimitive.long }

    /** Gate jumps from [from] to every system within [max], whatever the security. */
    suspend fun within(from: Long, max: Int): Map<Long, Int> =
        call("route.within", buildJsonObject { put("from", from); put("max", max) }).jsonObject.mapKeys { it.key.toLong() }.mapValues { it.value.jsonPrimitive.int }

    override fun close() { engine?.close(); engine = null }

    companion object {
        const val ASSET = "planners.js"
        fun fromAssets(context: Context) = PlannerBridge(context.assets.open(ASSET).bufferedReader().use { it.readText() })

        // QuickJS keeps per-thread stack bookkeeping, so the engine lives on one thread of its own.
        private fun defaultDispatcher(): CoroutineDispatcher = Executors.newSingleThreadExecutor { r -> Thread(r, "planners").apply { isDaemon = true } }.asCoroutineDispatcher()

        // The universe document is {version, universe:{systems…}, meta}; the planners want the gate map itself.
        private fun gateMapOf(text: String): String {
            val head = text.trimStart().take(64)
            return if (head.startsWith("{\"version\"")) "($text).universe" else text
        }
    }
}
