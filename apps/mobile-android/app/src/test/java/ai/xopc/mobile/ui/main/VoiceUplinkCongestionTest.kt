package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceUplinkCongestionTest {
  @Test fun networkQueueRecoversBeforeOldSpeechExpires() {
    val congestion = VoiceUplinkCongestion()
    assertEquals(VoiceCongestion.CLEAR, congestion.observe(0, 1_000))
    assertEquals(VoiceCongestion.WAITING, congestion.observe(4_200, 1_020))
    assertEquals(VoiceCongestion.WAITING, congestion.observe(8_000, 1_180))
    assertEquals(VoiceCongestion.CLEAR, congestion.observe(4_199, 1_190))
    assertEquals(VoiceCongestion.WAITING, congestion.observe(4_200, 1_500))
    assertEquals(VoiceCongestion.EXPIRED, congestion.observe(4_200, 1_680))
    assertEquals(VoiceCongestion.EXPIRED, congestion.observe(9_600, 1_700))
  }

  @Test fun clearingCongestionDoesNotOverrideUserMuteOrApproval() {
    assertEquals(true, voiceInputShouldMute(true, false, false, false))
    assertEquals(true, voiceInputShouldMute(false, false, true, false))
    assertEquals(true, voiceInputShouldMute(false, false, false, true))
    assertEquals(false, voiceInputShouldMute(false, false, false, false))
  }
}
