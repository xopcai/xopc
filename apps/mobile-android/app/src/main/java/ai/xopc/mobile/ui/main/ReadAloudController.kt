package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.speechChunks
import ai.xopc.mobile.gateway.speechLanguage
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal data class ReadAloudUiState(val phase: String = "idle", val sourceId: String = "",
  val error: String = "", val segment: Int = 0, val segmentCount: Int = 0)

/** Foreground speech playback with bounded chunks and one-segment prefetch. */
internal class ReadAloudController(private val context: Context, private val scope: CoroutineScope,
  private val fetch: suspend (String, String) -> ByteArray) {
  var state by mutableStateOf(ReadAloudUiState())
    private set
  private var job: Job? = null
  private var player: MediaPlayer? = null
  private var file: File? = null
  private var focus: AudioFocusRequest? = null
  private var generation = 0
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  fun speak(markdown: String, sourceId: String, fallbackLanguage: String) {
    stop()
    val chunks = speechChunks(markdown)
    if (chunks.isEmpty()) return
    val current = ++generation
    state = ReadAloudUiState("loading", sourceId, segmentCount = chunks.size)
    job = scope.launch {
      try {
        val language = speechLanguage(markdown, fallbackLanguage)
        var pending = async(Dispatchers.IO) { fetch(chunks.first(), language) }
        for (index in chunks.indices) {
          val bytes = pending.await()
          if (current != generation) return@launch
          require(bytes.isNotEmpty() && bytes.size <= 16 * 1024 * 1024) { "INVALID_SPEECH_AUDIO" }
          val next = if (index < chunks.lastIndex) async(Dispatchers.IO) {
            fetch(chunks[index + 1], language)
          } else null
          state = state.copy(phase = "loading", segment = index + 1)
          play(bytes, current)
          next?.let { pending = it }
        }
        if (current == generation) stop()
      } catch (_: CancellationException) {
      } catch (error: Exception) {
        if (current == generation) {
          releaseOutput()
          state = state.copy(phase = "error", error = error.message ?: "SPEECH_FAILED")
        }
      }
    }
  }

  fun toggle() {
    val active = player ?: return
    runCatching {
      if (active.isPlaying) { active.pause(); state = state.copy(phase = "paused") }
      else { active.start(); state = state.copy(phase = "playing") }
    }.onFailure { stop() }
  }

  fun stop() {
    generation++
    job?.cancel(); job = null
    releaseOutput()
    state = ReadAloudUiState()
  }

  private suspend fun play(bytes: ByteArray, current: Int) {
    val output = withContext(Dispatchers.IO) {
      File(context.cacheDir, "xopc-speech-${UUID.randomUUID()}.audio").also { it.writeBytes(bytes) }
    }
    if (current != generation) { output.delete(); return }
    file = output
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(attributes)
      .setOnAudioFocusChangeListener { change ->
        when (change) {
          AudioManager.AUDIOFOCUS_LOSS -> scope.launch { stop() }
          AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ->
            if (player?.isPlaying == true) scope.launch { toggle() }
          AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> player?.setVolume(0.2f, 0.2f)
          AudioManager.AUDIOFOCUS_GAIN -> player?.setVolume(1f, 1f)
        }
      }.build()
    if (audioManager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
      throw IllegalStateException("AUDIO_FOCUS_UNAVAILABLE")
    focus = request
    suspendCancellableCoroutine<Unit> { continuation ->
      val active = MediaPlayer()
      player = active
      active.setAudioAttributes(attributes)
      active.setOnPreparedListener {
        if (current == generation) {
          state = state.copy(phase = "playing")
          it.start()
        }
      }
      active.setOnCompletionListener { if (continuation.isActive) continuation.resume(Unit) }
      active.setOnErrorListener { _, _, _ ->
        if (continuation.isActive) continuation.resumeWithException(IllegalStateException("PLAYBACK_FAILED"))
        true
      }
      try { active.setDataSource(output.absolutePath); active.prepareAsync() }
      catch (error: Exception) { if (continuation.isActive) continuation.resumeWithException(error) }
      continuation.invokeOnCancellation { runCatching { active.release() } }
    }
    releaseOutput()
  }

  private fun releaseOutput() {
    val active = player; player = null
    if (active != null) runCatching { active.release() }
    val output = file; file = null
    output?.delete()
    val request = focus; focus = null
    if (request != null) audioManager.abandonAudioFocusRequest(request)
  }
}
