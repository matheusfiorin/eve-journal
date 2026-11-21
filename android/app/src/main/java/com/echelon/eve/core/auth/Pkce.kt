package com.echelon.eve.core.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * A PKCE pair (RFC 7636, S256). The verifier is 32 random bytes in base64url (43 characters, like the Worker's
 * random()); the challenge is base64url(SHA-256(verifier)), the same as auth.js challenge(). The Worker keeps the
 * challenge with the one-time code and only redeems the code for the matching verifier.
 */
data class Pkce(val verifier: String, val challenge: String) {
    companion object {
        private val encoder = Base64.getUrlEncoder().withoutPadding()
        fun challengeOf(verifier: String): String = encoder.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        fun create(random: SecureRandom = SecureRandom()): Pkce {
            val bytes = ByteArray(32).also(random::nextBytes)
            val verifier = encoder.encodeToString(bytes)
            return Pkce(verifier, challengeOf(verifier))
        }
        /** RFC 7636's verifier alphabet and length, so a corrupted stored verifier is caught before it is sent. */
        fun isVerifier(value: String) = value.length in 43..128 && value.all { it.isLetterOrDigit() && it.code < 128 || it in "-._~" }
    }
}
