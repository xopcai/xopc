package ai.xopc.mobile.gateway

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PairingProtocolTest {
  private val pairingId = UUID.fromString("11111111-2222-3333-4444-555555555555")
  private val gatewayId = UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
  private val secret = ByteArray(32) { it.toByte() }
  private val privateKey = Ed25519PrivateKeyParameters(ByteArray(32) { (it + 1).toByte() }, 0)
  private val publicKey = privateKey.generatePublicKey().encoded

  @Test fun readsHarmonyCompactInvitation() {
    val invitation = PairingProtocol.readInvitation(link(), 1_700_000_000_000)
    assertEquals(pairingId, invitation.pairingId)
    assertEquals(gatewayId, invitation.gatewayId)
    assertEquals("xopc_pair_${pairingId}_${encode(secret)}", invitation.pairingToken)
    assertArrayEquals(publicKey, invitation.gatewayPublicKey)
    assertEquals(listOf("https://gateway.example:8443"), invitation.origins)
  }

  @Test fun rejectsExpiredMalformedAndUnsafeLinks() {
    assertThrows(IllegalArgumentException::class.java) { PairingProtocol.readInvitation(link(), 2_000_000_000_000) }
    assertThrows(IllegalArgumentException::class.java) { PairingProtocol.readInvitation(link("http://gateway.example"), 1_700_000_000_000) }
    assertThrows(IllegalArgumentException::class.java) { PairingProtocol.readInvitation(link("https://gateway.example/path"), 1_700_000_000_000) }
    assertThrows(IllegalArgumentException::class.java) { PairingProtocol.decodeBase64Url("Zh") }
    assertThrows(IllegalArgumentException::class.java) { PairingProtocol.readInvitation(link() + "A", 1_700_000_000_000) }
  }

  @Test fun verifiesOnlyPayloadSignedByPinnedGatewayKey() {
    val payload = encode("{\"gatewayId\":\"$gatewayId\"}".toByteArray(StandardCharsets.UTF_8))
    val signer = Ed25519Signer()
    signer.init(true, privateKey)
    val bytes = payload.toByteArray(StandardCharsets.UTF_8)
    signer.update(bytes, 0, bytes.size)
    val envelope = SignedEnvelope(payload, encode(signer.generateSignature()))
    assertArrayEquals(PairingProtocol.decodeBase64Url(payload), PairingProtocol.verifyEnvelope(publicKey, envelope))
    assertThrows(IllegalArgumentException::class.java) {
      PairingProtocol.verifyEnvelope(publicKey, envelope.copy(signedPayload = payload + "A"))
    }
    assertThrows(IllegalArgumentException::class.java) {
      PairingProtocol.verifyEnvelope(ByteArray(32), envelope)
    }
  }

  @Test fun transportRejectsEscapingApiPaths() {
    assertEquals("/api/device-pairing/probe", GatewayTransport.apiPath("/api/device-pairing/probe"))
    assertEquals("/api/sessions?limit=20&offset=0", GatewayTransport.apiPath("/api/sessions?limit=20&offset=0"))
    listOf("/api/../admin", "//evil.example/api", "/api/%2e%2e", "/settings", "/api/x#token=y").forEach { path ->
      assertThrows(IllegalArgumentException::class.java) { GatewayTransport.apiPath(path) }
    }
  }

  private fun link(origin: String = "https://gateway.example:8443"): String {
    val originBytes = origin.toByteArray(StandardCharsets.US_ASCII)
    val bytes = ByteBuffer.allocate(102 + 2 + originBytes.size)
    bytes.put(4)
    bytes.putLong(pairingId.mostSignificantBits).putLong(pairingId.leastSignificantBits)
    bytes.put(secret)
    bytes.putLong(gatewayId.mostSignificantBits).putLong(gatewayId.leastSignificantBits)
    bytes.put(publicKey)
    bytes.putInt(1_800_000_000)
    bytes.put(1)
    bytes.putShort(originBytes.size.toShort()).put(originBytes)
    return "https://link.xopc.ai/c#${encode(bytes.array())}"
  }

  private fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}
