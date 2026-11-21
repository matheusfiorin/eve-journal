package com.echelon.eve.nav

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.echelon.eve.AppContainer
import com.echelon.eve.core.auth.AuthManager
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.data.SyncState
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.theme.ThemeSettings
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Everything the shell draws, as plain data: the screenshot tests build it by hand, the app from [ShellViewModel].
 * [ready] is false until the stored choices have loaded (the splash stays up until then, so nothing flickers).
 */
@Immutable
data class ShellState(
    val pilots: List<PilotState> = Pilot.entries.map { PilotState(it) },
    val selected: Pilot? = null,
    val sync: SyncState = SyncState(),
    val theme: ThemeSettings = ThemeSettings(),
    val auth: AuthManager.State = AuthManager.State.Idle,
    val ready: Boolean = true,
    val version: String = "",
    val backendHost: String = "",
) {
    fun state(pilot: Pilot): PilotState = pilots.first { it.pilot == pilot }
    val current: PilotState? get() = selected?.let(::state)
}

/** What the shell can ask for. Defaults do nothing, for previews and screenshots. */
@Immutable
data class ShellActions(
    val selectPilot: (Pilot) -> Unit = {},
    /** Starts the EVE sign-in for a pilot (Connect or Reconnect): opens the Custom Tab. */
    val connect: (Pilot) -> Unit = {},
    /** Pull-to-refresh and Retry: asks the Worker to sync from ESI. */
    val refresh: () -> Unit = {},
    val signOutHere: (Pilot) -> Unit = {},
    val disconnect: (Pilot) -> Unit = {},
    val setTheme: (ThemeSettings) -> Unit = {},
    val dismissAuth: () -> Unit = {},
)

/** The app's AppContainer for feature screens that need repositories. Null in previews and screenshot tests. */
val LocalAppContainer = staticCompositionLocalOf<AppContainer?> { null }

class ShellViewModel(private val c: AppContainer, private val version: String) : ViewModel() {
    private val themeFlow = c.prefs.theme.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val state: StateFlow<ShellState> = combine(c.pilots.pilots, c.selectedPilot, c.sync.state, themeFlow, c.auth.state) { pilots, selected, sync, theme, auth ->
        ShellState(pilots, selected, sync, theme ?: ThemeSettings(), auth, ready = theme != null, version = version, backendHost = c.api.base.host)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, ShellState(ready = false))

    fun actions(connect: (Pilot) -> Unit) = ShellActions(
        selectPilot = { p -> viewModelScope.launch { c.prefs.selectPilot(p); c.wing.refresh(p) } },
        connect = connect,
        refresh = { c.sync.refresh(force = true) },
        signOutHere = { p -> viewModelScope.launch { c.pilots.signOutHere(p); c.sync.refresh() } },
        disconnect = { p -> viewModelScope.launch { c.pilots.disconnect(p); c.sync.refresh() } },
        setTheme = { t -> viewModelScope.launch { c.prefs.setTheme(t) } },
        dismissAuth = { c.auth.dismiss() },
    )
}
