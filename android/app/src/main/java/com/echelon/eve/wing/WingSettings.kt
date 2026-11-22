package com.echelon.eve.wing

import android.content.Context
import com.echelon.eve.core.wing.WingStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** Where a pilot stood when a session started: the session's ISK and units are measured from here. */
@Serializable
data class Baseline(val wallet: Double? = null, val units: Long? = null)

/**
 * This phone's wing choices. Live status is opt-in ([shareStatus] false until the pilot turns it on); [route] is the
 * route this pilot follows and shares in follow mode (empty: none).
 */
interface WingSettings {
    val shareStatus: StateFlow<Boolean>
    val activity: StateFlow<String>
    val shareRoute: StateFlow<Boolean>
    val route: StateFlow<List<Long>>
    fun setShareStatus(on: Boolean)
    fun setActivity(activity: String)
    fun setShareRoute(on: Boolean)
    fun setRoute(route: List<Long>)
    fun baseline(key: String): Baseline?
    fun setBaseline(key: String, baseline: Baseline?)
}

/** In memory, for tests and previews. */
open class MemoryWingSettings(share: Boolean = false, activity: String = WingStatus.IDLE, shareRoute: Boolean = true, route: List<Long> = emptyList()) : WingSettings {
    protected val _share = MutableStateFlow(share)
    protected val _activity = MutableStateFlow(activity)
    protected val _shareRoute = MutableStateFlow(shareRoute)
    protected val _route = MutableStateFlow(route)
    protected val baselines = mutableMapOf<String, Baseline>()
    override val shareStatus: StateFlow<Boolean> = _share.asStateFlow()
    override val activity: StateFlow<String> = _activity.asStateFlow()
    override val shareRoute: StateFlow<Boolean> = _shareRoute.asStateFlow()
    override val route: StateFlow<List<Long>> = _route.asStateFlow()
    override fun setShareStatus(on: Boolean) { _share.value = on; saved() }
    override fun setActivity(activity: String) { if (activity in WingStatus.ACTIVITIES) { _activity.value = activity; saved() } }
    override fun setShareRoute(on: Boolean) { _shareRoute.value = on; saved() }
    override fun setRoute(route: List<Long>) { _route.value = route.take(60); saved() }
    override fun baseline(key: String): Baseline? = synchronized(baselines) { baselines[key] }
    override fun setBaseline(key: String, baseline: Baseline?) {
        synchronized(baselines) { if (baseline == null) baselines -= key else baselines[key] = baseline; while (baselines.size > 8) baselines.remove(baselines.keys.first()) }
        saved()
    }
    protected open fun saved() {}
}

/** Kept in the app's own SharedPreferences (`wing`), read once at start. Nothing in it is secret. */
class SharedWingSettings(context: Context) : MemoryWingSettings() {
    private val sp = context.getSharedPreferences("wing", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private val routeSer = ListSerializer(Long.serializer())
    private val baseSer = MapSerializer(String.serializer(), Baseline.serializer())

    init {
        _share.value = sp.getBoolean("shareStatus", false)
        _activity.value = sp.getString("activity", null)?.takeIf { it in WingStatus.ACTIVITIES } ?: WingStatus.IDLE
        _shareRoute.value = sp.getBoolean("shareRoute", true)
        _route.value = runCatching { json.decodeFromString(routeSer, sp.getString("route", "[]")!!) }.getOrDefault(emptyList())
        runCatching { baselines.putAll(json.decodeFromString(baseSer, sp.getString("baselines", "{}")!!)) }
    }

    override fun saved() {
        val b = synchronized(baselines) { baselines.toMap() }
        sp.edit().putBoolean("shareStatus", _share.value).putString("activity", _activity.value).putBoolean("shareRoute", _shareRoute.value)
            .putString("route", json.encodeToString(routeSer, _route.value)).putString("baselines", json.encodeToString(baseSer, b)).apply()
    }
}
