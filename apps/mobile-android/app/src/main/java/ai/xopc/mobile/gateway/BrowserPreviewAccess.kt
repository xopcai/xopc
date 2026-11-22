package ai.xopc.mobile.gateway

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.net.URL
import java.net.URLEncoder
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.runInterruptible
import org.json.JSONObject

internal data class BrowserPreviewStatus(
  val available: Boolean,
  val mode: String = "extension",
  val interactive: Boolean = false,
  val status: String = "running",
  val assistanceId: String? = null,
  val reason: String? = null,
  val url: String = "",
  val title: String = "",
  val viewportWidth: Int = 1280,
  val viewportHeight: Int = 720,
  val ownControl: Boolean = false,
  val controlOwner: String? = null,
  val controlEpoch: Int = 0,
  val privacyPaused: Boolean = false,
)

internal sealed interface ManagedBrowserFrameResult {
  data class Frame(val seq: Long, val bitmap: Bitmap) : ManagedBrowserFrameResult
  data object Empty : ManagedBrowserFrameResult
  data object PrivacyPaused : ManagedBrowserFrameResult
  data object Unavailable : ManagedBrowserFrameResult
}

internal class BrowserPreviewAccess(private val gateway: GatewaySession, private val realtime: RealtimeClient) {
  val messages = realtime.browserPreviewMessages.asSharedFlow()

  fun send(message: JSONObject): Boolean = realtime.sendBrowserPreview(message)

  private fun parseStatus(json: JSONObject): BrowserPreviewStatus {
    val viewport = json.optJSONObject("viewport")
    return BrowserPreviewStatus(
      available = json.optBoolean("available"),
      mode = json.optString("mode", "extension").ifBlank { "extension" },
      interactive = json.optBoolean("interactive"),
      status = json.optString("status", "running").ifBlank { "running" },
      assistanceId = json.optString("assistanceId").takeIf(String::isNotBlank),
      reason = json.optString("reason").takeIf(String::isNotBlank),
      url = json.optString("url"),
      title = json.optString("title"),
      viewportWidth = viewport?.optInt("width", 1280) ?: 1280,
      viewportHeight = viewport?.optInt("height", 720) ?: 720,
      ownControl = json.optBoolean("ownControl"),
      controlOwner = json.optString("controlOwner").takeIf(String::isNotBlank),
      controlEpoch = json.optInt("controlEpoch", 0),
      privacyPaused = json.optBoolean("privacyPaused"),
    )
  }

  suspend fun status(gatewayId: String, conversationId: String, clientId: String? = null): BrowserPreviewStatus =
    runInterruptible(Dispatchers.IO) {
      val query = clientId?.let { "?clientId=${URLEncoder.encode(it, "UTF-8")}" } ?: ""
      val raw = gateway.request("/api/browser/preview/$conversationId$query", expectedGatewayId = gatewayId)
      parseStatus(JSONObject(raw))
    }

  suspend fun available(gatewayId: String, conversationId: String): Boolean = status(gatewayId, conversationId).available

  suspend fun managedTakeover(gatewayId: String, conversationId: String, clientId: String): BrowserPreviewStatus =
    runInterruptible(Dispatchers.IO) {
      val raw = gateway.request(
        "/api/browser/managed/$conversationId/takeover",
        method = "POST",
        body = JSONObject().put("clientId", clientId).toString(),
        expectedGatewayId = gatewayId,
      )
      parseStatus(JSONObject(raw).getJSONObject("payload"))
    }

  suspend fun managedHeartbeat(gatewayId: String, conversationId: String, clientId: String, epoch: Int): BrowserPreviewStatus =
    runInterruptible(Dispatchers.IO) {
      val raw = gateway.request(
        "/api/browser/managed/$conversationId/heartbeat",
        method = "POST",
        body = JSONObject().put("clientId", clientId).put("epoch", epoch).toString(),
        expectedGatewayId = gatewayId,
      )
      parseStatus(JSONObject(raw).getJSONObject("payload"))
    }

  suspend fun managedRelease(gatewayId: String, conversationId: String, clientId: String, epoch: Int?) {
    runInterruptible(Dispatchers.IO) {
      val body = JSONObject().put("clientId", clientId)
      if (epoch != null && epoch > 0) body.put("epoch", epoch)
      gateway.request(
        "/api/browser/managed/$conversationId/release",
        method = "POST",
        body = body.toString(),
        expectedGatewayId = gatewayId,
      )
    }
  }

  suspend fun managedHandback(gatewayId: String, conversationId: String, clientId: String, epoch: Int?): BrowserPreviewStatus? =
    runInterruptible(Dispatchers.IO) {
      val body = JSONObject().put("clientId", clientId)
      if (epoch != null && epoch > 0) body.put("epoch", epoch)
      val raw = gateway.request(
        "/api/browser/managed/$conversationId/handback",
        method = "POST",
        body = body.toString(),
        expectedGatewayId = gatewayId,
      )
      JSONObject(raw).optJSONObject("payload")?.let(::parseStatus)
    }

  suspend fun managedInput(gatewayId: String, conversationId: String, clientId: String, epoch: Int, seq: Int, event: JSONObject) {
    runInterruptible(Dispatchers.IO) {
      gateway.request(
        "/api/browser/managed/$conversationId/input",
        method = "POST",
        body = JSONObject().put("clientId", clientId).put("epoch", epoch).put("seq", seq).put("event", event).toString(),
        expectedGatewayId = gatewayId,
      )
    }
  }

  suspend fun managedFrame(gatewayId: String, conversationId: String, clientId: String, after: Long): ManagedBrowserFrameResult =
    runInterruptible(Dispatchers.IO) {
      val auth = gateway.withActiveGateway(gatewayId) { gateway.voiceAuth() }
      val encodedClient = URLEncoder.encode(clientId, "UTF-8")
      val connection = URL("${auth.origin.trimEnd('/')}/api/browser/managed/$conversationId/frame?after=$after&clientId=$encodedClient")
        .openConnection() as HttpsURLConnection
      try {
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.connectTimeout = 2000
        connection.readTimeout = 3500
        connection.setRequestProperty("Authorization", "Bearer ${auth.bearer}")
        DeviceRequestProof.apply(connection, auth.bearer)
        when (val status = connection.responseCode) {
          204 -> ManagedBrowserFrameResult.Empty
          423 -> ManagedBrowserFrameResult.PrivacyPaused
          403, 404 -> ManagedBrowserFrameResult.Unavailable
          200 -> {
            val bytes = connection.inputStream.use { input ->
              val output = java.io.ByteArrayOutputStream()
              val chunk = ByteArray(8192)
              while (true) {
                val count = input.read(chunk)
                if (count < 0) break
                require(output.size() + count <= 1024 * 1024)
                output.write(chunk, 0, count)
              }
              output.toByteArray()
            }
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@runInterruptible ManagedBrowserFrameResult.Empty
            val seq = connection.getHeaderField("X-Xopc-Preview-Frame")?.toLongOrNull() ?: after
            ManagedBrowserFrameResult.Frame(seq, bitmap)
          }
          else -> throw GatewayHttpException(status)
        }
      } finally {
        connection.disconnect()
      }
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
