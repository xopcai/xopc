package ai.xopc.mobile.gateway

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

data class TurnClaim(val endpointId: String, val token: String, val supportsDeviceContext: Boolean = false) {
  fun json(): JSONObject = JSONObject().put("type", "endpoint").put("endpointId", endpointId).put("token", token)
}

data class RunStreamEvent(val runId: String, val conversationId: String, val type: String,
  val messageId: String?, val delta: String?, val offset: Int?, val presentation: String? = null,
  val status: String? = null) {
  companion object {
    fun parse(topic: String, event: String, data: JSONObject): RunStreamEvent? {
      val runId = topic.removePrefix("run:")
      if (!topic.startsWith("run:") || data.optString("runId") != runId) return null
      val conversationId = data.optString("conversationId").takeIf(String::isNotBlank) ?: return null
      if (event !in setOf("assistant_delta", "assistant_message_end", "clarify_request", "run_end", "error")) return null
      val payload = data.optJSONObject("payload") ?: return null
      return RunStreamEvent(runId, conversationId, event,
        (payload.opt("messageId") as? String)?.takeIf(String::isNotBlank),
        (payload.opt("delta") as? String)?.takeIf(String::isNotEmpty),
        (payload.opt("offset") as? Number)?.toInt()?.takeIf { it >= 0 },
        payload.optString("presentation").takeIf(String::isNotBlank),
        payload.optString("status").takeIf { it in setOf("success", "error", "cancelled", "suspended") })
    }
  }
}

