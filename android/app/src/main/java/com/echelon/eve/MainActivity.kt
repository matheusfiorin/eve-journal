package com.echelon.eve

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.echelon.eve.core.auth.AuthManager
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.nav.EchelonShell
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ShellViewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val container by lazy { (application as EchelonApp).container }
    private val shell: ShellViewModel by viewModels { viewModelFactory { initializer { ShellViewModel(container, BuildConfig.VERSION_NAME) } } }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        // Dark bars with light icons whatever the system theme: the app is dark-first like the web.
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { !shell.state.value.ready }
        // The hand-off: the assembled formation lifts and grows a little while the splash fades into the app. View
        // animators follow the system animation scale (instant when animations are off); the app's own "Reduce
        // motion" setting removes the splash at once.
        splash.setOnExitAnimationListener { provider ->
            if (shell.state.value.theme.motion == com.echelon.eve.ui.theme.MotionPref.Reduced) { provider.remove(); return@setOnExitAnimationListener }
            val ease = android.view.animation.PathInterpolator(.05f, .7f, .1f, 1f)
            runCatching { provider.iconView.animate().scaleX(1.18f).scaleY(1.18f).translationY(-provider.iconView.height * .06f).setInterpolator(ease).setDuration(320).start() }
            provider.view.animate().alpha(0f).setStartDelay(80).setDuration(280).setInterpolator(ease).withEndAction { provider.remove() }.start()
        }
        if (savedInstanceState == null) handle(intent)
        setContent {
            val state by shell.state.collectAsStateWithLifecycle()
            CompositionLocalProvider(LocalAppContainer provides container) {
                EchelonShell(state, shell.actions(connect = ::connect))
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        // Back from the Custom Tab without the callback: the sign-in was abandoned (its verifier stays for a late link).
        if (container.auth.state.value is AuthManager.State.Waiting && intent?.data == null) container.auth.cancelled()
    }

    /** echelon://auth/callback?code=…&pilot=… from the Worker after EVE SSO. */
    private fun handle(intent: Intent?) {
        val uri = intent?.data ?: return
        if (!container.auth.isCallback(uri)) return
        setIntent(Intent(intent).setData(null))
        lifecycleScope.launch {
            val result = container.auth.complete(uri)
            if (result is AuthManager.State.Connected) container.sync.refresh(force = false)
        }
    }

    private fun connect(pilot: Pilot) {
        lifecycleScope.launch {
            val url = container.auth.start(pilot)
            val colors = CustomTabColorSchemeParams.Builder().setToolbarColor(0xFF090C18.toInt()).setNavigationBarColor(0xFF090C18.toInt()).build()
            CustomTabsIntent.Builder().setDefaultColorSchemeParams(colors).setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK).setShowTitle(true).build()
                .launchUrl(this@MainActivity, url.toUri())
        }
    }
}
