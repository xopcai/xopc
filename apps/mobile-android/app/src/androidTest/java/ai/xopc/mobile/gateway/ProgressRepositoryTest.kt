package ai.xopc.mobile.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ProgressRepositoryTest {
  @Test fun parsesHomeWorkbenchActionsAndReviewDetail() {
    val home = ProgressRepository.parseHome("""{
      "needsUser":[{"id":"wait-1","title":"Review plan","summary":"Awaiting approval",
        "statusLabel":"Needs you","recommendation":"Check scope",
        "openAction":{"type":"open","label":"Open chat","href":"/chat/chat-1"},
        "primaryAction":{"type":"connector_decision","label":"Approve","approvalId":"approval-1","decision":"approve"},
        "secondaryActions":[{"type":"connector_decision","label":"Deny","approvalId":"approval-1","decision":"deny"}]}],
      "background":[{"id":"run-1","title":"Build","summary":"Running",
        "openAction":{"type":"resolve","label":"Approve","href":"/tasks/task-1"},
        "primaryAction":{"type":"retry_run","label":"Retry","subjectKind":"automation_run","runId":"run-1"},
        "secondaryActions":[{"type":"retry_run","label":"Unsafe","subjectKind":"other","runId":"run-1"}]}],
      "decisions":[{"detail":"Full permission scope","response":{"approvalId":"approval-1"}}]
    }""")
    assertEquals("/chat/chat-1", home.needsUser.single().openAction?.href)
    assertEquals("Check scope", home.needsUser.single().recommendation)
    assertEquals("Full permission scope", home.needsUser.single().reviewDetail)
    assertEquals("approve", home.needsUser.single().primaryAction?.decision)
    assertEquals("deny", home.needsUser.single().secondaryActions.single().decision)
    assertEquals(null, home.background.single().openAction)
    assertEquals("retry_run", home.background.single().primaryAction?.type)
    assertEquals(emptyList<ProgressHomeAction>(), home.background.single().secondaryActions)
  }

  @Test fun parsesTaskPageAndRejectsUnknownPhase() {
    val raw = """{"ok":true,"total":2,"items":[{"task":{"id":"task-1","title":"Build",
      "phase":"closed","body":"Done","resolution":"done","updatedAt":10,"closedAt":11,"version":2}}]}"""
    val page = ProgressRepository.parseTasks(raw)
    assertEquals(2, page.total)
    assertEquals("done", page.items.single().resolution)
    assertEquals(11L, page.items.single().closedAt)
    assertThrows(IllegalArgumentException::class.java) {
      ProgressRepository.parseTasks(raw.replace("\"closed\"", "\"unknown\""))
    }
  }

  @Test fun detailRequiresMatchingIdentityAndKeepsDisplayFields() {
    val raw = """{"ok":true,"task":{"id":"task-2","title":"Review","phase":"review",
      "body":"Check outputs","priority":"high","projectId":"project-1","updatedAt":42,"version":3},
      "allowedCommands":["close","request_review"]}"""
    val task = ProgressRepository.parseTaskDetail("task-2", raw)
    assertEquals("project-1", task.projectId)
    assertEquals("high", task.priority)
    assertThrows(IllegalArgumentException::class.java) {
      ProgressRepository.parseTaskDetail("another-task", raw)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProgressRepository.parseTaskDetail("task-2", raw, minimumVersion = 4)
    }
  }

  @Test fun taskPatchMustConfirmIdentityAndNewVersion() {
    val raw = """{"ok":true,"task":{"id":"task-2","title":"Edited","phase":"ready",
      "updatedAt":22,"version":4}}"""
    assertEquals("Edited", ProgressRepository.parseTaskUpdate("task-2", 3, raw).title)
    assertThrows(IllegalArgumentException::class.java) {
      ProgressRepository.parseTaskUpdate("other", 3, raw)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProgressRepository.parseTaskUpdate("task-2", 4, raw)
    }
  }

  @Test fun projectAndCreateResponsesRequireIdentity() {
    val detail = """{"ok":true,"project":{"id":"project-1","name":"Alpha","status":"active",
      "defaultAgentId":"research","workspaceRoot":"/work/alpha","executionMode":"managed_worktree"}}"""
    assertEquals("Alpha", ProgressRepository.parseProjectDetail("project-1", detail).name)
    assertEquals("research", ProgressRepository.parseProjectDetail("project-1", detail).defaultAgentId)
    assertEquals("/work/alpha", ProgressRepository.parseProjectDetail("project-1", detail).workspaceRoot)
    assertEquals("managed_worktree", ProgressRepository.parseProjectDetail("project-1", detail).executionMode)
    assertThrows(IllegalArgumentException::class.java) {
      ProgressRepository.parseProjectDetail("project-2", detail)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProgressRepository.parseProjectDetail("project-1", detail.replace("managed_worktree", "unknown"))
    }
    val created = """{"ok":true,"task":{"id":"task-new","title":"New","phase":"backlog",
      "projectId":"project-1","updatedAt":10,"version":1}}"""
    assertEquals("task-new", ProgressRepository.parseTaskCreate(created).id)
    assertThrows(IllegalArgumentException::class.java) {
      ProgressRepository.parseTaskCreate(created.replace("\"version\":1", "\"version\":0"))
    }
  }

  @Test fun projectSessionsKeepConversationRowsButExcludeTaskOrigins() {
    val raw = """{"ok":true,"sessions":[
      {"key":"11111111-1111-4111-8111-111111111111","displayName":"Planning","messageCount":4},
      {"key":"22222222-2222-4222-8222-222222222222","name":"Task chat","messageCount":2,
        "customData":{"origin":"task"}}]}"""
    val sessions = ProgressRepository.parseProjectSessions(raw)
    assertEquals(1, sessions.size)
    assertEquals("Planning", sessions.single().title)
    assertEquals(4, sessions.single().messageCount)
    assertThrows(IllegalArgumentException::class.java) {
      ProgressRepository.parseProjectSessions(raw.replace("\"messageCount\":4", "\"messageCount\":-1"))
    }
  }
}
