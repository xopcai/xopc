package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.PendingInput

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TransientComposerNoticeTest {
  @Test fun dismissingFeedbackPreservesDraftAndUnconfirmedInput() {
    val pending = PendingInput("message", "Keep this input")
    val state = ConnectionUiState(selectedConversationId = "conversation", draftText = "Draft",
      sendError = true, sendRejected = true, sendErrorDetail = "Rejected", attachmentError = true,
      pendingInput = pending, quickError = true)
    val dismissed = state.clearComposerFeedback(null, "conversation", false)
    assertEquals(false, dismissed.sendError)
    assertEquals(false, dismissed.attachmentError)
    assertEquals(true, dismissed.quickError)
    assertEquals("Draft", dismissed.draftText)
    assertSame(pending, dismissed.pendingInput)
    assertSame(state, state.clearComposerFeedback(null, "another-conversation", false))
  }

  @Test fun expiresWithoutAnotherComposerAction() = runTest {
    val notice = TransientComposerNotice(backgroundScope)
    notice.show("Failed")
    runCurrent()
    advanceTimeBy(5_999); runCurrent()
    assertEquals("Failed", notice.message)
    advanceTimeBy(1); runCurrent()
    assertEquals("", notice.message)
  }

  @Test fun repeatedFailuresGetAFullLifetime() = runTest {
    val notice = TransientComposerNotice(backgroundScope)
    notice.show("Failed"); runCurrent(); advanceTimeBy(4_000)
    notice.show("Failed"); runCurrent(); advanceTimeBy(2_000); runCurrent()
    assertEquals("Failed", notice.message)
    advanceTimeBy(4_000); runCurrent()
    assertEquals("", notice.message)
  }

  @Test fun dismissalAndLeavingCancelTheOldDeadline() = runTest {
    val notice = TransientComposerNotice(backgroundScope)
    notice.show("Old"); runCurrent(); advanceTimeBy(4_000)
    notice.clear()
    assertEquals("", notice.message)
    notice.show("New"); runCurrent(); advanceTimeBy(2_000); runCurrent()
    assertEquals("New", notice.message)
  }
}
