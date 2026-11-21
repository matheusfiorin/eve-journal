package com.echelon.eve

import android.content.Context
import androidx.lifecycle.ProcessLifecycleOwner
import coil3.ImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.echelon.eve.core.api.EchelonApi
import com.echelon.eve.core.auth.AuthManager
import com.echelon.eve.core.auth.DataStoreBlobStore
import com.echelon.eve.core.auth.KeystoreCipher
import com.echelon.eve.core.auth.SessionStore
import com.echelon.eve.core.cache.DiskConditionalCache
import com.echelon.eve.core.cache.UniverseCache
import com.echelon.eve.core.data.DataStorePrefs
import com.echelon.eve.core.data.MarketRepository
import com.echelon.eve.core.data.PilotRepository
import com.echelon.eve.core.data.Prefs
import com.echelon.eve.core.data.SyncCoordinator
import com.echelon.eve.core.data.WingRepository
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.push.PushRegistrar
import com.echelon.eve.core.wing.WingChannel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import okhttp3.Cache
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Manual dependency injection: every long-lived object is built once here, in dependency order. Screens get what they
 * need through [LocalAppContainer] (nav.LocalAppContainer) or as ViewModel constructor arguments. Feature packages add
 * their own objects as `by lazy` properties in an extension file of theirs, or ask for the pieces below.
 */
class AppContainer(context: Context, val apiBase: String = BuildConfig.API_BASE) {
    private val app = context.applicationContext
    /** Lives as long as the process: refreshes and saves survive a screen going away. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** One HTTP client for the backend and the image server; a small disk cache serves EVE's immutable images. */
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(45, TimeUnit.SECONDS)
        .cache(Cache(File(app.cacheDir, "http"), 32L * 1024 * 1024))
        .build()

    val sessions = SessionStore(DataStoreBlobStore(app), KeystoreCipher())
    val api = EchelonApi(apiBase, http, DiskConditionalCache(File(app.cacheDir, "conditional")), onUnauthorized = { token -> scope.launch { sessions.dropToken(token) } })
    val auth = AuthManager(api, sessions)
    val prefs: Prefs = DataStorePrefs(app)
    val selectedPilot: StateFlow<Pilot?> = prefs.selectedPilot.stateIn(scope, SharingStarted.Eagerly, null)

    val pilots = PilotRepository(api, sessions)
    val wing = WingRepository(api, sessions)
    val market = MarketRepository(api, sessions, UniverseCache(File(app.filesDir, "universe")))
    val sync = SyncCoordinator(scope, pilots, wing, market, sessions, selected = { selectedPilot.value })

    /** The web planners running in QuickJS (core.js.PlannerBridge); the engine starts on first use (a 70 kB script). */
    val planners: PlannerBridge by lazy { PlannerBridge.fromAssets(app) }

    val imageLoader: ImageLoader = ImageLoader.Builder(app).components { add(OkHttpNetworkFetcherFactory(callFactory = { http })) }.crossfade(true).build()

    /**
     * The live wing room (timers, pings, presence, shared plans), connected as the flying pilot while the app is in
     * the foreground or a timer service holds it (WingChannel.onTimerServiceStarted/Stopped).
     */
    val wingChannel = WingChannel(http, api.base, scope, identity = { selectedPilot.value?.let { p -> sessions.token(p.id)?.let { p to it } } },
        onUnauthorized = { token -> scope.launch { sessions.dropToken(token) } })

    /** Optional FCM: registers this phone's token for every connected pilot; a no-op without google-services.json. */
    val push = PushRegistrar(app, api, scope) { Pilot.entries.mapNotNull { sessions.token(it.id) } }

    init {
        ProcessLifecycleOwner.get().lifecycle.addObserver(sync)
        ProcessLifecycleOwner.get().lifecycle.addObserver(wingChannel)
        // A new flying pilot or a new session reconnects the room as them and re-registers for pushes.
        scope.launch { combine(selectedPilot, sessions.sessions) { p, s -> p to s[p?.id]?.token }.distinctUntilChanged().collect { wingChannel.identityChanged(); push.refresh() } }
    }
}
