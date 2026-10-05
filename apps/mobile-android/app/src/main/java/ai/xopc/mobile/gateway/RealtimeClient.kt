package ai.xopc.mobile.gateway

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

data class TurnClaim(val endpointId: String, val token: String) {
  fun json(): JSONObject = JSONObject().put("type", "endpoint").put("endpointId", endpointId).put("token", token)
}

data class RunStreamEvent(val runId: String, val conversationId: String, val type: String,
  val messageId: String?, val delta: String?, val offset: Int?) {
  companion object {
    fun appendDelta(current: String, delta: String, offset: Int?): String? {
      if (offset != null && offset != current.length) {
        if (offset < current.length && current.substring(offset).startsWith(delta)) return current
        return null
      }
      return (current + delta).takeIf { it.length <= 32_000 }
    }

    fun parse(topic: String, event: String, data: JSONObject): RunStreamEvent? {
      val runId = topic.removePrefix("run:")
      if (!topic.startsWith("run:") || data.optString("runId") != runId) return null
      val conversationId = data.optString("conversationId").takeIf(String::isNotBlank) ?: return null
      if (event !in setOf("assistant_delta", "run_end", "error")) return null
      val payload = data.optJSONObject("payload") ?: return null
      return RunStreamEvent(runId, conversationId, event,
        (payload.opt("messageId") as? String)?.takeIf(String::isNotBlank),
        (payload.opt("delta") as? String)?.takeIf(String::isNotEmpty),
        (payload.opt("offset") as? Number)?.toInt()?.takeIf { it >= 0 })
    }
  }
}

