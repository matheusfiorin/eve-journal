package com.echelon.eve.ui.format

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToLong

// Number and time formatting shared with the web, so a figure reads the same in both clients:
// compactNumber is model.js compactNumber, format() is ui/shared.js format(), duration() and left() are ui/shared.js.
// JavaScript's toFixed rounds the exact binary value half up and Math.round rounds half toward +∞; the helpers below do
// the same, so 1.05e3 is "1.1k" and 1.15e3 is "1.1k" here too.

/** What a value means, for [format]: ISK (compact with the unit), a percentage, hours, or a plain count. */
enum class Kind { Isk, Pct, Hours, Count }

private fun jsRound(value: Double): Long = floor(value + 0.5).toLong()
private fun toFixed(value: Double, digits: Int): String = BigDecimal(abs(value)).setScale(digits, RoundingMode.HALF_UP).toPlainString().let { if (value < 0 && it.any { c -> c in '1'..'9' }) "-$it" else it }
private fun grouped(value: Long, locale: Locale = Locale.US): String = NumberFormat.getIntegerInstance(locale).format(value)

/** "12.5M", "750k", "1.3B", "999": the web's compactNumber. */
fun compactNumber(value: Double): String {
    if (!value.isFinite()) return "—"
    val a = abs(value)
    for ((n, unit) in listOf(1e12 to "T", 1e9 to "B", 1e6 to "M", 1e3 to "k")) if (a >= n) return toFixed(value / n, if (a / n >= 100) 0 else 1) + unit
    return grouped(jsRound(value))
}

/** The web's format(value, kind): "12.5M ISK", "40%", "1d 6h", "1,250". */
fun format(value: Double?, kind: Kind = Kind.Count): String {
    if (value == null || !value.isFinite()) return "—"
    return when (kind) {
        Kind.Isk -> "${compactNumber(value)} ISK"
        Kind.Pct -> "${jsRound(value)}%"
        Kind.Hours -> if (value >= 24) "${floor(value / 24).toLong()}d ${jsRound(value % 24)}h" else "${jsRound(value)}h"
        Kind.Count -> grouped(jsRound(value))
    }
}

/** compactNumber without a pointless ".0": "12M", "14.8M", "750k". */
fun iskShort(value: Double): String = compactNumber(value).replace(Regex("\\.0(?=[kMBT]|$)"), "")

/** A full amount with two decimals, as the web's isk(): "12,500,000.25 ISK". */
fun isk(value: Double, locale: Locale = Locale.getDefault()): String =
    NumberFormat.getNumberInstance(locale).apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }.format(value) + " ISK"

/** "1d 6h", "5h 20m", "40 min", from seconds; never less than a minute. */
fun duration(seconds: Double): String {
    val m = max(1L, jsRound(seconds / 60)); val h = m / 60; val d = h / 24
    return when {
        d > 0 -> "${d}d ${h % 24}h"
        h > 0 -> "${h}h" + if (m % 60 != 0L) " ${m % 60}m" else ""
        else -> "$m min"
    }
}

/** Time until [atMillis], in the duration style: "Finished" once it has passed. */
fun left(atMillis: Long?, now: Long = System.currentTimeMillis()): String {
    if (atMillis == null) return "Not scheduled"
    val ms = atMillis - now
    return if (ms <= 0) "Finished" else duration(ms / 1000.0)
}

/** A countdown clock for timers: "4:05", "1:02:09", "2d 03:10:00". Never negative. */
fun clock(remainingMillis: Long): String {
    val s = max(0L, (remainingMillis + 999) / 1000)
    val d = s / 86400; val h = s % 86400 / 3600; val m = s % 3600 / 60; val sec = s % 60
    return when {
        d > 0 -> "%dd %02d:%02d:%02d".format(d, h, m, sec)
        h > 0 -> "%d:%02d:%02d".format(h, m, sec)
        else -> "%d:%02d".format(m, sec)
    }
}

/** "12.5m", "2b", "750k", "1,000,000", "3 ISK" → a whole number of ISK; null when it isn't one. */
fun parseIsk(text: String): Long? {
    val t = text.trim().lowercase().replace(Regex("[,\\s_]"), "").removeSuffix("isk")
    val m = Regex("^(\\d*\\.?\\d+)([kmbt]?)$").find(t) ?: return null
    val mult = mapOf("" to 1.0, "k" to 1e3, "m" to 1e6, "b" to 1e9, "t" to 1e12).getValue(m.groupValues[2])
    return (m.groupValues[1].toDouble() * mult).roundToLong()
}

/** "just now", "3 min ago", "2h ago", "4d ago": how long since [atMillis]. */
fun ago(atMillis: Long, now: Long = System.currentTimeMillis()): String {
    val s = (now - atMillis) / 1000
    return when {
        s < 45 -> "just now"
        s < 3600 -> "${max(1L, jsRound(s / 60.0))} min ago"
        s < 86400 -> "${s / 3600}h ago"
        else -> "${s / 86400}d ago"
    }
}

fun plural(n: Int, one: String, many: String = "${one}s") = "$n ${if (n == 1) one else many}"
