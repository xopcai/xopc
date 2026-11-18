package ai.xopc.mobile.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechTextTest {
  @Test fun stripsPrivateUrlsAndCodeBeforeSpeaking() {
    val chunks = speechChunks("# Hello **world**\n[Docs](https://example.com)\n" +
      "![Image](secret)\n```js\nconst x=1;\n```")
    assertEquals(listOf("Hello world\nDocs\nImage"), chunks)
  }

  @Test fun keepsUnicodeIntactAndBoundsRequests() {
    val source = "你好吗🙂".repeat(600)
    val chunks = speechChunks(source)
    assertEquals(source, chunks.joinToString(""))
    assertTrue(chunks.first().length <= 160)
    assertTrue(chunks.all { it.length <= 420 })
    assertFalse(chunks.any { it.last().isHighSurrogate() })
  }

  @Test fun groupsShortSentencesAndSplitsAtNaturalPauses() {
    val short = "Results. The rate is 3.14. Next sentence.\nA final line."
    assertEquals(listOf(short), speechChunks(short))
    val first = "Summary\n" + "Some more context ".repeat(7) + "ends here."
    val second = "This is the next sentence. It can be synthesized in parallel."
    assertEquals(listOf(first, second), speechChunks("$first $second"))
  }

  @Test fun codeOnlyDoesNotTriggerSpeech() {
    assertTrue(speechChunks("```ts\nfoo()\n```").isEmpty())
  }
}
