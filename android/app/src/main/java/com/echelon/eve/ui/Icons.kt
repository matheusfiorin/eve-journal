package com.echelon.eve.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

// The Formation icon set: line icons on a 20-unit grid with a 1.6 stroke, round caps and joins, drawn as Compose
// vectors. Strokes are black and take their colour from Icon's tint. Circles are written as two arcs. The three
// destinations have a "selected" twin (PlanSelected, …) with a filled core, which the tab bar crossfades to.

private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r},${cy}a$r,$r 0 1,0 ${2 * r},0a$r,$r 0 1,0 ${-2 * r},0"

private fun lineIcon(name: String, vararg paths: String, filled: Set<Int> = emptySet(), size: Float = 20f) =
    ImageVector.Builder(name, 24.dp, 24.dp, size, size).apply {
        paths.forEachIndexed { i, d ->
            val nodes = PathParser().parsePathString(d).toNodes()
            if (i in filled) addPath(nodes, fill = SolidColor(Color.Black), stroke = SolidColor(Color.Black), strokeLineWidth = 1.6f, strokeLineJoin = StrokeJoin.Round)
            else addPath(nodes, stroke = SolidColor(Color.Black), strokeLineWidth = 1.6f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
        }
    }.build()

// Shapes shared by an icon and its selected twin.
private const val PLAN_COURSE = "M3.5 16.5c3.5 0 3-5.5 6.5-5.5s3-5 6.5-5"
private const val PLAN_TARGET = "M16.5 2.2l2.3 2.3-2.3 2.3-2.3-2.3Z"
private const val FLY_BRACKETS = "M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"
private const val FLY_DART = "M10 5.8l3.2 7.4-3.2-1.7-3.2 1.7Z"
private const val CORP_HULL = "M10 2.3l6.7 3.85v7.7L10 17.7l-6.7-3.85v-7.7Z"
private const val CORP_CORE = "M10 7.4l2.3 1.3v2.6L10 12.6l-2.3-1.3V8.7Z"

object EchelonIcons {
    /** Plan: a plotted course to a target waypoint. */
    val Plan = lineIcon("plan", PLAN_COURSE, circle(3.5f, 16.5f, 1.4f), PLAN_TARGET)
    val PlanSelected = lineIcon("plan-selected", PLAN_COURSE, circle(3.5f, 16.5f, 1.4f), PLAN_TARGET, filled = setOf(1, 2))
    /** Fly: the HUD's target brackets around the leading dart. */
    val Fly = lineIcon("fly", FLY_BRACKETS, "M6.6 13.2 10 6l3.4 7.2")
    val FlySelected = lineIcon("fly-selected", FLY_BRACKETS, FLY_DART, filled = setOf(1))
    /** Corp: a structure's hull around its core. */
    val Corp = lineIcon("corp", CORP_HULL, CORP_CORE)
    val CorpSelected = lineIcon("corp-selected", CORP_HULL, CORP_CORE, filled = setOf(1))
    /** The wing: two darts in echelon, the brand's mark. */
    val Wing = lineIcon("wing", "M6.5 2.5l3.6 7.6-3.6-1.9-3.6 1.9Z", "M13.5 9.5l3.6 7.6-3.6-1.9-3.6 1.9Z", filled = setOf(0, 1))
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
    val Timer = lineIcon("timer", circle(10f, 11f, 6f), "M10 11V7.5M8 2.5h4M15 5l1.2-1.2")
    val Alert = lineIcon("alert", "M10 3 18 16.5H2Z", "M10 8v4", circle(10f, 14.3f, .6f), filled = setOf(2))
    val Check = lineIcon("check", "m4.5 10.5 3.5 3.5 7.5-8")
    val Plus = lineIcon("plus", "M10 4v12M4 10h12")
    val More = lineIcon("more", circle(4.5f, 10f, 1.2f), circle(10f, 10f, 1.2f), circle(15.5f, 10f, 1.2f), filled = setOf(0, 1, 2))
    val Link = lineIcon("link", "M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1", "M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1")
    /** A celebration: the four-point spark. */
    val Sparkle = lineIcon("sparkle", "M10 2.5l1.7 4.3 4.3 1.7-4.3 1.7L10 14.5l-1.7-4.3L4 8.5l4.3-1.7Z", "M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z", filled = setOf(1))
    /** An alert to the wingmate, a notification. */
    val Bell = lineIcon("bell", "M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 2h-13Z", "M8.3 17.5a1.8 1.8 0 0 0 3.4 0")
    /** A system or a waypoint to fly to. */
    val Waypoint = lineIcon("waypoint", "M10 17.5s-5.5-5-5.5-9a5.5 5.5 0 0 1 11 0c0 4-5.5 9-5.5 9Z", circle(10f, 8.5f, 1.8f))
    /** The cockpit: a gauge with its needle. */
    val Gauge = lineIcon("gauge", "M3.5 14.5a6.5 6.5 0 1 1 13 0", "M10 14.5l3-4.5", "M3.5 14.5h2M14.5 14.5h2M10 6.2V8")
    /** A target lock. */
    val Target = lineIcon("target", circle(10f, 10f, 6.5f), circle(10f, 10f, 2.2f), "M10 1.8v3M10 15.2v3M1.8 10h3M15.2 10h3")
}
