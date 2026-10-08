package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.AutomationRunEvent
import ai.xopc.mobile.gateway.AutomationRunSummary
import ai.xopc.mobile.gateway.AutomationSummary
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AutomationScreensTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  private val enabled = AutomationSummary("auto-1", "Morning brief", "Daily summary", true,
    "schedule", "0 9 * * *", "Summarize my day", null, 1000L, null, null, null, 123L)
  private val paused = AutomationSummary("auto-2", "Weekly review", "", false,
    "manual", "", "Review the week", null, null, null, null, null)
  private val run = AutomationRunSummary("run-1", "auto-1", "Morning brief", "succeeded",
    "Done", null, "chat-1", null, 1000L, 1100L, 100L)

  @Test fun automationListFiltersAndOpensDetail() {
    var opened = ""
    composeTestRule.setContent {
      AutomationListContent(AutomationUiState(items = listOf(enabled, paused)), "gateway-1", {}, { opened = it })
    }
    composeTestRule.onNodeWithTag("automation-filter-paused").performClick()
    composeTestRule.onNodeWithTag("automation-auto-1").assertDoesNotExist()
    composeTestRule.onNodeWithTag("automation-auto-2").performClick()
    assertEquals("auto-2", opened)
    composeTestRule.onNodeWithTag("automation-filter-all").performClick()
    composeTestRule.onNodeWithTag("automation-search").performTextInput("Morning")
    composeTestRule.onNodeWithTag("automation-refresh").performClick()
    composeTestRule.onNodeWithTag("automation-auto-1").assertExists()
    composeTestRule.onNodeWithTag("automation-auto-2").assertDoesNotExist()
  }

  @Test fun automationCreateRequiresFieldsAndKeepsFailureVisible() {
    var name by mutableStateOf("")
    var instruction by mutableStateOf("")
    var saved = 0
    composeTestRule.setContent {
      AutomationCreateContent(name, { name = it }, instruction, { instruction = it },
        "0 9 * * *", {}, false, true) { saved++ }
    }
    composeTestRule.onNodeWithTag("automation-create-error").assertExists()
    composeTestRule.onNodeWithTag("automation-create-save").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("automation-create-name").performTextInput("Morning")
    composeTestRule.onNodeWithTag("automation-create-instruction").performTextInput("Summarize")
    composeTestRule.onNodeWithTag("automation-create-save").performClick()
    assertEquals(1, saved)
  }

  @Test fun automationEditRequiresChangeAndShowsManagedScheduleRestriction() {
    val managed = enabled.copy(canEditSchedule = true, canEditDetails = false)
    var cron by mutableStateOf(managed.schedule)
    var saved = 0
    composeTestRule.setContent {
      AutomationEditContent(managed, managed.name, {}, managed.instruction, {}, cron,
        { cron = it }, false, true) { saved++ }
    }
    composeTestRule.onNodeWithTag("automation-edit-error").assertExists()
    composeTestRule.onNodeWithTag("automation-edit-save").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("automation-edit-cron").performTextInput(" 1")
    composeTestRule.onNodeWithTag("automation-edit-save").performClick()
    assertEquals(1, saved)
  }

  @Test fun automationDeleteRequiresConfirmationAndPermission() {
    val deletable = enabled.copy(canEditDetails = true, canEditSchedule = true, canDelete = true)
    var edits = 0
    var deletions = 0
    composeTestRule.setContent {
      AutomationDetailContent(AutomationUiState(selectedId = deletable.id, detail = deletable),
        {}, {}, {}, { edits++ }, { deletions++ })
    }
    composeTestRule.onNodeWithTag("automation-edit").performClick()
    assertEquals(1, edits)
    composeTestRule.onNodeWithTag("automation-delete").performClick()
    assertEquals(0, deletions)
    composeTestRule.onNodeWithTag("automation-delete-confirm").performClick()
    assertEquals(1, deletions)
  }

  @Test fun automationDetailShowsInstructionAndOpensRun() {
    var openedRun = ""
    composeTestRule.setContent {
      AutomationDetailContent(AutomationUiState(selectedId = "auto-1", detail = enabled.copy(instruction = "**Summarize** my day"),
        runs = listOf(run)), {}, { openedRun = it })
    }
    composeTestRule.onNodeWithText("Summarize my day", substring = true).assertExists()
    composeTestRule.onNodeWithTag("automation-run-run-1").performClick()
    assertEquals("run-1", openedRun)
  }

  @Test fun automationRunTimelineRoutesToConversationAndDefinition() {
    var openedChat = ""
    var openedAutomation = ""
    composeTestRule.setContent {
      AutomationRunContent(AutomationUiState(selectedRunId = "run-1", run = run,
        events = listOf(AutomationRunEvent("event-1", "Queued", 1000L))),
        {}, { openedChat = it }, { openedAutomation = it })
    }
    composeTestRule.onNodeWithText("Queued").assertExists()
    composeTestRule.onNodeWithTag("automation-open-chat").performClick()
    assertEquals("chat-1", openedChat)
    composeTestRule.onNodeWithTag("automation-view-definition").performClick()
    assertEquals("auto-1", openedAutomation)
  }

  @Test fun automationRunSummaryRendersMarkdownLikeHarmony() {
    composeTestRule.setContent {
      AutomationRunContent(AutomationUiState(selectedRunId = "run-1",
        run = run.copy(summary = "## Result\n\n**Done**")), {}, {}, {})
    }
    composeTestRule.onNodeWithTag("automation-run-summary").assertExists()
    composeTestRule.onNodeWithTag("markdown-heading").assertTextEquals("Result")
    composeTestRule.onNodeWithText("Done").assertExists()
  }

  @Test fun activeAutomationRunRequiresConfirmationToCancel() {
    val state = mutableStateOf(AutomationUiState(selectedRunId = "run-1",
      run = run.copy(status = "running")))
    val actions = mutableListOf<String>()
    composeTestRule.setContent {
      AutomationRunContent(state.value, {}, {}, {}, { actions += it })
    }
    composeTestRule.onNodeWithTag("automation-cancel-run").performClick()
    assertEquals(emptyList<String>(), actions)
    composeTestRule.onNodeWithTag("automation-cancel-confirm").performClick()
    assertEquals(listOf("cancel"), actions)
    state.value = state.value.copy(runActionBusy = true, runActionError = true)
    composeTestRule.onNodeWithTag("automation-cancel-run").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("automation-run-action-error").assertExists()
  }

  @Test fun failedAutomationRunCanRerunWithoutCancelControl() {
    var action = ""
    composeTestRule.setContent {
      AutomationRunContent(AutomationUiState(selectedRunId = "run-1", run = run.copy(status = "failed")),
        {}, {}, {}, { action = it })
    }
    composeTestRule.onNodeWithTag("automation-cancel-run").assertDoesNotExist()
    composeTestRule.onNodeWithTag("automation-rerun").performClick()
    assertEquals("rerun", action)
  }

  @Test fun automationRunRequiresConfirmationAndPauseReportsBusyError() {
    val state = mutableStateOf(AutomationUiState(selectedId = "auto-1", detail = enabled))
    val actions = mutableListOf<String>()
    composeTestRule.setContent {
      AutomationDetailContent(state.value, {}, {}, { actions += it })
    }
    composeTestRule.onNodeWithTag("automation-run-now").performClick()
    assertEquals(emptyList<String>(), actions)
    composeTestRule.onNodeWithTag("automation-run-confirm").performClick()
    assertEquals(listOf("run"), actions)
    composeTestRule.onNodeWithTag("automation-toggle").performClick()
    assertEquals(listOf("run", "pause"), actions)
    state.value = state.value.copy(actionBusy = true, actionError = true)
    composeTestRule.onNodeWithTag("automation-run-now").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("automation-toggle").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("automation-action-error").assertExists()
  }
}
