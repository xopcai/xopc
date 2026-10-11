package ai.xopc.mobile.gateway

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

class DeviceRequestProofTest {
  @Test fun canonicalBytesAndP256MatchGatewayVector() {
    val message = DeviceRequestProof.message("11111111-1111-4111-8111-111111111111", "xopc_at_test_vector", "POST", "/api/sessions/test/inputs?q=%E4%BD%A0%E5%A5%BD&a=1&a=2",
      DeviceRequestProof.digest("{\"text\":\"你好 👋\"}".toByteArray(Charsets.UTF_8)),
      listOf("application/json", "22222222-2222-4222-8222-222222222222", "", "", ""), 1791720000000L, "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3")
    assertEquals("xopc-request-v1\n11111111-1111-4111-8111-111111111111\nd47214a4ddd968f6ab36b8f51398d244eafdc228120711c6b2ea7b2e86442c70\nPOST\n/api/sessions/test/inputs?q=%E4%BD%A0%E5%A5%BD&a=1&a=2\n1a33dac3264f3b6f7c9489738e3647d60d147c22d6dce8ec604d7b61629abc3d\napplication/json\n22222222-2222-4222-8222-222222222222\n\n\n\n1791720000000\nMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3", message)
    val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode("MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjnMerjMejj+uFxTLzHbxNhOkATPCWeAMhzJB2bd8OC0McGu16nLQn8/0URG/flrmzaypJv/6YbMQCsWNQdm9kA==")))
    val verifier = Signature.getInstance("SHA256withECDSAinP1363Format")
    verifier.initVerify(publicKey); verifier.update(message.toByteArray(Charsets.UTF_8))
    assertTrue(verifier.verify(Base64.getDecoder().decode("UyxgmOBtH53/dGJY+97peYmlCfOdZCT57GhH7SRJ0NkPPIL41lLrm6IXxBsF6dGqZbryeagl8e3G2hxqbhH7fQ==")))
  }
}
