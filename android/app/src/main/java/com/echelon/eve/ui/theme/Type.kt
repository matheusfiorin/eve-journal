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

// The Formation type system: three variable families from google/fonts under the SIL Open Font License (licences in
// assets/licenses). Oxanium, squared and cut like a ship's hull lettering, for display; Saira at 90 % width for the UI
// (compact like a HUD, open enough to read at 12 sp); JetBrains Mono for every figure, tabular by construction.

private fun oxanium(weight: FontWeight) = Font(R.font.oxanium, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))
val Oxanium = FontFamily(oxanium(FontWeight.Normal), oxanium(FontWeight.Medium), oxanium(FontWeight.SemiBold), oxanium(FontWeight.Bold))

private fun saira(weight: FontWeight) = Font(R.font.saira, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight), FontVariation.width(90f)))
val Saira = FontFamily(saira(FontWeight.Normal), saira(FontWeight.Medium), saira(FontWeight.SemiBold), saira(FontWeight.Bold))

private fun mono(weight: FontWeight) = Font(R.font.jetbrains_mono, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))
val JetBrainsMono = FontFamily(mono(FontWeight.Normal), mono(FontWeight.Medium), mono(FontWeight.SemiBold), mono(FontWeight.Bold))

/** The display family (was Michroma before the Formation identity). */
@Deprecated("The display family is Oxanium now", ReplaceWith("Oxanium")) val Michroma: FontFamily get() = Oxanium
/** The UI family (was Barlow Semi Condensed before the Formation identity). */
@Deprecated("The UI family is Saira now", ReplaceWith("Saira")) val Barlow: FontFamily get() = Saira
/** The figures family (was Martian Mono before the Formation identity). */
@Deprecated("Figures use JetBrains Mono now", ReplaceWith("JetBrainsMono")) val MartianMono: FontFamily get() = JetBrainsMono

/** Styles Material's typography has no slot for. Numbers are always tabular JetBrains Mono. */
@Immutable
data class EchelonType(
    val hero: TextStyle = TextStyle(fontFamily = Oxanium, fontWeight = FontWeight.SemiBold, fontSize = TypeScale.hero, lineHeight = 44.sp, letterSpacing = .01.em),
    val screenTitle: TextStyle = TextStyle(fontFamily = Oxanium, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 24.sp, letterSpacing = .01.em),
    val numLarge: TextStyle = TextStyle(fontFamily = JetBrainsMono, fontWeight = FontWeight.SemiBold, fontSize = TypeScale.xl, lineHeight = 26.sp, letterSpacing = (-.03).em, fontFeatureSettings = "tnum, zero"),
    val num: TextStyle = TextStyle(fontFamily = JetBrainsMono, fontWeight = FontWeight.SemiBold, fontSize = TypeScale.md, lineHeight = 20.sp, letterSpacing = (-.03).em, fontFeatureSettings = "tnum, zero"),
    val numSmall: TextStyle = TextStyle(fontFamily = JetBrainsMono, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = (-.02).em, fontFeatureSettings = "tnum, zero"),
    val label: TextStyle = TextStyle(fontFamily = Saira, fontWeight = FontWeight.Medium, fontSize = TypeScale.xs, lineHeight = 16.sp, letterSpacing = .01.em),
    val chip: TextStyle = TextStyle(fontFamily = Saira, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 12.sp, letterSpacing = .02.em),
    /** Small caps-style overline over a section or a hero ("FORMATION · FIOFKA"): spaced capitals in the display face. */
    val overline: TextStyle = TextStyle(fontFamily = Oxanium, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = .16.em),
)

private fun ui(weight: FontWeight, size: Float, line: Float) = TextStyle(fontFamily = Saira, fontWeight = weight, fontSize = size.sp, lineHeight = line.sp)
private fun display(size: Float, line: Float) = TextStyle(fontFamily = Oxanium, fontWeight = FontWeight.SemiBold, fontSize = size.sp, lineHeight = line.sp)

/** Material slots: display and headline in Oxanium, the rest in Saira. */
val EchelonTypography = Typography(
    displayLarge = display(40f, 46f),
    displayMedium = display(34f, 40f),
    displaySmall = display(28f, 32f),
    headlineLarge = display(28f, 32f),
    headlineMedium = display(22f, 28f),
    headlineSmall = display(18f, 24f),
    titleLarge = ui(FontWeight.SemiBold, 22f, 28f),
    titleMedium = ui(FontWeight.SemiBold, 18f, 22f),
    titleSmall = ui(FontWeight.SemiBold, 15f, 20f),
    bodyLarge = ui(FontWeight.Normal, 16f, 23f),
    bodyMedium = ui(FontWeight.Normal, 15f, 21f),
    bodySmall = ui(FontWeight.Normal, 13f, 18f),
    labelLarge = ui(FontWeight.SemiBold, 14f, 18f),
    labelMedium = ui(FontWeight.Medium, 13f, 16f),
    labelSmall = ui(FontWeight.Medium, 12f, 16f),
)
