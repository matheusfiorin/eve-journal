package com.echelon.eve.core.api

/**
 * Why a request failed, in the two kinds the UI must tell apart (ui/pilots.js problemOf): the pilot's sign-in ended,
 * which Reconnect fixes, or EVE / the backend / the network is not answering, which only waiting or Retry fixes.
 */
sealed class ApiError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** 401: this session is gone (expired, disconnected elsewhere, or revoked). The token was dropped. */
    class Expired(message: String = "This pilot’s sign-in expired. Connect again.") : ApiError(message)
    /** The backend answered with an error ([status] ≥ 400, not 401); its message is plain copy meant for the pilot. */
    class Http(val status: Int, message: String, val retryAfterSeconds: Long? = null) : ApiError(message)
    /** No answer: offline, DNS, timeout, TLS. */
    class Offline(cause: Throwable) : ApiError("Can’t reach the Echelon backend. Check the connection.", cause)
    /** The answer was not what this app understands (an HTML error page, a changed shape). */
    class Invalid(message: String, cause: Throwable? = null) : ApiError(message, cause)

    val kind: Problem.Kind get() = if (this is Expired) Problem.Kind.Expired else Problem.Kind.Outage
}

/** What the UI shows for a failed pilot or feed: the kind decides the words and the button (Reconnect or Retry). */
data class Problem(val kind: Kind, val message: String) {
    enum class Kind { Expired, Outage }
    companion object {
        fun of(error: Throwable): Problem = when (error) {
            is ApiError -> Problem(error.kind, error.message ?: "Something went wrong.")
            else -> Problem(Kind.Outage, error.message ?: "Something went wrong.")
        }
    }
}
