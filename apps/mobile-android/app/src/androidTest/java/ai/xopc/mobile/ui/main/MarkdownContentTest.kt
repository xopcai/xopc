package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConversationMessage
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class MarkdownContentTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  @Test fun foldedCodeCopiesTheCompleteSource() {
    val source = (0 until 100).joinToString("\n") { "line $it" }
    var copied = ""
    composeTestRule.setContent { MarkdownContent("```text\n$source\n```", onCopyCode = { copied = it }) }
    composeTestRule.onNodeWithTag("markdown-code-text").assertTextEquals(markdownCodePreview(source))
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_copy_code)).performClick()
    assertEquals(source, copied)
  }

  @Test fun rendersMarkdownBlocksAndCopiesCodeWithoutShowingSyntax() {
    var copied = ""
    composeTestRule.setContent {
      MarkdownContent("""
        ## Heading

        A **bold** and *italic* [link](https://example.com).

        - first
        - second

        > quoted

        | Name | Value |
        | --- | --- |
        | one | two |

        ```kotlin
        val answer = 42
        ```
      """.trimIndent(), onCopyCode = { copied = it })
    }
    composeTestRule.onNodeWithTag("markdown-heading").assertTextEquals("Heading")
    composeTestRule.onNodeWithText("A bold and italic link.").assertExists()
    composeTestRule.onNodeWithTag("markdown-list").assertExists()
    composeTestRule.onNodeWithTag("markdown-quote").assertExists()
    composeTestRule.onNodeWithTag("markdown-table").assertExists()
    composeTestRule.onNodeWithTag("markdown-code-block").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_copy_code))
      .performClick()
    assertEquals("val answer = 42", copied)
  }

  @Test fun compactMarkdownPreviewRemovesSyntaxMarkers() {
    composeTestRule.setContent {
      MarkdownContent("## Heading\n\nA **bold** answer", modifier = Modifier.testTag("preview"),
        maxLines = 3)
    }
    composeTestRule.onNodeWithTag("preview").assertTextContains("Heading", substring = true)
    composeTestRule.onNodeWithTag("preview").assertTextContains("A bold answer", substring = true)
  }

  @Test fun assistantMessageUsesReusableMarkdownComponent() {
    composeTestRule.setContent {
      ChatMessageCard(ConversationMessage("answer", "assistant", "## Result\n\n**Done**"),
        onMore = {}, onOpenTarget = {}, onOpenPreview = { _, _ -> },
        onOpenLink = {}, onCopy = {})
    }
    composeTestRule.onNodeWithTag("markdown-content", useUnmergedTree = true).assertExists()
    composeTestRule.onNodeWithTag("markdown-heading", useUnmergedTree = true).assertTextEquals("Result")
    composeTestRule.onNodeWithText("Done", useUnmergedTree = true).assertExists()
  }

  @Test fun longAssistantAnswerLeavesSpaceBesideBubble() {
    composeTestRule.setContent {
      Box(Modifier.width(320.dp)) {
        ChatMessageCard(ConversationMessage("wide", "assistant",
          "这是用于验证移动端长回复阅读宽度的正文，应该充分利用气泡内部可用的空间。"),
          onMore = {}, onOpenTarget = {}, onOpenPreview = { _, _ -> },
          onOpenLink = {}, onCopy = {}, actionsEnabled = false)
      }
    }
    // The card tag is inside its 12dp horizontal content padding.
    composeTestRule.onNodeWithTag("message-assistant-card-wide").assertWidthIsEqualTo(264.dp)
    composeTestRule.onNodeWithTag("markdown-content").assertWidthIsEqualTo(264.dp)
  }

  @Test fun longUserMessageHasNarrowerWidthThanAssistant() {
    composeTestRule.setContent {
      Box(Modifier.width(320.dp)) {
        ChatMessageCard(ConversationMessage("user-wide", "user", "较长的用户消息".repeat(12)),
          onMore = {}, onOpenTarget = {}, onOpenPreview = { _, _ -> },
          onOpenLink = {}, onCopy = {})
      }
    }
    composeTestRule.onNodeWithTag("message-more-user-wide").assertWidthIsEqualTo(268.8.dp)
  }

  @Test fun nestedListsUseSmallIndentationIndependentOfMarkerWidth() {
    composeTestRule.setContent {
      Box(Modifier.width(320.dp)) {
        MarkdownContent("""
          100. 另一个 Qoni app
               - qoni.app 是一个位置社交 App，公开信息仍然有限。
                 - 搜索没有找到有效公开结果。
          101. 关于谢杨
        """.trimIndent())
      }
    }
    val parent = composeTestRule.onNodeWithText("100. 另一个 Qoni app")
      .getUnclippedBoundsInRoot()
    val child = composeTestRule.onNodeWithText("• qoni.app 是一个位置社交 App，公开信息仍然有限。")
      .getUnclippedBoundsInRoot()
    val grandchild = composeTestRule.onNodeWithText("• 搜索没有找到有效公开结果。")
      .getUnclippedBoundsInRoot()
    assertEquals(12f, (child.left - parent.left).value, 0.5f)
    assertEquals(24f, (grandchild.left - parent.left).value, 0.5f)
    assertEquals(parent.left, composeTestRule.onNodeWithText("101. 关于谢杨")
      .getUnclippedBoundsInRoot().left)
  }

}
