package com.echelon.eve.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

// The web's line icons (index.html <symbol>s, 20-unit grid, 1.5 stroke), as Compose vectors. Strokes are black and
// take their colour from Icon's tint. Circles are written as two arcs.

private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r},${cy}a$r,$r 0 1,0 ${2 * r},0a$r,$r 0 1,0 ${-2 * r},0"

private fun lineIcon(name: String, vararg paths: String, filled: Set<Int> = emptySet(), size: Float = 20f) =
    ImageVector.Builder(name, 24.dp, 24.dp, size, size).apply {
        paths.forEachIndexed { i, d ->
            val nodes = PathParser().parsePathString(d).toNodes()
            if (i in filled) addPath(nodes, fill = SolidColor(Color.Black))
            else addPath(nodes, stroke = SolidColor(Color.Black), strokeLineWidth = 1.5f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
        }
    }.build()

object EchelonIcons {
    /** Plan: stacked diamonds (the web's Earn). */
    val Plan = lineIcon("plan", "M10 2.5 16 8l-6 5.5L4 8Z", "m4 12 6 5.5 6-5.5")
    /** Fly: the bridge reticle. */
    val Fly = lineIcon("fly", circle(10f, 10f, 5.5f), circle(10f, 10f, 1.2f), "M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3", filled = setOf(1))
    /** Corp: the ledger. */
    val Corp = lineIcon("corp", "M5 2.5h10a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16V4A1.5 1.5 0 0 1 5 2.5Z", "M7 2.5v15M9.5 7h4.5M9.5 10h4.5M9.5 13h3")
    val Wing = lineIcon("wing", "M2.5 10 7 3.5l4.5 6.5L7 8.2Z", "M8.5 16.5 13 10l4.5 6.5L13 14.7Z")
    val Route = lineIcon("route", circle(4.5f, 15f, 2f), circle(10f, 6f, 2f), circle(15.5f, 13f, 2f), "m5.6 13.3 3.3-5.6M11.3 7.5l3 3.9")
    val Pilot = lineIcon("pilot", "M10 2.5a5 5 0 0 1 5 5v5a5 5 0 0 1-10 0v-5a5 5 0 0 1 5-5Z", "M7.5 8.5h5M10 17.5v-3")
    val Search = lineIcon("search", circle(8.5f, 8.5f, 5f), "m12.5 12.5 4.5 4.5")
    val Refresh = lineIcon("refresh", "M16 10a6 6 0 1 1-1.8-4.3", "M16.5 3v3.5H13")
    val Swap = lineIcon("swap", "M4 7h11l-3-3M16 13H5l3 3")
    val Close = lineIcon("close", "m5 5 10 10M15 5 5 15")
    val Back = lineIcon("back", "M12 5 7 10l5 5M7.5 10h9")
    val Chevron = lineIcon("chevron", "m8 5 5 5-5 5")
    val Settings = lineIcon("settings", circle(10f, 10f, 2.5f), "M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4")
    val Logbook = lineIcon("logbook", "M5 2.5h10v15l-5-3.5-5 3.5Z")
    val Timer = lineIcon("timer", circle(10f, 11f, 6f), "M10 11V7.5M8 2.5h4")
    val Alert = lineIcon("alert", "M10 3 18 16.5H2Z", "M10 8v4", circle(10f, 14.3f, .6f), filled = setOf(2))
    val Check = lineIcon("check", "m4.5 10.5 3.5 3.5 7.5-8")
    val Plus = lineIcon("plus", "M10 4v12M4 10h12")
    val More = lineIcon("more", circle(4.5f, 10f, 1.5f), circle(10f, 10f, 1.5f), circle(15.5f, 10f, 1.5f), filled = setOf(0, 1, 2))
    val Link = lineIcon("link", "M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1", "M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1")
}
