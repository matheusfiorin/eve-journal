package com.echelon.eve.ui.theme

import android.provider.Settings
import androidx.compose.foundation.LocalIndication
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode

/** How the ground looks: the animated starfield over the plotting grid, the grid alone, or true black. */
enum class Backdrop { Space, Plain, Oled }

/** Motion: follow the system's animation setting, or always reduce. */
enum class MotionPref { System, Reduced }

@Immutable
data class ThemeSettings(val backdrop: Backdrop = Backdrop.Space, val motion: MotionPref = MotionPref.System)

val LocalEchelonColors = staticCompositionLocalOf { EchelonColors.Space }
val LocalEchelonType = staticCompositionLocalOf { EchelonType() }
val LocalPilot = staticCompositionLocalOf { PilotColors.None }
val LocalBackdrop = staticCompositionLocalOf { Backdrop.Space }
/** True when animations should be cut to the end state: the system "Remove animations" toggle or the app setting. */
val LocalReduceMotion = staticCompositionLocalOf { false }

/** The design system's entry point: `Echelon.colors.surface1`, `Echelon.type.num`, `Echelon.pilot.color`. */
object Echelon {
    val colors: EchelonColors @Composable @ReadOnlyComposable get() = LocalEchelonColors.current
    val type: EchelonType @Composable @ReadOnlyComposable get() = LocalEchelonType.current
    val pilot: PilotColors @Composable @ReadOnlyComposable get() = LocalPilot.current
    val reduceMotion: Boolean @Composable @ReadOnlyComposable get() = LocalReduceMotion.current
    val backdrop: Backdrop @Composable @ReadOnlyComposable get() = LocalBackdrop.current
}

/** Material 3 roles mapped from the tokens, so stock components (dialogs, switches, text fields) look native to Echelon. */
fun EchelonColors.toColorScheme(): ColorScheme = darkColorScheme(
    primary = accent, onPrimary = textOnAccent, primaryContainer = accentSoft, onPrimaryContainer = accentStrong,
    inversePrimary = accentStrong,
    secondary = info, onSecondary = surfaceSunk, secondaryContainer = surface3, onSecondaryContainer = text,
    tertiary = ok, onTertiary = surfaceSunk, tertiaryContainer = okSoft, onTertiaryContainer = ok,
    background = bg, onBackground = text,
    surface = surface1, onSurface = text, surfaceVariant = surface2, onSurfaceVariant = textMuted,
    surfaceTint = accent, inverseSurface = text, inverseOnSurface = bg,
    error = danger, onError = surfaceSunk, errorContainer = dangerSoft, onErrorContainer = danger,
    outline = lineStrong, outlineVariant = line, scrim = scrim,
    surfaceBright = surface3, surfaceDim = surfaceSunk,
    surfaceContainerLowest = surfaceSunk, surfaceContainerLow = bg, surfaceContainer = surface1,
    surfaceContainerHigh = surface2, surfaceContainerHighest = surface3,
)

/** Reads the system animator scale; 0 means the user turned animations off (Developer options or Accessibility). */
fun systemReducesMotion(context: android.content.Context): Boolean =
    runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)

@Composable
fun EchelonTheme(settings: ThemeSettings = ThemeSettings(), pilot: PilotColors = PilotColors.None, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val preview = LocalInspectionMode.current
    // Read once per composition of the theme; the activity recreates on configuration changes and on resume refreshes it.
    val systemReduced = remember(context) { !preview && systemReducesMotion(context) }
    val colors = if (settings.backdrop == Backdrop.Oled) EchelonColors.Oled else EchelonColors.Space
    CompositionLocalProvider(
        LocalEchelonColors provides colors,
        LocalEchelonType provides EchelonType(),
        LocalPilot provides pilot,
        LocalBackdrop provides settings.backdrop,
        LocalReduceMotion provides (systemReduced || settings.motion == MotionPref.Reduced),
    ) {
        MaterialTheme(colorScheme = colors.toColorScheme(), typography = EchelonTypography, shapes = EchelonShapes) {
            CompositionLocalProvider(LocalIndication provides ripple(color = colors.accent), content = content)
        }
    }
}
