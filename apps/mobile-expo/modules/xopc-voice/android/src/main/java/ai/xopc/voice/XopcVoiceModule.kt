package ai.xopc.voice

import android.content.Context
import android.content.Intent
import android.media.*
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class XopcVoiceModule : Module() {
  private var recorder: AudioRecord? = null
  private var track: AudioTrack? = null
  private var echo: AcousticEchoCanceler? = null
  private var noise: NoiseSuppressor? = null
  private var focus: AudioFocusRequest? = null
  private var devices: AudioDeviceCallback? = null
  private var inputThread: Thread? = null
  @Volatile private var epoch = 0
  @Volatile private var capturing = false
  @Volatile private var captureId = 0
  private var background = false
  private var responseId = ""
  private var submitted = 0
  private var lastPlayed = 0
  private val playbackQueue = VoicePlaybackQueue()
  private var playbackVolume = 1f
  private var inputDeviceId: Int? = null
  private var outputDeviceId: Int? = null
  private var inputRoutingListener: AudioRouting.OnRoutingChangedListener? = null
  private var outputRoutingListener: AudioRouting.OnRoutingChangedListener? = null
  private val handler = Handler(Looper.getMainLooper())
  private var savedContext: Context? = null
  private val context get() = requireNotNull(savedContext ?: appContext.reactContext?.applicationContext)
  private val manager get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val playbackPump = Runnable {
    try { pumpPlayback() }
    catch (error: RuntimeException) {
      Log.w("XopcVoice", "Audio playback write failed", error)
      interrupt("playback_failed")
    }
  }
  private val progress = object : Runnable {
    override fun run() {
      val player = track ?: return
      val bytes = minOf(submitted.toLong(), (player.playbackHeadPosition.toLong() and 0xffffffffL) * 2).toInt()
      if (responseId.isNotEmpty() && bytes > lastPlayed) {
        lastPlayed = bytes
        sendEvent("played", mapOf("responseId" to responseId, "playedBytes" to bytes))
      }
      handler.postDelayed(this, 80)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("XopcVoice")
    Events("pcm", "played", "interrupted")
    AsyncFunction("start") { enabled: Boolean, title: String, stopLabel: String -> start(enabled, title, stopLabel) }.runOnQueue(Queues.MAIN)
    Function("setCaptureEnabled") { enabled: Boolean, id: Int ->
      capturing = false
      captureId = id
      capturing = enabled
    }
    AsyncFunction("enqueue") { id: String, audio: String -> enqueue(id, audio) }.runOnQueue(Queues.MAIN)
    AsyncFunction("flush") { flush() }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { stop() }.runOnQueue(Queues.MAIN)
    AsyncFunction("setSpeaker") { enabled: Boolean ->
      if (Build.VERSION.SDK_INT >= 31) {
        if (enabled) manager.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }?.let { manager.setCommunicationDevice(it) }
        else manager.clearCommunicationDevice()
      } else {
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = enabled
      }
    }.runOnQueue(Queues.MAIN)
    OnActivityEntersBackground {
      val generation = epoch
      if (!background && recorder != null) handler.post { if (epoch == generation) interrupt("background") }
    }
    OnDestroy { handler.post { stop() } }
  }

  private fun acquireAudioFocus(attributes: AudioAttributes): Boolean {
    val generation = epoch
    for (gain in intArrayOf(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)) {
      try {
        lateinit var request: AudioFocusRequest
        request = AudioFocusRequest.Builder(gain).setAudioAttributes(attributes)
          .setOnAudioFocusChangeListener({ change ->
            when (audioFocusAction(change, epoch == generation && focus === request)) {
              AudioFocusAction.RESTORE -> { playbackVolume = 1f; track?.setVolume(playbackVolume) }
              AudioFocusAction.DUCK -> { playbackVolume = 0.2f; track?.setVolume(playbackVolume) }
              AudioFocusAction.PAUSE -> interrupt("audio_focus_lost")
              AudioFocusAction.IGNORE -> Unit
            }
          }, handler).build()
        if (manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
          focus = request
          return true
        }
      } catch (error: RuntimeException) {
        Log.w("XopcVoice", "Audio focus request failed", error)
      }
    }
    return false
  }

  private fun configureInputEffects(input: AudioRecord) {
    try {
      if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(input.audioSessionId)?.apply { enabled = true }
    } catch (error: RuntimeException) {
      Log.w("XopcVoice", "Acoustic echo cancellation is unavailable", error)
    }
    try {
      if (NoiseSuppressor.isAvailable()) noise = NoiseSuppressor.create(input.audioSessionId)?.apply { enabled = true }
    } catch (error: RuntimeException) {
      Log.w("XopcVoice", "Noise suppression is unavailable", error)
    }
  }

  private fun createTrack(): AudioTrack {
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    val format = AudioFormat.Builder().setSampleRate(24000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build()
    val player = AudioTrack.Builder().setAudioAttributes(attributes).setAudioFormat(format)
      .setBufferSizeInBytes(96000).setTransferMode(AudioTrack.MODE_STREAM).build()
    if (player.state != AudioTrack.STATE_INITIALIZED) {
      player.release()
      throw IllegalStateException("PLAYBACK_UNAVAILABLE")
    }
    track = player
    val generation = epoch
    outputRoutingListener = AudioRouting.OnRoutingChangedListener { routing ->
      if (epoch == generation && track === player) routing.routedDevice?.let { outputDeviceId = it.id }
    }
    player.addOnRoutingChangedListener(outputRoutingListener!!, handler)
    player.setVolume(playbackVolume)
    player.play()
    outputDeviceId = player.routedDevice?.id
    handler.post(progress)
    return player
  }

  private fun startRecorder(bufferSize: Int): AudioRecord {
    var lastError: RuntimeException? = null
    for (source in intArrayOf(MediaRecorder.AudioSource.VOICE_COMMUNICATION, MediaRecorder.AudioSource.MIC)) {
      var candidate: AudioRecord? = null
      try {
        candidate = AudioRecord(source, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize)
        check(candidate.state == AudioRecord.STATE_INITIALIZED)
        candidate.startRecording()
        check(candidate.recordingState == AudioRecord.RECORDSTATE_RECORDING)
        return candidate
      } catch (error: SecurityException) {
        try { candidate?.release() } catch (_: RuntimeException) { }
        throw IllegalStateException("PERMISSION_DENIED", error)
      } catch (error: RuntimeException) {
        lastError = error
        try { candidate?.stop() } catch (_: RuntimeException) { }
        try { candidate?.release() } catch (_: RuntimeException) { }
      }
    }
    throw IllegalStateException("MICROPHONE_UNAVAILABLE", lastError)
  }

  private fun start(enabled: Boolean, title: String, stopLabel: String) {
    savedContext = appContext.reactContext?.applicationContext
    stop()
    background = enabled
    try {
      val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
      if (enabled) {
        VoiceCallService.onStop = { interrupt("ended") }
        context.startForegroundService(Intent(context, VoiceCallService::class.java).putExtra("title", title).putExtra("stopLabel", stopLabel))
      }
      try { manager.mode = AudioManager.MODE_IN_COMMUNICATION }
      catch (error: RuntimeException) { Log.w("XopcVoice", "Communication audio mode is unavailable", error) }
      if (!acquireAudioFocus(attributes)) Log.w("XopcVoice", "Audio focus was not granted; continuing capture")
      val minInput = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minInput > 0) { "MICROPHONE_FORMAT_UNAVAILABLE" }
      val input = startRecorder(maxOf(minInput, 6400))
      recorder = input
      configureInputEffects(input)
      val generation = epoch
      inputDeviceId = input.routedDevice?.id
      inputRoutingListener = AudioRouting.OnRoutingChangedListener { routing ->
        if (epoch == generation && recorder === input) routing.routedDevice?.let { inputDeviceId = it.id }
      }
      input.addOnRoutingChangedListener(inputRoutingListener!!, handler)
      inputThread = Thread({
        val buffer = ByteArray(1280)
        while (epoch == generation) {
          val currentCapture = captureId
          val count = input.read(buffer, 0, buffer.size)
          if (count < 0) {
            handler.post { if (epoch == generation) { Log.w("XopcVoice", "AudioRecord read failed: $count"); interrupt("capture_failed") } }
            break
          }
          if (count > 0 && capturing && captureId == currentCapture) {
            val audio = Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)
            handler.post { if (epoch == generation && capturing && captureId == currentCapture) sendEvent("pcm", mapOf("audio" to audio, "captureId" to currentCapture)) }
          }
        }
      }, "xopc-voice-capture").apply { start() }
      devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) {
          if (activeAudioDeviceRemoved(removed.map { it.id }, inputDeviceId, outputDeviceId, epoch == generation)) interrupt("route_lost")
        }
      }
      try { manager.registerAudioDeviceCallback(devices, handler) }
      catch (error: RuntimeException) { devices = null; Log.w("XopcVoice", "Audio route monitoring is unavailable", error) }
    } catch (error: SecurityException) { stop(); throw IllegalStateException("PERMISSION_DENIED", error) }
    catch (error: Throwable) { stop(); throw error }
  }

  private fun enqueue(id: String, audio: String) {
    val player = track ?: createTrack()
    if (responseId != id) { flush(); responseId = id }
    val bytes = Base64.decode(audio, Base64.NO_WRAP)
    require(bytes.isNotEmpty() && bytes.size % 2 == 0)
    check(submitted - lastPlayed + bytes.size <= 96000) { "Playback buffer full" }
    playbackQueue.add(bytes)
    submitted += bytes.size
    pumpPlayback()
    player.play()
  }

  private fun pumpPlayback() {
    val player = track ?: return
    handler.removeCallbacks(playbackPump)
    // Reserve space for the frame, then lower the streaming start threshold. Leaving
    // the effective buffer at two seconds stalls short replies (also after flush).
    check(player.setBufferSizeInFrames(player.bufferCapacityInFrames) > 0) { "PLAYBACK_UNAVAILABLE" }
    val drained = try {
      playbackQueue.drain { bytes, offset, count ->
        player.write(bytes, offset, count, AudioTrack.WRITE_NON_BLOCKING)
      }
    } finally {
      check(player.setBufferSizeInFrames(1) > 0) { "PLAYBACK_UNAVAILABLE" }
    }
    if (!drained) handler.postDelayed(playbackPump, 10)
  }

  private fun flush() {
    handler.removeCallbacks(playbackPump)
    playbackQueue.clear()
    track?.pause()
    track?.flush()
    responseId = ""
    submitted = 0
    lastPlayed = 0
  }

  private fun interrupt(reason: String) {
    if (recorder == null) return
    Log.w("XopcVoice", "Audio interrupted: reason=$reason epoch=$epoch inputDevice=$inputDeviceId outputDevice=$outputDeviceId")
    stop()
    sendEvent("interrupted", mapOf("reason" to reason))
  }

  private fun stop() {
    if (recorder == null && track == null && focus == null && !background) return
    epoch++
    capturing = false
    handler.removeCallbacks(progress)
    flush()
    outputRoutingListener?.let { track?.removeOnRoutingChangedListener(it) }; outputRoutingListener = null
    track?.release()
    track = null
    inputRoutingListener?.let { recorder?.removeOnRoutingChangedListener(it) }; inputRoutingListener = null
    try { recorder?.stop() } catch (_: IllegalStateException) { }
    inputThread?.join(200)
    inputThread = null
    recorder?.release()
    recorder = null
    echo?.release(); echo = null
    noise?.release(); noise = null
    devices?.let { manager.unregisterAudioDeviceCallback(it) }; devices = null
    focus?.let { manager.abandonAudioFocusRequest(it) }; focus = null
    if (Build.VERSION.SDK_INT >= 31) manager.clearCommunicationDevice()
    manager.mode = AudioManager.MODE_NORMAL
    VoiceCallService.onStop = null
    context.stopService(Intent(context, VoiceCallService::class.java))
    background = false
    playbackVolume = 1f
    inputDeviceId = null
    outputDeviceId = null
  }
}
