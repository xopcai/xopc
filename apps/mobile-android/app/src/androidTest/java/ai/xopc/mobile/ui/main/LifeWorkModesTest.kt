package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.PersonalAgentRecord
import ai.xopc.mobile.theme.XopcTheme
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Rule
import org.junit.Test

class LifeWorkModesTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  @Test fun lifeHidesDockLocksAgentAndRestoresWorkChrome() {
    val agent = PersonalAgentRecord("personal", "personal-chat", "ready", "Ada", "loopi", null)
    val state = mutableStateOf(ConnectionUiState(
      profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
      selectedConversationId = "work-chat",
      personal = PersonalUiState(gatewayId = "gateway", agent = agent),
    ))
    rule.setContent {
      XopcTheme {
        MainContent(HomeTab.Assistant, {}, state.value, onSwitchLifeMode = { life ->
          state.value = state.value.copy(lifeMode = life,
            selectedConversationId = if (life) "personal-chat" else "work-chat")
        })
      }
    }
    rule.onNodeWithTag("main-tab-dock").assertIsDisplayed()
    rule.onNodeWithTag("home-mode-life").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("home-mode-life").assertIsSelected()
    rule.onNodeWithTag("main-tab-dock").assertDoesNotExist()
    rule.onNodeWithTag("chat-agent-switch").assertIsNotEnabled()
    rule.onNodeWithTag("chat-header-search").assertIsDisplayed()
    rule.onNodeWithTag("assistant-options").assertIsDisplayed()
    capture("life-mode")
    rule.onNodeWithTag("home-mode-work").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("home-mode-work").assertIsSelected()
    rule.onNodeWithTag("main-tab-dock").assertIsDisplayed()
    rule.onNodeWithTag("tab-Assistant").assertIsSelected()
    capture("work-mode")
  }

  @Test fun workRemainsAvailableWhilePersonalAgentIsOpening() {
    val state = mutableStateOf(true)
    rule.setContent {
      XopcTheme { SceneSwitch(false, state.value) { if (!it) state.value = false } }
    }
    rule.onNodeWithTag("home-mode-life").assertIsNotEnabled()
    rule.onNodeWithTag("home-mode-work").performClick()
    rule.onNodeWithTag("home-mode-life").assertIsEnabled()
  }

  private fun capture(name: String) {
    val directory = InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("scene-tests")!!
    File(directory, "$name.png").outputStream().use {
      rule.onNode(isRoot()).captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
    }
  }
}
