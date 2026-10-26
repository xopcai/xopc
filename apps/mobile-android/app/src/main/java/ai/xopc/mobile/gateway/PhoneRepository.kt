package ai.xopc.mobile.gateway

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.net.URL
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import org.json.JSONObject

data class PhoneBinding(val conversationId: String, val transcriptId: String, val sessionId: String)
data class PhoneSummary(val available: Boolean, val access: String, val name: String, val needsUser: Boolean, val binding: PhoneBinding?, val assistanceId: String? = null, val assistanceVersion: Int = 1)
data class PhoneState(val sessionId: String, val epoch: Int, val ownControl: Boolean, val mode: String,
  val owner: String, val status: String, val assistanceId: String?, val restore: Boolean, val manualText: Boolean, val pendingTask: Boolean? = null, val revision: Long = 0, val assistanceVersion: Int? = null)
data class PhoneFrame(val bitmap: Bitmap, val seq: Long, val capturedAt: Long)

class PhoneRepository(private val session: GatewaySession) {
  val gatewayId = session.currentProfile()?.gatewayId
  val clientId: String = UUID.randomUUID().toString()
  private val viewerId = UUID.randomUUID().toString()
  private fun auth(): VoiceGatewayAuth = synchronized(session) {
    check(session.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    session.voiceAuth()
  }
  private fun base(id: String) = "/api/phone/conversations/$id"
  private suspend fun request(path: String, body: JSONObject? = null): JSONObject = runInterruptible(Dispatchers.IO) { synchronized(session) {
    check(session.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    val result = JSONObject(session.request(path, if (body == null) "GET" else "POST", body?.toString().orEmpty()))
    require(result.optBoolean("ok")) { "INVALID_PHONE_RESPONSE" }
    check(session.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    result
  } }
  suspend fun supported(): Boolean = request("/api/endpoint-tools/compatibility")
    .getJSONObject("payload").optBoolean("mobilePhoneWorkspaceV1")
  suspend fun summary(id: String): PhoneSummary {
    val value = request(base(id) + "/summary").getJSONObject("payload")
    val binding = value.optJSONObject("binding")?.let {
      PhoneBinding(it.getString("conversationId"), it.getString("transcriptId"), it.getString("phoneSessionId"))
    }
    return PhoneSummary(value.getBoolean("available"), value.getString("access"), value.optString("deviceName"), value.optBoolean("needsUser"), binding, value.optJSONObject("assistance")?.optString("id"), value.optJSONObject("assistance")?.optInt("version", 1) ?: 1)
  }
  suspend fun state(id: String): PhoneState? = request(base(id) + "?clientId=$clientId")
    .optJSONObject("payload")?.let(::parseState)
  suspend fun command(binding: PhoneBinding, state: PhoneState, op: String, action: JSONObject? = null,
    geometry: Int? = null, frameSeq: Long? = null): PhoneState {
    val body = JSONObject().put("clientId", clientId).put("operationId", UUID.randomUUID().toString())
      .put("epoch", state.epoch).put("expectedTranscriptId", binding.transcriptId).put("op", op)
    state.assistanceVersion?.let { body.put("assistanceVersion", it) }
    state.assistanceId?.let { body.put("assistanceId", it) }
    action?.let { body.put("action", it) }; geometry?.let { body.put("geometry", it) }
    frameSeq?.let { body.put("frameSeq", it) }
    return parseState(request(base(binding.conversationId) + "/${state.sessionId}/control", body).getJSONObject("payload"))
  }
  suspend fun video(binding: PhoneBinding, state: PhoneState): Pair<String, String> {
    val body = JSONObject().put("clientId", if (state.ownControl) clientId else viewerId).put("purpose", if (state.ownControl) "control" else "view")
      .put("expectedTranscriptId", binding.transcriptId)
    if (state.ownControl) body.put("epoch", state.epoch)
    val ticket = request(base(binding.conversationId) + "/${state.sessionId}/video-ticket", body).getJSONObject("payload")
    val auth = runInterruptible(Dispatchers.IO) { auth() }
    return (auth.origin.trimEnd('/') + ticket.getString("path")) to ticket.getString("ticket")
  }
  suspend fun frame(binding: PhoneBinding): PhoneFrame = runInterruptible(Dispatchers.IO) {
    val auth = auth()
    val connection = URL(auth.origin.trimEnd('/') + base(binding.conversationId) + "/${binding.sessionId}/frame?expectedTranscriptId=${binding.transcriptId}")
      .openConnection() as HttpsURLConnection
    try {
      connection.instanceFollowRedirects = false; connection.useCaches = false
      connection.connectTimeout = 8000; connection.readTimeout = 10000
      connection.setRequestProperty("Authorization", "Bearer ${auth.bearer}")
      DeviceRequestProof.apply(connection, auth.bearer)
      if (connection.responseCode != 200) throw GatewayHttpException(connection.responseCode)
      val bytes = connection.inputStream.use { input ->
        val output = java.io.ByteArrayOutputStream(); val chunk = ByteArray(8192)
        while (true) {
          val count = input.read(chunk); if (count < 0) break
          require(output.size() + count <= 8 * 1024 * 1024) { "PHONE_FRAME_TOO_LARGE" }
          output.write(chunk, 0, count)
        }
        output.toByteArray()
      }
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: error("INVALID_PHONE_FRAME")
      PhoneFrame(bitmap, connection.getHeaderField("X-Phone-Frame-Seq").toLong(),
        connection.getHeaderField("X-Phone-Captured-At").toLong())
    } finally { connection.disconnect() }
  }
  companion object {
    fun parseState(value: JSONObject): PhoneState {
      val report = value.getJSONObject("report")
      return PhoneState(report.getString("sessionId"), report.getInt("controlEpoch"), value.optBoolean("ownControl"),
        report.getString("mode"), report.optString("controlOwner"), report.getString("status"),
        report.optString("assistanceId").takeIf { it.isNotEmpty() }, report.optBoolean("reconnectRequired"), value.optString("textInput") == "manual", if (report.has("hasPendingTask")) report.optBoolean("hasPendingTask") else null, report.optLong("revision"), if (report.has("assistanceVersion")) report.optInt("assistanceVersion") else null)
    }
  }
}
