package ai.xopc.mobile.ui.main

internal enum class VoiceReplyDisposition { START, DEFER, REJECT }

internal fun voiceReconnectDelay(reason: String, attempt: Int): Long? {
  if (reason !in setOf("NETWORK", "route_lost", "CAPTURE_FAILED", "PLAYBACK_FAILED",
      "PLAYBACK_STALLED", "CAPTURE_INTERRUPTED", "OMNI_CONNECTION_CLOSED",
      "OMNI_CONNECTION_FAILED") || attempt !in 0..4) return null
  return longArrayOf(500, 1000, 2000, 4000, 8000)[attempt]
}

internal fun voiceReplyDisposition(activeId: String, activeDone: Boolean,
  incomingId: String, pendingId: String = ""): VoiceReplyDisposition = when {
  pendingId.isNotEmpty() && incomingId != pendingId -> VoiceReplyDisposition.REJECT
  incomingId.isEmpty() || activeId.isEmpty() || incomingId == activeId -> VoiceReplyDisposition.START
  activeDone -> VoiceReplyDisposition.DEFER
  else -> VoiceReplyDisposition.REJECT
}

/** Keeps a later reply in wire order while the current response drains from the speaker. */
internal class VoiceDeferredReplies<T> {
  var responseId: String = ""
    private set
  private val entries = ArrayDeque<T>()
  private var bytes = 0

  fun begin(responseId: String) { this.responseId = responseId }

  fun add(item: T, size: Int) {
    require(size >= 0 && entries.size < 1024 && bytes + size <= 256_000) {
      "AUDIO_QUEUE_FULL"
    }
    entries.addLast(item)
    bytes += size
  }

  fun take(): List<T> {
    val result = entries.toList()
    reset()
    return result
  }

  fun reset() {
    responseId = ""
    entries.clear()
    bytes = 0
  }
}
