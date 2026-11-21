package com.echelon.eve.ui.components

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing

// Buttons (base.css): a plain button is primary (violet fill), .secondary is surface-2 with a strong line, and links
// are text. All are 48 dp tall targets with 4 dp corners.

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, leading: (@Composable RowScope.() -> Unit)? = null) {
    val c = Echelon.colors
    Button(onClick, modifier.defaultMinSize(minHeight = Spacing.touch), enabled = enabled, shape = RoundedCornerShape(Radii.control),
        colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.textOnAccent, disabledContainerColor = c.accent.copy(alpha = .35f), disabledContentColor = c.textOnAccent.copy(alpha = .7f)),
        contentPadding = PaddingValues(horizontal = 18.dp)) {
        leading?.invoke(this); Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, leading: (@Composable RowScope.() -> Unit)? = null) {
    val c = Echelon.colors
    OutlinedButton(onClick, modifier.defaultMinSize(minHeight = Spacing.touch), enabled = enabled, shape = RoundedCornerShape(Radii.control),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = c.surface2, contentColor = c.text), border = BorderStroke(1.dp, c.lineStrong),
        contentPadding = PaddingValues(horizontal = 18.dp)) {
        leading?.invoke(this); Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, tone: Tone = Tone.Accent) {
    TextButton(onClick, modifier.defaultMinSize(minHeight = Spacing.touch), shape = RoundedCornerShape(Radii.control), colors = ButtonDefaults.textButtonColors(contentColor = tone.color())) {
        Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelLarge)
    }
}
