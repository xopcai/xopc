package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConversationModel
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.ModelSelection
import ai.xopc.mobile.gateway.PersonalVoiceOption
import ai.xopc.mobile.gateway.PersonalVoiceChoices
import ai.xopc.mobile.gateway.PersonalAgentRecord
import ai.xopc.mobile.gateway.PersonalProactivitySettings
import ai.xopc.mobile.theme.XopcTheme
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

class PersonalAgentSettingsTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun chatSettingsSaveCallModeAndKeepSettingsOpen() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val agent = PersonalAgentRecord("personal", id, "ready", "Ada", "loopi", null,
      revision = 7, userCallName = "Joyce")
    val state = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id,
      personal = PersonalUiState(gatewayId = "gateway", agent = agent)))
    var savedName = ""
    var savedMode = ""
    val outreach = PersonalProactivitySettings(3, "balanced", "Asia/Shanghai", 22, 8, 4, 20)
    compose.setContent {
      XopcTheme {
        MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = state.value,
          onLoadPersonalProactivity = { outreach }, onSavePersonalProactivity = { it },
          onUpdatePersonalAgentProfile = { name, _, _, _, mode ->
            savedMode = mode
            savedName = name
            state.value = state.value.copy(personal = state.value.personal.copy(
              agent = agent.copy(revision = 8, callEngine = mode)))
          })
      }
    }
    compose.onNodeWithTag("chat-header-voice-call").assertIsDisplayed()
    compose.onNodeWithTag("assistant-options").performClick()
    compose.onNodeWithTag("personal-agent-profile-sheet").assertIsDisplayed()
    compose.onNodeWithText(compose.activity.getString(R.string.personal_agent_address)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.personal_agent_humor)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.personal_agent_detail)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.chat_personal_timezone)).assertDoesNotExist()
    compose.onNodeWithText(compose.activity.getString(R.string.personal_agent_voice_unavailable)).assertDoesNotExist()
    compose.onNodeWithTag("personal-setting-call-mode").performScrollTo().performClick()
    compose.onNodeWithTag("personal-call-mode-natural").performClick()
    compose.onNodeWithTag("personal-setting-voice-details").assertDoesNotExist()
    compose.onNodeWithTag("personal-agent-profile-save").assertDoesNotExist()
    compose.waitForIdle()
    compose.runOnIdle {
      assertEquals("Ada", savedName)
      assertEquals("natural", savedMode)
    }
    compose.onNodeWithTag("personal-agent-profile-sheet").assertIsDisplayed()
  }

  @Test fun settingsSaveModelForThePersonalConversation() {
    val id = "11111111-2222-3333-4444-555555555555"
    val agent = PersonalAgentRecord("personal", id, "ready", "Ada", "loopi", null, revision = 7)
    val models = listOf(ConversationModel("test/one", "Model A", "off"),
      ConversationModel("test/two", "Model B", "low", "levels", listOf("low", "high")))
    val savedVersions = mutableListOf<Long?>()
    compose.setContent {
      XopcTheme {
        PersonalAgentProfileSheet(PersonalUiState(gatewayId = "gateway", agent = agent), {}, {},
          { _, _, _, _, _ -> }, {},
          onLoadModel = { gateway, conversation ->
            assertEquals("gateway", gateway)
            assertEquals(id, conversation)
            ModelSelection(models, "test/one", 7)
          },
          onSaveModel = { _, conversation, model, version ->
            assertEquals(id, conversation)
            savedVersions.add(version)
            ModelSelection(emptyList(), "test/two", requireNotNull(version) + 1, model.initialThinkingLevel)
          })
      }
    }
    compose.onNodeWithTag("personal-setting-model").performScrollTo().performClick()
    compose.onNodeWithTag("personal-model-test/two").performClick()
    compose.onNodeWithTag("personal-setting-thinking").assertDoesNotExist()
    compose.onNodeWithTag("personal-setting-model").performScrollTo().assertIsDisplayed()
    compose.runOnIdle { assertEquals(listOf(7L), savedVersions) }
  }

  @Test fun profileSettingsShowCustomNameAndSaveVoice() {
    val agent = PersonalAgentRecord("personal", "11111111-2222-3333-4444-555555555555",
      "ready", "My ADA", "loopi", null, revision = 7)
    val state = mutableStateOf(PersonalUiState(gatewayId = "gateway", agent = agent,
      agentVoiceChoices = PersonalVoiceChoices("xopc-cloud", "tts", listOf(
        PersonalVoiceOption("default", "Default voice"), PersonalVoiceOption("voice-warm", "Warm voice")))))
    var dismissed = false
    var savedVoice: String? = null
    compose.setContent {
      XopcTheme {
        PersonalAgentProfileSheet(state.value, { dismissed = true }, {}, { _, _, voice, _, _ ->
          savedVoice = voice
          state.value = state.value.copy(agent = agent.copy(revision = 8))
        }, {})
      }
    }
    compose.onNodeWithText("My ADA").assertIsDisplayed()
    compose.onNodeWithTag("personal-outreach-options").assertDoesNotExist()
    compose.onNodeWithTag("personal-setting-voice-details").performScrollTo().performClick()
    compose.onNodeWithText(compose.activity.getString(R.string.personal_agent_voice) + " · " +
      compose.activity.getString(R.string.personal_agent_default_voice)).performScrollTo().performClick()
    compose.onNodeWithText("Warm voice").performClick()
    compose.onNodeWithTag("personal-agent-profile-save").assertDoesNotExist()
    compose.waitForIdle()
    compose.runOnIdle {
      assertEquals("voice-warm", savedVoice)
      assertEquals(false, dismissed)
    }
  }
}
