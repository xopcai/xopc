package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.*
import ai.xopc.mobile.theme.XopcTheme
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import android.graphics.Bitmap
import android.content.ContentValues
import android.provider.MediaStore
import android.content.res.Configuration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ProgressOverviewTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  @Test fun largeTextStatisticsRemainVisibleBelowTheHeader() {
    val pending = List(7) { index -> ProgressItem("pending-$index", "审阅调研结果 $index", "调研已完成，确认后推进下一步。", null, null,
      ProgressAction("查看任务", "/tasks/task-$index")) }
    val configuration = Configuration(rule.activity.resources.configuration).apply { setLocale(Locale.SIMPLIFIED_CHINESE) }
    val context = rule.activity.createConfigurationContext(configuration)
    val fontScale = mutableStateOf(2f)
    rule.setContent {
      val density = LocalDensity.current
      CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale.value),
        LocalContext provides context, LocalConfiguration provides configuration) {
        XopcTheme {
          Surface(color = MaterialTheme.colorScheme.background) {
            ProgressScreen(ProgressUiState(needsUser = pending), PaddingValues(top = 24.dp),
              {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> }, {}, { _, _, _, _, _ -> }, {},
              bottomChromeHeight = 140.dp)
          }
        }
      }
    }
    saveScreenshot("progress-large-text")
    listOf("progress-pending-count" to ai.xopc.mobile.R.string.progress_action_required,
      "progress-running-count" to ai.xopc.mobile.R.string.progress_ongoing).forEach { (tag, label) ->
      val text = rule.onNode(hasText(context.getString(label)) and hasAnyAncestor(hasTestTag(tag)),
        useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
      assertTrue("The statistic label must not be clipped at 200% font size", text.height >= 26 * rule.density.density)
    }
    rule.onNodeWithText("需要你处理的事，以及正在推进的工作。").assertDoesNotExist()
    val header = rule.onNodeWithTag("progress-header").fetchSemanticsNode().boundsInRoot
    val statistics = rule.onNodeWithTag("progress-pending-count").fetchSemanticsNode().boundsInRoot
    assertTrue("The statistics need clear space below the fixed header", statistics.top > header.bottom)
    rule.runOnIdle { fontScale.value = 1f }
    saveScreenshot("progress-overview")
  }

  @Test fun refreshingKeepsVisibleWorkAndScrollPosition() {
    val pending = List(30) { index -> ProgressItem("pending-$index", "Review result $index", "Ready", null, null,
      ProgressAction("Review", "/tasks/task-$index")) }
    val state = mutableStateOf(ProgressUiState(needsUser = pending))
    rule.setContent {
      XopcTheme { ProgressOverview(state.value, {}, {}, {}, {}, {}, {}, {}, {}, 0.dp) }
    }
    rule.onNodeWithTag("progress-overview-list").performScrollToNode(hasTestTag("progress-item-pending-20"))
    val before = rule.onNodeWithTag("progress-item-pending-20").fetchSemanticsNode().boundsInRoot.top
    rule.runOnIdle { state.value = state.value.copy(homeLoading = true) }
    rule.onNodeWithTag("progress-loading").assertDoesNotExist()
    rule.onNodeWithTag("progress-item-pending-20").assertIsDisplayed()
    assertEquals(before, rule.onNodeWithTag("progress-item-pending-20").fetchSemanticsNode().boundsInRoot.top, 1f)
    rule.runOnIdle { state.value = state.value.copy(homeLoading = false, homeError = true) }
    rule.onNodeWithTag("progress-item-pending-20").assertIsDisplayed()
    assertEquals(before, rule.onNodeWithTag("progress-item-pending-20").fetchSemanticsNode().boundsInRoot.top, 1f)
    rule.onNodeWithTag("progress-overview-list").performTouchInput { swipeUp() }
    rule.onNodeWithTag("progress-overview-list").performScrollToNode(hasTestTag("progress-tasks"))
    rule.onNodeWithTag("progress-tasks").assertIsDisplayed()
  }

  private fun saveScreenshot(name: String) {
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, "$name.png")
      put(MediaStore.Images.Media.MIME_TYPE, "image/png")
      put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/xopc-test")
    }
    val resolver = rule.activity.contentResolver
    val uri = requireNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
    resolver.openOutputStream(uri)!!.use {
      rule.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
    }
  }

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
