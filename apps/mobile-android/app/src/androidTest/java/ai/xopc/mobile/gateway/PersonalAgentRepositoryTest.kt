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
  @Test fun proactiveSettingsRetainRevisionAndUnexposedDailyLimits() {
    val settings = PersonalAgentRepository.parseProactivity("""{"ok":true,"payload":{
      "revision":9,"mode":"balanced","timezone":"Asia/Shanghai","quietStart":22,"quietEnd":8,
      "dailyMessages":4,"dailyModelCalls":20}}""")
    val patch = settings.copy(mode = "off", timezone = "UTC", quietStart = 0).json()
    assertEquals(9, patch.getInt("revision"))
    assertEquals(4, patch.getInt("dailyMessages"))
    assertEquals(20, patch.getInt("dailyModelCalls"))
    assertEquals(0, patch.getInt("quietStart"))
    assertThrows(IllegalArgumentException::class.java) {
      PersonalAgentRepository.parseProactivity("""{"ok":false,"error":"Settings changed; reload before saving"}""")
    }
  }

}
