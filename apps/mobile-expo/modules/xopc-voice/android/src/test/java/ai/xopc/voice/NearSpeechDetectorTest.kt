package ai.xopc.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NearSpeechDetectorTest {
  private fun pcm(level: Short) = ByteArray(1280).also { bytes ->
    for (index in bytes.indices step 2) { bytes[index] = level.toInt().toByte(); bytes[index + 1] = (level.toInt() shr 8).toByte() }
  }

  @Test fun requiresTwoLoudFramesAndSixQuietFrames() {
    val detector = NearSpeechDetector()
    assertNull(detector.process(pcm(2000), 1280))
    assertEquals(true, detector.process(pcm(2000), 1280))
    repeat(5) { assertNull(detector.process(pcm(0), 1280)) }
    assertEquals(false, detector.process(pcm(0), 1280))
  }

  @Test fun resetClearsAnActiveCandidate() {
    val detector = NearSpeechDetector()
    detector.process(pcm(2000), 1280); detector.process(pcm(2000), 1280); detector.reset()
    repeat(6) { assertNull(detector.process(pcm(0), 1280)) }
  }
}
