package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConversationMessage
import androidx.activity.ComponentActivity
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class MarkdownContentTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

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
    composeTestRule.onNodeWithTag("markdown-content").assertExists()
    composeTestRule.onNodeWithTag("markdown-heading").assertTextEquals("Result")
    composeTestRule.onNodeWithText("Done").assertExists()
  }
}
