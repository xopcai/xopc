package ai.xopc.mobile.gateway

import org.junit.Assert.*
import org.junit.Test

class ProgressTaskManagementTest {
  private val task = ProgressTask("task", "Task", "", "review", null, 1, null, null,
    version = 3, allowedCommands = listOf("move", "close"),
    criteria = listOf(TaskCriterion("Works", "passed", true)))

  @Test fun phaseChangesNeverImplyExecutionAndFollowAllowedCommands() {
    assertEquals("move:active", task.phaseAction("active"))
    assertNull(task.phaseAction("review"))
    assertNull(task.phaseAction("closed"))
    assertNull(task.copy(allowedCommands = listOf("close")).phaseAction("active"))
    assertEquals("reopen:ready", task.copy(phase = "closed", allowedCommands = listOf("reopen")).phaseAction("ready"))
  }

  @Test fun completionRequiresAcceptanceAndNoActiveRunOrWait() {
    assertNull(task.completionBlock)
    assertEquals("criteria", task.copy(criteria = emptyList()).completionBlock)
    assertEquals("acceptance", task.copy(criteria = listOf(TaskCriterion("Works", "pending", false))).completionBlock)
    assertEquals("execution", task.copy(hasActiveExecution = true).completionBlock)
    assertEquals("execution", task.copy(activeWaitCount = 1).completionBlock)
  }

  @Test fun reviewActionsRetainOnlyValidTaskTargets() {
    val action = ProgressHomeAction("task_review", "Review", taskId = "task-1")
    assertEquals("task-1", action.reviewTaskId)
    assertNull(action.copy(taskId = null).reviewTaskId)
    assertNull(action.copy(taskId = "../task").reviewTaskId)
    assertNull(action.copy(type = "retry_run").reviewTaskId)
  }
}
