package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.ProgressAction
import ai.xopc.mobile.gateway.ProgressItem
import ai.xopc.mobile.gateway.ProgressTask
import ai.xopc.mobile.theme.XopcTheme
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
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
    val task = ProgressTask("header-task", "Header task", "", "ready", null, 0, null, null, version = 1, allowedCommands = listOf("close"))
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
              taskConversationTaskId = id, chatNavigationId = conversationId)
          },
          onChatNavigationHandled = { state.value = state.value.copy(chatNavigationId = null) })
      }
    }
    compose.onNodeWithTag("chat-header-sidebar").performClick()
    compose.onNodeWithTag("chat-sidebar-workbench").performClick()
    compose.onNodeWithTag("progress-item-header-task").performScrollTo().performClick()
    compose.runOnIdle { assertEquals(task.id, openedTask) }
    compose.onNodeWithTag("task-chat-header").assertIsDisplayed()
    compose.onNodeWithTag("assistant-composer-shell").assertIsDisplayed()
    compose.onNodeWithTag("task-chat-overview").assertDoesNotExist()
    compose.onNodeWithTag("task-chat-details-tip").performClick()
    compose.onNodeWithTag("task-chat-overview").assertIsDisplayed()
    compose.onNodeWithTag("task-chat-edit").assertIsDisplayed()
    compose.onNodeWithTag("task-chat-status").assertIsDisplayed()
    compose.onNodeWithTag("task-chat-edit").performClick()
    compose.onNodeWithTag("progress-task-editor").assertIsDisplayed()
    androidx.test.espresso.Espresso.pressBack()
    compose.onNodeWithTag("task-chat-overview").assertIsDisplayed()
    compose.onNodeWithTag("task-chat-details-close").performClick()
    compose.onNodeWithTag("task-chat-overview").assertDoesNotExist()
    compose.onNodeWithTag("assistant-composer-shell").assertIsDisplayed()
    compose.onNodeWithTag("task-chat-menu").performClick()
    compose.onNodeWithText(compose.activity.getString(R.string.progress_edit_task)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.progress_adjust_status)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.progress_cancel_task)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.assistant_options)).performClick()
    compose.onNodeWithTag("chat-options-panel").assertIsDisplayed()
    compose.onNodeWithTag("chat-options-close").performClick()
    compose.onNodeWithTag("task-chat-menu").performClick()
    compose.onNodeWithText(compose.activity.getString(R.string.chat_personal_search)).performClick()
  }
}
