package com.echelon.eve.core.auth

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Seals the session blob. The format is version byte 1, a 12-byte IV, then AES-GCM ciphertext with its 128-bit tag;
 * [associated] binds the blob to its purpose, so a blob copied into another slot fails to open.
 */
interface SessionCipher {
    fun seal(plain: ByteArray, associated: ByteArray): ByteArray
    fun open(sealed: ByteArray, associated: ByteArray): ByteArray
}

/** AES-GCM with any key: the Keystore one on a device, a fixed one in JVM tests. */
open class AesGcmCipher(private val key: () -> SecretKey) : SessionCipher {
    override fun seal(plain: ByteArray, associated: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        // The Keystore picks the IV itself (and refuses a caller's one); a software key gets a random IV from the provider too.
        c.init(Cipher.ENCRYPT_MODE, key())
        c.updateAAD(associated)
        val out = c.doFinal(plain)
        return byteArrayOf(1) + c.iv + out
    }
    override fun open(sealed: ByteArray, associated: ByteArray): ByteArray {
        require(sealed.size > 13 && sealed[0] == 1.toByte()) { "Unknown session format" }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 1, 12))
        c.updateAAD(associated)
        return c.doFinal(sealed, 13, sealed.size - 13)
    }
}

/**
 * The Android Keystore key: AES-256, GCM only, never leaves secure hardware where the phone has it. If the key is lost
 * (the user cleared credentials, a restore to a new phone) the blob no longer opens and the pilots simply connect
 * again; the store treats that as "no sessions".
 */
class KeystoreCipher(private val alias: String = "echelon-sessions") : AesGcmCipher({ keystoreKey(alias) })

private fun keystoreKey(alias: String): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
        init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setRandomizedEncryptionRequired(true).build())
    }.generateKey()
}
