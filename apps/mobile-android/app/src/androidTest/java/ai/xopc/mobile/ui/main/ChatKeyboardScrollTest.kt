package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ConversationMessage
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.theme.XopcTheme
import android.os.SystemClock
import android.util.Log
import android.view.ViewTreeObserver
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.espresso.Espresso
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ChatKeyboardScrollTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  private data class Frame(val time: Long, val messageBottom: Float, val composerTop: Float, val imeVisible: Boolean)

  @Test fun keyboardKeepsLongReplyAtComposerWithoutJumpingOrRebounding() {
    val reply = (0 until 36).joinToString("\n\n") { "Paragraph $it: a long response that fills several screens." }
    showChat(listOf(ConversationMessage("question", "user", "Show me a long answer"),
      ConversationMessage("long-reply", "assistant", reply)))
    val message = rule.onNodeWithTag("message-assistant-card-long-reply").fetchSemanticsNode()
    val composer = rule.onNodeWithTag("assistant-bottom-surface").fetchSemanticsNode()
    val opening = captureKeyboardTransition(message, composer, visible = true) {
      rule.onNodeWithTag("assistant-input").performClick()
    }
    assertTracksComposer(opening, opening = true)
    val closing = captureKeyboardTransition(message, composer, visible = false) { Espresso.pressBack() }
    assertTracksComposer(closing, opening = false)
  }

  @Test fun openingKeyboardWhileReadingHistoryDoesNotJumpToLatest() {
    showChat((0 until 30).map { ConversationMessage("message-$it", "assistant", "Reply $it") })
    rule.onNodeWithTag("assistant-message-list").performScrollToNode(hasText("Reply 1"))
      .performTouchInput { swipeDown() }
    rule.onNodeWithText("Reply 0").assertIsDisplayed()
    val message = rule.onNodeWithTag("message-assistant-card-message-5").fetchSemanticsNode()
    val composer = rule.onNodeWithTag("assistant-bottom-surface").fetchSemanticsNode()
    captureKeyboardTransition(message, composer, visible = true) {
      rule.onNodeWithTag("assistant-input").performClick()
    }
    rule.onNodeWithText("Reply 29").assertIsNotDisplayed()
    rule.onNodeWithTag("assistant-jump-bottom").assertIsDisplayed()
    Espresso.pressBack()
  }

  @Suppress("DEPRECATION")
  private fun showChat(messages: List<ConversationMessage>) {
    rule.runOnUiThread {
      rule.activity.enableEdgeToEdge()
      rule.activity.window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    }
    rule.setContent {
      XopcTheme {
        MainContent(HomeTab.Assistant, {}, ConnectionUiState(
          profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = "keyboard-chat", realtimeStatus = "connected", messages = messages))
      }
    }
    rule.waitForIdle()
  }

  private fun captureKeyboardTransition(message: SemanticsNode, composer: SemanticsNode, visible: Boolean,
    action: () -> Unit): List<Frame> {
    val frames = CopyOnWriteArrayList<Frame>()
    val decor = rule.activity.window.decorView
    val listener = ViewTreeObserver.OnPreDrawListener {
      frames += Frame(SystemClock.uptimeMillis(), message.positionInRoot.y + message.size.height,
        composer.positionInRoot.y,
        ViewCompat.getRootWindowInsets(decor)?.isVisible(WindowInsetsCompat.Type.ime()) == true)
      true
    }
    rule.runOnUiThread { decor.viewTreeObserver.addOnPreDrawListener(listener) }
    try {
      action()
      rule.waitUntil(5_000) {
        frames.any { it.imeVisible == visible } && frames.size >= 3 &&
          SystemClock.uptimeMillis() - frames.first().time >= 700
      }
      rule.waitForIdle()
    } finally {
      rule.runOnUiThread { decor.viewTreeObserver.removeOnPreDrawListener(listener) }
    }
    assertTrue("IME must reach the requested state", frames.last().imeVisible == visible)
    return frames.toList()
  }

  private fun assertTracksComposer(frames: List<Frame>, opening: Boolean) {
    val density = rule.density.density
    val worstOvershoot = frames.maxOf { (it.messageBottom - it.composerTop) / density }
    var furthest = frames.first().messageBottom
    var rebound = 0f
    frames.forEach { frame ->
      furthest = if (opening) minOf(furthest, frame.messageBottom) else maxOf(furthest, frame.messageBottom)
      rebound = maxOf(rebound, if (opening) frame.messageBottom - furthest else furthest - frame.messageBottom)
    }
    rebound /= density
    Log.i("ChatKeyboardScrollTest", "opening=$opening overshoot=${worstOvershoot}dp rebound=${rebound}dp frames=${frames.size}")
    assertTrue("Reply overshot composer by ${worstOvershoot}dp; frames=$frames", worstOvershoot <= 32f)
    assertTrue("Reply reversed direction by ${rebound}dp; frames=$frames", rebound <= 8f)
  }
}
