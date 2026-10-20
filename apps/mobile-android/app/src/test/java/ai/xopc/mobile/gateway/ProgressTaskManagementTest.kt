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
    assertEquals("move:closed", task.phaseAction("closed"))
    assertNull(task.copy(allowedCommands = listOf("close")).phaseAction("active"))
    assertEquals("move:ready", task.copy(phase = "closed", allowedCommands = listOf("move", "reopen")).phaseAction("ready"))
  }

  @Test fun completionRequiresAcceptanceAndNoActiveRunOrWait() {
    assertNull(task.completionBlock)
    assertEquals("criteria", task.copy(criteria = emptyList()).completionBlock)
    assertEquals("acceptance", task.copy(criteria = listOf(TaskCriterion("Works", "pending", false))).completionBlock)
    assertEquals("execution", task.copy(hasActiveExecution = true).completionBlock)
    assertEquals("execution", task.copy(activeWaitCount = 1).completionBlock)
  }

  private fun detail(version: Int = 4): String = """
    {"ok":true,"task":{"id":"task","title":"Task","phase":"active","updatedAt":20,"version":$version,
      "latestContractVersion":1,"contract":{"objective":"Work","acceptanceCriteria":["Works"],"acceptancePolicy":"manual"}},
      "operationalState":"running","allowedCommands":["move","close"],
      "runs":[{"id":"run","status":"running","contractVersion":1}],"waits":[],
      "receipts":[{"runId":"previous","summary":"Existing result","finalizedAt":10,"remainingWork":["Next step"]}],
      "criterionReviews":[{"contractVersion":1,"criterionIndex":0,"status":"passed"}],
      "phaseChanges":[{"id":"change","fromPhase":"review","toPhase":"active","source":"mobile",
        "actor":{"kind":"user","id":"owner"},"createdAt":20}]}
  """.trimIndent()

  @Test fun commandReloadsFullDetailInsteadOfReplacingItWithPartialAcknowledgement() {
    val calls = mutableListOf<Triple<String, String, String>>()
    val partial = """{"ok":true,"task":{"id":"task","version":4}}"""
    val result = ProgressRepository.commandAndReloadTask("task", 3, "command-body") { path, method, body ->
      calls += Triple(path, method, body)
      if (method == "POST") partial else detail()
    }
    assertEquals(listOf(Triple("/api/tasks/task/commands", "POST", "command-body"),
      Triple("/api/tasks/task", "GET", "")), calls)
    assertEquals(4, result.version)
    assertEquals("change", result.phaseChanges.single().id)
    assertEquals("owner", result.phaseChanges.single().actor.substringAfter(" · "))
    assertTrue(result.hasActiveExecution)
    assertEquals("running", result.operationalState)
    assertEquals("Existing result", result.latestResult)
    assertEquals(listOf("Next step"), result.remainingWork)
    assertEquals("passed", result.criteria.single().status)
  }

  @Test fun commandDoesNotRepeatTheMutationWhenReloadFails() {
    val methods = mutableListOf<String>()
    val failure = runCatching {
      ProgressRepository.commandAndReloadTask("task", 3, "command-body") { _, method, _ ->
        methods += method
        if (method == "POST") """{"ok":true,"task":{"id":"task","version":4}}"""
        else throw IllegalStateException("Read unavailable")
      }
    }.exceptionOrNull()
    assertEquals("Read unavailable", failure?.message)
    assertEquals(listOf("POST", "GET"), methods)
  }

  @Test fun commandRejectsStaleOrMismatchedReadResults() {
    for (read in listOf(detail(3), detail().replace("\"id\":\"task\"", "\"id\":\"other\""))) {
      val failure = runCatching {
        ProgressRepository.commandAndReloadTask("task", 3, "command-body") { _, method, _ ->
          if (method == "POST") """{"ok":true,"task":{"id":"task","version":4}}""" else read
        }
      }.exceptionOrNull()
      assertEquals("MISMATCHED_PROGRESS_TASK", failure?.message)
    }
  }

  @Test fun failedCommandDoesNotFetchOrOverwriteDetail() {
    val methods = mutableListOf<String>()
    val failure = runCatching {
      ProgressRepository.commandAndReloadTask("task", 3, "command-body") { _, method, _ ->
        methods += method
        throw IllegalStateException("HTTP_409")
      }
    }.exceptionOrNull()
    assertEquals("HTTP_409", failure?.message)
    assertEquals(listOf("POST"), methods)
  }

  @Test fun reviewActionsRetainOnlyValidTaskTargets() {
    val action = ProgressHomeAction("task_review", "Review", taskId = "task-1")
    assertEquals("task-1", action.reviewTaskId)
    assertNull(action.copy(taskId = null).reviewTaskId)
    assertNull(action.copy(taskId = "../task").reviewTaskId)
    assertNull(action.copy(type = "retry_run").reviewTaskId)
  }
}
