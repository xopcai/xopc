package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Test

class MessageActionsTest {
  @Test fun extractsMultipleNonemptyFencedBlocksWithoutLanguageLabels() {
    assertEquals("val x = 1\n\nprint(x)", extractMarkdownCodeBlocks(
      "Intro\n```kotlin\n val x = 1 \n```\n```\n \n```\n```python\nprint(x)\n```"))
  }

  @Test fun noFenceHasNoCopyCodeAction() {
    assertEquals("", extractMarkdownCodeBlocks("Only a `small inline sample`."))
  }
}
