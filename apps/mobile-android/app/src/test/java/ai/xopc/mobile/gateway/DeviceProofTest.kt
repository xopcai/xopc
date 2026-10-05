package ai.xopc.mobile.gateway

import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceProofTest {
  @Test fun pairingProofMatchesGatewayCanonicalFieldOrder() {
    val body = PairingProofBody(
      gatewayId = "gateway", requestId = "request", pairingToken = "token", timestamp = 123,
      nonce = "nonce", device = DevicePublicKey(x = "x", y = "y"), displayName = "Android \"phone\"",
    )
    assertEquals(
      "xopc-device-pairing-v3\nPOST\nrequest\n{\"device\":{\"displayName\":\"Android \\\"phone\\\"\",\"platform\":\"android\",\"publicKeyJwk\":{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"x\",\"y\":\"y\"}},\"gatewayId\":\"gateway\",\"nonce\":\"nonce\",\"pairingToken\":\"token\",\"requestId\":\"request\",\"timestamp\":123}",
      DeviceProof.pairing("request", body),
    )
  }

  @Test fun refreshProofMatchesGatewayFormat() {
    assertEquals("xopc-device-refresh-v2\ncredential\n123\nnonce\nrequest\nnext", DeviceProof.refresh("credential", 123, "nonce", "request", "next"))
  }
}
