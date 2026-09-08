package ai.xopc.voice

internal class VoicePlaybackQueue {
  private val frames = ArrayDeque<ByteArray>()
  private var offset = 0

  fun add(bytes: ByteArray) { frames.addLast(bytes) }

  fun clear() { frames.clear(); offset = 0 }

  // Non-blocking AudioTrack writes may accept only part of a frame, or nothing yet.
  fun drain(write: (ByteArray, Int, Int) -> Int): Boolean {
    while (frames.isNotEmpty()) {
      val frame = frames.first()
      val remaining = frame.size - offset
      val written = write(frame, offset, remaining)
      check(written in 0..remaining && written % 2 == 0) { "PLAYBACK_FAILED" }
      if (written == 0) return false
      offset += written
      if (offset == frame.size) { frames.removeFirst(); offset = 0 }
    }
    return true
  }
}

/** Converts AudioTrack's process-wide playback head into per-response byte progress. */
internal class VoicePlaybackProgress {
  private var base = 0L
  private var previous = 0L
  private var initialized = false

  fun reset(playbackHeadPosition: Int) {
    base = playbackHeadPosition.toLong() and 0xffffffffL
    previous = base
    initialized = true
  }

  fun playedBytes(playbackHeadPosition: Int, submittedBytes: Int): Int {
    val current = playbackHeadPosition.toLong() and 0xffffffffL
    if (!initialized) reset(playbackHeadPosition)
    // AudioTrack.flush() may reset the head asynchronously. Distinguish that
    // small backwards jump from the uint32 wrap that occurs after long sessions.
    if (current < previous && previous - current < 0x80000000L) base = current
    val frames = if (current >= base) current - base else 0x100000000L - base + current
    previous = current
    return minOf(submittedBytes.toLong(), frames * 2).toInt()
  }
}
