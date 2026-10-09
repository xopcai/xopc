package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ConversationMedia
import ai.xopc.mobile.gateway.ConversationMessage
import ai.xopc.mobile.theme.XopcTheme
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class UserVoiceMessageTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  @Test fun voiceBubbleShowsDurationWithoutSizeAndOnlyLoadsOnPlay() {
    val media = ConversationMedia("voice", "voice.wav", "audio", "audio/wav", 80044,
      "media://voice", durationSeconds = 5.0)
    var loads = 0
    var menus = 0
    var previews = 0
    rule.setContent {
      XopcTheme {
        Box(Modifier.width(320.dp)) {
          ChatMessageCard(ConversationMessage("user-voice", "user", "", media = listOf(media)),
            onMore = { menus++ }, onOpenTarget = {}, onOpenPreview = { _, _ -> previews++ },
            onOpenLink = {}, onCopy = {}, loadMedia = { loads++; silentWav() })
        }
      }
    }
    rule.onNodeWithTag("message-audio-voice").assertHeightIsEqualTo(48.dp)
      .assertWidthIsEqualTo(124.dp)
    rule.onNodeWithTag("message-audio-duration-voice", useUnmergedTree = true).assertTextEquals("5″")
    rule.runOnIdle { assertEquals(0, loads) }
    rule.onNodeWithTag("message-audio-voice").performTouchInput { longClick() }
    rule.runOnIdle { assertEquals(1, menus); assertEquals(0, loads) }
    rule.onNodeWithTag("message-audio-voice").performTouchInput { click() }
    rule.waitUntil(5000) {
      rule.onAllNodesWithTag("message-audio-playing-voice", useUnmergedTree = true)
        .fetchSemanticsNodes().isNotEmpty()
    }
    rule.runOnIdle { assertEquals(1, loads); assertEquals(0, previews) }
    rule.onNodeWithTag("message-audio-voice").performTouchInput { click() }
    rule.onNodeWithTag("message-audio-playing-voice", useUnmergedTree = true).assertDoesNotExist()
  }

  @Test fun voiceWithTextKeepsACompactTransparentPlaybackRow() {
    val media = ConversationMedia("voice", "voice.wav", "audio", "audio/wav", 80044,
      "media://voice", durationSeconds = 5.0)
    rule.setContent {
      XopcTheme {
        Box(Modifier.width(320.dp)) {
          ChatMessageCard(ConversationMessage("user-voice", "user", "这是一条带有文字的语音消息", media = listOf(media)),
            onMore = {}, onOpenTarget = {}, onOpenPreview = { _, _ -> },
            onOpenLink = {}, onCopy = {}, loadMedia = { silentWav() })
        }
      }
    }
    rule.onNodeWithTag("message-audio-voice").assertWidthIsEqualTo(148.dp)
      .assertHeightIsEqualTo(48.dp)
    rule.onNodeWithTag("message-audio-duration-voice", useUnmergedTree = true).assertTextEquals("5″")
  }

  private fun silentWav(): ByteArray {
    val size = 8000 * 5 * 2
    return ByteBuffer.allocate(44 + size).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray()); putInt(36 + size); put("WAVEfmt ".toByteArray())
      putInt(16); putShort(1); putShort(1); putInt(8000); putInt(16000)
      putShort(2); putShort(16); put("data".toByteArray()); putInt(size)
    }.array()
  }
}
