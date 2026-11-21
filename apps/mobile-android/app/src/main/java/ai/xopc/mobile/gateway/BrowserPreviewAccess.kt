package ai.xopc.mobile.gateway

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.runInterruptible
import org.json.JSONObject

internal class BrowserPreviewAccess(private val gateway: GatewaySession, private val realtime: RealtimeClient) {
  val messages = realtime.browserPreviewMessages.asSharedFlow()

  fun send(message: JSONObject): Boolean = realtime.sendBrowserPreview(message)

  suspend fun available(gatewayId: String, conversationId: String): Boolean = runInterruptible(Dispatchers.IO) {
    JSONObject(gateway.request("/api/browser/preview/$conversationId", expectedGatewayId = gatewayId)).optBoolean("available")
  }

  suspend fun snapshot(gatewayId: String, requestId: String, token: String, after: Long): Pair<Long, Bitmap>? =
    runInterruptible(Dispatchers.IO) {
      val auth = gateway.withActiveGateway(gatewayId) { gateway.voiceAuth() }
      val connection = URL("${auth.origin.trimEnd('/')}/api/browser/preview/$requestId/snapshot?after=$after")
        .openConnection() as HttpsURLConnection
      try {
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.connectTimeout = 1500
        connection.readTimeout = 1500
        connection.setRequestProperty("Authorization", "Bearer ${auth.bearer}")
        connection.setRequestProperty("X-Xopc-Preview", token)
        DeviceRequestProof.apply(connection, auth.bearer)
        when (val status = connection.responseCode) {
          204 -> null
          200 -> {
            val bytes = connection.inputStream.use { input ->
              val output = java.io.ByteArrayOutputStream()
              val chunk = ByteArray(4096)
              while (true) {
                val count = input.read(chunk)
                if (count < 0) break
                require(output.size() + count <= 80 * 1024)
                output.write(chunk, 0, count)
              }
              output.toByteArray()
            }
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@runInterruptible null
            (connection.getHeaderField("X-Xopc-Preview-Frame")?.toLongOrNull() ?: after) to bitmap
          }
          else -> throw GatewayHttpException(status)
        }
      } finally {
        connection.disconnect()
      }
    }
}
