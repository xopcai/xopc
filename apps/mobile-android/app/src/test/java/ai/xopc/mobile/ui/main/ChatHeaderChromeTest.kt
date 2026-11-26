package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ContextDelegatedTask
import ai.xopc.mobile.gateway.ContextEnvironment
import ai.xopc.mobile.gateway.ContextWorkItem
import ai.xopc.mobile.gateway.ConversationContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatHeaderChromeTest {

  @Test
  fun formatsModelSubtitleWithThinkingAndFastMode() {
    assertEquals(
      "Claude Sonnet 4.5 · 高 ⚡",
      chatModelSubtitle("Claude Sonnet 4.5", "levels", "high", isFastEnabled = true, isZh = true),
    )
    assertEquals(
      "GPT-5",
      chatModelSubtitle("GPT-5", "levels", "off", isFastEnabled = false, isZh = false),
    )
    assertEquals(
      "GPT-5 · Med",
      chatModelSubtitle("GPT-5", "toggle", "medium", isFastEnabled = false, isZh = false),
    )
    assertNull(chatModelSubtitle("", "levels", "high", isFastEnabled = true, isZh = true))
  }

  @Test
  fun contextStripOmitsCasualChatsAndSurfacesProjectTaskAndWorktree() {
    assertNull(chatContextStrip(null, null, isZh = true))
    assertNull(
      chatContextStrip(
        ConversationContext(
          conversationId = "c1",
          project = null,
          task = null,
          environment = ContextEnvironment("local_checkout", "/tmp", true, "main"),
          sources = emptyList(),
          sourcesHasMore = false,
          unavailableSections = emptyList(),
          workingDirectoryLocked = false,
        ),
        null,
        isZh = true,
      ),
    )

    val projectTask = chatContextStrip(
      ConversationContext(
        conversationId = "c2",
        project = ContextWorkItem("p1", "xopc"),
        task = ContextWorkItem("t1", "优化顶栏", "review"),
        environment = ContextEnvironment("managed_worktree", "/tmp", true, "feat/header"),
        sources = emptyList(),
        sourcesHasMore = false,
        unavailableSections = emptyList(),
        workingDirectoryLocked = true,
      ),
      null,
      isZh = true,
    )!!
    assertTrue(projectTask.hasProject)
    assertEquals("xopc", projectTask.projectTitle)
    assertEquals("优化顶栏 · 待验收", projectTask.taskText)
    assertTrue(projectTask.needsAttention)
    assertNull(projectTask.environmentTag)

    val delegated = chatContextStrip(
      ConversationContext(
        conversationId = "c3",
        project = ContextWorkItem("p1", "xopc"),
        task = null,
        environment = null,
        sources = emptyList(),
        sourcesHasMore = false,
        unavailableSections = emptyList(),
        workingDirectoryLocked = true,
        delegatedTasks = listOf(
          ContextDelegatedTask("t1", "A", "active", "running"),
          ContextDelegatedTask("t2", "B", "review", null),
        ),
        delegatedTaskCount = 2,
      ),
      null,
      isZh = true,
    )!!
    assertEquals("2 项任务 · 1 待处理", delegated.taskText)
    assertTrue(delegated.needsAttention)
    assertTrue(delegated.isTaskActive)

    val worktree = chatContextStrip(
      ConversationContext(
        conversationId = "c4",
        project = ContextWorkItem("p1", "xopc"),
        task = null,
        environment = ContextEnvironment("managed_worktree", "/tmp", true, "feat/mobile"),
        sources = emptyList(),
        sourcesHasMore = false,
        unavailableSections = emptyList(),
        workingDirectoryLocked = true,
      ),
      null,
      isZh = false,
    )!!
    assertEquals("Worktree · feat/mobile", worktree.environmentTag)
  }

  @Test
  fun deduplicatesRuntimeBadgeWhenIncludedInAgentName() {
    assertFalse(shouldShowRuntimeBadge("Claude Code", "Claude"))
    assertTrue(shouldShowRuntimeBadge("前端专家", "Claude"))
    assertFalse(shouldShowRuntimeBadge("主助理", null))
  }
}
