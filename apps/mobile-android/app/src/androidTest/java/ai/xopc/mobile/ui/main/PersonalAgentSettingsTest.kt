package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.PersonalAgentRecord
import ai.xopc.mobile.gateway.PersonalProactivitySettings
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

class PersonalAgentSettingsTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun chatSettingsSaveUsesPersonalProfileAndClosesAfterSuccess() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val agent = PersonalAgentRecord("personal", id, "ready", "Ada", "loopi", null,
      revision = 7, preferences = mapOf("warmth" to "gentle", "guidance" to "Keep context"), userCallName = "Joyce")
    val state = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id,
      personal = PersonalUiState(gatewayId = "gateway", agent = agent)))
    var savedName = ""
    var savedPreferences = emptyMap<String, String>()
    val outreach = PersonalProactivitySettings(3, "balanced", "Asia/Shanghai", 22, 8, 4, 20)
    compose.setContent {
      XopcTheme {
        MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = state.value,
          onLoadPersonalProactivity = { outreach }, onSavePersonalProactivity = { it },
          onUpdatePersonalAgentProfile = { name, _, preferences, _ ->
            savedName = name; savedPreferences = preferences
            state.value = state.value.copy(personal = state.value.personal.copy(
              agent = agent.copy(revision = 8), agentProfileSavedRevision = 1))
          })
      }
    }
    compose.onNodeWithTag("chat-header-search").assertIsDisplayed()
    compose.onNodeWithTag("assistant-options").performClick()
    compose.onNodeWithTag("personal-agent-profile-sheet").assertIsDisplayed()
    compose.onNodeWithTag("personal-agent-profile-save").performScrollTo().performClick()
    compose.waitForIdle()
    compose.runOnIdle {
      assertEquals("Ada", savedName)
      assertEquals("Joyce", savedPreferences["addressAs"])
      assertEquals("gentle", savedPreferences["warmth"])
      assertEquals("Keep context", savedPreferences["guidance"])
    }
    compose.onNodeWithTag("personal-agent-profile-sheet").assertDoesNotExist()
  }
}
