package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.PersonalAssertion
import ai.xopc.mobile.gateway.PersonalCounts
import ai.xopc.mobile.gateway.PersonalSummary
import ai.xopc.mobile.gateway.PersonalProfile
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.performScrollTo
import androidx.compose.runtime.mutableStateOf
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AboutYouScreenTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  @Test fun understandingListLoadsSelectedFilterAndOpensDetail() {
    val assertion = PersonalAssertion("a-1", "Prefers concise answers", "user_explicit",
      status = "needs_review", scope = "global", confidence = 0.9,
      sources = listOf("Project chat"))
    val summary = PersonalSummary("Mia", "Designer", PersonalCounts(1, 1, 0, 1, 0), "", "",
      emptyList(), listOf(assertion), emptyList())
    var filter = ""
    var opened = ""
    rule.setContent {
      AboutYouScreen(PersonalUiState("gateway", summary, assertions = listOf(assertion)),
        "about", PaddingValues(), "understanding", onBack = {}, onOpenList = {},
        onOpenDetail = { opened = it }, onLoadList = { next, _, _ -> filter = next },
        onRetryDetail = {}, onOpenNotes = {})
    }
    rule.waitForIdle()
    assertEquals("all", filter)
    rule.onNodeWithTag("assertion-a-1").performClick()
    assertEquals("a-1", opened)
  }

  @Test fun detailShowsGatewayPublicMetadataWithoutMutationControls() {
    val assertion = PersonalAssertion("a-1", "Prefers concise answers", "user_explicit",
      scope = "global", confidence = 0.9, sources = listOf("Project chat"))
    rule.setContent {
      AboutYouScreen(PersonalUiState("gateway", selectedAssertionId = "a-1",
        selectedAssertion = assertion), "detail", PaddingValues(), "overview",
        onBack = {}, onOpenList = {}, onOpenDetail = {}, onLoadList = { _, _, _ -> },
        onRetryDetail = {}, onOpenNotes = {})
    }
    rule.onNodeWithTag("about-you-detail-statement").assertExists()
    rule.onNodeWithText("Project chat").assertExists()
    rule.onNodeWithText("90%").assertExists()
  }

  @Test fun profileEditorValidatesTimezoneAndClosesAfterConfirmedRevision() {
    val summary = PersonalSummary("Mia", "Designer", PersonalCounts(0, 0, 0, 0, 0),
      "", "", emptyList(), emptyList(), emptyList(),
      profile = PersonalProfile("Mia", "Designer", "they", "Asia/Shanghai", "zh"))
    val state = mutableStateOf(PersonalUiState("gateway", summary))
    var submitted: PersonalProfile? = null
    rule.setContent {
      AboutYouScreen(state.value, "about", PaddingValues(), "overview",
        onBack = {}, onOpenList = {}, onOpenDetail = {}, onLoadList = { _, _, _ -> },
        onRetryDetail = {}, onOpenNotes = {}, onSaveProfile = { profile ->
          submitted = profile
          state.value = state.value.copy(savedProfileRevision = state.value.savedProfileRevision + 1)
        })
    }
    rule.onNodeWithTag("about-you-edit-profile").performClick()
    rule.onNodeWithTag("profile-call-name").assertTextContains("Mia")
    rule.onNodeWithTag("profile-editor-scroll").performTouchInput { swipeUp() }
    rule.onNodeWithTag("profile-timezone").performTextClearance()
    rule.onNodeWithTag("profile-timezone").performTextInput("Not/AZone")
    rule.onNodeWithTag("profile-save").performScrollTo().performClick()
    assertEquals(null, submitted)
    rule.onNodeWithTag("profile-timezone").performTextClearance()
    rule.onNodeWithTag("profile-timezone").performTextInput("UTC")
    rule.onNodeWithTag("profile-timezone").assertTextContains("UTC")
    rule.onNodeWithTag("profile-save").performScrollTo().performClick()
    rule.waitForIdle()
    assertEquals("UTC", submitted?.timezone)
    rule.onNodeWithTag("about-you-profile-sheet").assertDoesNotExist()
  }

  @Test fun detailEditPreservesDraftUntilSaveAndDeleteRequiresConfirmation() {
    val assertion = PersonalAssertion("a-1", "Old understanding", "user_explicit",
      scope = "global", confidence = 1.0)
    val state = mutableStateOf(PersonalUiState("gateway", selectedAssertionId = "a-1",
      selectedAssertion = assertion))
    var saved = ""
    var deletes = 0
    rule.setContent {
      AboutYouScreen(state.value, "detail", PaddingValues(), "overview",
        onBack = {}, onOpenList = {}, onOpenDetail = {}, onLoadList = { _, _, _ -> },
        onRetryDetail = {}, onOpenNotes = {}, onSaveStatement = { value ->
          saved = value
          state.value = state.value.copy(assertionSavedRevision = state.value.assertionSavedRevision + 1,
            selectedAssertion = assertion.copy(statement = value))
        }, onDeleteAssertion = { deletes++ })
    }
    rule.onNodeWithTag("about-you-edit-statement").performClick()
    rule.onNodeWithTag("about-you-statement-input").performTextClearance()
    rule.onNodeWithTag("about-you-statement-input").performTextInput("Corrected")
    rule.onNodeWithTag("about-you-save-statement").performClick()
    rule.waitForIdle()
    assertEquals("Corrected", saved)
    rule.onNodeWithTag("about-you-detail-statement").assertTextContains("Corrected")
    rule.onNodeWithTag("about-you-delete-statement").performClick()
    assertEquals(0, deletes)
    rule.onNodeWithTag("about-you-confirm-delete").performClick()
    assertEquals(1, deletes)
  }
}
