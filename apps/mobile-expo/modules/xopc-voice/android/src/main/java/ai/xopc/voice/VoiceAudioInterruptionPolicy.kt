package ai.xopc.voice

import android.media.AudioManager

internal enum class AudioFocusAction { IGNORE, RESTORE, DUCK, PAUSE }

internal fun audioFocusAction(change: Int, currentSession: Boolean): AudioFocusAction {
  if (!currentSession) return AudioFocusAction.IGNORE
  return when (change) {
    AudioManager.AUDIOFOCUS_GAIN -> AudioFocusAction.RESTORE
    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> AudioFocusAction.DUCK
    AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> AudioFocusAction.PAUSE
    else -> AudioFocusAction.IGNORE
  }
}

internal fun activeAudioDeviceRemoved(removedIds: List<Int>, inputId: Int?, outputId: Int?, currentSession: Boolean): Boolean =
  currentSession && removedIds.any { it == inputId || it == outputId }
