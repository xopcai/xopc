package ai.xopc.mobile.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionWaitRepositoryTest {
  private val conversationId = "11111111-2222-3333-4444-555555555555"

  @Test fun parsesTheCurrentConversationWaitAndItsNeeds() {
    val raw = """{"ok":true,"payload":{"transcriptId":"transcript-1","revision":8,
      "wait":{"id":"wait-1","conversationId":"$conversationId","version":3,
        "phase":"needs_connection","summary":"Connect calendar","needs":[
          {"key":"calendar","label":"Calendar","phase":"connect","authorizationMode":"browser",
            "capabilities":["read events"],"reason":"Permission needed"}],
        "timeRange":{"expression":"next week","timezone":"Asia/Shanghai"}}}}"""
    val result = ConnectionWaitRepository.parseSnapshot(conversationId, raw)
    assertEquals("transcript-1", result.transcriptId)
    assertEquals(8L, result.revision)
    assertEquals("Connect calendar", result.wait?.summary)
    assertEquals("next week · Asia/Shanghai", result.wait?.timeRange)
    assertEquals("Calendar", result.wait?.needs?.single()?.label)
  }

  @Test fun acceptsNoActiveWaitAndRejectsAnotherConversation() {
    val empty = ConnectionWaitRepository.parseSnapshot(conversationId,
      """{"ok":true,"payload":{"transcriptId":"transcript-1","revision":9,"wait":null}}""")
    assertNull(empty.wait)
    val wrong = """{"ok":true,"payload":{"transcriptId":"transcript-1","revision":9,
      "wait":{"id":"wait-1","conversationId":"other","version":1,"phase":"queued",
        "summary":"Other","needs":[]}}}"""
    assertTrue(runCatching { ConnectionWaitRepository.parseSnapshot(conversationId, wrong) }.isFailure)
  }
}
