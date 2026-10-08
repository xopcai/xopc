package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class VoiceReplyHandoffTest {
  @Test fun nextReplyWaitsForAudibleTailAndReplaysInWireOrder() {
    assertEquals(VoiceReplyDisposition.START, voiceReplyDisposition("", false, "reply-1"))
    assertEquals(VoiceReplyDisposition.REJECT, voiceReplyDisposition("reply-1", false, "reply-2"))
    assertEquals(VoiceReplyDisposition.DEFER, voiceReplyDisposition("reply-1", true, "reply-2"))
    assertEquals(VoiceReplyDisposition.REJECT,
      voiceReplyDisposition("reply-1", true, "reply-3", "reply-2"))

    val pending = VoiceDeferredReplies<String>()
    pending.begin("reply-2")
    pending.add("created", 14)
    pending.add("text", 8)
    pending.add("audio", 960)
    pending.add("done", 10)
    assertEquals("reply-2", pending.responseId)
    assertEquals(listOf("created", "text", "audio", "done"), pending.take())
    assertEquals("", pending.responseId)
    assertEquals(VoiceReplyDisposition.START, voiceReplyDisposition("", false, "reply-2"))
    assertEquals(VoiceReplyDisposition.DEFER, voiceReplyDisposition("reply-2", true, "reply-3"))
  }

  @Test fun deferredAudioIsBoundedAndReleaseDiscardsStaleReply() {
    val pending = VoiceDeferredReplies<String>()
    pending.begin("old-reply")
    pending.add("created", 10)
    assertThrows(IllegalArgumentException::class.java) {
      pending.add("oversized-audio", 256_000)
    }
    pending.reset()
    assertEquals(emptyList<String>(), pending.take())
    assertEquals("", pending.responseId)
  }

  @Test fun transientVoiceFailuresHaveBoundedBackoff() {
    assertEquals(listOf(500L, 1000L, 2000L, 4000L, 8000L),
      (0..4).map { voiceReconnectDelay("NETWORK", it) })
    assertEquals(null, voiceReconnectDelay("NETWORK", 5))
    assertEquals(null, voiceReconnectDelay("TIME_LIMIT", 0))
    assertEquals(null, voiceReconnectDelay("PROTOCOL_ERROR", 0))
  }
}
