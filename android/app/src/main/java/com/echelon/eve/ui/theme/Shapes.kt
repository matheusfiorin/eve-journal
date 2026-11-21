package com.echelon.eve.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection

val EchelonShapes = Shapes(
    extraSmall = RoundedCornerShape(Radii.chip),
    small = RoundedCornerShape(Radii.control),
    medium = RoundedCornerShape(Radii.panel),
    large = RoundedCornerShape(Radii.pop),
    extraLarge = RoundedCornerShape(Radii.pop),
)

/** The primary panel's silhouette: square corners with the top-right one cut at 45°, like .panel--primary. */
fun cutCornerShape(cut: Dp = Radii.cut): Shape = object : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val c = with(density) { cut.toPx() }
        return Outline.Generic(Path().apply { moveTo(0f, 0f); lineTo(size.width - c, 0f); lineTo(size.width, c); lineTo(size.width, size.height); lineTo(0f, size.height); close() })
    }
}
