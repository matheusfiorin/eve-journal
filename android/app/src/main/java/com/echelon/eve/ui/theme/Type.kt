package com.echelon.eve.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.echelon.eve.R

// The web's three families (index.html loads them from Google Fonts), bundled from google/fonts under the SIL Open Font
// License (assets/licenses): Michroma for display, Barlow Semi Condensed for UI, Martian Mono for numbers.

val Michroma = FontFamily(Font(R.font.michroma))

val Barlow = FontFamily(
    Font(R.font.barlow_semi_condensed_regular, FontWeight.Normal),
    Font(R.font.barlow_semi_condensed_medium, FontWeight.Medium),
    Font(R.font.barlow_semi_condensed_semibold, FontWeight.SemiBold),
    Font(R.font.barlow_semi_condensed_bold, FontWeight.Bold),
)

// Martian Mono is variable; the web narrows it to 87.5 % width ('wdth' 87.5) so figures sit tight in tables.
private fun martian(weight: FontWeight) = Font(R.font.martian_mono, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight), FontVariation.width(87.5f)))
val MartianMono = FontFamily(martian(FontWeight.Normal), martian(FontWeight.Medium), martian(FontWeight.SemiBold))

/** Styles Material's typography has no slot for. Numbers are always tabular Martian Mono. */
@Immutable
data class EchelonType(
    val hero: TextStyle = TextStyle(fontFamily = Michroma, fontSize = TypeScale.hero, lineHeight = 46.sp, letterSpacing = .02.em),
    val screenTitle: TextStyle = TextStyle(fontFamily = Michroma, fontSize = 20.sp, lineHeight = 24.sp, letterSpacing = .02.em),
    val numLarge: TextStyle = TextStyle(fontFamily = MartianMono, fontWeight = FontWeight.SemiBold, fontSize = TypeScale.xl, lineHeight = 26.sp, letterSpacing = (-.01).em, fontFeatureSettings = "tnum"),
    val num: TextStyle = TextStyle(fontFamily = MartianMono, fontWeight = FontWeight.SemiBold, fontSize = TypeScale.md, lineHeight = 20.sp, letterSpacing = (-.01).em, fontFeatureSettings = "tnum"),
    val numSmall: TextStyle = TextStyle(fontFamily = MartianMono, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 14.sp, fontFeatureSettings = "tnum"),
    val label: TextStyle = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = TypeScale.xs, lineHeight = 16.sp),
    val chip: TextStyle = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 12.sp),
)

private fun ui(weight: FontWeight, size: Float, line: Float) = TextStyle(fontFamily = Barlow, fontWeight = weight, fontSize = size.sp, lineHeight = line.sp)

/** Material slots mapped onto the web scale: display/headline use Michroma, the rest Barlow. */
val EchelonTypography = Typography(
    displayLarge = TextStyle(fontFamily = Michroma, fontSize = 40.sp, lineHeight = 46.sp),
    displayMedium = TextStyle(fontFamily = Michroma, fontSize = 34.sp, lineHeight = 40.sp),
    displaySmall = TextStyle(fontFamily = Michroma, fontSize = 28.sp, lineHeight = 32.sp),
    headlineLarge = TextStyle(fontFamily = Michroma, fontSize = 28.sp, lineHeight = 32.sp),
    headlineMedium = TextStyle(fontFamily = Michroma, fontSize = 22.sp, lineHeight = 28.sp),
    headlineSmall = TextStyle(fontFamily = Michroma, fontSize = 18.sp, lineHeight = 24.sp),
    titleLarge = ui(FontWeight.SemiBold, 22f, 28f),
    titleMedium = ui(FontWeight.SemiBold, 18f, 22f),
    titleSmall = ui(FontWeight.SemiBold, 15f, 20f),
    bodyLarge = ui(FontWeight.Normal, 16f, 23f),
    bodyMedium = ui(FontWeight.Normal, 15f, 22f),
    bodySmall = ui(FontWeight.Normal, 13f, 18f),
    labelLarge = ui(FontWeight.SemiBold, 14f, 18f),
    labelMedium = ui(FontWeight.Medium, 13f, 16f),
    labelSmall = ui(FontWeight.Medium, 12f, 16f),
)
