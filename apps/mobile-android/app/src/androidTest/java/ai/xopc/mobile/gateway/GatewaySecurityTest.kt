package ai.xopc.mobile.gateway

import androidx.test.core.app.ApplicationProvider
import android.content.Context
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GatewaySecurityTest {
  @Test fun credentialRoundTripSurvivesStoreRecreation() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val first = AndroidSecureStore(context, "gateway_credentials_test_v1", "xopc.gateway.credentials.test.v1")
    val name = "test.credential"
    first.remove(name)
    try {
      first.write(name, "test-refresh-value")
      assertEquals("test-refresh-value", AndroidSecureStore(context, "gateway_credentials_test_v1", "xopc.gateway.credentials.test.v1").read(name))
      assertNotEquals("test-refresh-value", context.getSharedPreferences("gateway_credentials_test_v1", Context.MODE_PRIVATE).getString(name, null))
    } finally {
      first.remove(name)
    }
    assertNull(AndroidSecureStore(context, "gateway_credentials_test_v1", "xopc.gateway.credentials.test.v1").read(name))
  }

  @Test fun deviceIdentityIsStableAndProducesRawP256Signature() {
    val first = DeviceIdentity("xopc.gateway.device.p256.test.v1")
    val key = first.publicKey()
    assertEquals("EC", key.kty)
    assertEquals("P-256", key.crv)
    assertEquals(32, Base64.getUrlDecoder().decode(key.x).size)
    assertEquals(32, Base64.getUrlDecoder().decode(key.y).size)
    assertEquals(key, DeviceIdentity("xopc.gateway.device.p256.test.v1").publicKey())
    assertEquals(64, Base64.getUrlDecoder().decode(first.sign("xopc-device-pairing-v3")).size)
  }
}
