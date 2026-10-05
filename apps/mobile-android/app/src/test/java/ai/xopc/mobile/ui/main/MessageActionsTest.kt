package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageActionsTest {
  @Test fun extractsMultipleNonemptyFencedBlocksWithoutLanguageLabels() {
    assertEquals("val x = 1\n\nprint(x)", extractMarkdownCodeBlocks(
      "Intro\n```kotlin\n val x = 1 \n```\n```\n \n```\n```python\nprint(x)\n```"))
  }

  @Test fun noFenceHasNoCopyCodeAction() {
    assertEquals("", extractMarkdownCodeBlocks("Only a `small inline sample`."))
  }

  @Test fun extractsLinksAndRoutesOnlySupportedInternalDestinations() {
    assertEquals(listOf(MessageMarkdownLink("Task", "/tasks/task-1")),
      extractMessageMarkdownLinks("Open [Task](/tasks/task-1)"))
    assertEquals("task", messageLinkTarget("xopc://open?kind=task&id=task-1")?.kind)
    assertEquals("note-1", messageLinkTarget("#/notes/note-1")?.id)
    assertNull(messageLinkTarget("/notes/../secret"))
    assertNull(messageLinkTarget("javascript:alert(1)"))
  }

  @Test fun messagePreviewThresholdsMatchHarmonyHistoryRules() {
    assertEquals(4, messagePreviewLineLimit("user"))
    assertEquals(8, messagePreviewLineLimit("assistant"))
    assertFalse(messageNeedsPreview("assistant", (1..8).joinToString("\n") { "第${it}行" }))
    assertTrue(messageNeedsPreview("assistant", (1..9).joinToString("\n") { "第${it}行" }))
    assertFalse(messageNeedsPreview("user", (1..4).joinToString("\n") { "第${it}行" }))
    assertTrue(messageNeedsPreview("user", (1..5).joinToString("\n") { "第${it}行" }))
  }
}
