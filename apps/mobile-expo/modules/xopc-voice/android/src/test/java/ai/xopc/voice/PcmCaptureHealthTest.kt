package ai.xopc.voice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PcmCaptureHealthTest {
  @Test
  fun rejectsAnInputThatOnlyReturnsDigitalSilence() {
    val health = PcmCaptureHealth(startupSilenceBytes = 12)

    assertTrue(health.observe(ByteArray(4), 4))
    assertTrue(health.observe(ByteArray(4), 4))
    assertFalse(health.observe(ByteArray(4), 4))
  }

  @Test
  fun acceptsSilenceAfterAnyRealInputSignal() {
    val health = PcmCaptureHealth(startupSilenceBytes = 8)

    assertTrue(health.observe(byteArrayOf(0, 0, 20, 0), 4))
    assertTrue(health.observe(ByteArray(32), 32))
  }

  @Test
  fun resetStartsAnewStartupWindow() {
    val health = PcmCaptureHealth(startupSilenceBytes = 8)

    assertTrue(health.observe(byteArrayOf(20, 0), 2))
    health.reset()
    assertTrue(health.observe(ByteArray(4), 4))
    assertFalse(health.observe(ByteArray(4), 4))
  }

  @Test
  fun ignoresBytesOutsideTheReportedReadCount() {
    val health = PcmCaptureHealth(startupSilenceBytes = 4)

    assertTrue(health.observe(byteArrayOf(0, 0, 20, 0), 2))
    assertFalse(health.observe(byteArrayOf(0, 0, 20, 0), 2))
  }

  @Test
  fun rejectsLowLevelPlaceholderNoise() {
    val health = PcmCaptureHealth(startupSilenceBytes = 8, minimumSignalAmplitude = 16)
    val noise = byteArrayOf(8, 0, -8, -1)

    assertTrue(health.observe(noise, noise.size))
    assertFalse(health.observe(noise, noise.size))
  }
}
