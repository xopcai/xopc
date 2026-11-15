package ai.xopc.mobile.gateway

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RunStreamEventTest {
  @Test fun preservesCompactNarrationClassification() {
    val data = JSONObject("""{"runId":"run-1","conversationId":"conversation-1","payload":{"messageId":"m","presentation":"narration"}}""")
    val event = RunStreamEvent.parse("run:run-1", "assistant_message_end", data)
    assertEquals("m", event?.messageId)
    assertEquals("narration", event?.presentation)
  }
  @Test fun acceptsOnlyMatchingRunAndConversationEvents() {
    val data = JSONObject("""{"runId":"run-1","conversationId":"conversation-1","payload":{"messageId":"msg-1","delta":"Hello","offset":0}}""")
    val event = RunStreamEvent.parse("run:run-1", "assistant_delta", data)
    assertEquals("conversation-1", event?.conversationId)
    assertEquals("Hello", event?.delta)
    assertEquals(0, event?.offset)
    assertNull(RunStreamEvent.parse("run:run-2", "assistant_delta", data))
    assertNull(RunStreamEvent.parse("run:run-1", "unknown", data))
  }
  @Test fun clarificationEventsTriggerConversationRefresh() {
    val data = JSONObject("""{"runId":"run-1","conversationId":"conversation-1","payload":{"requestId":"q1","question":"Where?","interactionMode":"compose"}}""")
    val event = RunStreamEvent.parse("run:run-1", "clarify_request", data)
    assertEquals("clarify_request", event?.type)
    assertEquals("conversation-1", event?.conversationId)
  }

  @Test fun compactMusicToolSuccessCanRefreshBeforeTheRunEnds() {
    val payload = JSONObject().put("toolName", "music_generation").put("status", "success")
    val data = JSONObject().put("runId", "run-1").put("conversationId", "chat").put("payload", payload)
    assertEquals("tool_end", RunStreamEvent.parse("run:run-1", "tool_end", data)?.type)
    payload.put("status", "error")
    assertNull(RunStreamEvent.parse("run:run-1", "tool_end", data))
    payload.put("status", "success").put("toolName", "other_tool")
    assertNull(RunStreamEvent.parse("run:run-1", "tool_end", data))
  }

}
