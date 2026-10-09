package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.*
import ai.xopc.mobile.theme.XopcTheme
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ProgressOverviewTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  @Test fun scheduledWorkIsSeparatedAndStatisticsJumpToRunningWork() {
    val pending = ProgressItem("pending", "Review the result", "Ready for review", null, null,
      ProgressAction("Review", "/tasks/task-1"))
    val running = ProgressItem("running", "Research in progress", "Working", "Running", null,
      ProgressAction("Open chat", "/chat/chat-1"))
    val scheduled = ProgressItem("scheduled", "Scheduled brief", "Tomorrow", null, null,
      ProgressAction("Open automation", "/automations/auto-1"), kind = "scheduled")
    var opened = ""
    rule.setContent {
      XopcTheme {
        ProgressOverview(ProgressUiState(needsUser = listOf(pending), background = listOf(scheduled, running),
          automationMetrics = AutomationMetrics(1, 1, 0, 0, AutomationMetricsNext("fallback", "Duplicate upcoming", 2000))),
          {}, {}, {}, {}, {}, { opened = it }, {}, {}, 0.dp)
      }
    }
    rule.onNode(hasText("1") and hasAnyAncestor(hasTestTag("progress-running-count")), useUnmergedTree = true).assertExists()
    rule.onNodeWithTag("progress-running-count").performClick()
    rule.onNodeWithTag("progress-item-running").assertIsDisplayed()
    val runningBounds = rule.onNodeWithTag("progress-item-running").fetchSemanticsNode().boundsInRoot
    rule.onNodeWithTag("progress-overview-list").performScrollToNode(hasTestTag("progress-item-scheduled"))
    val scheduledBounds = rule.onNodeWithTag("progress-item-scheduled").fetchSemanticsNode().boundsInRoot
    assertTrue(scheduledBounds.top > runningBounds.top)
    rule.onNodeWithTag("progress-upcoming-fallback").assertDoesNotExist()
    rule.onNodeWithTag("progress-item-scheduled").performClick()
    assertEquals("auto-1", opened)
    rule.onNodeWithTag("progress-overview-list").performScrollToIndex(0)
    rule.onNodeWithTag("progress-pending-count").performClick()
    rule.onNodeWithTag("progress-item-pending").assertIsDisplayed()
    rule.onNodeWithTag("progress-overview-list").performScrollToNode(hasTestTag("progress-automations"))
    rule.onNodeWithTag("progress-workflows").assertDoesNotExist()
    rule.onNodeWithTag("progress-automations").assertIsDisplayed()
  }

  @Test fun shortcutsShareCompactRowsAndEmptyStatisticsAreDisabled() {
    val clicked = mutableListOf<String>()
    rule.setContent {
      XopcTheme {
        ProgressOverview(ProgressUiState(), {}, {}, { clicked += "tasks" }, { clicked += "projects" },
          { clicked += "automations" }, {}, {}, {}, 0.dp)
      }
    }
    rule.onNodeWithTag("progress-pending-count").assertIsNotEnabled()
    rule.onNodeWithTag("progress-running-count").assertIsNotEnabled()
    rule.onNodeWithTag("progress-tasks").performClick()
    rule.onNodeWithTag("progress-projects").performClick()
    rule.onNodeWithTag("progress-automations").performClick()
    assertEquals(listOf("tasks", "projects", "automations"), clicked)
    val tasks = rule.onNodeWithTag("progress-tasks").fetchSemanticsNode().boundsInRoot
    val projects = rule.onNodeWithTag("progress-projects").fetchSemanticsNode().boundsInRoot
    assertEquals(tasks.center.y, projects.center.y, 1f)
    assertTrue(tasks.height <= 65 * rule.density.density)
  }
}
