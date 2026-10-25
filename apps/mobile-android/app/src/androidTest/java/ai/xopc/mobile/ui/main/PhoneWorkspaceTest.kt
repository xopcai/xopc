package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import android.content.Context
import ai.xopc.mobile.gateway.GatewaySession
import ai.xopc.mobile.gateway.PhoneRepository
import ai.xopc.mobile.gateway.PhoneSummary
import ai.xopc.mobile.gateway.PhoneState
import ai.xopc.mobile.theme.XopcTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Uses a new simulator pairing and the dedicated Settings-only conversation. */
class PhoneWorkspaceTest {
  @get:Rule val compose = createComposeRule()
  private fun text(id: Int) = ApplicationProvider.getApplicationContext<Context>().getString(id)
  private fun openMore() {
    compose.waitUntil(20_000) { compose.onAllNodes(hasTestTag("phone-more") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
    compose.onNodeWithTag("phone-more").performClick()
  }
  @Test fun viewOnlyHidesManualActions() {
    compose.setContent { XopcTheme { PhoneWorkspaceContent(
      PhoneUiState(summary = PhoneSummary(true, "view", "Test phone", false, null)), {}, { _, _ -> }, { _, _, _ -> }, {}, {}) } }
    compose.onNodeWithTag("phone-control").assertDoesNotExist()
    compose.onNodeWithText(text(R.string.phone_view_only)).assertIsDisplayed()
    openMore()
    compose.onNodeWithText(text(R.string.phone_text)).assertDoesNotExist()
    compose.onNodeWithText(text(R.string.phone_stop)).assertDoesNotExist()
  }
  @Test fun restoredAssistanceCanBeTakenOverWithoutOldPixels() {
    var operation = ""
    val state = PhoneUiState(summary = PhoneSummary(true, "control", "Test phone", true, null),
      live = PhoneState("restored", 1, false, "control", "none", "needs_user", "wait", true, true))
    compose.setContent { XopcTheme { PhoneWorkspaceContent(state, {}, { op, _ -> operation = op }, { _, _, _ -> }, {}, {}) } }
    compose.onNodeWithTag("phone-control").assertIsEnabled().performClick()
    compose.runOnIdle { org.junit.Assert.assertEquals("takeover", operation) }
  }
  @Test fun stopConfirmationRemainsDuringAnEpochRefresh() {
    var state by mutableStateOf(PhoneUiState(summary = PhoneSummary(true, "control", "Test phone", false, null),
      live = PhoneState("same-session", 1, false, "control", "none", "paused", null, false, true)))
    compose.setContent { XopcTheme { PhoneWorkspaceContent(state, {}, { _, _ -> }, { _, _, _ -> }, {}, {}) } }
    openMore()
    compose.onNodeWithText(text(R.string.phone_stop)).performClick()
    compose.runOnIdle { state = state.copy(live = state.live?.copy(epoch = 2)) }
    compose.onNodeWithText(text(R.string.phone_cancel)).assertIsDisplayed().performClick()
  }
  @Test fun liveVideoControlsAndPaging() = runBlocking<Unit> {
    val args = InstrumentationRegistry.getArguments()
    val link = args.getString("phonePairingLink")
    val id = args.getString("phoneConversationId")
    assumeTrue("Needs an isolated live Phone Use acceptance pairing", !link.isNullOrEmpty() && !id.isNullOrEmpty())
    val session = GatewaySession(ApplicationProvider.getApplicationContext())
    val profile = session.pair(checkNotNull(link)) {}
    val repository = PhoneRepository(session)
    val deadline = System.currentTimeMillis() + 90_000
    while (repository.summary(checkNotNull(id)).access != "control" && System.currentTimeMillis() < deadline) Thread.sleep(500)
    var tab by mutableStateOf(HomeTab.Assistant)
    compose.setContent {
      XopcTheme { MainContent(phoneRepository = repository, selectedTab = tab, onSelectTab = { tab = it },
        connection = ConnectionUiState(profile = profile, selectedConversationId = id)) }
    }
    compose.waitUntil(30_000) { compose.onAllNodesWithTag("chat-header-phone").fetchSemanticsNodes().isNotEmpty() }
    compose.onNodeWithTag("chat-header-phone").performClick()
    compose.waitUntil(30_000) { compose.onAllNodesWithTag("phone-video-live").fetchSemanticsNodes().isNotEmpty() }
    compose.onNodeWithTag("phone-control").assertIsDisplayed().assertIsEnabled().performClick()
    compose.waitUntil(20_000) { compose.onAllNodesWithText(text(R.string.phone_handback)).fetchSemanticsNodes().isNotEmpty() }
    compose.onAllNodesWithTag("phone-control").assertCountEquals(1)
    compose.waitUntil(30_000) { compose.onAllNodesWithTag("phone-video-live").fetchSemanticsNodes().isNotEmpty() }
    val capture = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
    val output = ApplicationProvider.getApplicationContext<Context>().cacheDir.resolve("phone-acceptance.png")
    output.outputStream().use { capture.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    compose.onNodeWithTag("phone-video-live").performTouchInput { swipeUp() }
    compose.onNodeWithText(text(R.string.phone_handback)).assertIsDisplayed()
    openMore()
    compose.onNodeWithText(text(R.string.phone_text)).performClick()
    compose.onNodeWithTag("phone-text-input").performTextInput("xopc-local-draft")
    androidx.test.espresso.Espresso.pressBack()
    androidx.test.espresso.Espresso.pressBack()
    openMore()
    compose.onNodeWithText(text(R.string.phone_release)).performClick()
    compose.waitUntil(20_000) { compose.onAllNodesWithText(text(R.string.phone_takeover)).fetchSemanticsNodes().isNotEmpty() }
    openMore()
    compose.onNodeWithText(text(R.string.phone_stop)).performClick()
    compose.waitUntil(5000) { compose.onAllNodesWithText(text(R.string.phone_cancel)).fetchSemanticsNodes().isNotEmpty() }
    compose.onNodeWithText(text(R.string.phone_cancel)).performClick()
    compose.waitUntil(20_000) { compose.onAllNodes(hasTestTag("phone-control") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
    compose.onNodeWithTag("phone-control").performClick()
    compose.waitUntil(20_000) { compose.onAllNodesWithText(text(R.string.phone_handback)).fetchSemanticsNodes().isNotEmpty() }
    compose.waitUntil(20_000) { compose.onAllNodes(hasTestTag("phone-control") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
    compose.onNodeWithTag("phone-control").performClick()
    compose.waitUntil(20_000) { compose.onAllNodesWithText(text(R.string.phone_takeover)).fetchSemanticsNodes().isNotEmpty() }
    compose.onNodeWithTag("phone-return").performClick()
    compose.onNodeWithTag("chat-header-phone").assertIsDisplayed()
  }
}
