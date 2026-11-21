package com.echelon.eve.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Echelon design tokens, ported from styles/tokens.css ("astrogation plotter"). Every colour, size, radius and motion
// value of the app lives here; screens read them through EchelonTheme, never as literals.

/** The palette. Dark-first, like the web; [Echelon.colors] is the one in use (the OLED option swaps the grounds). */
@Immutable
data class EchelonColors(
    // ground and surfaces
    val bg: Color = Color(0xFF0C1424),
    val bgGrid: Color = Color(0x0D94AADC),
    val surface1: Color = Color(0xFF121C2E),
    val surface2: Color = Color(0xFF18243A),
    val surface3: Color = Color(0xFF1F2E48),
    val surfaceSunk: Color = Color(0xFF0A1120),
    val scrim: Color = Color(0xB8060A14),
    // lines
    val line: Color = Color(0xFF24324B),
    val lineStrong: Color = Color(0xFF3A4D6E),
    val tick: Color = Color(0xFF4A5F84),
    // text
    val text: Color = Color(0xFFE7EDF7),
    val textMuted: Color = Color(0xFF9AAAC4),
    val textFaint: Color = Color(0xFF7486A3),
    val textOnAccent: Color = Color(0xFF140F2E),
    // UI accent: plotter violet, neither pilot's colour
    val accent: Color = Color(0xFFA99BFF),
    val accentStrong: Color = Color(0xFFC3B9FF),
    val accentSoft: Color = Color(0x24A99BFF),
    val accentLine: Color = Color(0x73A99BFF),
    // semantic
    val ok: Color = Color(0xFF62D99B),
    val okSoft: Color = Color(0x2162D99B),
    val warn: Color = Color(0xFFF4C55A),
    val warnSoft: Color = Color(0x21F4C55A),
    val danger: Color = Color(0xFFFF7E70),
    val dangerSoft: Color = Color(0x21FF7E70),
    val info: Color = Color(0xFF7FB2FF),
) {
    companion object {
        val Space = EchelonColors()
        /** True black grounds for OLED screens; surfaces keep their steps so cards still separate. */
        val Oled = EchelonColors(bg = Color.Black, surfaceSunk = Color(0xFF05080F), surface1 = Color(0xFF0D1422), surface2 = Color(0xFF131C2E), surface3 = Color(0xFF1A2740))
    }
}

/** Pilot identity colours: who, never good or bad. */
@Immutable
data class PilotColors(val color: Color, val soft: Color) {
    companion object {
        val Fiofka = PilotColors(Color(0xFFF0BB5C), Color(0x24F0BB5C))
        val Decxus = PilotColors(Color(0xFF5CD3DE), Color(0x245CD3DE))
        /** No pilot chosen yet: the UI accent stands in, as --pilot does on the web. */
        val None = PilotColors(Color(0xFFA99BFF), Color(0x24A99BFF))
        private val byId = mapOf(2124810474L to Fiofka, 2124815118L to Decxus)
        private val byName = mapOf("fiofka" to Fiofka, "decxus" to Decxus)
        fun of(id: Long?): PilotColors = byId[id] ?: None
        fun of(name: String?): PilotColors = byName[name?.lowercase()] ?: None
    }
}

/** Activity colours (the crew map branches). */
object ActivityColors {
    val Mining = Color(0xFFE8956A)
    val Industry = Color(0xFF8FB2FF)
    val Exploration = Color(0xFF6FE3C1)
    val Hauling = Color(0xFFF2D16B)
    val Combat = Color(0xFFFF8A8A)
    val Trade = Color(0xFFC3CEDF)
    val Wormholes = Color(0xFFD08CFF)
    val Pvp = Color(0xFFFF6FAE)
}

/** Spacing on a 4 dp grid; [gutter] is the page side margin (16 px on the web). */
object Spacing {
    val xxs = 2.dp
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 20.dp
    val xxl = 24.dp
    val xxxl = 32.dp
    val gutter = 16.dp
    /** The smallest touch target (the web's coarse-pointer rule is 44 px; Material asks 48 dp). */
    val touch = 48.dp
}

/** Three radii by hierarchy, plus popovers. Sharp corners are part of the plotter look; don't round further. */
object Radii {
    val chip = 2.dp
    val control = 4.dp
    val panel = 6.dp
    val pop = 8.dp
    /** The primary panel's cut corner. */
    val cut = 14.dp
}

/** The web's type scale in sp. */
object TypeScale {
    val xs = 12.sp
    val sm = 13.sp
    val md = 15.sp
    val lg = 18.sp
    val xl = 22.sp
    val xxl = 28.sp
    val hero = 40.sp
}

/** Motion durations (ms) and easings from tokens.css. Everything answers an action; nothing loops but live things. */
object Durations {
    const val quick = 120
    const val short = 200
    const val medium = 320
    const val long = 560
    const val boot = 1100
}

object Easings {
    val out = CubicBezierEasing(.2f, .8f, .2f, 1f)
    val into = CubicBezierEasing(.6f, 0f, .8f, .2f)
    val inOut = CubicBezierEasing(.6f, 0f, .2f, 1f)
    /** The "lock-on" overshoot used when something settles into place. */
    val lock = CubicBezierEasing(.2f, 1.25f, .4f, 1f)
}
