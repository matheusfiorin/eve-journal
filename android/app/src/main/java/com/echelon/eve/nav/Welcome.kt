package com.echelon.eve.nav

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.auth.AuthManager
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.Emblem
import com.echelon.eve.ui.components.ErrorState
import com.echelon.eve.ui.components.HeroBackground
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.Portrait
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.formationShape
import com.echelon.eve.ui.components.Dart
import com.echelon.eve.ui.components.EchelonStripes
import com.echelon.eve.ui.motion.Springs
import com.echelon.eve.ui.motion.entrance
import com.echelon.eve.ui.motion.pressScale
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.ripple
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * The first screen (the web's "who's flying" picker), and the sign-in screen: pick a pilot, then connect them with EVE
 * or carry on with public data. The phone remembers the choice; the top bar switches later.
 */
@Composable
fun WelcomeScreen(state: ShellState, actions: ShellActions, initialChosen: Pilot? = null) {
    var chosen by rememberSaveable { mutableStateOf(initialChosen) }
    val haptics = rememberHaptics()
    // A sign-in that finished while this screen is up takes the pilot straight in.
    LaunchedEffect(state.auth) { (state.auth as? AuthManager.State.Connected)?.let { actions.selectPilot(it.pilot) } }
    val reduced = Echelon.reduceMotion
    HeroBackground(Modifier.fillMaxSize(), seed = 11) {
        // Centred on the screen when it fits (a phone held upright), scrolling from the top when it does not.
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
        val minHeight = maxHeight
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = minHeight).padding(horizontal = Spacing.xxl, vertical = Spacing.xxxl)
            .wrapContentWidth().widthIn(max = 480.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.lg, Alignment.CenterVertically)) {
            // The formation assembles once, the first time the app opens (the splash hands over to it).
            Emblem(size = 88.dp, highlight = chosen?.let { PilotColors.of(it.id) }, animate = true)
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text("ECHELON", style = Echelon.type.hero.copy(letterSpacing = .14.em, fontSize = 34.sp), color = Echelon.colors.text, modifier = Modifier.entrance(1))
                Row(Modifier.entrance(2), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    EchelonStripes(height = 8.dp)
                    Text("THE WING CONSOLE", style = Echelon.type.overline, color = Echelon.colors.textMuted)
                }
            }
            AnimatedContent(chosen, transitionSpec = {
                if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                else (slideInHorizontally(Springs.nav()) { if (targetState != null) it / 4 else -it / 4 } + fadeIn()) togetherWith (slideOutHorizontally(Springs.nav()) { if (targetState != null) -it / 6 else it / 6 } + fadeOut())
            }, label = "welcome") { pilot ->
                if (pilot == null) Picker(state) { p ->
                    haptics.select()
                    if (state.state(p).connected) actions.selectPilot(p) else chosen = p
                } else Connect(state.state(pilot), state.auth, actions, onBack = { chosen = null })
            }
        }
        }
    }
}

@Composable
private fun Picker(state: ShellState, onPick: (Pilot) -> Unit) {
    val c = Echelon.colors
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Text("Whose phone is this?", style = MaterialTheme.typography.titleLarge, color = c.text)
        Text("Each pilot uses their own phone. Pick yours; your wingmate’s timers, calls and plans reach you through the wing.", style = MaterialTheme.typography.bodyMedium, color = c.textMuted, textAlign = TextAlign.Center)
        state.pilots.forEachIndexed { i, p -> PilotChoice(p, Modifier.entrance(3 + i)) { onPick(p.pilot) } }
    }
}

@Composable
private fun PilotChoice(p: PilotState, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = Echelon.colors
    val colors = PilotColors.of(p.id)
    val shape = formationShape(Radii.cut, Radii.panel)
    val interaction = remember { MutableInteractionSource() }
    Row(modifier.pressScale(interaction).fillMaxWidth().clip(shape).background(Brush.horizontalGradient(listOf(colors.soft, c.surface1.copy(alpha = .9f)))).border(1.dp, colors.color.copy(alpha = .5f), shape).clickable(interaction, ripple(color = colors.color), role = Role.Button, onClick = onClick).padding(Spacing.lg),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        Portrait(p.id, colors, size = 64.dp, contentDescription = "Portrait of ${p.name}")
        Column(Modifier.weight(1f)) {
            Text(p.name, style = MaterialTheme.typography.titleLarge, color = colors.color)
            Text(statusOf(p), style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
        androidx.compose.material3.Icon(EchelonIcons.Chevron, null, tint = c.textMuted)
    }
}

@Composable
private fun Connect(p: PilotState, auth: AuthManager.State, actions: ShellActions, onBack: () -> Unit) {
    val c = Echelon.colors
    val colors = PilotColors.of(p.id)
    androidx.compose.runtime.CompositionLocalProvider(com.echelon.eve.ui.theme.LocalPilot provides colors) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Portrait(p.id, colors, size = 96.dp, contentDescription = "Portrait of ${p.name}")
            Text("Connect ${p.name}", style = MaterialTheme.typography.titleLarge, color = c.text)
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(Radii.panel)).background(c.surface1.copy(alpha = .9f)).border(1.dp, c.line, RoundedCornerShape(Radii.panel)).padding(Spacing.lg)) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Bullet("EVE’s own sign-in page opens in a browser tab. Your password never reaches Echelon.")
                    Bullet("You choose what the wingmate sees on the next page.")
                    Bullet("The backend keeps the EVE sign-in and syncs every 10 minutes. This phone keeps only a session, locked with its keystore.")
                }
            }
            when (auth) {
                is AuthManager.State.Waiting -> Text("Finish signing in in the browser, then come back here.", style = MaterialTheme.typography.bodyMedium, color = c.accentStrong, textAlign = TextAlign.Center)
                is AuthManager.State.Failed -> ErrorState("Sign-in didn’t finish", auth.message, tone = Tone.Danger)
                else -> {}
            }
            PrimaryButton(if (auth is AuthManager.State.Failed) "Try again" else "Connect with EVE", { actions.connect(p.pilot) }, Modifier.fillMaxWidth())
            LinkButton("Continue without connecting", { actions.selectPilot(p.pilot) }, tone = Tone.Neutral)
            LinkButton("Choose another pilot", onBack, tone = Tone.Neutral)
        }
    }
}

@Composable
private fun Bullet(text: String) {
    val c = Echelon.colors
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Dart(c.accent, Modifier.padding(top = 6.dp).size(8.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
    }
}
