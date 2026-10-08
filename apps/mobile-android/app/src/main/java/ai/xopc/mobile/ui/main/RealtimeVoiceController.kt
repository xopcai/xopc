package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.VoiceCallConnection
import ai.xopc.mobile.gateway.VOICE_PROXY_WS_PATH
import ai.xopc.mobile.gateway.parseVoiceDownlink
import ai.xopc.mobile.gateway.voiceClientEvent
import ai.xopc.mobile.gateway.voiceUplink
import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioFocusRequest
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.SystemClock
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

internal data class VoiceClarification(val requestId: String, val question: String,
  val choices: List<String>, val suggestedAnswer: String, val version: Int)
data class VoiceApproval(val id: String, val actionId: String, val conversationId: String)

/** One scoped voice call. Socket callbacks only update Compose state through the main scope. */
internal class RealtimeVoiceController(private val context: Context, private val scope: CoroutineScope,
  private val create: suspend (String, String) -> VoiceCallConnection,
  private val cancel: suspend (VoiceCallConnection) -> Unit,
  private val respond: suspend (String, Int, String, String) -> Unit,
  private val pendingApproval: suspend (String) -> VoiceApproval?,
  private val respondApproval: suspend (VoiceApproval, Boolean) -> Unit) {
  var phase by mutableStateOf("idle"); private set
  var error by mutableStateOf(""); private set
  var userText by mutableStateOf(""); private set
  var assistantText by mutableStateOf(""); private set
  var speaking by mutableStateOf(false); private set
  var muted by mutableStateOf(false); private set
  var speaker by mutableStateOf(false); private set
  var mode by mutableStateOf("natural"); private set
  var clarification by mutableStateOf<VoiceClarification?>(null); private set
  var clarificationBusy by mutableStateOf(false); private set
  var approval by mutableStateOf<VoiceApproval?>(null); private set
  var approvalBusy by mutableStateOf(false); private set

  private val client = OkHttpClient.Builder().pingInterval(15, TimeUnit.SECONDS).build()
  private var generation = 0
  private var connection: VoiceCallConnection? = null
  private var socket: WebSocket? = null
  private var recorder: AudioRecord? = null
  private var player: AudioTrack? = null
  private var captureJob: Job? = null
  private var playbackJob: Job? = null
  private var heartbeatJob: Job? = null
  private var approvalJob: Job? = null
  private var requestedMute = false
  private var playbackQueue = Channel<Pair<String, ByteArray>>(15)
  private var eventSequence = 0
  private var audioSequence = 0
  private var inputSequence = 0
  private var utteranceId = UUID.randomUUID().toString()
  private var responseId = ""
  private var bufferedBytes = 0L
  private var responseStartFrame = 0L
  private var audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val voiceAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
  private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    .setAudioAttributes(voiceAttributes).build()

  suspend fun start(conversationId: String, selectedMode: String) {
    stop()
    val current = ++generation
    mode = selectedMode; phase = "connecting"; error = ""; userText = ""; assistantText = ""
    speaking = false
    clarification = null; approval = null; requestedMute = false; muted = false
    try {
      require(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED) { "MICROPHONE_PERMISSION_REQUIRED" }
      val session = create(conversationId, selectedMode)
      if (current != generation) { cancel(session); return }
      connection = session
      try { connect(session, session.websocketPath, current) }
      catch (_: Exception) { connect(session, VOICE_PROXY_WS_PATH, current) }
      if (current != generation) return
      startAudio(current)
      send("input.mute", JSONObject().put("muted", false))
      phase = "connected"
      heartbeatJob = scope.launch {
        val started = SystemClock.elapsedRealtime()
        while (isActive && current == generation) {
          delay(15_000)
          if (SystemClock.elapsedRealtime() - started >= session.maxSessionMs) {
            fail("TIME_LIMIT", current); break
          }
          send("session.ping", JSONObject())
        }
      }
      if (selectedMode == "assistant") approvalJob = scope.launch {
        while (isActive && current == generation && phase == "connected") {
          runCatching { pendingApproval(conversationId) }.onSuccess { found ->
            approval = found
            updateMute()
          }
          delay(3_000)
        }
      }
    } catch (failure: CancellationException) { throw failure }
    catch (failure: Exception) { fail(failure.message ?: "VOICE_UNAVAILABLE", current) }
  }

  private suspend fun connect(session: VoiceCallConnection, path: String, current: Int) {
    val ready = CompletableDeferred<Unit>()
    val url = session.origin.trimEnd('/').replaceFirst("https://", "wss://") + path
    require(url.startsWith("wss://")) { "SECURE_ROUTE_REQUIRED" }
    var socketForAttempt: WebSocket? = null
    val listener = object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        socketForAttempt = webSocket
        webSocket.send(voiceClientEvent("session.start", JSONObject()
          .put("sessionId", session.sessionId).put("ticket", session.ticket)))
      }
      override fun onMessage(webSocket: WebSocket, text: String) {
        scope.launch {
          if (current != generation || webSocket !== socketForAttempt) return@launch
          try {
            val event = JSONObject(text)
            require(event.getInt("protocolVersion") == 3 &&
              event.getString("sessionId") == session.sessionId &&
              event.getInt("seq") == eventSequence + 1) { "PROTOCOL_ERROR" }
            eventSequence++
            val payload = event.getJSONObject("payload")
            when (event.getString("type")) {
              "session.ready" -> {
                require(payload.getInt("connectionEpoch") == session.connectionEpoch &&
                  payload.getJSONObject("route").getString("engine") == session.routeEngine) {
                  "PROTOCOL_ERROR"
                }
                ready.complete(Unit)
              }
              "input.transcript.final" -> userText = payload.optString("text")
              "response.created" -> {
                responseId = payload.optString("responseId")
                assistantText = ""; bufferedBytes = 0
                responseStartFrame = (player?.playbackHeadPosition?.toLong() ?: 0L) and 0xffffffffL
                speaking = false
              }
              "response.text.delta" -> if (payload.optString("responseId") == responseId)
                assistantText = (assistantText + payload.optString("delta")).takeLast(32_000)
              "response.audio.started" -> require(payload.getJSONObject("format")
                .getInt("sampleRate") == 24_000) { "UNSUPPORTED_FORMAT" }
              "response.done" -> if (payload.optString("responseId") == responseId) {
                playbackQueue.send(responseId to ByteArray(0))
              }
              "response.clarification" -> if (payload.optString("responseId") == responseId) {
                val rows = payload.optJSONArray("choices")
                clarification = VoiceClarification(payload.getString("requestId"),
                  payload.getString("question"),
                  (0 until (rows?.length() ?: 0).coerceAtMost(8)).map { rows!!.getString(it) },
                  payload.optString("suggestedAnswer"), payload.optInt("version", 1))
                updateMute()
              }
              "response.cancelled" -> if (payload.optString("responseId") == responseId) {
                player?.flush(); responseId = ""; speaking = false
              }
              "session.error" -> if (!payload.optBoolean("recoverable"))
                throw IllegalStateException(payload.optString("code", "VOICE_UNAVAILABLE"))
              "session.closed" -> throw IllegalStateException(payload.optString("reason", "ENDED"))
            }
          } catch (failure: Exception) {
            if (!ready.isCompleted) ready.completeExceptionally(failure)
            else fail(failure.message ?: "PROTOCOL_ERROR", current)
          }
        }
      }
      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        scope.launch {
          if (current != generation || webSocket !== socketForAttempt) return@launch
          try {
            val frame = parseVoiceDownlink(bytes.toByteArray())
            require(frame.epoch == session.connectionEpoch && frame.sequence == audioSequence + 1) {
              "PROTOCOL_ERROR"
            }
            audioSequence++
            if (frame.responseId == responseId && !playbackQueue.trySend(frame.responseId to frame.audio).isSuccess)
              throw IllegalStateException("AUDIO_QUEUE_FULL")
          } catch (failure: Exception) { fail(failure.message ?: "PROTOCOL_ERROR", current) }
        }
      }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        scope.launch {
          if (current != generation || webSocket !== socketForAttempt) return@launch
          if (!ready.isCompleted) ready.completeExceptionally(IllegalStateException("NETWORK"))
          else fail("NETWORK", current)
        }
      }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        scope.launch {
          if (current != generation || webSocket !== socketForAttempt) return@launch
          if (!ready.isCompleted) ready.completeExceptionally(IllegalStateException("NETWORK"))
          else if (phase == "connected") fail("NETWORK", current)
        }
      }
    }
    val attempt = client.newWebSocket(Request.Builder().url(url).build(), listener)
    socketForAttempt = attempt
    socket = attempt
    try { withTimeout(15_000) { ready.await() } }
    catch (failure: Exception) {
      attempt.cancel()
      if (socket === attempt) socket = null
      eventSequence = 0
      throw failure
    }
  }

  @SuppressLint("MissingPermission")
  private fun startAudio(current: Int) {
    val inputMin = AudioRecord.getMinBufferSize(16_000, AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT)
    val outputMin = AudioTrack.getMinBufferSize(24_000, AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT)
    require(inputMin > 0 && outputMin > 0) { "AUDIO_UNAVAILABLE" }
    val focus = audioManager.requestAudioFocus(focusRequest)
    require(focus == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "AUDIO_FOCUS_UNAVAILABLE" }
    recorder = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16_000,
      AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(inputMin, 2560))
    player = AudioTrack(voiceAttributes,
      AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(24_000)
        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(), maxOf(outputMin, 3840),
      AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE)
    require(recorder?.state == AudioRecord.STATE_INITIALIZED && player?.state == AudioTrack.STATE_INITIALIZED) {
      "AUDIO_UNAVAILABLE"
    }
    recorder?.startRecording(); player?.play()
    playbackQueue = Channel(15)
    captureJob = scope.launch(Dispatchers.IO) {
      val bytes = ByteArray(640)
      while (isActive && current == generation) {
        val count = recorder?.read(bytes, 0, bytes.size, AudioRecord.READ_BLOCKING) ?: break
        if (count != 640 || muted) continue
        val active = connection ?: break
        val ws = socket ?: break
        if (ws.queueSize() >= 20_000) continue
        val frame = voiceUplink(active.connectionEpoch, utteranceId, ++inputSequence,
          SystemClock.elapsedRealtimeNanos() / 1_000_000.0, inputSequence == 1, false, bytes.copyOf())
        if (!ws.send(frame.toByteString())) break
      }
    }
    playbackJob = scope.launch(Dispatchers.IO) {
      for ((id, audio) in playbackQueue) {
        if (current != generation) break
        if (id != responseId) continue
        if (audio.isEmpty()) {
          val targetFrames = responseStartFrame + bufferedBytes / 2
          val deadline = SystemClock.elapsedRealtime() + 15_000
          while (current == generation && id == responseId &&
            ((player?.playbackHeadPosition?.toLong() ?: 0L) and 0xffffffffL) < targetFrames &&
            SystemClock.elapsedRealtime() < deadline) delay(40)
          if (current == generation && id == responseId) withContext(Dispatchers.Main.immediate) {
            speaking = false
          }
          continue
        }
        var offset = 0
        while (offset < audio.size && current == generation && id == responseId) {
          val written = player?.write(audio, offset, audio.size - offset,
            AudioTrack.WRITE_BLOCKING) ?: break
          if (written <= 0) break
          offset += written
          bufferedBytes += written
          withContext(Dispatchers.Main.immediate) { speaking = true }
          send("response.audio.played", JSONObject().put("responseId", id)
            .put("playedDurationMs", bufferedBytes / 48))
        }
        if (offset < audio.size && current == generation && id == responseId) {
          withContext(Dispatchers.Main.immediate) { fail("PLAYBACK_FAILED", current) }
          break
        }
      }
    }
  }

  fun changeMuted(value: Boolean) {
    requestedMute = value
    updateMute()
  }

  private fun updateMute() {
    val value = requestedMute || clarification != null || approval != null
    if (muted && !value) { utteranceId = UUID.randomUUID().toString(); inputSequence = 0 }
    muted = value
    send("input.mute", JSONObject().put("muted", value))
  }

  fun changeSpeaker(value: Boolean) {
    speaker = value
    if (Build.VERSION.SDK_INT >= 31) {
      val route = audioManager.availableCommunicationDevices.firstOrNull { device ->
        device.type == if (value) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
          else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
      }
      if (route != null) audioManager.setCommunicationDevice(route)
      else if (!value) audioManager.clearCommunicationDevice()
    } else {
      @Suppress("DEPRECATION")
      audioManager.isSpeakerphoneOn = value
    }
  }

  fun stopReply() {
    val id = responseId
    if (id.isEmpty()) return
    responseId = ""; speaking = false; player?.pause(); player?.flush(); player?.play()
    send("response.stop_playback", JSONObject().put("responseId", id))
  }

  suspend fun answerClarification(action: String, answer: String = "") {
    val pending = clarification ?: return
    if (clarificationBusy) return
    require(action == "answer" || action == "agent_decide") { "INVALID_CLARIFICATION_ACTION" }
    clarificationBusy = true
    try {
      respond(pending.requestId, pending.version, action, answer.trim())
      clarification = null
      updateMute()
    } catch (failure: Exception) { error = failure.message ?: "CLARIFICATION_FAILED" }
    finally { clarificationBusy = false }
  }

  suspend fun answerApproval(allow: Boolean) {
    val pending = approval ?: return
    if (approvalBusy) return
    approvalBusy = true
    try {
      respondApproval(pending, allow)
      approval = null
      updateMute()
    } catch (failure: Exception) { error = failure.message ?: "APPROVAL_FAILED" }
    finally { approvalBusy = false }
  }

  private fun send(type: String, payload: JSONObject) {
    socket?.send(voiceClientEvent(type, payload))
  }

  private fun fail(reason: String, current: Int) {
    if (current != generation) return
    error = reason
    phase = "paused"
    scope.launch { release() }
  }

  suspend fun stop() {
    ++generation
    phase = "idle"; error = ""; clarification = null; approval = null
    speaking = false
    release()
  }

  private suspend fun release() {
    captureJob?.cancel(); playbackJob?.cancel(); heartbeatJob?.cancel(); approvalJob?.cancel()
    captureJob = null; playbackJob = null; heartbeatJob = null; approvalJob = null
    playbackQueue.close()
    socket?.close(1000, "end"); socket = null
    withContext(Dispatchers.IO) {
      runCatching { recorder?.stop() }; recorder?.release(); recorder = null
      runCatching { player?.pause() }; player?.release(); player = null
    }
    audioManager.abandonAudioFocusRequest(focusRequest)
    if (Build.VERSION.SDK_INT >= 31) audioManager.clearCommunicationDevice()
    else {
      @Suppress("DEPRECATION")
      audioManager.isSpeakerphoneOn = false
    }
    connection?.let { current -> scope.launch(Dispatchers.IO) { runCatching { cancel(current) } } }
    connection = null
  }
}
