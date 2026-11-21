package com.echelon.eve.ui.format

import androidx.compose.ui.graphics.Color
import kotlin.math.floor
import kotlin.math.pow

// Security status as the web shows it (route.js secShown/secClass, map.js secColor/secText/secBand).

enum class SecBand(val label: String) { High("high-sec"), Low("low-sec"), Null("null-sec") }

/** The rounded figure EVE shows: one decimal, and anything just above 0 counts as 0.1. */
fun secShown(sec: Double): Double = if (sec > 0 && sec < 0.05) 0.1 else floor(sec * 10 + 0.5) / 10

fun secBand(sec: Double): SecBand = secShown(sec).let { if (it >= 0.5) SecBand.High else if (it > 0) SecBand.Low else SecBand.Null }

// EVE's own palette from 0.0 and below (purple) to 1.0 (blue).
private val SEC = longArrayOf(0xFF8D3264, 0xFF722020, 0xFFBB1116, 0xFFCE440F, 0xFFDC6D07, 0xFFF3FD82, 0xFF71E554, 0xFF60DBA3, 0xFF4ECEF8, 0xFF399AEB, 0xFF2C75E1).map { Color(it) }
private fun index(sec: Double) = floor(secShown(sec) * 10 + 0.5).toInt().coerceIn(0, 10)

/** The in-game hue for the security light. */
fun secColor(sec: Double): Color = SEC[index(sec)]

// WCAG relative luminance and contrast, as map.js computes them.
private fun channel(v: Float) = if (v <= 0.03928f) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
fun luminance(c: Color) = 0.2126 * channel(c.red) + 0.7152 * channel(c.green) + 0.0722 * channel(c.blue)
fun contrast(a: Color, b: Color): Double { val x = luminance(a); val y = luminance(b); return (maxOf(x, y) + 0.05) / (minOf(x, y) + 0.05) }

/** [hex] lifted toward white in 5 % steps until it reaches [min] contrast on [bg] (the surface-1 card by default). */
fun readable(c: Color, bg: Color = Color(0xFF121C2E), min: Double = 4.5): Color {
    val rgb = intArrayOf((c.red * 255 + .5f).toInt(), (c.green * 255 + .5f).toInt(), (c.blue * 255 + .5f).toInt())
    var t = 0.0
    while (t <= 1.0001) {
        val out = rgb.map { floor(it + (255 - it) * t + 0.5).toInt() }.let { Color(it[0], it[1], it[2]) }
        if (contrast(out, bg) >= min) return out
        t += 0.05
    }
    return Color.White
}

private val SEC_TEXT = SEC.map { readable(it) }

/** The security figure's text colour: the hue, lifted where it would be too dark to read (the 0.0–0.3 reds). */
fun secText(sec: Double): Color = SEC_TEXT[index(sec)]

/** "0.5" with one decimal, as EVE shows it. */
fun secLabel(sec: Double): String = "%.1f".format(java.util.Locale.US, secShown(sec)).let { if (it == "-0.0") "0.0" else it }
