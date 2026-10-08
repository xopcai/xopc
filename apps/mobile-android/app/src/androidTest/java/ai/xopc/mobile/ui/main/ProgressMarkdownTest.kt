package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ProgressTask
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test

class ProgressMarkdownTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  @Test fun taskDetailRendersBodyAsMarkdown() {
    val task = ProgressTask("task-1", "Write report", "## Summary\n\n**Complete** the report.",
      "open", null, 1000L, null, null)
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
}
