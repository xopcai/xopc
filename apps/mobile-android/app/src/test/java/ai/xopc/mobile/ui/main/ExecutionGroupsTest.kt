package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ExecutionStep
import org.junit.Assert.assertEquals
import org.junit.Test

class ExecutionGroupsTest {
  @Test fun groupsAdjacentPublicToolsAndDropsPrivateThinking() {
    val steps = listOf(
      ExecutionStep("thinking", "thinking", "other", "", "", "", "done"),
      ExecutionStep("a", "tool", "search", "", "first query", "", "done"),
      ExecutionStep("b", "tool", "search", "", "second query", "", "done"),
      ExecutionStep("c", "tool", "fetch", "", "https://example.com", "", "running"),
      ExecutionStep("d", "progress", "other", "Reading results", "", "", "done"),
    )
    val groups = ExecutionGroups.group(steps, live = false)
    assertEquals(listOf("search", "fetch", "other"), groups.map { it.category })
    assertEquals(2, groups.first().steps.size)
    assertEquals("stopped", groups[1].status)
    assertEquals("Reading results", groups.last().steps.single().text)
  }
}
