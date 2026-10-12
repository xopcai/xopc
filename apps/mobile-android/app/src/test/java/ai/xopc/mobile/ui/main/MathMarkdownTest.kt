package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MathMarkdownTest {
  @Test fun multilineFormulaKeepsItsSourceAndBlankLines() {
    val raw = "\\[\n\\begin{aligned}\na &= b \\\\\n\nc &= d\n\\end{aligned}\n\\]"
    val blocks = projectMarkdown("Before\n\n$raw\n\nAfter")
    assertEquals(3, blocks.size)
    assertEquals(raw, (blocks[1].node as MathSourceBlock).source)
    assertTrue(MathMarkdownSyntax.closed(raw))
  }
  @Test fun ordinaryCodeAndUnclosedQuotesKeepTheirBoundaries() {
    assertEquals(257, MathMarkdownSyntax.candidateCount(List(257) { "\\[x\\]" }.joinToString("\n\n")))
    val commented = "\\[ % \\]\nx^2\n\\]"
    assertEquals(commented, (projectMarkdown(commented)[0].node as MathSourceBlock).source)
    assertTrue(projectMarkdown("```ts\n\\[x\\]\n```")[0].node !is MathSourceBlock)
    val blocks = projectMarkdown("> \\[\n> x^2\n\nOutside")
    assertEquals(2, blocks.size)
  }
}
