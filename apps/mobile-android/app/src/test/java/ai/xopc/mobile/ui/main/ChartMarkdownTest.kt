package ai.xopc.mobile.ui.main

import org.commonmark.node.FencedCodeBlock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChartMarkdownTest {
  @Test fun chartRequiresAnActualMatchingClosingFence() {
    fun node(source: String) = projectMarkdown(source).single().node as FencedCodeBlock
    val pending = node("````chart\n{}\n```")
    assertEquals("chart", pending.info)
    assertFalse(pending.hasClosedChartFence())
    val closed = node("~~~chart\n{}\n~~~~")
    assertTrue(closed.hasClosedChartFence())
    assertFalse(node("```chart\n{}\n```text").hasClosedChartFence())
  }

  @Test fun closingFenceInvalidatesTheRetainedStreamingBlock() {
    val pending = projectMarkdown("```chart\n{}\n")
    val completed = projectMarkdown("```chart\n{}\n```", pending)
    assertFalse(pending.single() === completed.single())
    assertEquals(pending.single().id, completed.single().id)
  }

  @Test fun limitCountsUtf8Bytes() {
    assertTrue(chartSourceAllowed("a".repeat(102400)))
    assertFalse(chartSourceAllowed("a".repeat(102401)))
    assertFalse(chartSourceAllowed("中".repeat(40000)))
  }

  @Test fun previewTakesPriorityWithoutExceedingTheWebViewBudget() {
    val ids = listOf("chart-test-first", "chart-test-second", "chart-test-preview")
    try {
      ids.forEach { ChartWebBudget.request(it) }
      assertEquals(2, ChartWebBudget.active.size)
      assertFalse(ids.last() in ChartWebBudget.active)
      ChartWebBudget.request(ids.last(), priority = true)
      assertEquals(2, ChartWebBudget.active.size)
      assertTrue(ids.last() in ChartWebBudget.active)
      ChartWebBudget.release(ids.last())
      assertTrue(ids[0] in ChartWebBudget.active)
      assertTrue(ids[1] in ChartWebBudget.active)
    } finally { ids.forEach { ChartWebBudget.release(it) } }
    assertTrue(ChartWebBudget.active.isEmpty())
  }
}
