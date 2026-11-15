package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ProgressProject
import ai.xopc.mobile.gateway.ProgressProjectSession
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test

class ProgressProjectFilterTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  @Test fun selectedIndicatorSlidesAndRetargetsWithoutJumping() {
    val selection = mutableStateOf("first")
    composeTestRule.setContent {
      SegmentedTabs(listOf(
        SegmentOption("first", "First", "segment-first"),
        SegmentOption("second", "Second", "segment-second"),
        SegmentOption("third", "Third", "segment-third"),
      ), selection.value, { selection.value = it })
    }
    val indicator = composeTestRule.onNodeWithTag("segmented-tab-indicator", useUnmergedTree = true)
    val first = composeTestRule.onNodeWithTag("segment-first")
    val second = composeTestRule.onNodeWithTag("segment-second")
    val third = composeTestRule.onNodeWithTag("segment-third")
    val start = indicator.fetchSemanticsNode().boundsInRoot.left
    val end = third.fetchSemanticsNode().boundsInRoot.left
    composeTestRule.mainClock.autoAdvance = false
    try {
      third.performSemanticsAction(SemanticsActions.OnClick)
      composeTestRule.mainClock.advanceTimeBy(96)
      val moving = indicator.fetchSemanticsNode().boundsInRoot.left
      check(moving > start && moving < end)
      third.assertIsSelected()
      second.performSemanticsAction(SemanticsActions.OnClick)
      composeTestRule.mainClock.advanceTimeBy(320)
      val settled = indicator.fetchSemanticsNode().boundsInRoot.left
      check(kotlin.math.abs(settled - second.fetchSemanticsNode().boundsInRoot.left) <= 1f)
      second.assertIsSelected()
      check(first.fetchSemanticsNode().boundsInRoot.left == start)
    } finally {
      composeTestRule.mainClock.autoAdvance = true
    }
  }

  @Test fun projectStatusFilterCombinesWithSearchAndKeepsNavigation() {
    val projects = listOf(
      ProgressProject("active-1", "Alpha", "Alpha project brief", "active", ""),
      ProgressProject("paused-1", "Beta", "", "paused", ""),
      ProgressProject("archived-1", "Gamma", "", "archived", ""))
    val state = mutableStateOf(ProgressUiState(gatewayId = "test-gateway", projects = projects))
    var opened = ""
    composeTestRule.setContent {
      ProgressScreen(state.value, PaddingValues(),
        {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { id ->
          opened = id
          state.value = state.value.copy(projectId = id, project = projects.first { it.id == id })
        }, { _, _, _ -> }, {},
        { _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-projects").performClick()
    composeTestRule.onNodeWithTag("progress-project-filter-all").assertIsSelected()
    composeTestRule.onNodeWithTag("progress-project-active-1").assertExists()
    composeTestRule.onNodeWithTag("progress-project-archived-1").assertExists()
    composeTestRule.onNodeWithTag("progress-project-status-active-1", useUnmergedTree = true).assertTextEquals(
      composeTestRule.activity.getString(R.string.progress_project_status_active))
    composeTestRule.onNodeWithTag("progress-project-status-paused-1", useUnmergedTree = true).assertTextEquals(
      composeTestRule.activity.getString(R.string.progress_project_status_paused))
    composeTestRule.onNodeWithTag("progress-project-status-archived-1", useUnmergedTree = true).assertTextEquals(
      composeTestRule.activity.getString(R.string.progress_project_status_archived))

    composeTestRule.onNodeWithTag("progress-project-filter-active").performClick()
    composeTestRule.onNodeWithTag("progress-project-active-1").assertExists()
    composeTestRule.onNodeWithTag("progress-project-paused-1").assertExists()
    composeTestRule.onNodeWithTag("progress-project-archived-1").assertDoesNotExist()

    composeTestRule.onNodeWithTag("progress-project-filter-archived").performClick()
    composeTestRule.onNodeWithTag("progress-project-active-1").assertDoesNotExist()
    composeTestRule.onNodeWithTag("progress-project-archived-1").assertExists()
    composeTestRule.onNodeWithTag("progress-project-search").assertDoesNotExist()
    composeTestRule.onNodeWithTag("projects-open-search").performClick()
    composeTestRule.onNodeWithTag("progress-project-search").performTextInput("Alpha")
    composeTestRule.onNodeWithTag("progress-project-archived-1").assertDoesNotExist()
    composeTestRule.onNodeWithTag("projects-open-search-close").performClick()
    composeTestRule.onNodeWithTag("progress-project-search").assertDoesNotExist()
    composeTestRule.onNodeWithTag("progress-project-archived-1").assertExists()
    composeTestRule.onNodeWithTag("progress-project-filter-all").performClick()
    composeTestRule.onNodeWithTag("progress-project-active-1").performClick()
    composeTestRule.runOnIdle { check(opened == "active-1") }
    composeTestRule.onAllNodesWithText("Alpha").assertCountEquals(1)
    composeTestRule.onNodeWithText("Alpha project brief").assertExists()
    composeTestRule.onNodeWithTag("progress-project-detail-status").assertTextEquals(
      composeTestRule.activity.getString(R.string.progress_project_status_active))
  }

  @Test fun projectConversationSectionOpensExistingSession() {
    val project = ProgressProject("project-1", "Alpha", "", "active", "")
    val sessionId = "11111111-1111-4111-8111-111111111111"
    val state = mutableStateOf(ProgressUiState(gatewayId = "test-gateway", projects = listOf(project),
      projectSessions = listOf(ProgressProjectSession(sessionId, "Planning", 4))))
    var openedChat = ""
    composeTestRule.setContent {
      ProgressScreen(state.value, PaddingValues(),
        {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { id ->
          state.value = state.value.copy(projectId = id, project = project)
        }, { _, _, _ -> }, {}, { _, _, _ -> },
        onOpenChat = { openedChat = it })
    }
    composeTestRule.onNodeWithTag("progress-projects").performClick()
    composeTestRule.onNodeWithTag("progress-project-project-1").performClick()
    composeTestRule.onNodeWithTag("progress-project-tab-sessions").performClick()
    composeTestRule.onNodeWithTag("progress-project-session-$sessionId").performClick()
    composeTestRule.runOnIdle { check(openedChat == sessionId) }
    composeTestRule.onNodeWithTag("progress-project-tab-tasks").performClick()
    composeTestRule.onNodeWithTag("progress-project-session-$sessionId").assertDoesNotExist()
  }

  @Test fun projectNewChatKeepsProjectIdentityInCallback() {
    val project = ProgressProject("project-1", "Alpha", "", "active", "")
    val state = mutableStateOf(ProgressUiState(gatewayId = "test-gateway", projects = listOf(project)))
    var createdFor = ""
    composeTestRule.setContent {
      ProgressScreen(state.value, PaddingValues(),
        {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { id ->
          state.value = state.value.copy(projectId = id, project = project)
        }, { _, _, _ -> }, {}, { _, _, _ -> }, {},
        onCreateProjectChat = { createdFor = it })
    }
    composeTestRule.onNodeWithTag("progress-projects").performClick()
    composeTestRule.onNodeWithTag("progress-project-project-1").performClick()
    composeTestRule.onNodeWithTag("progress-project-tab-sessions").performClick()
    composeTestRule.onNodeWithTag("progress-project-new-chat").performClick()
    composeTestRule.runOnIdle { check(createdFor == "project-1") }
  }

  @Test fun projectNewChatCannotBeRepeatedWhileCreationIsBusy() {
    val project = ProgressProject("project-1", "Alpha", "", "active", "")
    val state = mutableStateOf(ProgressUiState(gatewayId = "test-gateway", projects = listOf(project)))
    val busy = mutableStateOf(false)
    var requests = 0
    composeTestRule.setContent {
      ProgressScreen(state.value, PaddingValues(),
        {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { id ->
          state.value = state.value.copy(projectId = id, project = project)
        }, { _, _, _ -> }, {}, { _, _, _ -> }, {},
        onCreateProjectChat = { requests++ }, chatBusy = busy.value)
    }
    composeTestRule.onNodeWithTag("progress-projects").performClick()
    composeTestRule.onNodeWithTag("progress-project-project-1").performClick()
    composeTestRule.onNodeWithTag("progress-project-new-chat").performClick()
    composeTestRule.runOnIdle { busy.value = true }
    composeTestRule.onNodeWithTag("progress-project-new-chat").assertIsNotEnabled()
    composeTestRule.runOnIdle { check(requests == 1); busy.value = false }
    composeTestRule.onNodeWithTag("progress-project-new-chat").assertIsEnabled()
  }
}
