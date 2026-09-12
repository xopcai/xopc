package ai.xopc.voice

import android.media.AudioDeviceInfo

private val externalOutputTypes = setOf(
  AudioDeviceInfo.TYPE_WIRED_HEADSET,
  AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
  AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
  AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
  AudioDeviceInfo.TYPE_BLE_HEADSET,
  AudioDeviceInfo.TYPE_BLE_SPEAKER,
  AudioDeviceInfo.TYPE_HEARING_AID,
  AudioDeviceInfo.TYPE_USB_HEADSET,
  AudioDeviceInfo.TYPE_USB_DEVICE,
  AudioDeviceInfo.TYPE_USB_ACCESSORY,
  AudioDeviceInfo.TYPE_HDMI,
  AudioDeviceInfo.TYPE_HDMI_ARC,
  AudioDeviceInfo.TYPE_HDMI_EARC,
  AudioDeviceInfo.TYPE_LINE_ANALOG,
  AudioDeviceInfo.TYPE_LINE_DIGITAL,
)

internal fun useVoiceSpeaker(forceSpeaker: Boolean, outputTypes: List<Int>): Boolean =
  forceSpeaker || outputTypes.none { it in externalOutputTypes }

internal fun voicePlaybackStartFrames(capacityFrames: Int, sampleRate: Int = 24000): Int =
  minOf(capacityFrames, maxOf(1, sampleRate / 50))
