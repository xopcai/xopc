package ai.xopc.mobile.gateway

import android.os.SystemClock
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONArray
import org.json.JSONObject

internal interface VoiceNoteLive {
  val available: StateFlow<Boolean>
  val transcript: StateFlow<String>
  suspend fun connect()
  fun audio(pcm: ByteArray)
  fun commit()
}

internal class DiscussionLiveTranscription(
  private val gateway: GatewaySession,
  private val gatewayId: String,
  private val webSockets: WebSocket.Factory = client,
) : VoiceNoteLive {
  override val available = MutableStateFlow(false)
  override val transcript = MutableStateFlow("")
  private var socket: WebSocket? = null
  private var epoch = 0
  private var sequence = 0
  private var utterance = ""
  @Volatile private var committed = false
  private var confirmed = ""

  override suspend fun connect() {
    while (!committed && connectOnce()) delay(1_000)
  }

  private suspend fun connectOnce(): Boolean {
    var didConnect = false
    var session: VoiceCallConnection? = null
    try {
      val opened = runInterruptible(Dispatchers.IO) {
        gateway.withActiveGateway(gatewayId) {
          val status = JSONObject(gateway.request("/api/voice/realtime/status")).getJSONObject("payload")
          if (!status.optBoolean("enabled") ||
            status.optJSONObject("capabilities")?.optJSONObject("dictation")?.optBoolean("available") != true) {
            return@withActiveGateway null
          }
          val body = JSONObject().put("purpose", "dictation")
            .put("supportedProtocolVersions", JSONArray().put(3))
            .put("mediaPreferences", JSONArray().put("websocket-pcm")).toString()
          gateway.request("/api/voice/realtime/preflight", "POST", body)
          val auth = gateway.voiceAuth()
          val result = JSONObject(gateway.request("/api/voice/realtime/sessions", "POST", body)).getJSONObject("payload")
          VoiceCallConnection(result.getString("sessionId"), result.getString("ticket"), result.getString("websocketPath"),
            result.getInt("connectionEpoch"), auth.origin, auth.bearer, result.getJSONObject("limits").getLong("maxSessionMs"),
            result.getJSONObject("route").getString("engine")).also { session = it }
            .also {
              require(result.getInt("protocolVersion") == 3 &&
                result.getJSONObject("inputFormat").getInt("sampleRate") == VOICE_SAMPLE_RATE &&
                it.websocketPath == VOICE_WS_PATH)
            }
        }
      } ?: return false
      val events = Channel<String>(64)
      val request = runInterruptible(Dispatchers.IO) {
        Request.Builder().url(opened.origin.trimEnd('/').replaceFirst("https://", "wss://") + opened.websocketPath)
          .header("X-Xopc-Proof", DeviceRequestProof.connection(opened.origin, opened.websocketPath, opened.ticket))
          .build()
      }
      val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          webSocket.send(voiceClientEvent("session.start", sessionIdentity(opened)))
        }
        override fun onMessage(webSocket: WebSocket, text: String) {
          if (events.trySend(text).isFailure) webSocket.cancel()
        }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(code, null)
          events.close()
        }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          events.close()
        }
      }
      val connected = webSockets.newWebSocket(request, listener)
      synchronized(this) {
        socket = connected
        epoch = opened.connectionEpoch
        sequence = 0
        utterance = UUID.randomUUID().toString()
      }
      var eventSequence = 0
      fun parse(text: String): JSONObject = JSONObject(text).also {
        require(it.getInt("protocolVersion") == 3 && it.getString("sessionId") == opened.sessionId &&
          it.getInt("seq") == ++eventSequence) { "VOICE_PROTOCOL_ERROR" }
      }
      val ready = checkNotNull(withTimeoutOrNull(8_000) { parse(events.receive()) })
      val readyPayload = ready.getJSONObject("payload")
      require(ready.getString("type") == "session.ready" &&
        readyPayload.getInt("connectionEpoch") == epoch &&
        readyPayload.getJSONObject("route").getString("engine") == opened.routeEngine)
      didConnect = true
      available.value = true
      val revisions = mutableMapOf<String, Int>()
      val finalized = mutableSetOf<String>()
      for (raw in events) {
        val event = parse(raw)
        val payload = event.getJSONObject("payload")
        val type = event.getString("type")
        if (type == "session.closed" || type == "session.error" && !payload.optBoolean("recoverable")) break
        if (type != "input.transcript.delta" && type != "input.transcript.final") continue
        val id = payload.optString("utteranceId")
        val revision = payload.optInt("revision")
        val previous = revisions[id] ?: -1
        if (id.isBlank() || id in finalized || revision < previous ||
          revision == previous && type == "input.transcript.delta") continue
        revisions[id] = revision
        val text = payload.optString("text").trim()
        val latest = (confirmed + "\n" + text).trim().takeLast(4_000)
        if (type == "input.transcript.final") {
          finalized += id
          confirmed = latest
        }
        transcript.value = latest
      }
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      // The durable capture continues and supplies segment transcription.
    } finally {
      available.value = false
      synchronized(this) {
        socket?.close(1000, null)
        socket = null
      }
      session?.let { call ->
        withContext(NonCancellable + Dispatchers.IO) {
          runCatching { gateway.cancelVoiceCall(call, sessionIdentity(call).toString()) }
        }
      }
    }
    return didConnect
  }

  @Synchronized
  override fun audio(pcm: ByteArray) {
    val ws = socket ?: return
    if (!available.value || committed) return
    if (ws.queueSize() > 9_600 || !ws.send(voiceUplink(epoch, utterance, ++sequence,
        SystemClock.elapsedRealtimeNanos() / 1_000_000.0 - 20.0, sequence == 1, false, pcm).toByteString())) {
      available.value = false
      ws.cancel()
    }
  }

  @Synchronized
  override fun commit() {
    if (committed) return
    committed = true
    if (available.value) socket?.send(voiceClientEvent("input.commit", JSONObject()))
  }

  private fun sessionIdentity(call: VoiceCallConnection) =
    JSONObject().put("sessionId", call.sessionId).put("ticket", call.ticket)

  private companion object {
    val client = OkHttpClient.Builder().pingInterval(15, TimeUnit.SECONDS).build()
  }
}
