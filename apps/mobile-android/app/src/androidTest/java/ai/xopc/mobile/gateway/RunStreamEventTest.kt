package ai.xopc.mobile.gateway

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RunStreamEventTest {
  @Test fun acceptsOnlyMatchingRunAndConversationEvents() {
    val data = JSONObject("""{"runId":"run-1","conversationId":"conversation-1","payload":{"messageId":"msg-1","delta":"Hello","offset":0}}""")
    val event = RunStreamEvent.parse("run:run-1", "assistant_delta", data)
    assertEquals("conversation-1", event?.conversationId)
    assertEquals("Hello", event?.delta)
    assertEquals(0, event?.offset)
    assertNull(RunStreamEvent.parse("run:run-2", "assistant_delta", data))
    assertNull(RunStreamEvent.parse("run:run-1", "unknown", data))
  }

  @Test fun offsetKeepsReplayIdempotentAndRejectsMissingPrefix() {
    assertEquals("Hello world", RunStreamEvent.appendDelta("Hello ", "world", 6))
    assertEquals("Hello world", RunStreamEvent.appendDelta("Hello world", "world", 6))
    assertNull(RunStreamEvent.appendDelta("", "world", 6))
    assertNull(RunStreamEvent.appendDelta("Hello", "changed", 1))
  }
}
