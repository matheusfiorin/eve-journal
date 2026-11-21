package com.echelon.eve.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.theme.Backdrop
import com.echelon.eve.ui.theme.MotionPref
import com.echelon.eve.ui.theme.ThemeSettings
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

/** Per-device choices that are not secret: who is flying and how the app looks. */
interface Prefs {
    val selectedPilot: Flow<Pilot?>
    val theme: Flow<ThemeSettings>
    suspend fun selectPilot(pilot: Pilot)
    suspend fun setTheme(settings: ThemeSettings)
}

private val Context.prefsStore: DataStore<Preferences> by preferencesDataStore("echelon-prefs")

class DataStorePrefs(private val context: Context) : Prefs {
    private val pilotKey = longPreferencesKey("pilot")
    private val backdropKey = stringPreferencesKey("backdrop")
    private val motionKey = stringPreferencesKey("motion")
    override val selectedPilot: Flow<Pilot?> = context.prefsStore.data.map { Pilot.of(it[pilotKey]) }
    override val theme: Flow<ThemeSettings> = context.prefsStore.data.map { p ->
        ThemeSettings(Backdrop.entries.firstOrNull { it.name == p[backdropKey] } ?: Backdrop.Space, MotionPref.entries.firstOrNull { it.name == p[motionKey] } ?: MotionPref.System)
    }
    override suspend fun selectPilot(pilot: Pilot) { context.prefsStore.edit { it[pilotKey] = pilot.id } }
    override suspend fun setTheme(settings: ThemeSettings) { context.prefsStore.edit { it[backdropKey] = settings.backdrop.name; it[motionKey] = settings.motion.name } }
}

class MemoryPrefs(pilot: Pilot? = null, theme: ThemeSettings = ThemeSettings()) : Prefs {
    private val p = MutableStateFlow(pilot); private val t = MutableStateFlow(theme)
    override val selectedPilot: Flow<Pilot?> = p
    override val theme: Flow<ThemeSettings> = t
    override suspend fun selectPilot(pilot: Pilot) { p.value = pilot }
    override suspend fun setTheme(settings: ThemeSettings) { t.value = settings }
}
