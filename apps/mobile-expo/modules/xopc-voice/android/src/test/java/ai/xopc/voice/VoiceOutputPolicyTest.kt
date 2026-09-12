package ai.xopc.voice

import android.media.AudioDeviceInfo
import org.junit.Assert.*
import org.junit.Test

class VoiceOutputPolicyTest {
  @Test fun defaultsToSpeakerInsteadOfTheEarpiece() {
    assertTrue(useVoiceSpeaker(false, listOf(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)))
    assertTrue(useVoiceSpeaker(false, emptyList()))
  }

  @Test fun automaticOutputRespectsConnectedHeadsets() {
    for (type in listOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_HEARING_AID,
      AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE)) {
      assertFalse("External device $type must not be overridden", useVoiceSpeaker(false, listOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, type)))
    }
  }

  @Test fun explicitSpeakerSelectionOverridesSystemOutputUntilDisabled() {
    val devices = listOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
    assertTrue(useVoiceSpeaker(true, devices))
    assertFalse(useVoiceSpeaker(false, devices))
  }

  @Test fun playbackStartsAfterOneCompleteTwentyMillisecondFrame() {
    assertEquals(480, voicePlaybackStartFrames(48000))
    assertEquals(240, voicePlaybackStartFrames(240))
  }
}
