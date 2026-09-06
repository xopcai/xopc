package ai.xopc.voice

import android.media.AudioManager
import org.junit.Assert.*
import org.junit.Test

class VoiceAudioInterruptionPolicyTest {
  @Test fun shortAudioNotificationsDuckAndRestoreInsteadOfPausing() {
    assertEquals(AudioFocusAction.DUCK, audioFocusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK, true))
    assertEquals(AudioFocusAction.RESTORE, audioFocusAction(AudioManager.AUDIOFOCUS_GAIN, true))
  }

  @Test fun actualFocusLossStillPauses() {
    assertEquals(AudioFocusAction.PAUSE, audioFocusAction(AudioManager.AUDIOFOCUS_LOSS, true))
    assertEquals(AudioFocusAction.PAUSE, audioFocusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, true))
  }

  @Test fun callbacksFromAnOldSessionCannotInterruptTheNewCall() {
    assertEquals(AudioFocusAction.IGNORE, audioFocusAction(AudioManager.AUDIOFOCUS_LOSS, false))
    assertEquals(AudioFocusAction.IGNORE, audioFocusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK, false))
    assertFalse(activeAudioDeviceRemoved(listOf(1, 2), 1, 2, false))
  }

  @Test fun removingAnUnusedDeviceDoesNotPauseTheCall() {
    assertFalse(activeAudioDeviceRemoved(listOf(3), 1, 2, true))
    assertFalse(activeAudioDeviceRemoved(listOf(3), null, null, true))
    assertTrue(activeAudioDeviceRemoved(listOf(1), 1, 2, true))
    assertTrue(activeAudioDeviceRemoved(listOf(2), 1, 2, true))
  }
}
