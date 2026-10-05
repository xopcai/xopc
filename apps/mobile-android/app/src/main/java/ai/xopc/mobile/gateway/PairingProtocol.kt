package ai.xopc.mobile.gateway

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer

data class PairingInvitation(
  val pairingId: UUID,
  val pairingToken: String,
  val gatewayId: UUID,
  val gatewayPublicKey: ByteArray,
  val origins: List<String>,
  val expiresAtMs: Long,
) {
  override fun equals(other: Any?): Boolean = other is PairingInvitation &&
    pairingId == other.pairingId && pairingToken == other.pairingToken &&
    gatewayId == other.gatewayId && gatewayPublicKey.contentEquals(other.gatewayPublicKey) &&
    origins == other.origins && expiresAtMs == other.expiresAtMs

  override fun hashCode(): Int = pairingId.hashCode() * 31 + gatewayId.hashCode()
}

data class SignedEnvelope(val signedPayload: String, val signature: String)

/** The Gateway's compact v4 link is the only accepted source of pairing secrets and key pins. */
object PairingProtocol {
  private const val PREFIX = "https://link.xopc.ai/c#"
  private val originPattern = Regex("^https://(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\\[[0-9A-Fa-f:]+\\])(?::[0-9]{1,5})?/?$")

  fun decodeBase64Url(value: String): ByteArray {
    require(value.matches(Regex("[A-Za-z0-9_-]*")) && value.length % 4 != 1) { "INVALID_BASE64" }
    val bytes = try { Base64.getUrlDecoder().decode(value) } catch (_: IllegalArgumentException) {
      throw IllegalArgumentException("INVALID_BASE64")
    }
    require(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == value) { "INVALID_BASE64" }
    return bytes
  }

  fun secureOrigin(value: String): String {
    require(originPattern.matches(value)) { "INVALID_SECURE_ORIGIN" }
    val port = Regex(":([0-9]+)/?$").find(value)?.groupValues?.get(1)?.toIntOrNull()
    require(port == null || port in 1..65535) { "INVALID_SECURE_ORIGIN" }
    return value.removeSuffix("/")
  }

  fun readInvitation(link: String, nowMs: Long = System.currentTimeMillis()): PairingInvitation {
    val text = link.trim()
    require(text.startsWith(PREFIX) && text.length <= 16384) { "INVALID_INVITATION" }
    val bytes = decodeBase64Url(text.substring(PREFIX.length))
    require(bytes.size >= 102) { "INVALID_INVITATION" }
    val input = ByteBuffer.wrap(bytes)
    require(input.get().toInt() == 4) { "INVALID_INVITATION" }
    val pairingId = readUuid(input)
    val secret = ByteArray(32).also(input::get)
    val gatewayId = readUuid(input)
    val publicKey = ByteArray(32).also(input::get)
    val expiresAtMs = (input.int.toLong() and 0xffffffffL) * 1000L
    val count = input.get().toInt() and 0xff
    require(count in 1..8 && expiresAtMs > nowMs) { "INVALID_INVITATION" }
    val origins = ArrayList<String>(count)
    repeat(count) {
      require(input.remaining() >= 2) { "INVALID_INVITATION" }
      val length = input.short.toInt() and 0xffff
      require(length > 0 && input.remaining() >= length) { "INVALID_INVITATION" }
      val raw = ByteArray(length).also(input::get)
      require(raw.all { byte -> byte.toInt() in 0x21..0x7e }) { "INVALID_INVITATION" }
      val origin = secureOrigin(String(raw, StandardCharsets.US_ASCII))
      require(origin !in origins) { "INVALID_INVITATION" }
      origins += origin
    }
    require(!input.hasRemaining()) { "INVALID_INVITATION" }
    val encodedSecret = Base64.getUrlEncoder().withoutPadding().encodeToString(secret)
    return PairingInvitation(pairingId, "xopc_pair_${pairingId}_$encodedSecret", gatewayId, publicKey, origins, expiresAtMs)
  }

  /** Signature covers the base64url text, exactly as in the HarmonyOS client. */
  fun verifyEnvelope(publicKey: ByteArray, envelope: SignedEnvelope): ByteArray {
    require(publicKey.size == 32) { "GATEWAY_IDENTITY_MISMATCH" }
    val signatureBytes = decodeBase64Url(envelope.signature)
    require(signatureBytes.size == 64) { "GATEWAY_IDENTITY_MISMATCH" }
    val verifier = Ed25519Signer()
    verifier.init(false, Ed25519PublicKeyParameters(publicKey, 0))
    val signedText = envelope.signedPayload.toByteArray(StandardCharsets.UTF_8)
    verifier.update(signedText, 0, signedText.size)
    require(verifier.verifySignature(signatureBytes)) { "GATEWAY_IDENTITY_MISMATCH" }
    return decodeBase64Url(envelope.signedPayload)
  }

  private fun readUuid(input: ByteBuffer) = UUID(input.long, input.long)
}
