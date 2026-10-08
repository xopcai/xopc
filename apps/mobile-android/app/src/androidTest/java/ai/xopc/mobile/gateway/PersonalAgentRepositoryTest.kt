package ai.xopc.mobile.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class PersonalAgentRepositoryTest {
  @Test fun parsesExistingFixedConversationAndRejectsInvalidIdentity() {
    val id = "11111111-2222-3333-4444-555555555555"
    val agent = PersonalAgentRepository.parse("""{"ok":true,"payload":{
      "agentId":"personal","conversationId":"$id","state":"ready",
      "displayName":"Ada","appearance":"loopi","errorMessage":null}}""")
    assertEquals(id, agent?.conversationId)
    assertEquals("Ada", agent?.displayName)
    assertNull(agent?.errorMessage)
    assertNull(PersonalAgentRepository.parse("""{"ok":true,"payload":null}"""))
    assertThrows(IllegalArgumentException::class.java) {
      PersonalAgentRepository.parse("""{"ok":true,"payload":{
        "agentId":"personal","conversationId":"not-a-uuid","state":"ready"}}""")
    }
  }
}
