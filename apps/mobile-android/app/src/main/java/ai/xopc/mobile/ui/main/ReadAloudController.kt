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
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal data class ReadAloudUiState(val phase: String = "idle", val sourceId: String = "",
  val error: String = "", val segment: Int = 0, val segmentCount: Int = 0)

internal data class ChatSpeechScope(val conversationId: String, val transcriptId: String?)
internal data class ChatSpeechReply(val id: String, val text: String)

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
  private data class Position(val chunk: Int = 0, val offset: Int = 0, val autoplay: Boolean = true)
  private class Reading(val queue: ArrayDeque<ChatSpeechReply>, val seen: MutableSet<String>) {
    var position = Position()
  }
  private val readings = mutableMapOf<ChatSpeechScope, Reading>()
  private var activeScope: ChatSpeechScope? = null
  private var replies = emptyList<ChatSpeechReply>()
  private var fallbackLanguage = "en-US"
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  fun showConversation(chat: ChatSpeechScope, replies: List<ChatSpeechReply>, language: String) {
    if (activeScope != chat) {
      activeScope?.let(::leaveConversation)
      readings.keys.removeAll { it.conversationId == chat.conversationId && it != chat }
      activeScope = chat
    }
    this.replies = replies
    fallbackLanguage = language
    val reading = readings[chat] ?: return
    val anchor = replies.indexOfLast { it.id in reading.seen }
    replies.drop(anchor + 1).forEach { if (reading.seen.add(it.id)) reading.queue.addLast(it) }
    if (state.phase == "idle" || state.phase == "waiting") playNext()
  }

  fun leaveConversation(chat: ChatSpeechScope) {
    if (activeScope != chat) return
    readings[chat]?.let {
      if (it.queue.isNotEmpty()) {
        val offset = player?.let { output -> runCatching { output.currentPosition }.getOrDefault(it.position.offset) }
        it.position = Position((state.segment - 1).coerceAtLeast(0), offset ?: it.position.offset,
          state.phase == "playing" || (state.phase == "loading" && it.position.autoplay))
      }
    }
    activeScope = null
    replies = emptyList()
    stopOutput()
  }

  fun speak(chat: ChatSpeechScope, reply: ChatSpeechReply) {
    if (activeScope != chat) return
    ai.xopc.mobile.playback.MusicPlayback.pause()
    stopOutput()
    val anchor = replies.indexOfFirst { it.id == reply.id }
    val queue = ArrayDeque<ChatSpeechReply>()
    queue.addLast(reply)
    if (anchor >= 0) queue.addAll(replies.drop(anchor + 1))
    readings[chat] = Reading(queue, replies.mapTo(mutableSetOf(reply.id)) { it.id })
    playNext()
  }

  private fun playNext() {
    val reading = readings[activeScope] ?: return
    var reply = reading.queue.firstOrNull()
    var chunks = reply?.let { speechChunks(it.text) }.orEmpty()
    while (reply != null && chunks.isEmpty()) {
      reading.queue.removeFirst()
      reading.position = Position()
      reply = reading.queue.firstOrNull()
      chunks = reply?.let { speechChunks(it.text) }.orEmpty()
    }
    if (reply == null) {
      stopOutput()
      state = ReadAloudUiState("waiting")
      return
    }
    val text = reply.text
    val position = reading.position
    val first = position.chunk.coerceIn(chunks.indices)
    val current = ++generation
    state = ReadAloudUiState("loading", reply.id, segment = first + 1, segmentCount = chunks.size)
    job = scope.launch {
      try {
        supervisorScope {
          val language = speechLanguage(text, fallbackLanguage)
          fun request(index: Int) = async(Dispatchers.IO) { fetch(chunks[index], language) }
          fun prefetch(index: Int) = if (index < chunks.lastIndex) request(index + 1) else null
          var pending = request(first)
          var next = prefetch(first)
          for (index in first..chunks.lastIndex) {
            state = state.copy(phase = "loading", segment = index + 1)
            reading.position = if (index == first) position else Position(index)
            val bytes = try {
              pending.await()
            } catch (error: Exception) {
              if (index == first || error is CancellationException) throw error
              request(index).await()
            }
            if (current != generation) return@supervisorScope
            require(bytes.isNotEmpty() && bytes.size <= 16 * 1024 * 1024) { "INVALID_SPEECH_AUDIO" }
            if (index > first) next = prefetch(index)
            play(bytes, current, reading.position)
            pending = next ?: break
          }
        }
        if (current == generation) {
          releaseOutput()
          reading.queue.removeFirst()
          reading.position = Position()
          playNext()
        }
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
    activeScope?.let(readings::remove)
    stopOutput()
  }

  private fun stopOutput() {
    generation++
    job?.cancel(); job = null
    releaseOutput()
    state = ReadAloudUiState()
  }

  private suspend fun play(bytes: ByteArray, current: Int, position: Position) {
    val output = File(context.cacheDir, "xopc-speech-${UUID.randomUUID()}.audio")
    try {
      withContext(Dispatchers.IO) { output.writeBytes(bytes) }
    } catch (error: Exception) {
      output.delete()
      throw error
    }
    if (current != generation) { output.delete(); return }
    file = output
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    if (focus == null) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener { change ->
          scope.launch {
            if (current != generation) return@launch
            when (change) {
              AudioManager.AUDIOFOCUS_LOSS -> stop()
              AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> if (player?.isPlaying == true) toggle()
              AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> player?.setVolume(0.2f, 0.2f)
              AudioManager.AUDIOFOCUS_GAIN -> player?.setVolume(1f, 1f)
            }
          }
        }.build()
      if (audioManager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
        throw IllegalStateException("AUDIO_FOCUS_UNAVAILABLE")
      focus = request
    }
    suspendCancellableCoroutine<Unit> { continuation ->
      val active = MediaPlayer()
      player = active
      active.setAudioAttributes(attributes)
      fun prepared() {
        if (current != generation) return
        if (position.autoplay) active.start()
        state = state.copy(phase = if (position.autoplay) "playing" else "paused")
      }
      active.setOnPreparedListener {
        if (current != generation) return@setOnPreparedListener
        if (position.offset > 0) {
          it.setOnSeekCompleteListener { output ->
            output.setOnSeekCompleteListener(null)
            prepared()
          }
          it.seekTo(position.offset.coerceAtMost((it.duration - 1).coerceAtLeast(0)).toLong(), MediaPlayer.SEEK_CLOSEST)
        } else {
          prepared()
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
    releasePlayer()
  }

  private fun releasePlayer() {
    val active = player; player = null
    if (active != null) runCatching { active.release() }
    val output = file; file = null
    output?.delete()
  }

  private fun releaseOutput() {
    releasePlayer()
    val request = focus; focus = null
    if (request != null) audioManager.abandonAudioFocusRequest(request)
  }
}
