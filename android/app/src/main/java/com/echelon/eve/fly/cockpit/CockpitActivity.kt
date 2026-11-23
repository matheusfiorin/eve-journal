package com.echelon.eve.fly.cockpit

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.echelon.eve.EchelonApp
import com.echelon.eve.MainActivity
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.fly.fly
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.GridBackground
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PilotBadge
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.EchelonTheme
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.ThemeSettings
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch

/**
 * The cockpit on its own, for the home-screen widget and a long press on the Quick Settings tile: no tabs, no hub,
 * straight to the screen you keep next to the keyboard. "Open app" (and the cockpit's links to timers and the wing)
 * go to the full app.
 *
 * Picture-in-picture: while a timer runs, leaving the cockpit (home, recents, switching app) shrinks it into a PiP
 * window (CockpitPipScreen) with Pause/Resume and +1 min. API 31+ enters by itself (setAutoEnterEnabled, kept in step
 * with the timers); older phones enter from onUserLeaveHint. The params follow the timer state and the next-timer
 * card's bounds (the source-rect hint the system animates from).
 */
class CockpitActivity : ComponentActivity() {
    private val container by lazy { (application as EchelonApp).container }
    private var inPip by mutableStateOf(false)
    private var spec: PipSpec? = null
    private var anchor: android.graphics.Rect? = null
    private val pipSupported by lazy { packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        inPip = isInPictureInPictureMode
        addOnPictureInPictureModeChangedListener { inPip = it.isInPictureInPictureMode }
        // The PiP params follow the timers: a start, pause, resume or end changes the buttons and whether leaving enters PiP.
        // A slow tick catches a timer running out with nothing else changing.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.CREATED) {
                val tick = flow { while (true) { emit(Unit); delay(15_000) } }
                combine(container.fly.timers.timers, container.selectedPilot, tick) { t, p, _ -> pipSpec(t.values, p, System.currentTimeMillis()) }
                    .distinctUntilChanged().collect { spec = it; updatePip() }
            }
        }
        setContent {
            val theme by container.prefs.theme.collectAsStateWithLifecycle(ThemeSettings())
            val pilot by container.selectedPilot.collectAsStateWithLifecycle()
            CompositionLocalProvider(LocalAppContainer provides container) {
                EchelonTheme(theme, PilotColors.of(pilot?.id)) {
                    if (inPip) { KeepScreenOn(); CockpitPipRoute(pilot); return@EchelonTheme }
                    GridBackground(Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize().statusBarsPadding()) {
                            CockpitBar(pilot, onOpenApp = { openApp("Fly/cockpit") }, onClose = ::finish)
                            CompositionLocalProvider(LocalPipAnchor provides { r -> if (r != anchor) { anchor = r; updatePip() } }) {
                                CockpitRoute(ScreenContext(pilot, null, open = { d, key, _ -> openApp("${d.name}/$key") }, back = ::finish))
                            }
                        }
                    }
                }
            }
        }
    }

    private fun updatePip() {
        val s = spec ?: return
        if (!pipSupported) return
        runCatching { setPictureInPictureParams(pipParams(this, s, anchor)) }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Before API 31 there is no auto-enter: going home with a timer running enters PiP here.
        val s = spec
        if (Build.VERSION.SDK_INT < 31 && pipSupported && s?.autoEnter == true && !isInPictureInPictureMode) runCatching { enterPictureInPictureMode(pipParams(this, s, anchor)) }
    }

    /** Opens the app on that sub-screen ("Fly/wing") rather than its first tab. */
    private fun openApp(target: String) {
        startActivity(MainActivity.open(this, target))
        finish()
    }

    companion object {
        fun intent(context: Context): Intent = Intent(context, CockpitActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        fun pending(context: Context): PendingIntent = PendingIntent.getActivity(context, 2, intent(context), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}

/** The standalone cockpit's slim bar: close, the title, who is flying, and the way into the full app. */
@Composable
internal fun CockpitBar(pilot: Pilot?, onOpenApp: () -> Unit, onClose: () -> Unit) {
    val c = Echelon.colors
    Row(Modifier.fillMaxWidth().padding(start = Spacing.xs, end = Spacing.sm), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        IconButton(onClose, Modifier.size(48.dp)) { Icon(EchelonIcons.Close, "Close the cockpit", Modifier.size(20.dp), tint = c.textMuted) }
        Text("Cockpit", style = Echelon.type.screenTitle, color = c.text, modifier = Modifier.weight(1f))
        if (pilot != null) PilotBadge(pilot.displayName, PilotColors.of(pilot.id))
        LinkButton("Open app", onOpenApp)
    }
}
