package com.echelon.eve.core.auth

import android.net.Uri
import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.api.EchelonApi
import com.echelon.eve.core.model.Pilot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The mobile sign-in (the brief's mobile auth contract):
 * 1. [start] makes a PKCE pair, keeps the verifier in the sealed store, and returns the Worker's
 *    /auth/start?pilot=<id>&client=android&challenge=<C>, which the app opens in a Custom Tab (the consent page, then
 *    EVE SSO).
 * 2. The Worker redirects to echelon://auth/callback?code=K&pilot=<id>; [complete] takes that link.
 * 3. It redeems K with the verifier (POST /api/mobile/redeem) and stores the session it gets back, revoking the one it
 *    replaced. A callback this phone did not start has no verifier and is refused, which also stops login CSRF.
 */
class AuthManager(private val api: EchelonApi, private val store: SessionStore, private val clock: () -> Long = System::currentTimeMillis) {
    sealed interface State {
        data object Idle : State
        data class Waiting(val pilot: Pilot) : State
        data class Connected(val pilot: Pilot) : State
        data class Failed(val pilot: Pilot?, val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    /** The sign-in in progress, for the UI (a "Finishing sign-in…" overlay, an error with Try again). */
    val state: StateFlow<State> = _state.asStateFlow()

    /** Begins a sign-in for [pilot] and returns the URL to open in a Custom Tab. */
    suspend fun start(pilot: Pilot, pkce: Pkce = Pkce.create()): String {
        store.begin(PendingSignIn(pilot.id, pkce.verifier, clock()))
        _state.value = State.Waiting(pilot)
        return api.url("/auth/start").newBuilder()
            .addQueryParameter("pilot", pilot.id.toString())
            .addQueryParameter("client", "android")
            .addQueryParameter("challenge", pkce.challenge)
            .build().toString()
    }

    /** True for links this manager handles (echelon://auth/callback…). */
    fun isCallback(uri: Uri?): Boolean = uri != null && uri.scheme == SCHEME && uri.host == "auth" && uri.path == "/callback"

    suspend fun complete(uri: Uri): State = complete(uri.getQueryParameter("code"), uri.getQueryParameter("pilot"), uri.getQueryParameter("error"))

    /** The callback's parts; split out from [complete] so JVM tests need no android.net.Uri. */
    suspend fun complete(code: String?, pilotParam: String?, error: String? = null): State {
        val pilot = Pilot.of(pilotParam?.toLongOrNull())
        val result = run {
            if (pilot == null) return@run State.Failed(null, "That sign-in link was for an unknown pilot.")
            // Always consume the pending verifier, so a link can be tried once.
            val pending = store.takePending(pilot.id)
            if (error != null) return@run State.Failed(pilot, "EVE sign-in was cancelled.")
            if (pending == null) return@run State.Failed(pilot, "This sign-in wasn’t started on this phone, or it took longer than 30 minutes. Start again.")
            if (code.isNullOrBlank() || code.length > 200) return@run State.Failed(pilot, "The sign-in link was incomplete. Start again.")
            try {
                val got = api.redeem(code, pending.verifier)
                if (got.pilot != pilot.id) return@run State.Failed(pilot, "The backend returned a different pilot. Start again.")
                val replaced = store.put(StoredSession(got.pilot, got.session, got.expires))
                if (replaced != null) api.revoke(replaced)
                State.Connected(pilot)
            } catch (e: ApiError.Http) {
                State.Failed(pilot, if (e.status == 400) "That sign-in link has expired or was already used. Start again." else e.message ?: "Sign-in failed.")
            } catch (e: ApiError) {
                State.Failed(pilot, e.message ?: "Sign-in failed.")
            } catch (e: IllegalArgumentException) {
                State.Failed(pilot, "The backend’s answer was invalid. Start again.")
            }
        }
        _state.value = result
        return result
    }

    /** The pilot came back from the Custom Tab without finishing: leave the verifier (the link may still arrive). */
    fun cancelled() { if (_state.value is State.Waiting) _state.value = State.Idle }
    fun dismiss() { _state.value = State.Idle }

    companion object { const val SCHEME = "echelon" }
}
