package ai.xopc.mobile.gateway

import org.junit.Assert.assertEquals
import org.junit.Test

class ConversationVisibilityTest {
  @Test fun hidesInternalContextWithoutFilteringUserAuthoredText() {
    val id = "11111111-2222-3333-4444-555555555555"
    val history = ConversationRepository.parseHistory(id, """{"session":{"key":"$id","messages":[
      {"id":"hidden","role":"user","display":false,"content":"Internal continuation instructions"},
      {"id":"private","role":"user","metadata":{"hiddenFromClient":true},"content":"Internal setup data"},
      {"id":"context","role":"custom","display":false,"content":"Internal tools instructions"},
      {"id":"user","role":"user","content":"MCP configuration is saved. What does this mean?"},
      {"id":"answer","role":"assistant","content":"已连接，可以继续使用。"}
    ]},"pagination":{"hasMore":false}}""")
    assertEquals(listOf("user", "answer"), history.messages.map { it.id })
  }
}
