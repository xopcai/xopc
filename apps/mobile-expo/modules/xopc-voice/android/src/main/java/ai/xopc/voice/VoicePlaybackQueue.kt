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
