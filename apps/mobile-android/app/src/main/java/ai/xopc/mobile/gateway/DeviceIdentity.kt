package ai.xopc.mobile.gateway

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.math.BigInteger
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.UUID
import org.bouncycastle.asn1.ASN1Integer
import org.bouncycastle.asn1.ASN1Sequence

data class DevicePublicKey(val kty: String = "EC", val crv: String = "P-256", val x: String, val y: String)

/** Stable P-256 device identity; the private key never leaves Android Keystore. */
class DeviceIdentity(private val keyAlias: String = "xopc.gateway.device.p256.v1") {
  fun publicKeyDer(): String = encode(keyPair().public.encoded)

  fun publicKey(): DevicePublicKey {
    val point = keyPair().public as ECPublicKey
    return DevicePublicKey(x = encode(fixed32(point.w.affineX)), y = encode(fixed32(point.w.affineY)))
  }

  fun sign(message: String): String {
    val signer = Signature.getInstance("SHA256withECDSA")
    signer.initSign(keyPair().private)
    signer.update(message.toByteArray(Charsets.UTF_8))
    val sequence = ASN1Sequence.getInstance(signer.sign())
    require(sequence.size() == 2) { "INVALID_DEVICE_SIGNATURE" }
    val r = (sequence.getObjectAt(0) as ASN1Integer).positiveValue
    val s = (sequence.getObjectAt(1) as ASN1Integer).positiveValue
    return encode(fixed32(r) + fixed32(s))
  }

  fun nonce(size: Int = 24): String {
    require(size in 16..64)
    return encode(ByteArray(size).also { SecureRandom().nextBytes(it) })
  }

  fun refreshToken(): String = "xopc_rt_${UUID.randomUUID()}_${nonce(32)}"

  private fun keyPair(): KeyPair {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = keyStore.getEntry(keyAlias, null) as? KeyStore.PrivateKeyEntry
    if (existing != null) return KeyPair(existing.certificate.publicKey, existing.privateKey)
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    generator.initialize(
      KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .build()
    )
    return generator.generateKeyPair()
  }

  private fun fixed32(integer: BigInteger): ByteArray {
    require(integer.signum() >= 0)
    val raw = integer.toByteArray().dropWhile { it == 0.toByte() }.toByteArray()
    require(raw.size <= 32) { "INVALID_P256_INTEGER" }
    return ByteArray(32 - raw.size) + raw
  }

  private fun encode(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

}
