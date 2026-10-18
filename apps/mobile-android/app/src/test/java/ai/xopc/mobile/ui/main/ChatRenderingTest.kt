package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ConversationMessage
import org.junit.Assert.*
import org.junit.Test

class ChatRenderingTest {
  @Test fun transportDraftsWaitForAnswerClassification() {
    val buffer = ChatStreamBuffer()
    assertTrue(buffer.append("draft", "run", emptyList(), "Checking the sources", 0))
    val drafts = buffer.drain(emptyList())
    assertEquals("Checking the sources", drafts.single().text)
    assertTrue(chatPresentationMessages(emptyList(), drafts).isEmpty())
    val confirmed = drafts.map { it.copy(answerConfirmed = true) }
    assertEquals(confirmed, chatPresentationMessages(emptyList(), confirmed))
  }

  @Test fun completedToolOnlyMessagesDoNotLeaveEmptyCards() {
    val process = ConversationMessage("tool", "assistant", "", "run", hasNonTextContent = true)
    assertTrue(chatPresentationMessages(listOf(process), emptyList()).isEmpty())
  }

  @Test fun historyAndLiveSegmentsShareOnePresentationRow() {
    val saved = ConversationMessage("a", "assistant", "First", "r")
    val live = ConversationMessage("b", "assistant", "Second", "r")
    val rows = chatPresentationMessages(listOf(saved), listOf(live))
    assertEquals(1, rows.size)
    assertEquals("First\nSecond", rows.single().text)
    assertEquals(saved.renderId, rows.single().renderId)
    assertEquals(setOf("a", "b"), rows.single().sourceIds)
    assertEquals(listOf(saved), chatPresentationMessages(listOf(saved), listOf(saved)))
  }
  @Test fun aReplayedPacketCanExtendAnIncompleteReceivedPrefix() {
    val buffer = ChatStreamBuffer()
    val visible = listOf(ConversationMessage("m", "assistant", "Hello wor", "r"))
    assertTrue(buffer.append("m", "r", visible, "world", 6))
    assertEquals("Hello world", buffer.drain(visible).single().text)
  }
  @Test fun codePreviewIsExplicitAndTheOriginalRemainsComplete() {
    val source = (0 until 100).joinToString("\n") { "line $it" }
    assertEquals(40, markdownCodePreview(source).lines().size)
    assertTrue(source.endsWith("line 99"))
  }
  @Test fun linksRetainInternalRoutesAndRejectExecutableOrCredentialedExternalTargets() {
    assertEquals("note", messageLinkTarget("/notes/report.md")?.kind)
    assertEquals("a", messageLinkTarget("/automations/a")?.id)
    assertEquals("a", messageLinkTarget("#/automations?automation=a")?.id)
    assertNull(messageLinkTarget("/automations?automation=bad id"))
    assertEquals("docs/中文.md", messageLinkTarget("xopc://workspace/file?path=docs%2F%E4%B8%AD%E6%96%87.md")?.id)
    assertNull(messageLinkTarget("xopc://workspace/file?path=../secrets"))
    assertTrue(externalMessageLink("http://example.com/page"))
    assertFalse(externalMessageLink("https://user:password@example.com/page"))
    assertFalse(externalMessageLink("javascript:alert(1)"))
  }
  @Test fun receivedOffsetsAndReplayAreIndependentOfUiCommit() {
    val buffer = ChatStreamBuffer()
    assertTrue(buffer.append("a", "r", emptyList(), "你😀", 0))
    assertTrue(buffer.append("a", "r", emptyList(), "你😀好", 0))
    assertFalse(buffer.append("a", "r", emptyList(), "gap", 8))
    val committed = buffer.drain(emptyList())
    assertEquals("你😀好", committed.single().text)
    assertTrue(buffer.append("b", "r", committed, "B", 0))
    assertEquals(listOf("a", "b"), buffer.drain(committed).map { it.id })
  }

  @Test fun missingPrefixDoesNotReplaceRetainedContent() {
    val previous = listOf(ConversationMessage("m", "assistant", "hello", "r"))
    val buffer = ChatStreamBuffer()
    assertFalse(buffer.append("m", "r", previous, "different", 0))
    assertFalse(buffer.append("m", "r", previous, "bad", -1))
    assertEquals(previous, buffer.drain(previous))
  }

  @Test fun markdownKeepsPrefixNodeAndTailIdentity() {
    val first = projectMarkdown("# Title\n\nPartial")
    val next = projectMarkdown("# Title\n\nPartial **bold**", first)
    assertSame(first[0], next[0])
    assertEquals(first[1].id, next[1].id)
    assertNotEquals(first[1].fingerprint, next[1].fingerprint)
  }

  @Test fun changedReferenceDefinitionInvalidatesTheDependentPrefix() {
    val first = projectMarkdown("[docs][ref]\n\n[ref]: https://example.com/one")
    val next = projectMarkdown("[docs][ref]\n\n[ref]: https://example.com/two", first)
    assertEquals(first[0].id, next[0].id)
    assertNotEquals(first[0].fingerprint, next[0].fingerprint)
  }

  @Test fun longRepliesAreRetainedWithoutSilentTruncation() {
    val buffer = ChatStreamBuffer()
    val text = "a".repeat(100_000)
    assertTrue(buffer.append("m", "r", emptyList(), text, 0))
    assertEquals(text, buffer.drain(emptyList()).single().text)
  }
}
