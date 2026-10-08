package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.XopcTheme
import ai.xopc.mobile.gateway.ProgressTask
import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import java.util.Locale
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasTestTag
import org.junit.Rule
import org.junit.Test

class ProgressMarkdownTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  @Test fun taskDetailRendersBodyAsMarkdown() {
    val task = ProgressTask("task-1", "Write report", "## Summary\n\n**Complete** the report.",
      "active", null, 1000L, null, null)
    val state = mutableStateOf(ProgressUiState(gatewayId = "markdown-test", tasks = listOf(task)))
    composeTestRule.setContent {
      ProgressScreen(state.value, PaddingValues(), {}, {}, {}, { id ->
        state.value = state.value.copy(detailTaskId = id, detailTask = task)
      }, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> }, {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-1").performClick()
    composeTestRule.onNodeWithTag("progress-task-body").assertExists()
    composeTestRule.onNodeWithTag("markdown-heading").assertTextEquals("Summary")
    composeTestRule.onNodeWithText("Complete the report.").assertExists()
  }

  @Test fun closedTaskUsesChineseResolutionAndPriorityInOverviewAndDetail() {
    val task = ProgressTask("task-closed", "整理报告", "报告内容", "closed", "done",
      1000L, 1000L, null, priority = "high")
    val state = mutableStateOf(ProgressUiState(gatewayId = "chinese-test", tasks = listOf(task),
      recentClosedTasks = listOf(task)))
    val configuration = Configuration(composeTestRule.activity.resources.configuration).apply {
      setLocale(Locale.SIMPLIFIED_CHINESE)
    }
    val context = composeTestRule.activity.createConfigurationContext(configuration)
    composeTestRule.setContent {
      CompositionLocalProvider(LocalContext provides context, LocalConfiguration provides configuration) {
        XopcTheme {
          ProgressScreen(state.value, PaddingValues(), {}, {}, {}, { id ->
            state.value = state.value.copy(detailTaskId = id, detailTask = task)
          }, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> }, {}, { _, _, _, _, _ -> }, {})
        }
      }
    }
    composeTestRule.onNodeWithTag("progress-overview-list").performScrollToNode(
      hasTestTag("progress-closed-task-closed"))
    composeTestRule.onNodeWithText("已完成").assertExists()
    composeTestRule.onNodeWithTag("progress-closed-task-closed").performClick()
    composeTestRule.onNodeWithText("优先级：高").performScrollTo().assertExists()
    composeTestRule.onNodeWithText("结果：已完成").performScrollTo().assertExists()
    composeTestRule.onNodeWithText("done").assertDoesNotExist()
    composeTestRule.onNodeWithText("high").assertDoesNotExist()
  }
}
