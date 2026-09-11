package ai.xopc.voice

import kotlin.math.abs
import kotlin.math.max

/** Low-frequency near-speech candidate detector; it never leaves the native audio thread. */
class NearSpeechDetector {
  private var noiseFloor = 120.0
  private var loudFrames = 0
  private var quietFrames = 0
  private var active = false

  @Synchronized fun process(pcm: ByteArray, count: Int): Boolean? {
    if (count < 2) return null
    var total = 0L
    var samples = 0
    var index = 0
    while (index + 1 < count) {
      val sample = ((pcm[index].toInt() and 0xff) or (pcm[index + 1].toInt() shl 8)).toShort().toInt()
      total += abs(sample).toLong()
      samples++
      index += 2
    }
    val level = total.toDouble() / samples
    val threshold = max(600.0, noiseFloor * 3.0)
    if (!active) {
      if (level >= threshold) {
        loudFrames++
        if (loudFrames >= 2) { active = true; quietFrames = 0; return true }
      } else {
        loudFrames = 0
        noiseFloor = noiseFloor * 0.95 + level * 0.05
      }
      return null
    }
    quietFrames = if (level < threshold * 0.7) quietFrames + 1 else 0
    if (quietFrames >= 6) { active = false; loudFrames = 0; quietFrames = 0; return false }
    return null
  }

  @Synchronized fun reset() { loudFrames = 0; quietFrames = 0; active = false }
}
