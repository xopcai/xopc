package ai.xopc.mobile.gateway

import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
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

data class TurnClaim(val endpointId: String, val token: String, val supportsDeviceContext: Boolean = false, val supportsClarificationV2: Boolean = false) {
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
      if (event !in setOf("assistant_delta", "assistant_message_end", "clarify_request", "run_end", "error", "tool_end")) return null
      val payload = data.optJSONObject("payload") ?: return null
      if (event == "tool_end" &&
        (payload.optString("toolName") != "music_generation" || payload.optString("status") != "success")) return null
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
  private val http: OkHttpClient = OkHttpClient.Builder().followRedirects(false).pingInterval(25, TimeUnit.SECONDS).build(),
) {
  private data class BootstrapCache(
    val key: String,
    val supportsPersonalTools: Boolean,
    val supportsExtendedTools: Boolean,
    val supportsLocationTools: Boolean,
    val supportsDeviceTools: Boolean,
    val supportsDeviceContext: Boolean,
    val supportsClarificationV2: Boolean,
    val supportsEnvironment: Boolean,
  )

  private val conversationHistoryEvents = setOf("session.task-result", "session.agent-reaction", "session.agent-reaction.preference")
  @Volatile private var claim: TurnClaim? = null
  @Volatile private var appForeground = true
  @Volatile private var pendingProbe: CompletableDeferred<Boolean>? = null
  @Volatile private var bootstrapCache: BootstrapCache? = null
  private var watchedRunTopic: String? = null
  private var watchedRunSeq = 0L
  private var readySocket: WebSocket? = null
  private var browserPreviewSupported = false
  val browserPreviewMessages = MutableSharedFlow<JSONObject>(extraBufferCapacity = 64)

  fun clearBootstrapCache() {
    bootstrapCache = null
  }

  @Synchronized fun notifyBackground() {
    appForeground = false
    pendingProbe?.complete(false)
    pendingProbe = null
    readySocket?.send(endpointFrame("endpoint.availability_changed", JSONObject().put("availability", "background")))
  }

  suspend fun probeOrReconnect(timeoutMs: Long = 1_500L, foreground: Boolean = true): Boolean {
    appForeground = foreground
    val availability = if (foreground) "foreground" else "background"
    val deferred = CompletableDeferred<Boolean>()
    val socket = synchronized(this) {
      val current = readySocket ?: return false
      pendingProbe?.complete(false)
      pendingProbe = deferred
      current
    }
    val sent = runCatching {
      socket.send(endpointFrame("endpoint.availability_changed", JSONObject().put("availability", availability)))
      socket.send(frame("realtime.ping", JSONObject().put("availability", availability)))
    }.getOrDefault(false)
    if (!sent) {
      synchronized(this) { if (pendingProbe === deferred) pendingProbe = null }
      return false
    }
    return try { withTimeoutOrNull(timeoutMs) { deferred.await() } == true }
    finally { synchronized(this) { if (pendingProbe === deferred) pendingProbe = null } }
  }

  @Synchronized fun sendBrowserPreview(payload: JSONObject): Boolean =
    browserPreviewSupported && readySocket?.send(frame("browser.preview", payload)) == true

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
    onTaskResult: (String) -> Unit = { onInvalidation("sessions") },
    onSuggestionChanged: (String?) -> Unit = {},
    recovering: Boolean = false) {
    var attempt = 0
    onState(if (recovering) "reconnecting" else "connecting")
    while (currentCoroutineContext().isActive) {
      try {
        connectOnce({
          attempt = 0
          onState(it)
        }, onInvalidation, onRunEvent, onTaskResult, onSuggestionChanged)
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        DeviceLocation.cancelAll(); DevicePersonalTools.cancelAll()
        claim = null
      }
      onState("reconnecting")
      delay((1_000L shl attempt.coerceAtMost(5)).coerceAtMost(30_000L))
      attempt++
    }
  }

  private suspend fun connectOnce(onState: (String) -> Unit, onInvalidation: (String) -> Unit,
    onRunEvent: (RunStreamEvent) -> Unit, onTaskResult: (String) -> Unit,
    onSuggestionChanged: (String?) -> Unit) {
    val profile = gateway.currentProfile() ?: throw IllegalStateException("NOT_PAIRED")
    val clientId = "android:${profile.deviceId}"
    val displayName = "xopc Android"
    val origin = runInterruptible(Dispatchers.IO) {
      // A safe read can rediscover a reachable route before any one-time requests.
      gateway.request("/api/health", expectedGatewayId = profile.gatewayId)
      gateway.activeVerifiedOrigin()
    }
    val cacheKey = "${profile.gatewayId}:${profile.deviceId}:$origin"
    val bootstrap = bootstrapCache?.takeIf { it.key == cacheKey } ?: run {
      val registration = JSONObject().put("principalId", profile.deviceId).put("displayName", displayName)
        .put("kind", "mobile").put("platform", "android").put("publicKey", identity.publicKeyDer())
      val compatibility = runInterruptible(Dispatchers.IO) { JSONObject(gateway.request("/api/endpoint-tools/compatibility")) }
      val compatPayload = compatibility.optJSONObject("payload")
      val supportsClarificationV2 = runInterruptible(Dispatchers.IO) {
        runCatching { JSONObject(gateway.request("/api/health")).optJSONArray("clarificationVersions")?.let { versions ->
          (0 until versions.length()).any { versions.optInt(it) == 2 }
        } == true }.getOrDefault(false)
      }
      runInterruptible(Dispatchers.IO) {
        val registered = JSONObject(gateway.request("/api/endpoint-tools/principals", "POST", registration.toString()))
        require(registered.optBoolean("ok")) { "ENDPOINT_REGISTRATION_FAILED" }
      }
      BootstrapCache(
        key = cacheKey,
        supportsPersonalTools = compatPayload?.optBoolean("mobilePersonalToolsV1") == true,
        supportsExtendedTools = compatPayload?.optBoolean("mobileExtendedPersonalToolsV1") == true,
        supportsLocationTools = compatPayload?.optBoolean("deviceLocationTasksV1") == true,
        supportsDeviceTools = compatPayload?.optBoolean("deviceStateToolsV1") == true,
        supportsDeviceContext = compatPayload?.optBoolean("turnDeviceContextV1") == true,
        supportsClarificationV2 = supportsClarificationV2,
        supportsEnvironment = compatPayload?.optBoolean("endpointEnvironmentV1") == true,
      ).also { bootstrapCache = it }
    }
    val ticketResponse = runInterruptible(Dispatchers.IO) {
      JSONObject(gateway.request("/api/realtime/tickets", "POST", JSONObject()
        .put("clientId", clientId).put("clientKind", "mobile").put("protocolVersion", 2).toString()))
    }
    val ticketPayload = ticketResponse.getJSONObject("payload")
    require(ticketResponse.optBoolean("ok") && ticketPayload.getJSONObject("realtime").getInt("minVersion") <= 2 &&
      ticketPayload.getJSONObject("realtime").getInt("maxVersion") >= 2) { "INVALID_REALTIME_TICKET" }
    val ticketCapabilities = ticketPayload.getJSONObject("realtime").optJSONArray("capabilities") ?: JSONArray()
    require((0 until ticketCapabilities.length()).any { ticketCapabilities.optString(it) == "endpoint.tools.v3" }) { "GATEWAY_UPDATE_REQUIRED" }
    val endpoint = runInterruptible(Dispatchers.IO) {
      endpointHello(profile.deviceId, clientId, displayName, bootstrap.supportsDeviceTools, bootstrap.supportsLocationTools, bootstrap.supportsPersonalTools, bootstrap.supportsExtendedTools)
    }
    val events = Channel<String>(Channel.BUFFERED)
    val listener = object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        val hello = JSONObject().put("ticket", ticketPayload.getString("ticket"))
          .put("clientId", clientId).put("clientKind", "mobile")
          .put("capabilities", JSONArray()
            .put("endpoint.tools.v3")
            .put("mobile.mcp-setup-card.v1")
            .put("browser.preview.v1")
            .put("realtime.background-keepalive.v1")
            .put("endpoint.background-tools.v1"))
          .put("subscriptions", JSONArray().put(JSONObject().put("topic", "gateway"))
            .put(JSONObject().put("topic", "sessions"))).put("endpoint", endpoint)
        webSocket.send(frame("realtime.hello", hello))
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        synchronized(this@RealtimeClient) {
          if (readySocket === webSocket) pendingProbe?.complete(true)
        }
        if (text.length > 4 * 1024 * 1024 || events.trySend(text).isFailure) webSocket.close(1009, "Frame too large")
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        if (code == 4401 || code == 4403 || code == 4409) bootstrapCache = null
        synchronized(this@RealtimeClient) {
          if (readySocket === webSocket) pendingProbe?.complete(false)
        }
        events.close()
      }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        synchronized(this@RealtimeClient) {
          if (readySocket === webSocket) pendingProbe?.complete(false)
        }
        events.close()
      }
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
      val readyPayload = ready.getJSONObject("payload")
      val foregroundTimeoutMs = readyPayload.optLong("heartbeatTimeoutMs", 45_000L).takeIf { it > 0 } ?: 45_000L
      val backgroundTimeoutMs = readyPayload.optLong("backgroundHeartbeatTimeoutMs", foregroundTimeoutMs).takeIf { it > 0 } ?: foregroundTimeoutMs
      val endpointReady = readyPayload.getJSONObject("endpoint")
      require(endpointReady.getString("endpointId") == clientId && endpointReady.getString("turnToken").length >= 32) {
        "MISSING_ENDPOINT_CLAIM"
      }
      claim = TurnClaim(clientId, endpointReady.getString("turnToken"), bootstrap.supportsDeviceContext, bootstrap.supportsClarificationV2)
      if (bootstrap.supportsEnvironment) {
        val contextClaim = claim!!
        environmentJob = CoroutineScope(currentCoroutineContext()).launch { publishEnvironment(contextClaim) }
      }
      synchronized(this) {
        readySocket = socket
        val negotiated = readyPayload.optJSONArray("negotiatedCapabilities") ?: JSONArray()
        browserPreviewSupported = (0 until negotiated.length()).any { negotiated.optString(it) == "browser.preview.v1" }
        watchedRunTopic?.let { subscribe(socket, it, watchedRunSeq) }
      }
      onState("connected")
      var providerAccepted = false
      var providerSequence = 0L
      var providerLastReport = 0L
      var lastForeground: Boolean? = null
      if (deviceTools != null) socket.send(endpointFrame("provider.catalog.replace", JSONObject(DeviceToolCatalog.appProviderJson)))
      suspend fun publishProviderState() {
        if (!providerAccepted) return
        val now = System.currentTimeMillis()
        val foreground = appForeground && withContext(Dispatchers.Main.immediate) { DeviceLocation.isForeground() }
        if (foreground == lastForeground && now - providerLastReport < 15_000) return
        providerLastReport = now
        lastForeground = foreground
        socket.send(endpointFrame("endpoint.availability_changed", JSONObject().put("availability", if (foreground) "foreground" else "background")))
        socket.send(endpointFrame("provider.state.changed", JSONObject().put("localId", DeviceToolCatalog.appProviderId)
          .put("catalogRevision", 1).put("sequence", ++providerSequence).put("validForMs", 30_000)
          .put("reason", if (foreground) "ready" else "needs_foreground")))
      }
      var lastReceived = System.currentTimeMillis()
      var lastPingSent = lastReceived
      while (currentCoroutineContext().isActive) {
        publishProviderState()
        val received = withTimeoutOrNull(5_000) { events.receiveCatching() }
        if (received == null) {
          val now = System.currentTimeMillis()
          val foreground = appForeground && withContext(Dispatchers.Main.immediate) { DeviceLocation.isForeground() }
          val activeTimeout = if (foreground) foregroundTimeoutMs else backgroundTimeoutMs
          if (now - lastReceived > activeTimeout) break
          val pingInterval = if (foreground) 15_000L else 25_000L
          if (now - lastPingSent >= pingInterval) {
            lastPingSent = now
            socket.send(frame("realtime.ping", JSONObject().put("availability", if (foreground) "foreground" else "background")))
          }
          continue
        }
        val raw = received.getOrNull() ?: break
        lastReceived = System.currentTimeMillis()
        val message = JSONObject(raw)
        require(message.getInt("protocolVersion") == 2) { "INVALID_REALTIME_FRAME" }
        when (message.getString("kind")) {
          "browser.preview" -> browserPreviewMessages.emit(message.getJSONObject("payload"))
          "endpoint.message" -> {
            val inner = message.getJSONObject("payload")
            require(inner.optInt("protocolVersion") == 3) { "INVALID_ENDPOINT_FRAME" }
            when (inner.getString("type")) {
              "provider.catalog.ack" -> {
                val ack = inner.getJSONObject("payload")
                providerAccepted = ack.optInt("revision") == 1 && ack.optBoolean("accepted")
              }
              "tool.invoke" -> {
                val request = inner.getJSONObject("payload")
                val appReady = request.optString("toolName") == DeviceToolCatalog.appToolName && providerAccepted &&
                  withContext(Dispatchers.Main.immediate) { DeviceLocation.isForeground() }
                deviceTools?.invoke(request, appReady) { kind, payload -> socket.send(endpointFrame(kind, payload)) }
              }
              "tool.cancel" -> { val id = inner.getJSONObject("payload").getString("invocationId"); DeviceLocation.cancel(id); DevicePersonalTools.cancel(id) }
            }
          }
          "realtime.event" -> {
            val payload = message.getJSONObject("payload")
            val topic = payload.getString("topic")
            if (topic == "sessions" && payload.optString("event") == "session.next-turn-suggestion.changed") {
              val conversationId = payload.optJSONObject("data")?.optString("conversationId").orEmpty()
              if (conversationId.isNotBlank()) onSuggestionChanged(conversationId)
            } else if (topic == "sessions" && payload.optString("event") in conversationHistoryEvents) {
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
            if (topic == "sessions") onSuggestionChanged(null)
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

  private fun endpointHello(principalId: String, endpointId: String, displayName: String, supportsDeviceTools: Boolean, supportsLocationTools: Boolean, supportsPersonalTools: Boolean, supportsExtendedTools: Boolean): JSONObject {
    val unsigned = JSONObject().put("appVersion", "1.0").put("availability", if (appForeground) "foreground" else "background")
      .put("connectionInstanceId", UUID.randomUUID().toString()).put("displayName", displayName)
      .put("endpointId", endpointId).put("kind", "mobile").put("nonce", UUID.randomUUID().toString())
      .put("platform", "android").put("principalId", principalId).put("signedAt", System.currentTimeMillis())
      .put("tools", if (supportsDeviceTools) deviceTools?.catalog(supportsLocationTools, supportsPersonalTools, supportsExtendedTools) ?: JSONArray() else JSONArray())
    val canonical = canonicalEndpointJson(unsigned)
    return unsigned.put("signature", identity.sign(canonical))
  }

  private fun endpointFrame(kind: String, payload: JSONObject): String = frame("endpoint.message", JSONObject()
    .put("protocolVersion", 3).put("messageId", UUID.randomUUID().toString()).put("type", kind)
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
