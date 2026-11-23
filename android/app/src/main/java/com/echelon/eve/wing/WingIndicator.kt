package com.echelon.eve.wing

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.Presence
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingStatus
import com.echelon.eve.core.wing.jumpsBetween
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.ui.components.StatusDot
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.motion.cometTrail
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.draw.clip

/** The wing's sync state at a glance: is this phone in the room, is the wingmate, how far apart, and what is still queued. */
data class WingIndicatorState(
    val link: Link,
    val mate: Pilot?,
    val mateOnline: Boolean = false,
    val jumps: Int? = null,
    val queued: Int = 0,
    val session: Boolean = false,
) {
    enum class Link { Off, Connecting, Live, Retrying, Refused }

    val tone: Tone get() = when (link) {
        Link.Live -> if (mateOnline) Tone.Ok else Tone.Neutral
        Link.Connecting, Link.Retrying -> Tone.Warn
        Link.Refused -> Tone.Danger
        Link.Off -> Tone.Neutral
    }

    /** The few words next to the dot: "Decxus · 3j", "Decxus · here", "Offline · 2 queued". */
    val label: String get() = buildList {
        add(when (link) {
            Link.Live -> mate?.displayName ?: "Wing"
            Link.Connecting -> "Connecting"
            Link.Retrying -> "Reconnecting"
            Link.Refused -> "Sign in again"
            Link.Off -> "Offline"
        })
        if (link == Link.Live && mate != null && !mateOnline) add("away")
        if (link == Link.Live && mateOnline) jumps?.let { add(if (it == 0) "here" else "${it}j") }
        if (queued > 0) add("$queued queued")
    }.joinToString(" · ")

    /** What a screen reader says. */
    val description: String get() = buildString {
        append(when (link) {
            Link.Live -> "Wing room connected"; Link.Connecting -> "Connecting to the wing room"; Link.Retrying -> "Reconnecting to the wing room"
            Link.Refused -> "The wing room refused the sign-in"; Link.Off -> "Not connected to the wing room"
        })
        if (mate != null && link == Link.Live) append(if (mateOnline) ", ${mate.displayName} online" else ", ${mate.displayName} away")
        jumps?.let { if (link == Link.Live && mateOnline) append(if (it == 0) ", in your system" else ", $it jumps apart") }
        if (queued > 0) append(", $queued waiting to send")
        if (session) append(", session running")
    }

    companion object {
        fun of(status: WingChannel.Status, pilot: Pilot?, presence: Map<Long, Presence>, statuses: Map<Long, WingStatus>, jumps: (Long?, Long?) -> Int?, queued: Int, session: Boolean): WingIndicatorState {
            val link = when (status) {
                WingChannel.Status.Connected -> Link.Live; WingChannel.Status.Connecting -> Link.Connecting; is WingChannel.Status.Retrying -> Link.Retrying
                WingChannel.Status.Unauthorized -> Link.Refused; WingChannel.Status.Idle -> Link.Off
            }
            val mate = pilot?.wingmate
            return WingIndicatorState(link, mate, mate?.let { presence[it.id]?.online } == true,
                if (pilot == null) null else jumps(statuses[pilot.id]?.system, statuses[mate!!.id]?.system), queued, session)
        }
    }
}

/**
 * The compact wing status for a top bar: a dot (green: both in the room; amber: reconnecting; red: sign-in refused;
 * grey: offline or the wingmate away), the wingmate's name with jumps apart, and messages still queued.
 * Reads the container itself; renders nothing in previews. [onClick] typically opens Fly → Wing.
 */
@Composable
fun WingStatusIndicator(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val c = LocalAppContainer.current ?: return
    val ch = c.wingChannel
    val status by ch.status.collectAsStateWithLifecycle()
    val presence by ch.presence.collectAsStateWithLifecycle()
    val statuses by ch.statuses.collectAsStateWithLifecycle()
    val queued by ch.pending.collectAsStateWithLifecycle()
    val session by ch.session.collectAsStateWithLifecycle()
    val pilot by c.selectedPilot.collectAsStateWithLifecycle()
    val market by c.market.state.collectAsStateWithLifecycle()
    val systems = market.data?.systems.orEmpty()
    WingIndicator(WingIndicatorState.of(status, pilot, presence, statuses, { a, b -> jumpsBetween(systems, a, b) }, queued, session != null), modifier, onClick)
}

/** The stateless indicator, for screenshots and for a shell that already holds the state. */
@Composable
fun WingIndicator(state: WingIndicatorState, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val c = Echelon.colors
    val shape = RoundedCornerShape(Radii.pop)
    val mateColor = state.mate?.let { com.echelon.eve.ui.theme.PilotColors.of(it.id).color } ?: c.accent
    // The chip is drawn 28 dp tall inside a 48 dp target, like the rest of the top bar.
    Box(
        modifier.heightIn(min = Spacing.touch).semantics(mergeDescendants = true) { contentDescription = state.description }
            .then(if (onClick != null) Modifier.clip(shape).clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.heightIn(min = 28.dp).background(c.surface2, shape).border(1.dp, if (state.session) c.accent else c.line, shape).padding(horizontal = Spacing.sm, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // A comet in the wingmate's colour when the line changes (they came online, jumped closer, the link dropped).
            StatusDot(state.tone, Modifier.cometTrail(state.label, mateColor), live = state.link == WingIndicatorState.Link.Live && state.mateOnline)
            Text(state.label, style = Echelon.type.label, color = if (state.link == WingIndicatorState.Link.Refused) c.danger else c.textMuted, maxLines = 1)
        }
    }
}
