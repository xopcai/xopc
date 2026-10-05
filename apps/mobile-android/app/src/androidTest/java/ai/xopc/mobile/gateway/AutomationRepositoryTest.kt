package ai.xopc.mobile.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AutomationRepositoryTest {
  private val automation = """{"id":"auto-1","name":"Morning brief","enabled":true,
    "trigger":{"kind":"schedule","schedule":{"kind":"cron","expr":"0 9 * * *"}},
    "action":{"kind":"agent","instruction":"Summarize my day"},
    "state":{"nextRunAtMs":1000,"lastRunStatus":"succeeded"},"updatedAtMs":123,
    "management":{"owner":"user","editable":["enabled"],"runnable":true,"deletable":true}}"""

  @Test fun parsesAutomationListAndDetailWithIdentityCheck() {
    val items = AutomationRepository.parseList("""{"automations":[$automation]}""")
    assertEquals("Morning brief", items.single().name)
    assertEquals("0 9 * * *", items.single().schedule)
    assertEquals(1000L, items.single().nextRunAtMs)
    assertEquals(123L, items.single().updatedAtMs)
    assertEquals(true, items.single().canToggle)
    assertEquals(false, items.single().canEditSchedule)
    assertEquals(true, items.single().canDelete)
    assertEquals("auto-1", AutomationRepository.parseDetail("auto-1", """{"automation":$automation}""").id)
    assertThrows(IllegalArgumentException::class.java) {
      AutomationRepository.parseDetail("auto-2", """{"automation":$automation}""")
    }
  }

  @Test fun managedSchedulePermissionDoesNotGrantInstructionEditing() {
    val triggerOnly = automation.replace("[\"enabled\"]", "[\"trigger\"]")
    val item = AutomationRepository.parseList("""{"automations":[$triggerOnly]}""").single()
    assertEquals(true, item.canEditSchedule)
    assertEquals(false, item.canEditDetails)
    assertEquals(false, item.canToggle)
    val unmanaged = AutomationRepository.parseList("""{"automations":[${automation.substringBefore(",\n    \"management\"")}}]}""").single()
    assertEquals(true, unmanaged.canEditDetails)
    assertEquals(true, unmanaged.canDelete)
  }

  @Test fun managedAutomationCannotExposeForbiddenActions() {
    val restricted = automation.replace("\"enabled\"],\"runnable\":true", "],\"runnable\":false")
    val item = AutomationRepository.parseList("""{"automations":[$restricted]}""").single()
    assertEquals(false, item.canRun)
    assertEquals(false, item.canToggle)
    assertThrows(IllegalArgumentException::class.java) {
      AutomationRepository.parseRunDetailForAutomation("other", """{"run":{"id":"run-1",
        "automationId":"auto-1","status":"queued"}}""")
    }
  }

  @Test fun runHistoryAndEventsRequireMatchingIdentifiers() {
    val run = """{"id":"run-1","automationId":"auto-1","automationName":"Morning brief",
      "status":"succeeded","summary":"Done","conversationId":"chat-1","createdAtMs":1000}"""
    assertEquals("run-1", AutomationRepository.parseRuns("auto-1", """{"runs":[$run]}""").single().id)
    assertEquals("chat-1", AutomationRepository.parseRunDetail("run-1", """{"run":$run}""").conversationId)
    assertThrows(IllegalArgumentException::class.java) {
      AutomationRepository.parseRuns("auto-2", """{"runs":[$run]}""")
    }
    assertEquals("Queued", AutomationRepository.parseEvents(
      """{"events":[{"id":"event-1","message":"Queued","createdAtMs":1000}]}""").single().message)
  }
}
