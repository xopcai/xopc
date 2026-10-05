package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ConnectionWaitInfo
import ai.xopc.mobile.gateway.ConnectionWaitNeed
import ai.xopc.mobile.gateway.ConnectionWaitSnapshot
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals

class ConnectionWaitCardTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  @Test fun showsWaitSummaryAndDetailsWithoutSendingAnAction() {
    val need = ConnectionWaitNeed("calendar", "Calendar", "connect", "browser",
      listOf("read events"), "Permission needed")
    val state = ConnectionWaitUiState("gateway", "conversation", ConnectionWaitSnapshot("transcript", 2,
      ConnectionWaitInfo("wait-1", "conversation", 1, "needs_connection",
        "Connect calendar", listOf(need), "next week · Asia/Shanghai")))
    var retries = 0
    composeTestRule.setContent { ConnectionWaitCard(state) { retries++ } }
    composeTestRule.onNodeWithTag("connection-wait-card").assertExists()
    composeTestRule.onNodeWithText("Connect calendar").assertExists()
    composeTestRule.onNodeWithTag("connection-wait-details").performClick()
    composeTestRule.onNodeWithTag("connection-wait-need-calendar").assertExists()
    composeTestRule.runOnIdle { assertEquals(0, retries) }
  }

  @Test fun readyWaitDoesNotCoverTheConversation() {
    val state = ConnectionWaitUiState(snapshot = ConnectionWaitSnapshot("transcript", 3,
      ConnectionWaitInfo("wait-1", "conversation", 2, "ready", "Ready", emptyList(), null)))
    composeTestRule.setContent { ConnectionWaitCard(state) {} }
    composeTestRule.onNodeWithTag("connection-wait-card").assertDoesNotExist()
  }
}
