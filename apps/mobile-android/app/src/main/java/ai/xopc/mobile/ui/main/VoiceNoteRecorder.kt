package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.VOICE_BYTES_PER_MS
import ai.xopc.mobile.gateway.VOICE_CHUNK_BYTES
import ai.xopc.mobile.gateway.VOICE_RECORD_LIMIT_BYTES
import ai.xopc.mobile.gateway.VOICE_SAMPLE_RATE
import ai.xopc.mobile.gateway.voiceWav
import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal class VoicePcmChunks {
  private val pcm = ByteArray(VOICE_CHUNK_BYTES)
  private var size = 0
  var bytes = 0
    private set
  val atLimit get() = bytes >= VOICE_RECORD_LIMIT_BYTES

  fun append(frame: ByteArray): ByteArray? {
    val count = minOf(frame.size, VOICE_RECORD_LIMIT_BYTES - bytes)
    if (count == 0) return null
    check(count <= VOICE_CHUNK_BYTES - size)
    frame.copyInto(pcm, size, endIndex = count)
    size += count
    bytes += count
    return if (size == VOICE_CHUNK_BYTES) takeTail() else null
  }

  fun takeTail(): ByteArray? {
    if (size == 0) return null
    return voiceWav(pcm, size).also { size = 0 }
  }
}

internal class VoiceNoteRecorder(private val scope: CoroutineScope) {
  var phase by mutableStateOf("idle")
    private set
  @Volatile private var durationBytes = 0
  val elapsedSeconds get() = durationBytes / (VOICE_BYTES_PER_MS * 1000)
  private val command = MutableStateFlow("idle")
  private var job: Job? = null

  @SuppressLint("MissingPermission")
  fun start(store: suspend (Int, ByteArray) -> Unit, stream: (ByteArray) -> Unit) {
    check(job?.isActive != true)
    phase = "recording"
    command.value = phase
    durationBytes = 0
    job = scope.launch {
      try {
        withContext(Dispatchers.IO) {
          val min = AudioRecord.getMinBufferSize(VOICE_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT)
          check(min > 0) { "AUDIO_UNAVAILABLE" }
          val mic = AudioRecord(MediaRecorder.AudioSource.MIC, VOICE_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, maxOf(min, 2560))
          val chunks = VoicePcmChunks()
          val frame = ByteArray(640)
          var sequence = 0
          try {
            check(mic.state == AudioRecord.STATE_INITIALIZED)
            while (!chunks.atLimit) {
              when (command.value) {
                "paused" -> {
                  if (mic.recordingState == AudioRecord.RECORDSTATE_RECORDING) mic.stop()
                  command.first { it != "paused" }
                  continue
                }
                "recording" -> Unit
                else -> break
              }
              if (mic.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                mic.startRecording()
                check(mic.recordingState == AudioRecord.RECORDSTATE_RECORDING)
              }
              val read = mic.read(frame, 0, frame.size, AudioRecord.READ_BLOCKING)
              check(read >= 0) { "CAPTURE_FAILED" }
              if (read != frame.size || command.value != "recording") continue
              val wav = chunks.append(frame)
              durationBytes = chunks.bytes
              stream(frame)
              if (wav != null) store(sequence++, wav)
            }
          } finally {
            try {
              if (mic.recordingState == AudioRecord.RECORDSTATE_RECORDING) mic.stop()
            } finally {
              mic.release()
              if (command.value != "discarding") chunks.takeTail()?.let { tail ->
                withContext(NonCancellable) { store(sequence, tail) }
              }
            }
          }
        }
        if (phase != "discarding") phase = if (durationBytes > 0) "ready" else "error"
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (phase != "discarding") phase = "error"
      }
    }
  }

  fun pauseRecording() {
    if (phase == "recording") transitionTo("paused")
  }

  fun resumeRecording() {
    if (phase == "paused") transitionTo("recording")
  }

  fun stopRecording() {
    if (phase == "recording" || phase == "paused") transitionTo("finishing")
  }

  suspend fun discard() {
    transitionTo("discarding")
    job?.join()
    transitionTo("idle")
  }

  fun reset() = transitionTo("idle")

  private fun transitionTo(value: String) {
    command.value = value
    phase = value
  }
}
