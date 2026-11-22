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
    assertEquals("language", messageLinkTarget("xopc://settings/language")?.id)
    assertEquals("appearance", messageLinkTarget("#/settings/appearance")?.id)
    assertEquals("", messageLinkTarget("/settings")?.id)
    assertEquals("automation-run", messageLinkTarget("#/automations?run=run-1")?.kind)
    assertEquals("https://example.com/mcp",
      messageLinkTarget("xopc://capabilities/mcp?id=example&url=https%3A%2F%2Fexample.com%2Fmcp")?.summary)
    assertNull(messageLinkTarget("xopc://capabilities/mcp?id=example&url=http%3A%2F%2Fexample.com"))
    assertNull(messageLinkTarget("/settings/not-a-section"))
    assertNull(messageLinkTarget("/notes/%2fsecret"))
    assertNull(messageLinkTarget("//external.example/settings/language"))
    assertEquals("", messageLinkTarget("xopc://open?kind=settings")?.id)
    assertNull(messageLinkTarget("xopc://open?"))
    assertNull(messageLinkTarget("xopc://user@open?kind=task&id=task-1"))
    assertNull(messageLinkTarget("xopc://open:8080?kind=task&id=task-1"))
    assertEquals("file-1", messageLinkTarget("xopc-file:file-1")?.id)
    assertNull(messageLinkTarget("xopc-file:.."))
    assertNull(messageLinkTarget("xopc-file:."))
    assertNull(messageLinkTarget("xopc-file:file-1?token=1"))
    assertNull(messageLinkTarget("xopc-file:file-1#frag"))
    assertEquals("src/main.kt", messageLinkTarget("xopc://workspace/file?path=src%2Fmain.kt")?.id)
    assertNull(messageLinkTarget("xopc://workspace/file?path=%2Fetc%2Fpasswd"))
    assertNull(messageLinkTarget("xopc://workspace/file?path=src%2F.%2Fmain.kt"))
    assertNull(messageLinkTarget("xopc://workspace/file?path=src%2F%2Fmain.kt"))
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
