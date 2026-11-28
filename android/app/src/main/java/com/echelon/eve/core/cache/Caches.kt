package com.echelon.eve.core.cache

import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

/**
 * Stored answers for conditional GETs: the last ETag and body per request key, so a 304 can be served from disk even
 * after the process restarts. OkHttp's own cache won't do this: it never stores answers to authorised requests that
 * say `private, no-cache`, which is exactly what /api/market sends a signed-in pilot.
 */
interface ConditionalCache {
    fun get(key: String): Entry?
    fun put(key: String, entry: Entry)
    fun remove(key: String)
    data class Entry(val etag: String, val body: String)
}

class MemoryConditionalCache : ConditionalCache {
    private val map = java.util.concurrent.ConcurrentHashMap<String, ConditionalCache.Entry>()
    override fun get(key: String) = map[key]
    override fun put(key: String, entry: ConditionalCache.Entry) { map[key] = entry }
    override fun remove(key: String) { map.remove(key) }
}

/** One file pair per key under [dir], named by the key's hash (keys carry the pilot, which is not a file name). */
class DiskConditionalCache(private val dir: File) : ConditionalCache {
    private fun base(key: String) = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)
    override fun get(key: String): ConditionalCache.Entry? = runCatching {
        val b = base(key); val tag = File(dir, "$b.etag"); val body = File(dir, "$b.body")
        if (tag.exists() && body.exists()) ConditionalCache.Entry(tag.readText(), body.readText()) else null
    }.getOrNull()
    override fun put(key: String, entry: ConditionalCache.Entry) {
        runCatching { dir.mkdirs(); val b = base(key); atomicWrite(File(dir, "$b.body"), entry.body); atomicWrite(File(dir, "$b.etag"), entry.etag) }
    }
    override fun remove(key: String) { val b = base(key); File(dir, "$b.etag").delete(); File(dir, "$b.body").delete() }
}

/**
 * The static universe document (about 1 MB) keyed by version: it only changes with CCP's static data, so it is
 * downloaded once per version and kept here; older versions are deleted when a new one lands. Every step is optional:
 * a failed read is a miss and the document is simply fetched again (like ui/universecache.js).
 */
class UniverseCache(private val dir: File) {
    private fun file(version: String) = File(dir, "universe-${version.replace(Regex("[^A-Za-z0-9._-]"), "_")}.json")
    fun get(version: String): String? = runCatching { file(version).takeIf { it.exists() }?.readText() }.getOrNull()
    fun put(version: String, json: String) {
        runCatching {
            dir.mkdirs()
            val keep = file(version)
            atomicWrite(keep, json)
            dir.listFiles { f -> f.name.startsWith("universe-") && f != keep }?.forEach { it.delete() }
        }
    }
    fun versions(): List<String> = dir.listFiles()?.map { it.name }?.filter { it.startsWith("universe-") }?.map { it.removePrefix("universe-").removeSuffix(".json") } ?: emptyList()
}

/** Write to a temporary file, then rename, so a crash mid-write never leaves half a document behind. */
internal fun atomicWrite(target: File, text: String) {
    val tmp = File(target.parentFile, "${target.name}.tmp")
    tmp.writeText(text)
    // File.renameTo can refuse an existing target on Windows. Never delete the saved file as a fallback.
    try {
        Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } catch (_: AtomicMoveNotSupportedException) {
        Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
    }
}
