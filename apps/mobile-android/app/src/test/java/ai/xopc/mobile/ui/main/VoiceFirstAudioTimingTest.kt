package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceFirstAudioTimingTest {
  @Test fun measuresOnlyFirstReceiptAndWrite() {
    val timing = VoiceFirstAudioTiming()
    timing.speechStopped(100)
    timing.created("reply")
    assertNull(timing.buffered("reply", 110))
    assertEquals(200L, timing.received("reply", 300))
    assertNull(timing.received("reply", 320))
    assertEquals(250L, timing.buffered("reply", 350))
    assertNull(timing.buffered("reply", 370))
  }

  @Test fun preservesDeferredReplyEndpointsAndDropsCancelledOnes() {
    val timing = VoiceFirstAudioTiming()
    timing.created("first")
    timing.speechStopped(100)
    timing.created("second")
    assertEquals(200L, timing.received("second", 300))
    timing.finish("first")
    timing.created("second")
    assertEquals(500L, timing.buffered("second", 600))
    timing.finish("second")
    assertNull(timing.buffered("second", 700))
    timing.speechStopped(800)
    timing.reset()
    timing.created("new-call")
    assertNull(timing.received("new-call", 900))
  }

  @Test fun resumedSpeechInvalidatesThePreviousStop() {
    val timing = VoiceFirstAudioTiming()
    timing.speechStopped(100)
    timing.speechStarted()
    timing.created("reply")
    assertNull(timing.received("reply", 300))
    assertNull(timing.buffered("reply", 350))
  }
}
