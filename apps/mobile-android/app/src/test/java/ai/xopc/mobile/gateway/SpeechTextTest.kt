package ai.xopc.mobile.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechTextTest {
  @Test fun stripsPrivateUrlsAndCodeBeforeSpeaking() {
    val chunks = speechChunks("# Hello **world**\n[Docs](https://example.com)\n" +
      "![Image](secret)\n```js\nconst x=1;\n```")
    assertEquals(listOf("Hello world", "DocsImage"), chunks)
  }

  @Test fun keepsUnicodeIntactAndBoundsRequests() {
    val source = "你好吗🙂".repeat(600)
    val chunks = speechChunks(source)
    assertEquals(source, chunks.joinToString(""))
    assertTrue(chunks.first().length <= 80)
    assertTrue(chunks.all { it.length <= 240 })
    assertFalse(chunks.any { it.last().isHighSurrogate() })
  }

  @Test fun codeOnlyDoesNotTriggerSpeech() {
    assertTrue(speechChunks("```ts\nfoo()\n```").isEmpty())
  }
}
