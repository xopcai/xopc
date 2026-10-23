package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.ProgressAction
import ai.xopc.mobile.gateway.ProgressItem
import ai.xopc.mobile.gateway.ProgressTask
import ai.xopc.mobile.theme.XopcTheme
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TaskChatHeaderTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun taskConversationKeepsSearchAndSettingsAccessible() {
    val task = ProgressTask("header-task", "Header task", "", "ready", null, 0, null, null)
    val conversationId = "11111111-2222-4333-8444-555555555555"
    val state = mutableStateOf(ConnectionUiState(
      profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
      progress = ProgressUiState(gatewayId = "gateway", needsUser = listOf(
        ProgressItem("header-task", task.title, "Ready", null, null,
          ProgressAction("Open task", "/tasks/header-task"))))))
    var openedTask = ""
    compose.setContent {
      XopcTheme {
        MainScreen(connection = state.value,
          onOpenProgressTask = { id -> state.value = state.value.copy(progress = state.value.progress.copy(
            detailTaskId = id, detailTask = task)) },
          onOpenTaskChat = { id ->
            openedTask = id
            state.value = state.value.copy(selectedConversationId = conversationId,
              taskConversationTaskId = id, quickOpenedConversationId = conversationId)
          },
          onQuickNavigationHandled = { state.value = state.value.copy(quickOpenedConversationId = null) })
      }
    }
    compose.onNodeWithTag("tab-Progress").performClick()
    compose.onNodeWithTag("progress-item-header-task").performScrollTo().performClick()
    compose.onNodeWithTag("progress-task-chat").assertIsDisplayed().performClick()
    compose.runOnIdle { assertEquals(task.id, openedTask) }
    compose.onNodeWithTag("chat-floating-header").assertIsDisplayed()
    compose.onNodeWithTag("chat-header-search").assertIsDisplayed()
    compose.onNodeWithTag("assistant-options").assertIsDisplayed().performClick()
    compose.onNodeWithTag("chat-options-panel").assertIsDisplayed()
    compose.onNodeWithTag("chat-options-close").performClick()
    compose.onNodeWithTag("chat-header-search").assertIsDisplayed()
  }
}
