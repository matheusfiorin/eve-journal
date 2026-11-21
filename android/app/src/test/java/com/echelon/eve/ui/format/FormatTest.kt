package com.echelon.eve.ui.format

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

// Expected values were printed by the web's own functions (model.js compactNumber, map.js secColor/secText,
// route.js secShown/secClass) under Node, so both clients render the same figure.
class FormatTest {
    @Test fun compactNumberMatchesTheWeb() {
        val cases = listOf(0.0 to "0", 5.0 to "5", 999.4 to "999", 999.5 to "1,000", 1000.0 to "1.0k", 1049.0 to "1.0k", 1050.0 to "1.1k",
            1150.0 to "1.1k", 1250.0 to "1.3k", 99949.0 to "99.9k", 99950.0 to "100.0k", 100000.0 to "100k", 999999.0 to "1000k", 1e6 to "1.0M",
            12.5e6 to "12.5M", 125e6 to "125M", 1.25e9 to "1.3B", 2e12 to "2.0T", -1500.0 to "-1.5k", -12.55e6 to "-12.6M", 0.5 to "1", 2.5 to "3")
        for ((v, want) in cases) assertEquals("compactNumber($v)", want, compactNumber(v))
        assertEquals("—", compactNumber(Double.NaN))
    }

    @Test fun formatKinds() {
        assertEquals("12.5M ISK", format(12.5e6, Kind.Isk))
        assertEquals("41%", format(40.5, Kind.Pct))
        assertEquals("1d 6h", format(30.0, Kind.Hours))
        assertEquals("5h", format(5.4, Kind.Hours))
        assertEquals("1,250", format(1249.5))
        assertEquals("—", format(null))
        assertEquals("12,500,000.25 ISK", isk(12500000.25, Locale.US))
    }

    @Test fun durationsAndClocks() {
        assertEquals("1 min", duration(5.0))
        assertEquals("40 min", duration(40 * 60.0))
        assertEquals("5h 20m", duration(5 * 3600 + 20 * 60.0))
        assertEquals("2h", duration(7200.0))
        assertEquals("1d 6h", duration(30 * 3600.0))
        assertEquals("Finished", left(1000, now = 2000))
        assertEquals("Not scheduled", left(null))
        assertEquals("4:05", clock(245_000))
        assertEquals("4:05", clock(244_001)) // a countdown shows the second it is in, so it reaches 0:00 only at the end
        assertEquals("1:02:09", clock(3729_000))
        assertEquals("2d 03:10:00", clock((2 * 86400 + 3 * 3600 + 600) * 1000L))
        assertEquals("0:00", clock(-5))
        assertEquals("just now", ago(1_000, now = 30_000))
        assertEquals("3 min ago", ago(0, now = 180_000))
        assertEquals("2h ago", ago(0, now = 2 * 3_600_000 + 5))
        assertEquals("4d ago", ago(0, now = 4 * 86_400_000L))
    }

    @Test fun parseIskShorthand() {
        assertEquals(12_500_000L, parseIsk("12.5m"))
        assertEquals(2_000_000_000L, parseIsk("2b"))
        assertEquals(750_000L, parseIsk("750K ISK"))
        assertEquals(1_000_000L, parseIsk("1,000,000"))
        assertEquals(null, parseIsk("lots"))
    }

    @Test fun securityMatchesTheWeb() {
        // sec, shown, band, colour, text colour
        val cases = listOf(
            listOf(-1.0, -1.0, "null", 0xFF8D3264, 0xFFAF7093), listOf(0.0, 0.0, "null", 0xFF8D3264, 0xFFAF7093),
            listOf(0.01, 0.1, "low", 0xFF722020, 0xFFAA7979), listOf(0.25, 0.3, "low", 0xFFCE440F, 0xFFD56033),
            listOf(0.35, 0.4, "low", 0xFFDC6D07, 0xFFDC6D07), listOf(0.44, 0.4, "low", 0xFFDC6D07, 0xFFDC6D07),
            listOf(0.45, 0.5, "hi", 0xFFF3FD82, 0xFFF3FD82), listOf(0.65, 0.7, "hi", 0xFF60DBA3, 0xFF60DBA3),
            listOf(0.946, 0.9, "hi", 0xFF399AEB, 0xFF399AEB), listOf(0.95, 1.0, "hi", 0xFF2C75E1, 0xFF4183E4),
        )
        for ((sec, shown, band, color, text) in cases) {
            val s = sec as Double
            assertEquals("secShown($s)", shown as Double, secShown(s), 1e-9)
            assertEquals("secBand($s)", mapOf("hi" to SecBand.High, "low" to SecBand.Low, "null" to SecBand.Null)[band], secBand(s))
            assertEquals("secColor($s)", Color(color as Long).toArgb(), secColor(s).toArgb())
            assertEquals("secText($s)", Color(text as Long).toArgb(), secText(s).toArgb())
        }
        assertEquals("0.5", secLabel(0.46))
        assertEquals("0.0", secLabel(-0.04))
    }
}
