package com.echelon.eve.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.motion.pressScale
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.formationShape

// Buttons. Primary wears the Formation silhouette (top-end corner cut) and an Ion fill that warms a little toward
// Flare; secondary is surface-2 with a strong line; links are text. All are at least 48 dp tall, and all sink under
// the finger (pressScale).

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, leading: (@Composable RowScope.() -> Unit)? = null) {
    val c = Echelon.colors
    val interaction = remember { MutableInteractionSource() }
    val shape = formationShape(cut = 9.dp, radius = Radii.control)
    val fill = if (enabled) Brush.horizontalGradient(listOf(c.accent, lerp(c.accent, c.flare, .28f))) else Brush.linearGradient(listOf(c.accent.copy(alpha = .35f), c.accent.copy(alpha = .35f)))
    Button(onClick, modifier.pressScale(interaction).defaultMinSize(minHeight = Spacing.touch).background(fill, shape), enabled = enabled, shape = shape,
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, contentColor = c.textOnAccent, disabledContainerColor = Color.Transparent, disabledContentColor = c.textOnAccent.copy(alpha = .7f)),
        contentPadding = PaddingValues(horizontal = 20.dp), interactionSource = interaction) {
        leading?.invoke(this); Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, leading: (@Composable RowScope.() -> Unit)? = null) {
    val c = Echelon.colors
    val interaction = remember { MutableInteractionSource() }
    OutlinedButton(onClick, modifier.pressScale(interaction).defaultMinSize(minHeight = Spacing.touch), enabled = enabled, shape = RoundedCornerShape(Radii.control),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = c.surface2, contentColor = c.text), border = BorderStroke(1.dp, c.lineStrong),
        contentPadding = PaddingValues(horizontal = 18.dp), interactionSource = interaction) {
        leading?.invoke(this); Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, tone: Tone = Tone.Accent) {
    val interaction = remember { MutableInteractionSource() }
    TextButton(onClick, modifier.pressScale(interaction).defaultMinSize(minHeight = Spacing.touch), shape = RoundedCornerShape(Radii.control), colors = ButtonDefaults.textButtonColors(contentColor = tone.color()), interactionSource = interaction) {
        Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelLarge)
    }
}
