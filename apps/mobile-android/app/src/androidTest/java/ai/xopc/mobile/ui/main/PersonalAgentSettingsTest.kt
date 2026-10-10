package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.PersonalAgentRecord
import ai.xopc.mobile.gateway.PersonalProactivitySettings
import ai.xopc.mobile.theme.XopcTheme
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

class PersonalAgentSettingsTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun chatSettingsSaveUsesPersonalProfileAndClosesAfterSuccess() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val agent = PersonalAgentRecord("personal", id, "ready", "Ada", "loopi", null,
      revision = 7, preferences = mapOf("warmth" to "gentle", "guidance" to "Keep context", "humor" to "playful", "supportMode" to "listen"), userCallName = "Joyce")
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
    compose.onNodeWithText(compose.activity.getString(R.string.personal_agent_humor)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.chat_personal_timezone)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.chat_personal_model_thinking)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.personal_agent_voice_unavailable)).assertDoesNotExist()
    compose.onNodeWithTag("personal-agent-profile-save").assertIsDisplayed().performClick()
    compose.waitForIdle()
    compose.runOnIdle {
      assertEquals("Ada", savedName)
      assertEquals("Joyce", savedPreferences["addressAs"])
      assertEquals("gentle", savedPreferences["warmth"])
      assertEquals("Keep context", savedPreferences["guidance"])
      assertEquals("playful", savedPreferences["humor"])
      assertEquals("listen", savedPreferences["supportMode"])
      assertNull(savedPreferences["proactivity"])
    }
    compose.onNodeWithTag("personal-agent-profile-sheet").assertDoesNotExist()
  }

  @Test fun unifiedSavePreservesAdvancedOutreachSettingsAndRetriesFailure() {
    val agent = PersonalAgentRecord("personal", "11111111-2222-3333-4444-555555555555",
      "ready", "Ada", "loopi", null, revision = 7)
    val outreach = PersonalProactivitySettings(3, "balanced", "Asia/Shanghai", 23, 7, 4, 20)
    val state = mutableStateOf(PersonalUiState(gatewayId = "gateway", agent = agent))
    var savedOutreach: PersonalProactivitySettings? = null
    var profileWrites = 0
    var outreachWrites = 0
    var dismissed = false
    compose.setContent {
      XopcTheme {
        PersonalAgentProfileSheet(state.value, { dismissed = true }, {}, { _, _, _, _ ->
          profileWrites++
          state.value = state.value.copy(agentProfileSavedRevision = 1)
        }, { outreach }, { settings ->
          outreachWrites++
          if (outreachWrites == 1) error("Temporary failure")
          savedOutreach = settings
          settings.copy(revision = 4)
        }, {})
      }
    }
    compose.onNodeWithText(compose.activity.getString(R.string.chat_personal_outreach_off))
      .performScrollTo().performClick()
    compose.onNodeWithTag("personal-agent-profile-save").assertIsDisplayed().performClick()
    compose.waitForIdle()
    compose.onNodeWithText(compose.activity.getString(R.string.personal_agent_outreach_save_error)).assertIsDisplayed()
    compose.runOnIdle {
      assertEquals(0, profileWrites)
      assertEquals(false, dismissed)
    }
    compose.onNodeWithTag("personal-agent-profile-save").performClick()
    compose.waitForIdle()
    compose.runOnIdle {
      assertEquals(outreach.copy(mode = "off"), savedOutreach)
      assertEquals(1, profileWrites)
      assertEquals(true, dismissed)
    }
  }
}
