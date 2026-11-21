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
    HeroBackground(Modifier.fillMaxSize(), seed = 11) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()).padding(horizontal = Spacing.xxl, vertical = Spacing.xxxl),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Emblem(size = 72.dp, highlight = chosen?.let { PilotColors.of(it.id) })
            Text("Echelon", style = Echelon.type.hero, color = Echelon.colors.text)
            AnimatedContent(chosen, transitionSpec = { (slideInHorizontally { it / 4 } + fadeIn()) togetherWith fadeOut() }, label = "welcome") { pilot ->
                if (pilot == null) Picker(state) { p ->
                    haptics.select()
                    if (state.state(p).connected) actions.selectPilot(p) else chosen = p
                } else Connect(state.state(pilot), state.auth, actions, onBack = { chosen = null })
            }
        }
    }
}

@Composable
private fun Picker(state: ShellState, onPick: (Pilot) -> Unit) {
    val c = Echelon.colors
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Text("Who’s flying?", style = MaterialTheme.typography.titleLarge, color = c.text)
        Text("Every screen centres on this pilot, with the wingmate’s plans alongside.", style = MaterialTheme.typography.bodyMedium, color = c.textMuted, textAlign = TextAlign.Center)
        state.pilots.forEach { p -> PilotChoice(p) { onPick(p.pilot) } }
    }
}

@Composable
private fun PilotChoice(p: PilotState, onClick: () -> Unit) {
    val c = Echelon.colors
    val colors = PilotColors.of(p.id)
    val shape = RoundedCornerShape(Radii.panel)
    Row(Modifier.fillMaxWidth().clip(shape).background(c.surface1.copy(alpha = .86f)).border(1.dp, colors.color.copy(alpha = .5f), shape).clickable(role = Role.Button, onClick = onClick).padding(Spacing.lg),
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
        Box(Modifier.padding(top = 7.dp).background(c.accent, RoundedCornerShape(1.dp)).padding(3.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
    }
}
