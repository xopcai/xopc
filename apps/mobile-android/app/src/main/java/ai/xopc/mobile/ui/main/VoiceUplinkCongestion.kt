package ai.xopc.mobile.ui.main

internal enum class VoiceCongestion { CLEAR, WAITING, EXPIRED }

internal fun voiceInputShouldMute(userMuted: Boolean, clarification: Boolean,
  approval: Boolean, congestion: Boolean): Boolean =
  userMuted || clarification || approval || congestion

/** Bounds queued microphone audio so stale speech is never sent after recovery. */
internal class VoiceUplinkCongestion {
  private var startedAtMs = -1L

  fun observe(queuedBytes: Long, nowMs: Long): VoiceCongestion {
    if (queuedBytes < 4_200) {
      startedAtMs = -1L
      return VoiceCongestion.CLEAR
    }
    if (queuedBytes >= 9_600) return VoiceCongestion.EXPIRED
    if (startedAtMs < 0L) startedAtMs = nowMs
    return if (nowMs - startedAtMs >= 180L) VoiceCongestion.EXPIRED
      else VoiceCongestion.WAITING
  }
}
