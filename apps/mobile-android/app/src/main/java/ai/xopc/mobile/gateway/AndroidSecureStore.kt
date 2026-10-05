package ai.xopc.mobile.gateway

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Small encrypted record store. Android Keystore owns the non-exportable encryption key. */
class AndroidSecureStore(
  context: Context,
  preferencesName: String = "gateway_credentials_v1",
  private val keyAlias: String = "xopc.gateway.credentials.v1",
) {
  private val preferences = context.applicationContext.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)

  @Synchronized
  fun read(name: String): String? {
    checkName(name)
    val encoded = preferences.getString(name, null) ?: return null
    val record = Base64.getUrlDecoder().decode(encoded)
    require(record.size >= 1 + IV_BYTES + 16 && record[0].toInt() == 1) { "INVALID_SECURE_RECORD" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, record.copyOfRange(1, 1 + IV_BYTES)))
    cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
    return cipher.doFinal(record, 1 + IV_BYTES, record.size - 1 - IV_BYTES).toString(Charsets.UTF_8)
  }

  @Synchronized
  fun write(name: String, value: String) {
    checkName(name)
    val plaintext = value.toByteArray(Charsets.UTF_8)
    require(plaintext.size <= MAX_BYTES) { "SECURE_RECORD_TOO_LARGE" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
    cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
    val record = byteArrayOf(1) + cipher.iv + cipher.doFinal(plaintext)
    check(preferences.edit().putString(name, Base64.getUrlEncoder().withoutPadding().encodeToString(record)).commit()) {
      "SECURE_RECORD_WRITE_FAILED"
    }
  }

  @Synchronized
  fun remove(name: String) {
    checkName(name)
    check(preferences.edit().remove(name).commit()) { "SECURE_RECORD_REMOVE_FAILED" }
  }

  @Synchronized
  fun removeMatchingPrefix(prefix: String) {
    require(prefix.endsWith('.') && prefix.length in 2..100 &&
      prefix.dropLast(1).matches(Regex("[A-Za-z0-9._-]+"))) { "INVALID_SECURE_RECORD_NAME" }
    val names = preferences.all.keys.filter { it.startsWith(prefix) }
    if (names.isEmpty()) return
    val editor = preferences.edit()
    names.forEach(editor::remove)
    check(editor.commit()) { "SECURE_RECORD_REMOVE_FAILED" }
  }

  private fun encryptionKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = keyStore.getKey(keyAlias, null) as? SecretKey
    if (existing != null) return existing
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  private fun checkName(name: String) {
    require(name.matches(Regex("[A-Za-z0-9._-]{1,120}"))) { "INVALID_SECURE_RECORD_NAME" }
  }

  private companion object {
    const val IV_BYTES = 12
    const val MAX_BYTES = 128 * 1024
  }
}
