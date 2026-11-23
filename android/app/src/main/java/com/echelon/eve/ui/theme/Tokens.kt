package com.echelon.eve.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Echelon design tokens: the "Formation" identity. Deep ink grounds with a violet cast, Ion violet as the UI accent,
// Flare magenta for brand moments only, and the two pilots' identity colours. Every colour, size, radius and motion
// value of the app lives here; screens read them through EchelonTheme, never as literals. Text colours pass WCAG AA
// (4.5:1) on every surface: textFaint is the weakest, 4.7:1 on surface3 (ColorContrastTest checks them all).

/** The palette. Dark-first; [Echelon.colors] is the one in use (the OLED option swaps the grounds). */
@Immutable
data class EchelonColors(
    // ground and surfaces: ink with a violet cast, each step a little lighter
    val bg: Color = Color(0xFF090C18),
    val bgGrid: Color = Color(0x1F8E96D6),
    val surface1: Color = Color(0xFF11152A),
    val surface2: Color = Color(0xFF181D36),
    val surface3: Color = Color(0xFF212744),
    val surfaceSunk: Color = Color(0xFF060811),
    val scrim: Color = Color(0xC4040610),
    // lines
    val line: Color = Color(0xFF252B4A),
    val lineStrong: Color = Color(0xFF3A4270),
    val tick: Color = Color(0xFF525C8E),
    // text
    val text: Color = Color(0xFFEEF0FA),
    val textMuted: Color = Color(0xFFA6ACCD),
    val textFaint: Color = Color(0xFF8A91B6),
    val textOnAccent: Color = Color(0xFF150D33),
    // UI accent: Ion violet, neither pilot's colour
    val accent: Color = Color(0xFFA58CFF),
    val accentStrong: Color = Color(0xFFCDBEFF),
    val accentSoft: Color = Color(0x26A58CFF),
    val accentLine: Color = Color(0x80A58CFF),
    // semantic
    val ok: Color = Color(0xFF5BE0A0),
    val okSoft: Color = Color(0x215BE0A0),
    val warn: Color = Color(0xFFFFC857),
    val warnSoft: Color = Color(0x21FFC857),
    val danger: Color = Color(0xFFFF7F70),
    val dangerSoft: Color = Color(0x21FF7F70),
    val info: Color = Color(0xFF7DB4FF),
    // brand: Flare is the second brand hue, for the emblem's beacon, celebrations and the hero glow (never a state)
    val flare: Color = Color(0xFFFF7AC6),
    /** The glow behind heroes, the selected tab and pressed cards: the accent at low alpha. */
    val glow: Color = Color(0x40A58CFF),
) {
    /** The brand gradient (Ion → Flare): the emblem's beacon, celebrations, a progress bar that completes. */
    val brand: List<Color> get() = listOf(accent, flare)

    companion object {
        val Space = EchelonColors()
        /** True black grounds for OLED screens; surfaces keep their steps so cards still separate. */
        val Oled = EchelonColors(bg = Color.Black, surfaceSunk = Color(0xFF040509), surface1 = Color(0xFF0C0F1E), surface2 = Color(0xFF13172B), surface3 = Color(0xFF1B2040))
    }
}

/** Pilot identity colours: who, never good or bad. Amber and cyan sit opposite each other and far from Ion violet. */
@Immutable
data class PilotColors(val color: Color, val soft: Color) {
    companion object {
        val Fiofka = PilotColors(Color(0xFFF0BB5C), Color(0x24F0BB5C))
        val Decxus = PilotColors(Color(0xFF5CD3DE), Color(0x245CD3DE))
        /** No pilot chosen yet: the UI accent stands in, as --pilot does on the web. */
        val None = PilotColors(Color(0xFFA58CFF), Color(0x26A58CFF))
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

/** Spacing on a 4 dp grid; [gutter] is the page side margin. */
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
    /** The smallest touch target (Material asks 48 dp). */
    val touch = 48.dp
    /** The widest a column of content grows on tablets and in landscape; the rest is ground. */
    val maxContent = 720.dp
}

/** Radii by hierarchy, plus popovers. Formation corners are tight; the 45° cut corner is the motif, so don't round further. */
object Radii {
    val chip = 3.dp
    val control = 6.dp
    val panel = 8.dp
    val pop = 12.dp
    /** The cut corner of primary panels, hub cards and the tab pill: the formation's step. */
    val cut = 14.dp
}

/** The type scale in sp. */
object TypeScale {
    val xs = 12.sp
    val sm = 13.sp
    val md = 15.sp
    val lg = 18.sp
    val xl = 22.sp
    val xxl = 28.sp
    val hero = 40.sp
}

/** Motion durations (ms). Everything answers an action; nothing loops but live things and the backdrop. */
object Durations {
    const val quick = 120
    const val short = 200
    const val medium = 320
    const val long = 560
    const val boot = 1100
    /** Between two items of a staggered entrance. */
    const val stagger = 40
    /** A celebration burst (timer done, goal reached), first spark to last fade. */
    const val celebrate = 1100
    /** The warp between destinations: streaks out, the new screen settling. */
    const val warp = 460
    /** One scan sweep revealing results (Explore, the Jump radar). */
    const val scan = 1100
    /** A wingmate's comet trail after their status changes. */
    const val trail = 720
    /** A ping or acknowledgement's ripple. */
    const val ripple = 900
    /** The skeleton developing into content. */
    const val develop = 420
}

object Easings {
    val out = CubicBezierEasing(.2f, .8f, .2f, 1f)
    val into = CubicBezierEasing(.6f, 0f, .8f, .2f)
    val inOut = CubicBezierEasing(.6f, 0f, .2f, 1f)
    /** The "lock-on" overshoot used when something settles into place. */
    val lock = CubicBezierEasing(.2f, 1.25f, .4f, 1f)
    /** Emphasised deceleration, for things arriving (entrances, the splash hand-off). */
    val emphasized = CubicBezierEasing(.05f, .7f, .1f, 1f)
}
