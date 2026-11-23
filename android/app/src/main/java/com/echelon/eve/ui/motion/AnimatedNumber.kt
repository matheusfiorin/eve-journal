package com.echelon.eve.ui.motion

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.theme.Echelon

/** The older name of [RollingNumber]: a figure that counts up when its screen appears and rolls its digits after. */
@Composable
fun AnimatedNumber(
    value: Double?,
    modifier: Modifier = Modifier,
    kind: Kind = Kind.Count,
    from: Double = 0.0,
    style: TextStyle = Echelon.type.num,
    color: Color = Color.Unspecified,
    text: (Double) -> String = { format(it, kind) },
) = RollingNumber(value, modifier, kind, from, style, color, text = text)
