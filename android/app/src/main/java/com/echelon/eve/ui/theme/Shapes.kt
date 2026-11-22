package com.echelon.eve.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.runtime.Immutable
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

val EchelonShapes = Shapes(
    extraSmall = RoundedCornerShape(Radii.chip),
    small = RoundedCornerShape(Radii.control),
    medium = RoundedCornerShape(Radii.panel),
    large = RoundedCornerShape(Radii.pop),
    extraLarge = RoundedCornerShape(Radii.pop),
)

/** The primary panel's silhouette: square corners with the top-right one cut at 45°. */
fun cutCornerShape(cut: Dp = Radii.cut): Shape = FormationShape(cut, 0.dp)

/**
 * The Formation motif as a shape: the top-end corner cut at 45° (the step of an echelon), the other three rounded by
 * [radius]. Primary panels, hub cards, primary buttons and the tab pill use it, so the step reads across the app.
 */
fun formationShape(cut: Dp = Radii.cut, radius: Dp = Radii.panel): Shape = FormationShape(cut, radius)

@Immutable
private data class FormationShape(val cut: Dp, val radius: Dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val c = with(density) { cut.toPx() }.coerceAtMost(size.minDimension / 2)
        val r = with(density) { radius.toPx() }.coerceAtMost(size.minDimension / 2)
        val rtl = layoutDirection == LayoutDirection.Rtl
        val path = Path().apply {
            // Drawn for LTR (cut at top-right); mirrored for RTL so the cut stays at the top-end corner.
            moveTo(r, 0f)
            lineTo(size.width - c, 0f)
            lineTo(size.width, c)
            lineTo(size.width, size.height - r)
            if (r > 0f) arcTo(Rect(size.width - 2 * r, size.height - 2 * r, size.width, size.height), 0f, 90f, false)
            lineTo(r, size.height)
            if (r > 0f) arcTo(Rect(0f, size.height - 2 * r, 2 * r, size.height), 90f, 90f, false)
            lineTo(0f, r)
            if (r > 0f) arcTo(Rect(0f, 0f, 2 * r, 2 * r), 180f, 90f, false)
            close()
            if (rtl) transform(androidx.compose.ui.graphics.Matrix().apply { scale(-1f, 1f); translate(-size.width, 0f) })
        }
        return Outline.Generic(path)
    }
}
