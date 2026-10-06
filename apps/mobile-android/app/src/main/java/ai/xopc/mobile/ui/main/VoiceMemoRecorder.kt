package ai.xopc.mobile.ui.main

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import java.io.File
import java.util.UUID

/** Short local recording for a voice attachment. Audio is deleted after the encrypted import. */
internal class VoiceMemoRecorder(private val context: Context) {
  var phase by mutableStateOf("idle"); private set
  var error by mutableStateOf(""); private set
  var durationSeconds by mutableStateOf(0); private set
  private var recorder: MediaRecorder? = null
  private var player: MediaPlayer? = null
  private var file: File? = null
  private var segmentStartedAt = 0L
  private var recordedMs = 0L

  val elapsedSeconds: Int
    get() = ((recordedMs + if (phase == "recording")
      SystemClock.elapsedRealtime() - segmentStartedAt else 0L) / 1000).toInt()

  val elapsedMilliseconds: Long
    get() = recordedMs + if (phase == "recording")
      SystemClock.elapsedRealtime() - segmentStartedAt else 0L

  @SuppressLint("MissingPermission")
  fun start() {
    cancel()
    try {
      require(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED) { "MICROPHONE_PERMISSION_REQUIRED" }
      val output = File(context.cacheDir, "voice-${UUID.randomUUID()}.m4a")
      @Suppress("DEPRECATION")
      val capture = if (android.os.Build.VERSION.SDK_INT >= 31) MediaRecorder(context)
        else MediaRecorder()
      capture.setAudioSource(MediaRecorder.AudioSource.MIC)
      capture.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      capture.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      capture.setAudioSamplingRate(16_000)
      capture.setAudioEncodingBitRate(32_000)
      capture.setMaxDuration(600_000)
      capture.setMaxFileSize(10L * 1024 * 1024)
      capture.setOutputFile(output.absolutePath)
      capture.setOnInfoListener { _, _, _ -> stopRecording() }
      capture.prepare(); capture.start()
      recorder = capture; file = output; recordedMs = 0L
      segmentStartedAt = SystemClock.elapsedRealtime()
      phase = "recording"
    } catch (failure: Exception) {
      error = failure.message ?: "RECORDING_FAILED"
      cancelResources()
      phase = "error"
    }
  }

  fun pauseRecording() {
    val capture = recorder ?: return
    if (phase != "recording") return
    try {
      capture.pause()
      recordedMs += SystemClock.elapsedRealtime() - segmentStartedAt
      phase = "paused"
    } catch (failure: Exception) {
      error = failure.message ?: "RECORDING_FAILED"
      phase = "error"
      cancelResources()
    }
  }

  fun resumeRecording() {
    val capture = recorder ?: return
    if (phase != "paused") return
    try {
      capture.resume()
      segmentStartedAt = SystemClock.elapsedRealtime()
      phase = "recording"
    } catch (failure: Exception) {
      error = failure.message ?: "RECORDING_FAILED"
      phase = "error"
      cancelResources()
    }
  }

  fun stopRecording() {
    val capture = recorder ?: return
    if (phase != "recording" && phase != "paused") return
    try {
      capture.stop()
      val totalMs = recordedMs + if (phase == "recording")
        SystemClock.elapsedRealtime() - segmentStartedAt else 0L
      durationSeconds = ((totalMs + 999) / 1000)
        .toInt().coerceIn(1, 600)
      require((file?.length() ?: 0) in 1..(10L * 1024 * 1024)) { "RECORDING_EMPTY" }
      phase = "ready"
    } catch (failure: Exception) {
      error = failure.message ?: "RECORDING_FAILED"; phase = "error"
    } finally { capture.release(); recorder = null }
  }

  fun play() {
    val saved = file ?: return
    if (phase != "ready") return
    try {
      player = MediaPlayer().apply {
        setDataSource(saved.absolutePath)
        setOnCompletionListener { stopPlayback() }
        prepare(); start()
      }
      phase = "playing"
    } catch (failure: Exception) { error = failure.message ?: "PLAYBACK_FAILED"; phase = "error" }
  }

  fun stopPlayback() {
    runCatching { player?.stop() }; player?.release(); player = null
    if (phase == "playing") phase = "ready"
  }

  fun consume(): Pair<ByteArray, Int> {
    require(phase == "ready") { "VOICE_NOT_READY" }
    val bytes = requireNotNull(file).readBytes()
    require(bytes.size in 1..(10 * 1024 * 1024)) { "INVALID_VOICE_ATTACHMENT" }
    return bytes to durationSeconds
  }

  fun cancel() {
    cancelResources()
    durationSeconds = 0; recordedMs = 0L; error = ""; phase = "idle"
  }

  private fun cancelResources() {
    stopPlayback()
    runCatching { recorder?.stop() }; recorder?.release(); recorder = null
    file?.delete(); file = null
  }
}