/** A ViewModel-owned realtime connection. The caller owns this suspending loop and its cancellation. */
class RealtimeClient(
  private val gateway: GatewaySession,
  private val identity: DeviceIdentity = DeviceIdentity("xopc.gateway.endpoint.p256.v1"),
  private val http: OkHttpClient = OkHttpClient.Builder().followRedirects(false).build(),
) {
  @Volatile private var claim: TurnClaim? = null
  private var watchedRunTopic: String? = null
  private var watchedRunSeq = 0L
  private var readySocket: WebSocket? = null

  @Synchronized fun watchRun(runId: String?) {
    val topic = runId?.takeIf(String::isNotBlank)?.let { "run:$it" }
    if (topic == watchedRunTopic) return
    watchedRunTopic?.let { old -> readySocket?.send(frame("realtime.unsubscribe", JSONObject().put("topics", JSONArray().put(old)))) }
    watchedRunTopic = topic
    watchedRunSeq = 0
    topic?.let { subscribe(readySocket, it, 0) }
  }

  private fun subscribe(socket: WebSocket?, topic: String, afterSeq: Long?) {
    if (socket == null) return
    val item = JSONObject().put("topic", topic)
    if (afterSeq != null) item.put("afterSeq", afterSeq)
    socket.send(frame("realtime.subscribe", JSONObject().put("subscriptions", JSONArray().put(item))))
  }

  fun turnClaim(): TurnClaim = claim ?: throw IllegalStateException("REALTIME_NOT_READY")

  suspend fun run(onState: (String) -> Unit, onInvalidation: (String) -> Unit,
    onRunEvent: (RunStreamEvent) -> Unit) {
    var attempt = 0
    while (currentCoroutineContext().isActive) {
      onState(if (attempt == 0) "connecting" else "reconnecting")
      try {
        connectOnce(onState, onInvalidation, onRunEvent)
        attempt = 0
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        claim = null
        onState("reconnecting")
        delay((1_000L shl attempt.coerceAtMost(4)).coerceAtMost(30_000L))
        attempt++
      }
    }
  }

  private suspend fun connectOnce(onState: (String) -> Unit, onInvalidation: (String) -> Unit,
    onRunEvent: (RunStreamEvent) -> Unit) {
    val profile = gateway.currentProfile() ?: throw IllegalStateException("NOT_PAIRED")
    val clientId = "android:${profile.deviceId}"
    val displayName = "xopc Android"
    val registration = JSONObject().put("principalId", profile.deviceId).put("displayName", displayName)
      .put("kind", "mobile").put("platform", "android").put("publicKey", identity.publicKeyDer())
    val ticketResponse = runInterruptible(Dispatchers.IO) {
      val registered = JSONObject(gateway.request("/api/endpoint-tools/principals", "POST", registration.toString()))
      require(registered.optBoolean("ok")) { "ENDPOINT_REGISTRATION_FAILED" }
      JSONObject(gateway.request("/api/realtime/tickets", "POST", JSONObject()
        .put("clientId", clientId).put("clientKind", "mobile").put("protocolVersion", 2).toString()))
    }
    val ticketPayload = ticketResponse.getJSONObject("payload")
    require(ticketResponse.optBoolean("ok") && ticketPayload.getJSONObject("realtime").getInt("minVersion") <= 2 &&
      ticketPayload.getJSONObject("realtime").getInt("maxVersion") >= 2) { "INVALID_REALTIME_TICKET" }
    val endpoint = runInterruptible(Dispatchers.IO) { endpointHello(profile.deviceId, clientId, displayName) }
    val origin = runInterruptible(Dispatchers.IO) { gateway.activeVerifiedOrigin() }
    val events = Channel<String>(Channel.BUFFERED)
    val listener = object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        val hello = JSONObject().put("ticket", ticketPayload.getString("ticket"))
          .put("clientId", clientId).put("clientKind", "mobile")
          .put("subscriptions", JSONArray().put(JSONObject().put("topic", "gateway"))
            .put(JSONObject().put("topic", "sessions"))).put("endpoint", endpoint)
        webSocket.send(frame("realtime.hello", hello))
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        if (text.length > 4 * 1024 * 1024 || events.trySend(text).isFailure) webSocket.close(1009, "Frame too large")
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { events.close() }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { events.close() }
    }
    val socket = http.newWebSocket(Request.Builder()
      .url(origin.replaceFirst("https:", "wss:") + "/api/realtime/v1/ws").build(), listener)
    try {
      val first = withTimeoutOrNull(10_000) { events.receiveCatching().getOrNull() }
        ?: throw IllegalStateException("REALTIME_HELLO_TIMEOUT")
      val ready = JSONObject(first)
      require(ready.getInt("protocolVersion") == 2 && ready.getString("kind") == "realtime.ready") { "INVALID_REALTIME_READY" }
      val endpointReady = ready.getJSONObject("payload").getJSONObject("endpoint")
      require(endpointReady.getString("endpointId") == clientId && endpointReady.getString("turnToken").length >= 32) {
        "MISSING_ENDPOINT_CLAIM"
      }
      claim = TurnClaim(clientId, endpointReady.getString("turnToken"))
      synchronized(this) {
        readySocket = socket
        watchedRunTopic?.let { subscribe(socket, it, watchedRunSeq) }
      }
      onState("connected")
      var lastReceived = System.currentTimeMillis()
      while (currentCoroutineContext().isActive) {
        val received = withTimeoutOrNull(5_000) { events.receiveCatching() }
        if (received == null) {
          if (System.currentTimeMillis() - lastReceived > 45_000) break
          socket.send(frame("realtime.ping", JSONObject()))
          continue
        }
        val raw = received.getOrNull() ?: break
        lastReceived = System.currentTimeMillis()
        val message = JSONObject(raw)
        require(message.getInt("protocolVersion") == 2) { "INVALID_REALTIME_FRAME" }
        when (message.getString("kind")) {
          "realtime.event" -> {
            val payload = message.getJSONObject("payload")
            val topic = payload.getString("topic")
            if (topic == "sessions" || topic == "gateway") onInvalidation(topic)
            else if (topic.startsWith("run:")) {
              val accepted = synchronized(this) {
                val seq = payload.getLong("seq")
                if (topic != watchedRunTopic || seq <= watchedRunSeq) false
                else { watchedRunSeq = seq; true }
              }
              if (accepted) RunStreamEvent.parse(topic, payload.getString("event"),
                payload.getJSONObject("data"))?.let(onRunEvent)
            }
          }
          "realtime.gap" -> {
            val gap = message.getJSONObject("payload")
            val topic = gap.getString("topic")
            onInvalidation(topic)
            if (topic.startsWith("run:") && !gap.optBoolean("recoverable")) {
              synchronized(this) {
                if (topic == watchedRunTopic) {
                  watchedRunSeq = 0
                  subscribe(socket, topic, null)
                }
              }
            }
          }
          "realtime.error" -> break
        }
      }
      throw IllegalStateException("REALTIME_DISCONNECTED")
    } finally {
      claim = null
      synchronized(this) { if (readySocket === socket) readySocket = null }
      socket.close(1000, "Closing")
      events.close()
    }
  }

  private fun endpointHello(principalId: String, endpointId: String, displayName: String): JSONObject {
    val unsigned = JSONObject().put("appVersion", "1.0").put("availability", "foreground")
      .put("connectionInstanceId", UUID.randomUUID().toString()).put("displayName", displayName)
      .put("endpointId", endpointId).put("kind", "mobile").put("nonce", UUID.randomUUID().toString())
      .put("platform", "android").put("principalId", principalId).put("signedAt", System.currentTimeMillis())
      .put("tools", JSONArray())
    val canonical = listOf("appVersion", "availability", "connectionInstanceId", "displayName", "endpointId", "kind",
      "nonce", "platform", "principalId", "signedAt", "tools")
      .joinToString(",", "{", "}") { key -> JSONObject.quote(key) + ":" + unsigned.get(key).let {
        if (it is String) JSONObject.quote(it) else it.toString()
      } }
    return unsigned.put("signature", identity.sign(canonical))
  }

  private fun frame(kind: String, payload: JSONObject): String = JSONObject().put("protocolVersion", 2)
    .put("messageId", UUID.randomUUID().toString()).put("kind", kind)
    .put("sentAt", System.currentTimeMillis()).put("payload", payload).toString()
}
