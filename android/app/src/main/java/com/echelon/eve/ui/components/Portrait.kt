package com.echelon.eve.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Radii

/** EVE's image server. Sizes are powers of two from 32 to 1024; ask for twice the drawn size for sharp pixels. */
object EveImages {
    private const val BASE = "https://images.evetech.net"
    private fun px(dp: Dp) = listOf(32, 64, 128, 256, 512, 1024).first { it >= dp.value * 2 || it == 1024 }
    fun portrait(characterId: Long, size: Dp = 40.dp) = "$BASE/characters/$characterId/portrait?size=${px(size)}"
    fun typeIcon(typeId: Long, size: Dp = 32.dp) = "$BASE/types/$typeId/icon?size=${px(size).coerceAtMost(64)}"
    fun typeRender(typeId: Long, size: Dp = 128.dp) = "$BASE/types/$typeId/render?size=${px(size)}"
    fun corpLogo(corporationId: Long, size: Dp = 32.dp) = "$BASE/corporations/$corporationId/logo?size=${px(size)}"
}

/**
 * A pilot portrait (.portrait): a square crop on surface-2, ringed in the pilot's colour with a gap, so who is who
 * reads at a glance. Shows the ring alone until the image loads (or when offline).
 */
@Composable
fun Portrait(characterId: Long?, pilot: PilotColors, modifier: Modifier = Modifier, size: Dp = 40.dp, contentDescription: String? = null) {
    val c = Echelon.colors
    val ring = if (size < 32.dp) 1.dp else 2.dp
    Box(modifier.size(size).border(ring, pilot.color, RoundedCornerShape(Radii.control)).padding(ring + 1.dp), contentAlignment = Alignment.Center) {
        val shape = RoundedCornerShape(Radii.chip)
        Box(Modifier.matchParentSize().clip(shape).background(c.surface2))
        // The initial in the pilot's colour until the image arrives (and when offline).
        val initial = com.echelon.eve.core.model.Pilot.of(characterId)?.displayName?.take(1)
        if (initial != null) androidx.compose.material3.Text(initial, style = Echelon.type.hero.copy(fontSize = androidx.compose.ui.unit.TextUnit(size.value * .42f, androidx.compose.ui.unit.TextUnitType.Sp), lineHeight = androidx.compose.ui.unit.TextUnit.Unspecified), color = pilot.color.copy(alpha = .8f))
        if (characterId != null) AsyncImage(EveImages.portrait(characterId, size), contentDescription, Modifier.matchParentSize().clip(shape), contentScale = ContentScale.Crop)
    }
}

/** An item type's icon from the image server, on a sunk tile. */
@Composable
fun TypeIcon(typeId: Long, modifier: Modifier = Modifier, size: Dp = 32.dp, contentDescription: String? = null) {
    val shape = RoundedCornerShape(Radii.control)
    Box(modifier.size(size).clip(shape).background(Echelon.colors.surfaceSunk)) {
        AsyncImage(EveImages.typeIcon(typeId, size), contentDescription, Modifier.matchParentSize(), contentScale = ContentScale.Fit)
    }
}

/**
 * The console's emblem (icons/icon.svg): Fiofka's and Decxus's chevrons in formation on a plotted arc, with the accent
 * beacon. [highlight] dims the other pilot's chevron, so the emblem doubles as a "who's flying" mark.
 */
@Composable
fun Emblem(modifier: Modifier = Modifier, size: Dp = 28.dp, highlight: PilotColors? = null) {
    val c = Echelon.colors
    val fio = PilotColors.Fiofka.color; val dec = PilotColors.Decxus.color
    Canvas(modifier.size(size)) {
        val k = this.size.minDimension / 32f
        scale(k, k, pivot = Offset.Zero) {
            drawPath(EmblemPaths.arc, c.lineStrong, style = Stroke(1.2f, cap = StrokeCap.Round))
            drawPath(EmblemPaths.fiofka, if (highlight == null || highlight == PilotColors.Fiofka) fio else fio.copy(alpha = .35f))
            drawPath(EmblemPaths.decxus, if (highlight == null || highlight == PilotColors.Decxus) dec else dec.copy(alpha = .35f))
            drawCircle(c.accent, 1.4f, Offset(27f, 9.5f))
        }
    }
}

private object EmblemPaths {
    val arc: Path = PathParser().parsePathString("M27 9.5A12.5 12.5 0 1 0 22 27").toPath()
    val fiofka: Path = PathParser().parsePathString("M7 15 13 7l6 8-6-2.5Z").toPath()
    val decxus: Path = PathParser().parsePathString("M14 23l6-8 6 8-6-2.5Z").toPath()
}
