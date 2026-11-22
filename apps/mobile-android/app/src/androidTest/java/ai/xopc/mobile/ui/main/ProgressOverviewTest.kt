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

  @Test fun largeTextAttentionRemainsVisibleBelowTheHeader() {
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
              {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> }, {})
          }
        }
      }
    }
    saveScreenshot("progress-large-text")
    rule.onNodeWithTag("progress-pending-count").assertDoesNotExist()
    val header = rule.onNodeWithTag("progress-header").fetchSemanticsNode().boundsInRoot
    val attention = rule.onNodeWithTag("progress-item-pending-0").fetchSemanticsNode().boundsInRoot
    assertTrue("The attention item must appear below the fixed header", attention.top > header.bottom)
    rule.runOnIdle { fontScale.value = 1f }
    saveScreenshot("progress-overview")
  }

  @Test fun refreshingKeepsVisibleWorkAndScrollPosition() {
    val pending = List(30) { index -> ProgressItem("pending-$index", "Review result $index", "Ready", null, null,
      ProgressAction("Review", "/tasks/task-$index")) }
    val state = mutableStateOf(ProgressUiState(needsUser = pending))
    rule.setContent {
      XopcTheme { ProgressOverview(state.value, {}, {}, {}, {}, {}, {}, {}) }
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
    rule.onNodeWithTag("progress-overview-list").performScrollToNode(hasTestTag("progress-retry"))
    rule.onNodeWithTag("progress-retry").assertIsDisplayed()
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

  @Test fun scheduledWorkIsSeparatedAndDoesNotDuplicateUpcomingAutomation() {
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
          {}, {}, {}, { opened = it }, {}, {}, {})
      }
    }
    rule.onNodeWithTag("progress-overview-list").performScrollToNode(hasTestTag("progress-item-running"))
    val runningBounds = rule.onNodeWithTag("progress-item-running").fetchSemanticsNode().boundsInRoot
    rule.onNodeWithTag("progress-overview-list").performScrollToNode(hasTestTag("progress-item-scheduled"))
    val scheduledBounds = rule.onNodeWithTag("progress-item-scheduled").fetchSemanticsNode().boundsInRoot
    assertTrue(scheduledBounds.top > runningBounds.top)
    rule.onNodeWithTag("progress-upcoming-fallback").assertDoesNotExist()
    rule.onNodeWithTag("progress-item-scheduled").performClick()
    assertEquals("auto-1", opened)
    rule.onNodeWithTag("progress-overview-list").performScrollToNode(hasTestTag("progress-automations"))
    rule.onNodeWithTag("progress-workflows").assertDoesNotExist()
    rule.onNodeWithTag("progress-automations").assertIsDisplayed()
  }

  @Test fun deliveryAndUpcomingSectionsLinkToLibraryAndAutomations() {
    val clicked = mutableListOf<String>()
    val delivery = ProgressDelivery("delivery", "task", "task-1", "Delivered work", "Ready")
    val scheduled = ProgressItem("scheduled", "Scheduled brief", "Tomorrow", null, null,
      ProgressAction("Open automation", "/automations/auto-1"), kind = "scheduled")
    rule.setContent {
      XopcTheme {
        ProgressOverview(ProgressUiState(deliveries = listOf(delivery), background = listOf(scheduled)),
          {}, {}, { clicked += "automations" }, {}, {}, {}, {}, { clicked += "library" })
      }
    }
    rule.onNodeWithTag("progress-open-library").performClick()
    rule.onNodeWithTag("progress-automations").performClick()
    assertEquals(listOf("library", "automations"), clicked)
    rule.onNodeWithTag("progress-pending-count").assertDoesNotExist()
    rule.onNodeWithTag("progress-running-count").assertDoesNotExist()
  }
}
