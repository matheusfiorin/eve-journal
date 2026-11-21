package com.echelon.eve

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader

class EchelonApp : Application(), SingletonImageLoader.Factory {
    /** The app's object graph (manual DI); see AppContainer. */
    val container: AppContainer by lazy { AppContainer(this) }

    override fun onCreate() {
        super.onCreate()
        container.sync.refresh()
        com.echelon.eve.nav.Features.all.forEach { it.start(container) }
    }

    // Coil shares the app's OkHttp client, so portraits and type icons use its disk cache and connection pool.
    override fun newImageLoader(context: PlatformContext): ImageLoader = container.imageLoader
}