/** A ViewModel-owned realtime connection. The caller owns this suspending loop and its cancellation. */
internal class RealtimeClient(
  private val gateway: GatewaySession,
  private val deviceTools: DeviceTools? = null,
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
    if (topic.startsWith("run:")) item.put("view", "compact")
    if (afterSeq != null) item.put("afterSeq", afterSeq)
    socket.send(frame("realtime.subscribe", JSONObject().put("subscriptions", JSONArray().put(item))))
  }

  fun turnClaim(): TurnClaim = claim ?: throw IllegalStateException("REALTIME_NOT_READY")

  suspend fun run(onState: (String) -> Unit, onInvalidation: (String) -> Unit,
    onRunEvent: (RunStreamEvent) -> Unit,
    onTaskResult: (String) -> Unit = { onInvalidation("sessions") }) {
    var attempt = 0
    while (currentCoroutineContext().isActive) {
      onState(if (attempt == 0) "connecting" else "reconnecting")
      try {
        connectOnce(onState, onInvalidation, onRunEvent, onTaskResult)
        attempt = 0
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        DeviceLocation.cancelAll(); DevicePersonalTools.cancelAll()
        claim = null
        onState("reconnecting")
        delay((1_000L shl attempt.coerceAtMost(4)).coerceAtMost(30_000L))
        attempt++
      }
    }
  }

  private suspend fun connectOnce(onState: (String) -> Unit, onInvalidation: (String) -> Unit,
    onRunEvent: (RunStreamEvent) -> Unit, onTaskResult: (String) -> Unit) {
    val profile = gateway.currentProfile() ?: throw IllegalStateException("NOT_PAIRED")
    val clientId = "android:${profile.deviceId}"
    val displayName = "xopc Android"
    val registration = JSONObject().put("principalId", profile.deviceId).put("displayName", displayName)
      .put("kind", "mobile").put("platform", "android").put("publicKey", identity.publicKeyDer())
    val compatibility = runInterruptible(Dispatchers.IO) { JSONObject(gateway.request("/api/endpoint-tools/compatibility")) }
    val supportsPersonalTools = compatibility.optJSONObject("payload")?.optBoolean("mobilePersonalToolsV1") == true
    val supportsLocationTools = compatibility.optJSONObject("payload")?.optBoolean("deviceLocationTasksV1") == true
    val supportsDeviceTools = compatibility.optJSONObject("payload")?.optBoolean("deviceStateToolsV1") == true
    val supportsDeviceContext = compatibility.optJSONObject("payload")?.optBoolean("turnDeviceContextV1") == true
    val supportsEnvironment = compatibility.optJSONObject("payload")?.optBoolean("endpointEnvironmentV1") == true
    val ticketResponse = runInterruptible(Dispatchers.IO) {
      val registered = JSONObject(gateway.request("/api/endpoint-tools/principals", "POST", registration.toString()))
      require(registered.optBoolean("ok")) { "ENDPOINT_REGISTRATION_FAILED" }
      JSONObject(gateway.request("/api/realtime/tickets", "POST", JSONObject()
        .put("clientId", clientId).put("clientKind", "mobile").put("protocolVersion", 2).toString()))
    }
    val ticketPayload = ticketResponse.getJSONObject("payload")
    require(ticketResponse.optBoolean("ok") && ticketPayload.getJSONObject("realtime").getInt("minVersion") <= 2 &&
      ticketPayload.getJSONObject("realtime").getInt("maxVersion") >= 2) { "INVALID_REALTIME_TICKET" }
    val endpoint = runInterruptible(Dispatchers.IO) { endpointHello(profile.deviceId, clientId, displayName, supportsDeviceTools, supportsLocationTools, supportsPersonalTools) }
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
    val connectionProof = runInterruptible(Dispatchers.IO) { DeviceRequestProof.connection(origin, "/api/realtime/v1/ws", ticketPayload.getString("ticket")) }
    val socket = http.newWebSocket(Request.Builder()
      .url(origin.replaceFirst("https:", "wss:") + "/api/realtime/v1/ws")
      .header("X-Xopc-Proof", connectionProof).build(), listener)
    var environmentJob: kotlinx.coroutines.Job? = null
    try {
      val first = withTimeoutOrNull(10_000) { events.receiveCatching().getOrNull() }
        ?: throw IllegalStateException("REALTIME_HELLO_TIMEOUT")
      val ready = JSONObject(first)
      require(ready.getInt("protocolVersion") == 2 && ready.getString("kind") == "realtime.ready") { "INVALID_REALTIME_READY" }
      val endpointReady = ready.getJSONObject("payload").getJSONObject("endpoint")
      require(endpointReady.getString("endpointId") == clientId && endpointReady.getString("turnToken").length >= 32) {
        "MISSING_ENDPOINT_CLAIM"
      }
      claim = TurnClaim(clientId, endpointReady.getString("turnToken"), supportsDeviceContext)
      if (supportsEnvironment) {
        val contextClaim = claim!!
        environmentJob = CoroutineScope(currentCoroutineContext()).launch { publishEnvironment(contextClaim) }
      }
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
          "endpoint.message" -> {
            val inner = message.getJSONObject("payload")
            when (inner.getString("type")) {
              "tool.invoke" -> deviceTools?.invoke(inner.getJSONObject("payload")) { kind, payload -> socket.send(endpointFrame(kind, payload)) }
              "tool.cancel" -> { val id = inner.getJSONObject("payload").getString("invocationId"); DeviceLocation.cancel(id); DevicePersonalTools.cancel(id) }
            }
          }
          "realtime.event" -> {
            val payload = message.getJSONObject("payload")
            val topic = payload.getString("topic")
            if (topic == "sessions" && payload.optString("event") == "session.task-result") {
              val conversationId = payload.optJSONObject("data")?.optString("conversationId").orEmpty()
              if (conversationId.isNotBlank()) onTaskResult(conversationId)
            } else if (topic == "sessions" || topic == "gateway") onInvalidation(topic)
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
      environmentJob?.cancel()
      DeviceLocation.cancelAll(); DevicePersonalTools.cancelAll()
        claim = null
      synchronized(this) { if (readySocket === socket) readySocket = null }
      socket.close(1000, "Closing")
      events.close()
    }
  }

  private suspend fun publishEnvironment(origin: TurnClaim) {
    val root = "/api/user-context/environment"
    var epoch: String? = null
    var sequence = 0L
    var heartbeatSequence = 0L
    var nextReport = 0L
    suspend fun request(path: String, body: JSONObject? = null): JSONObject = runInterruptible(Dispatchers.IO) {
      val response = JSONObject(if (body == null) gateway.request(path) else gateway.request(path, "POST", body.toString()))
      require(response.optBoolean("ok")) { "CONTEXT_UNAVAILABLE" }
      response.getJSONObject("payload")
    }
    while (currentCoroutineContext().isActive && claim?.token == origin.token) {
      try {
        if (epoch == null) epoch = request("$root/endpoints/${java.net.URLEncoder.encode(origin.endpointId, "UTF-8")}").getString("connectionEpoch")
        val foreground = withContext(Dispatchers.Main.immediate) { DeviceLocation.isForeground() }
        request("$root/heartbeats", JSONObject().put("origin", origin.json()).put("heartbeat", JSONObject()
          .put("connectionEpoch", epoch).put("sequence", ++heartbeatSequence)
          .put("availability", if (foreground) "foreground" else "background")))
        val now = System.currentTimeMillis()
        if (foreground && now >= nextReport) {
          val values = JSONObject().put("environment.timezone", java.util.TimeZone.getDefault().id)
            .put("environment.locale", java.util.Locale.getDefault().toLanguageTag())
          request("$root/reports", JSONObject().put("origin", origin.json()).put("report", JSONObject()
            .put("version", 1).put("reportId", UUID.randomUUID().toString()).put("connectionEpoch", epoch)
            .put("sequence", ++sequence).put("baseRevision", JSONObject.NULL).put("mode", "full")
            .put("capturedAt", now).put("values", values)))
          nextReport = now + 60_000
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { epoch = null; nextReport = 0L }
      delay(15_000)
    }
  }

  private fun endpointHello(principalId: String, endpointId: String, displayName: String, supportsDeviceTools: Boolean, supportsLocationTools: Boolean, supportsPersonalTools: Boolean): JSONObject {
    val unsigned = JSONObject().put("appVersion", "1.0").put("availability", "foreground")
      .put("connectionInstanceId", UUID.randomUUID().toString()).put("displayName", displayName)
      .put("endpointId", endpointId).put("kind", "mobile").put("nonce", UUID.randomUUID().toString())
      .put("platform", "android").put("principalId", principalId).put("signedAt", System.currentTimeMillis())
      .put("tools", if (supportsDeviceTools) deviceTools?.catalog(supportsLocationTools, supportsPersonalTools) ?: JSONArray() else JSONArray())
    val canonical = canonicalEndpointJson(unsigned)
    return unsigned.put("signature", identity.sign(canonical))
  }

  private fun endpointFrame(kind: String, payload: JSONObject): String = frame("endpoint.message", JSONObject()
    .put("protocolVersion", 2).put("messageId", UUID.randomUUID().toString()).put("type", kind)
    .put("sentAt", System.currentTimeMillis()).put("payload", payload))

  private fun frame(kind: String, payload: JSONObject): String = JSONObject().put("protocolVersion", 2)
    .put("messageId", UUID.randomUUID().toString()).put("kind", kind)
    .put("sentAt", System.currentTimeMillis()).put("payload", payload).toString()
}

private fun canonicalEndpointJson(value: Any?): String = when (value) {
  is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") {
    JSONObject.quote(it) + ":" + canonicalEndpointJson(value.get(it))
  }
  is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonicalEndpointJson(value.get(it)) }
  is String -> JSONObject.quote(value)
  null, JSONObject.NULL -> "null"
  else -> value.toString()
}
