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
  private val handler = Handler(Looper.getMainLooper())
  private var savedContext: Context? = null
  private val context get() = requireNotNull(savedContext ?: appContext.reactContext?.applicationContext)
  private val manager get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
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
    OnActivityEntersBackground { if (!background && recorder != null) handler.post { interrupt("background") } }
    OnDestroy { handler.post { stop() } }
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
      manager.mode = AudioManager.MODE_IN_COMMUNICATION
      focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE).setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener({ change -> if (change < 0) interrupt("interruption") }, handler).build()
      check(manager.requestAudioFocus(focus!!) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "Audio focus unavailable" }
      val minInput = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minInput > 0) { "Microphone format unavailable" }
      val input = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minInput, 6400))
      recorder = input
      check(input.state == AudioRecord.STATE_INITIALIZED) { "Microphone unavailable" }
      if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(input.audioSessionId)?.apply { this.enabled = true }
      if (NoiseSuppressor.isAvailable()) noise = NoiseSuppressor.create(input.audioSessionId)?.apply { this.enabled = true }
      track = AudioTrack.Builder().setAudioAttributes(attributes)
        .setAudioFormat(AudioFormat.Builder().setSampleRate(24000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(96000).setTransferMode(AudioTrack.MODE_STREAM).build()
      check(track?.state == AudioTrack.STATE_INITIALIZED) { "Playback unavailable" }
      track?.play()
      input.startRecording()
      val generation = epoch
      inputThread = Thread({
        val buffer = ByteArray(1280)
        while (epoch == generation) {
          val currentCapture = captureId
          val count = input.read(buffer, 0, buffer.size)
          if (count < 0) { handler.post { if (epoch == generation) interrupt("interruption") }; break }
          if (count > 0 && capturing && captureId == currentCapture) {
            val audio = Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)
            handler.post { if (epoch == generation && capturing && captureId == currentCapture) sendEvent("pcm", mapOf("audio" to audio, "captureId" to currentCapture)) }
          }
        }
      }, "xopc-voice-capture").apply { start() }
      devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) {
          if (removed.any { it.isSource || it.isSink }) interrupt("route_lost")
        }
      }
      manager.registerAudioDeviceCallback(devices, handler)
      handler.post(progress)
    } catch (error: Throwable) { stop(); throw error }
  }

  private fun enqueue(id: String, audio: String) {
    val player = track ?: return
    if (responseId != id) { flush(); responseId = id }
    val bytes = Base64.decode(audio, Base64.NO_WRAP)
    require(bytes.isNotEmpty() && bytes.size % 2 == 0)
    check(submitted - lastPlayed + bytes.size <= 96000) { "Playback buffer full" }
    val written = player.write(bytes, 0, bytes.size, AudioTrack.WRITE_NON_BLOCKING)
    check(written == bytes.size) { "Playback underrun or overflow" }
    submitted += written
    player.play()
  }

  private fun flush() {
    track?.pause()
    track?.flush()
    responseId = ""
    submitted = 0
    lastPlayed = 0
  }

  private fun interrupt(reason: String) {
    if (recorder == null) return
    stop()
    sendEvent("interrupted", mapOf("reason" to reason))
  }

  private fun stop() {
    if (recorder == null && track == null && focus == null && !background) return
    epoch++
    capturing = false
    handler.removeCallbacks(progress)
    flush()
    track?.release()
    track = null
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
  }
}
