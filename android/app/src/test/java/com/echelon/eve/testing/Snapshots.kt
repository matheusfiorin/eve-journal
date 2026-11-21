package com.echelon.eve.testing

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInspectionMode
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.echelon.eve.ui.components.GridBackground
import com.echelon.eve.ui.theme.Backdrop
import com.echelon.eve.ui.theme.EchelonTheme
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.ThemeSettings

/**
 * The Paparazzi rule every screenshot test uses: a Pixel 8 in the app's window theme. [tall] renders the whole
 * scrolling height (component galleries) instead of one screen.
 */
fun echelonPaparazzi(tall: Boolean = false) = Paparazzi(
    deviceConfig = DeviceConfig.PIXEL_8,
    theme = "android:Theme.Material.NoActionBar",
    renderingMode = if (tall) RenderingMode.V_SCROLL else RenderingMode.NORMAL,
    maxPercentDifference = 0.1,
)

/** Renders [content] in EchelonTheme on the app ground. The starfield is still (inspection mode), so goldens are stable. */
fun Paparazzi.echelon(name: String? = null, pilot: PilotColors = PilotColors.Fiofka, backdrop: Backdrop = Backdrop.Space, content: @Composable () -> Unit) =
    snapshot(name) {
        CompositionLocalProvider(LocalInspectionMode provides true) {
            EchelonTheme(ThemeSettings(backdrop = backdrop), pilot) { GridBackground(Modifier.fillMaxSize()) { content() } }
        }
    }
