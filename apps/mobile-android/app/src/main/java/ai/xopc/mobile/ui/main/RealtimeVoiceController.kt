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
import kotlinx.coroutines.currentCoroutineContext
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
import java.util.concurrent.atomic.AtomicBoolean

internal data class VoiceClarification(val requestId: String, val question: String,
  val choices: List<String>, val suggestedAnswer: String, val version: Int)
data class VoiceApproval(val id: String, val actionId: String, val conversationId: String)

private sealed interface PendingVoiceReply {
  data class Event(val value: JSONObject) : PendingVoiceReply
  data class Audio(val responseId: String, val bytes: ByteArray) : PendingVoiceReply
}

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
  var taskId by mutableStateOf(""); private set
  var taskCancelling by mutableStateOf(false); private set
  var activity by mutableStateOf(""); private set
  var hasReply by mutableStateOf(false); private set

  private val client = OkHttpClient.Builder().pingInterval(15, TimeUnit.SECONDS).build()
  @Volatile private var generation = 0
  @Volatile private var connection: VoiceCallConnection? = null
  @Volatile private var socket: WebSocket? = null
  private var recorder: AudioRecord? = null
  @Volatile private var player: AudioTrack? = null
  private var captureJob: Job? = null
  private var playbackJob: Job? = null
  private var heartbeatJob: Job? = null
  private var approvalJob: Job? = null
  private var duckJob: Job? = null
  private var cleanupJob: Job? = null
  private var reconnectJob: Job? = null
  private var reconnectAttempt = 0
  private var activeConversationId = ""
  private var connectedAt = 0L
  private var lastPongAt = 0L
  private var requestedMute = false
  @Volatile private var congestionMuted = false
  @Volatile private var captureMuted = false
  private var playbackQueue = Channel<Pair<String, ByteArray>>(64)
  private var eventSequence = 0
  private var audioSequence = 0
  private val inputStateLock = Any()
  private var inputSequence = 0
  private var utteranceId = UUID.randomUUID().toString()
  @Volatile private var responseId = ""
  private var responseDone = false
  private var receivedBytes = 0L
  private val pendingReply = VoiceDeferredReplies<PendingVoiceReply>()
  @Volatile private var bufferedBytes = 0L
  private var responseStartFrame = 0L
  @Volatile private var playbackEpoch = 0
  private var playbackGain = 1f
  private val speakingUtterances = mutableSetOf<String>()
  private var audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var previousAudioMode: Int? = null
  private val voiceAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
  private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    .setAudioAttributes(voiceAttributes)
    .setOnAudioFocusChangeListener { change ->
      if (change == AudioManager.AUDIOFOCUS_LOSS ||
        change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        scope.launch { if (phase == "connected") fail("CAPTURE_INTERRUPTED", generation) }
    }.build()

  suspend fun start(conversationId: String, selectedMode: String, fresh: Boolean = true) {
    if (fresh) reconnectAttempt = 0
    val restoreMute = !fresh && requestedMute
    val restoreSpeaker = !fresh && speaker
    stop()
    playbackQueue = Channel(64)
    val current = ++generation
    activeConversationId = conversationId
    connectedAt = 0L
    mode = selectedMode; phase = "connecting"; error = ""; userText = ""; assistantText = ""
    speaking = false
    clarification = null; approval = null; taskId = ""; taskCancelling = false; activity = ""
    requestedMute = restoreMute; congestionMuted = false; muted = restoreMute
    captureMuted = restoreMute; speaker = restoreSpeaker
    try {
      require(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED) { "MICROPHONE_PERMISSION_REQUIRED" }
      val session = create(conversationId, selectedMode)
      if (current != generation) { cancel(session); return }
      connection = session
      try { connect(session, session.websocketPath, current) }
      catch (failure: CancellationException) { throw failure }
      catch (_: Exception) {
        if (current != generation) return
        connect(session, VOICE_PROXY_WS_PATH, current)
      }
      if (current != generation) return
      startAudio(current)
      if (restoreSpeaker) changeSpeaker(true)
      send("input.mute", JSONObject().put("muted", restoreMute))
      phase = "connected"
      connectedAt = SystemClock.elapsedRealtime()
      lastPongAt = connectedAt
      heartbeatJob = scope.launch {
        val started = SystemClock.elapsedRealtime()
        while (isActive && current == generation) {
          delay(15_000)
          if (SystemClock.elapsedRealtime() - started >= session.maxSessionMs) {
            fail("TIME_LIMIT", current); break
          }
          if (SystemClock.elapsedRealtime() - lastPongAt > 35_000) {
            fail("NETWORK", current); break
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
    val attemptClosed = AtomicBoolean(false)
    val listener = object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        if (current != generation || attemptClosed.get()) return
        socketForAttempt = webSocket
        webSocket.send(voiceClientEvent("session.start", JSONObject()
          .put("sessionId", session.sessionId).put("ticket", session.ticket)))
      }
      override fun onMessage(webSocket: WebSocket, text: String) {
        scope.launch {
          if (current != generation || webSocket !== socketForAttempt || webSocket !== socket) return@launch
          try {
            val event = JSONObject(text)
            require(event.getInt("protocolVersion") == 3 &&
              event.getString("sessionId") == session.sessionId &&
              event.getInt("seq") == eventSequence + 1) { "PROTOCOL_ERROR" }
            eventSequence++
            handleEvent(event, session, ready)
          } catch (failure: Exception) {
            if (!ready.isCompleted) ready.completeExceptionally(failure)
            else fail(failure.message ?: "PROTOCOL_ERROR", current)
          }
        }
      }
      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        scope.launch {
          if (current != generation || webSocket !== socketForAttempt || webSocket !== socket) return@launch
          try {
            val frame = parseVoiceDownlink(bytes.toByteArray())
            require(frame.epoch == session.connectionEpoch && frame.sequence == audioSequence + 1) {
              "PROTOCOL_ERROR"
            }
            audioSequence++
            handleAudio(frame.responseId, frame.audio)
          } catch (failure: Exception) { fail(failure.message ?: "PROTOCOL_ERROR", current) }
        }
      }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        scope.launch {
          if (current != generation || webSocket !== socketForAttempt || webSocket !== socket) return@launch
          if (!ready.isCompleted) ready.completeExceptionally(IllegalStateException("NETWORK"))
          else fail("NETWORK", current)
        }
      }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        scope.launch {
          if (current != generation || webSocket !== socketForAttempt || webSocket !== socket) return@launch
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
      attemptClosed.set(true)
      attempt.cancel()
      if (socket === attempt) socket = null
      eventSequence = 0; audioSequence = 0
      throw failure
    }
  }

  private fun handleEvent(event: JSONObject, session: VoiceCallConnection,
    ready: CompletableDeferred<Unit>) {
    val payload = event.getJSONObject("payload")
    val incomingId = payload.optString("responseId")
    if (pendingReply.responseId.isNotEmpty() && incomingId == pendingReply.responseId) {
      deferReply(PendingVoiceReply.Event(event), event.toString().length * 2)
      return
    }
    when (event.getString("type")) {
      "session.ready" -> {
        require(payload.getInt("connectionEpoch") == session.connectionEpoch &&
          payload.getJSONObject("route").getString("engine") == session.routeEngine) {
          "PROTOCOL_ERROR"
        }
        ready.complete(Unit)
      }
      "input.transcript.final" -> userText = payload.optString("text")
      "input.speech_started" -> if (!captureMuted) {
        speakingUtterances.add(payload.optString("utteranceId"))
        if (connection?.bargeIn == true && responseId.isNotEmpty() && receivedBytes > 0)
          fadePlayback(0.25f, 60L)
      }
      "input.speech_stopped" -> if (!captureMuted &&
        speakingUtterances.remove(payload.optString("utteranceId")) &&
        speakingUtterances.isEmpty()) fadePlayback(1f, 120L)
      "session.pong" -> lastPongAt = SystemClock.elapsedRealtime()
      "response.created" -> {
        when (voiceReplyDisposition(responseId, responseDone, incomingId,
          pendingReply.responseId)) {
          VoiceReplyDisposition.DEFER -> {
            pendingReply.begin(incomingId)
            deferReply(PendingVoiceReply.Event(event), event.toString().length * 2)
            return
          }
          VoiceReplyDisposition.REJECT -> {
            send("response.stop_playback", JSONObject().put("responseId", incomingId))
            return
          }
          VoiceReplyDisposition.START -> Unit
        }
        responseId = incomingId
        hasReply = incomingId.isNotEmpty()
        assistantText = ""; bufferedBytes = 0; receivedBytes = 0; responseDone = false
        responseStartFrame = (player?.playbackHeadPosition?.toLong() ?: 0L) and 0xffffffffL
        speaking = false
      }
      "response.text.delta" -> if (incomingId == responseId)
        assistantText = (assistantText + payload.optString("delta")).takeLast(32_000)
      "task.created" -> { taskId = payload.optString("taskId"); taskCancelling = false }
      "task.activity" -> if (payload.optString("taskId") == taskId)
        activity = if (payload.optString("status") == "running") payload.optString("toolName") else ""
      "task.done" -> if (payload.optString("taskId") == taskId) {
        taskId = ""; taskCancelling = false; activity = ""
      }
      "response.audio.started" -> require(payload.getJSONObject("format")
        .getInt("sampleRate") == 24_000) { "UNSUPPORTED_FORMAT" }
      "response.done" -> if (incomingId == responseId) {
        responseDone = true
        if (!payload.optBoolean("audio", true) && assistantText.isNotBlank())
          error = "NO_RESPONSE_AUDIO"
        if (!payload.optBoolean("audio", true) || receivedBytes == 0L) finishResponse()
        else require(playbackQueue.trySend(incomingId to ByteArray(0)).isSuccess) {
          "AUDIO_QUEUE_FULL"
        }
      }
      "response.clarification" -> if (incomingId == responseId) {
        val rows = payload.optJSONArray("choices")
        clarification = VoiceClarification(payload.getString("requestId"),
          payload.getString("question"),
          (0 until (rows?.length() ?: 0).coerceAtMost(8)).map { rows!!.getString(it) },
          payload.optString("suggestedAnswer"), payload.optInt("version", 1))
        updateMute()
      }
      "response.cancelled" -> if (incomingId == responseId) {
        fadePlayback(1f, 0L)
        playbackEpoch++
        player?.pause(); player?.flush(); player?.play()
        finishResponse()
      }
      "session.error" -> {
        val code = payload.optString("code", "VOICE_UNAVAILABLE")
        if (payload.optBoolean("recoverable")) error = code
        else throw IllegalStateException(code)
      }
      "session.closed" -> throw IllegalStateException(payload.optString("reason", "ENDED"))
    }
  }

  private fun handleAudio(id: String, bytes: ByteArray) {
    if (pendingReply.responseId.isNotEmpty() && id == pendingReply.responseId) {
      deferReply(PendingVoiceReply.Audio(id, bytes), bytes.size)
      return
    }
    if (id != responseId || responseDone) return
    if (receivedBytes == 0L && speakingUtterances.isNotEmpty() && connection?.bargeIn == true)
      fadePlayback(0.25f, 60L)
    receivedBytes += bytes.size
    require(playbackQueue.trySend(id to bytes).isSuccess) { "AUDIO_QUEUE_FULL" }
  }

  private fun deferReply(item: PendingVoiceReply, size: Int) {
    pendingReply.add(item, size)
  }

  private fun finishResponse() {
    fadePlayback(1f, 0L)
    speakingUtterances.clear()
    responseId = ""; responseDone = false; receivedBytes = 0; bufferedBytes = 0
    hasReply = false
    speaking = false
    val deferred = pendingReply.take()
    if (deferred.isEmpty()) return
    val session = connection ?: return
    val ready = CompletableDeferred<Unit>()
    ready.complete(Unit)
    for (item in deferred) when (item) {
      is PendingVoiceReply.Event -> handleEvent(item.value, session, ready)
      is PendingVoiceReply.Audio -> handleAudio(item.responseId, item.bytes)
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
    previousAudioMode = audioManager.mode
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
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
    captureJob = scope.launch(Dispatchers.IO) {
      val bytes = ByteArray(640)
      val congestion = VoiceUplinkCongestion()
      try {
        while (isActive && current == generation) {
          val count = recorder?.read(bytes, 0, bytes.size, AudioRecord.READ_BLOCKING) ?: break
          if (count < 0) throw IllegalStateException("CAPTURE_FAILED")
          if (count != 640) continue
          if (captureMuted && !congestionMuted) continue
          val active = connection ?: break
          val ws = socket ?: break
          when (congestion.observe(ws.queueSize(), SystemClock.elapsedRealtime())) {
            VoiceCongestion.EXPIRED -> throw IllegalStateException("INPUT_DROPPED")
            VoiceCongestion.WAITING -> {
              if (!congestionMuted) withContext(Dispatchers.Main.immediate) {
                congestionMuted = true; updateMute()
              }
              continue
            }
            VoiceCongestion.CLEAR -> if (congestionMuted) withContext(Dispatchers.Main.immediate) {
              congestionMuted = false; updateMute()
            }
          }
          if (captureMuted) continue
          val frame = synchronized(inputStateLock) {
            val sequence = ++inputSequence
            voiceUplink(active.connectionEpoch, utteranceId, sequence,
              SystemClock.elapsedRealtimeNanos() / 1_000_000.0 - 20.0,
              sequence == 1, false, bytes.copyOf())
          }
          if (!ws.send(frame.toByteString())) throw IllegalStateException("NETWORK")
        }
      } catch (failure: CancellationException) { throw failure }
      catch (failure: Exception) {
        withContext(Dispatchers.Main.immediate) {
          fail(failure.message ?: "CAPTURE_FAILED", current)
        }
      }
    }
    playbackJob = scope.launch(Dispatchers.IO) {
      try {
      for ((id, audio) in playbackQueue) {
        if (current != generation) break
        if (id != responseId) continue
        val frameEpoch = playbackEpoch
        if (audio.isEmpty()) {
          val targetFrames = responseStartFrame + bufferedBytes / 2
          val deadline = SystemClock.elapsedRealtime() + 15_000
          while (current == generation && id == responseId &&
            ((player?.playbackHeadPosition?.toLong() ?: 0L) and 0xffffffffL) < targetFrames &&
            SystemClock.elapsedRealtime() < deadline) delay(40)
          if (current == generation && id == responseId) withContext(Dispatchers.Main.immediate) {
            if (((player?.playbackHeadPosition?.toLong() ?: 0L) and 0xffffffffL) < targetFrames)
              fail("PLAYBACK_STALLED", current)
            else finishResponse()
          }
          continue
        }
        var offset = 0
        while (offset < audio.size && current == generation && id == responseId &&
          frameEpoch == playbackEpoch) {
          val written = player?.write(audio, offset, audio.size - offset,
            AudioTrack.WRITE_BLOCKING) ?: break
          if (current != generation || id != responseId || frameEpoch != playbackEpoch) break
          if (written <= 0) break
          offset += written
          bufferedBytes += written
          withContext(Dispatchers.Main.immediate) { speaking = true }
          send("response.audio.played", JSONObject().put("responseId", id)
            .put("playedDurationMs", bufferedBytes / 48))
        }
        if (offset < audio.size && current == generation && id == responseId &&
          frameEpoch == playbackEpoch) {
          withContext(Dispatchers.Main.immediate) { fail("PLAYBACK_FAILED", current) }
          break
        }
      }
      } catch (failure: CancellationException) { throw failure }
      catch (_: Exception) {
        withContext(Dispatchers.Main.immediate) { fail("PLAYBACK_FAILED", current) }
      }
    }
  }

  fun changeMuted(value: Boolean) {
    requestedMute = value
    updateMute()
  }

  private fun updateMute() {
    val value = voiceInputShouldMute(requestedMute, clarification != null,
      approval != null, congestionMuted)
    if (muted && !value) synchronized(inputStateLock) {
      utteranceId = UUID.randomUUID().toString(); inputSequence = 0
    }
    muted = value
    captureMuted = value
    if (value && speakingUtterances.isNotEmpty()) {
      speakingUtterances.clear()
      fadePlayback(1f, 120L)
    }
    send("input.mute", JSONObject().put("muted", value))
  }

  fun changeSpeaker(value: Boolean) {
    runCatching {
      if (Build.VERSION.SDK_INT >= 31) {
        val route = audioManager.availableCommunicationDevices.firstOrNull { device ->
          device.type == if (value) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
            else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
        }
        if (route != null) require(audioManager.setCommunicationDevice(route)) {
          "ROUTE_CHANGE_FAILED"
        }
        else if (!value) audioManager.clearCommunicationDevice()
        else throw IllegalStateException("ROUTE_CHANGE_FAILED")
      } else {
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = value
      }
      speaker = value
    }.onFailure { error = "ROUTE_CHANGE_FAILED" }
  }

  fun stopReply() {
    if (taskId.isNotEmpty()) {
      if (!taskCancelling) {
        taskCancelling = true
        send("task.cancel", JSONObject().put("taskId", taskId))
      }
      return
    }
    val id = responseId
    if (id.isEmpty()) return
    playbackEpoch++
    player?.pause(); player?.flush(); player?.play()
    finishResponse()
    send("response.stop_playback", JSONObject().put("responseId", id))
  }

  private fun fadePlayback(target: Float, durationMs: Long) {
    duckJob?.cancel(); duckJob = null
    if (durationMs == 0L) {
      playbackGain = target
      runCatching { player?.setVolume(target) }
      return
    }
    val startGain = playbackGain
    duckJob = scope.launch {
      repeat(4) { step ->
        delay(durationMs / 4)
        playbackGain = startGain + (target - startGain) * (step + 1) / 4
        runCatching { player?.setVolume(playbackGain) }
      }
    }
  }

  fun onBackground() {
    if (phase == "idle" || phase == "paused" && error == "background") return
    ++generation
    reconnectJob?.cancel(); reconnectJob = null
    val previous = cleanupJob
    phase = "paused"; error = "background"; speaking = false
    cleanupJob = scope.launch { previous?.join(); release() }
  }

  suspend fun onForeground() {
    if (phase != "paused" || error != "background" || activeConversationId.isEmpty()) return
    start(activeConversationId, mode, fresh = false)
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
    ++generation
    error = reason
    if (connectedAt > 0 && SystemClock.elapsedRealtime() - connectedAt >= 30_000)
      reconnectAttempt = 0
    val retryDelay = voiceReconnectDelay(reason, reconnectAttempt)
    phase = if (retryDelay == null) "paused" else "recovering"
    val targetId = activeConversationId
    val targetMode = mode
    val expected = generation
    cleanupJob = scope.launch {
      release()
      if (retryDelay != null && expected == generation && targetId.isNotEmpty()) {
        reconnectAttempt++
        reconnectJob = scope.launch {
          delay(retryDelay)
          if (expected == generation && phase == "recovering")
            start(targetId, targetMode, fresh = false)
        }
      }
    }
  }

  suspend fun stop() {
    ++generation
    val currentJob = currentCoroutineContext()[Job]
    reconnectJob?.let { if (it !== currentJob) it.cancel() }
    reconnectJob = null
    cleanupJob?.join(); cleanupJob = null
    phase = "idle"; error = ""; clarification = null; approval = null
    taskId = ""; taskCancelling = false; activity = ""
    speaking = false
    release()
  }

  private suspend fun release() {
    duckJob?.cancel(); duckJob = null; playbackGain = 1f
    speakingUtterances.clear()
    playbackEpoch++
    captureJob?.cancel(); playbackJob?.cancel(); heartbeatJob?.cancel(); approvalJob?.cancel()
    captureJob = null; playbackJob = null; heartbeatJob = null; approvalJob = null
    playbackQueue.close()
    socket?.send(voiceClientEvent("session.stop", JSONObject().put("reason", "user_finished")))
    socket?.close(1000, "end"); socket = null
    withContext(Dispatchers.IO) {
      val capture = recorder; recorder = null
      runCatching { capture?.stop() }; runCatching { capture?.release() }
      val output = player; player = null
      runCatching { output?.pause() }; runCatching { output?.release() }
    }
    runCatching { audioManager.abandonAudioFocusRequest(focusRequest) }
    if (Build.VERSION.SDK_INT >= 31) runCatching { audioManager.clearCommunicationDevice() }
    else {
      @Suppress("DEPRECATION")
      runCatching { audioManager.isSpeakerphoneOn = false }
    }
    previousAudioMode?.let { oldMode ->
      runCatching {
        if (audioManager.mode == AudioManager.MODE_IN_COMMUNICATION) audioManager.mode = oldMode
      }
    }
    previousAudioMode = null
    connection?.let { current -> withContext(Dispatchers.IO) {
      runCatching { withTimeout(5_000) { cancel(current) } }
    } }
    connection = null
    lastPongAt = 0L
    responseId = ""; responseDone = false; receivedBytes = 0; bufferedBytes = 0
    hasReply = false
    pendingReply.reset()
    congestionMuted = false; captureMuted = false
    taskId = ""; taskCancelling = false; activity = ""; clarification = null; approval = null
    eventSequence = 0; audioSequence = 0
    synchronized(inputStateLock) {
      inputSequence = 0; utteranceId = UUID.randomUUID().toString()
    }
  }
}
