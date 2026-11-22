package com.echelon.eve.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.echelon.eve.ui.motion.StaggerClock
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.EchelonColors
import com.echelon.eve.ui.theme.PilotColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/** The Formation palette's promises: WCAG AA text on every surface, and pilots that never look alike. */
class ColorContrastTest {
    private fun contrast(a: Color, b: Color): Double {
        val (hi, lo) = listOf(a.luminance().toDouble(), b.luminance().toDouble()).sortedDescending()
        return (hi + .05) / (lo + .05)
    }

    @Test fun textIsAaOnEverySurface() {
        for (palette in listOf(EchelonColors.Space, EchelonColors.Oled)) {
            val grounds = listOf(palette.bg, palette.surface1, palette.surface2, palette.surface3)
            val texts = mapOf("text" to palette.text, "textMuted" to palette.textMuted, "textFaint" to palette.textFaint, "accent" to palette.accent,
                "accentStrong" to palette.accentStrong, "ok" to palette.ok, "warn" to palette.warn, "danger" to palette.danger, "info" to palette.info,
                "Fiofka" to PilotColors.Fiofka.color, "Decxus" to PilotColors.Decxus.color)
            for (g in grounds) for ((name, t) in texts) assertTrue("$name on $g is ${contrast(t, g)}", contrast(t, g) >= 4.5)
        }
    }

    @Test fun primaryButtonLabelIsAa() = assertTrue(contrast(EchelonColors.Space.textOnAccent, EchelonColors.Space.accent) >= 4.5)

    @Test fun pilotsAreFarApartInHue() {
        val hue = { c: Color -> hsv(c) }
        val fio = hue(PilotColors.Fiofka.color); val dec = hue(PilotColors.Decxus.color); val ion = hue(EchelonColors.Space.accent)
        fun gap(a: Float, b: Float) = abs(a - b).let { if (it > 180) 360 - it else it }
        assertTrue(gap(fio, dec) > 90); assertTrue(gap(fio, ion) > 90); assertTrue(gap(dec, ion) > 60)
    }

    private fun hsv(c: Color): Float {
        val r = c.red; val g = c.green; val b = c.blue
        val max = maxOf(r, g, b); val min = minOf(r, g, b); val d = max - min
        if (d == 0f) return 0f
        val h = when (max) { r -> ((g - b) / d) % 6; g -> (b - r) / d + 2; else -> (r - g) / d + 4 } * 60
        return if (h < 0) h + 360 else h
    }
}

class StaggerClockTest {
    @Test fun delaysStepThenCap() {
        assertEquals(0L, StaggerClock.delayOf(0))
        assertEquals(3L * Durations.stagger, StaggerClock.delayOf(3))
        assertEquals(StaggerClock.MAX_SLOTS.toLong() * Durations.stagger, StaggerClock.delayOf(50))
        assertEquals(0L, StaggerClock.delayOf(-2))
    }

    @Test fun theLastSlotStillStartsWellUnderHalfASecond() = assertTrue(StaggerClock.delayOf(Int.MAX_VALUE) < 500)
}
