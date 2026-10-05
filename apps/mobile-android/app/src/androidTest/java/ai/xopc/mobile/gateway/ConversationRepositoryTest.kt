package ai.xopc.mobile.gateway

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ConversationRepositoryTest {
  @Test fun taskPendingInputRetainsItsTaskIdentity() {
    val id = "11111111-2222-3333-4444-555555555555"
    val pending = ConversationRepository.parsePendingInput(
      """{"kind":"task","taskId":"task-1","clientMessageId":"$id","input":{"content":"Continue"}}""")
    assertEquals("task-1", pending.taskId)
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parsePendingInput(
        """{"kind":"task","taskId":"../other","clientMessageId":"$id","input":{"content":"Continue"}}""")
    }
  }
  @Test fun parsesGatewayListAndCompactHistory() {
    val list = ConversationRepository.parseList("""{"items":[{"key":"11111111-2222-3333-4444-555555555555","displayName":"A chat","updatedAt":"2026-10-04T00:00:00Z","messageCount":2,"agentId":"main","status":"pinned"}],"hasMore":false} """)
    assertEquals("A chat", list.items.single().title)
    assertEquals("pinned", list.items.single().status)
    assertEquals(1, list.remoteCount)
    assertEquals(false, list.hasMore)
    val id = list.items.single().id
    val history = ConversationRepository.parseHistory(id,
      """{"session":{"key":"$id","transcriptId":"transcript-1","messages":[{"id":"1","role":"user","content":"Hello"},{"id":"2","role":"assistant","turnId":"turn-1","content":[{"type":"text","text":"Hi"},{"type":"toolCall","name":"search"}]},{"id":"3","role":"assistant","content":[{"type":"toolCall","name":"search"}]}]}}""")
    assertEquals(listOf("Hello", "Hi"), history.messages.map { it.text })
    assertEquals("transcript-1", history.transcriptId)
    assertEquals("turn-1", history.messages.last().turnId)
  }

  @Test fun compactHistoryKeepsReferencesMediaDeliverablesAndOpenTargets() {
    val id = "11111111-2222-3333-4444-555555555555"
    val raw = """{"session":{"key":"$id","messages":[{"id":"u1","role":"user","content":"Review this","media":[{"id":"m1","name":"brief.txt","type":"document","mimeType":"text/plain","size":5,"uri":"data:text/plain;base64,aGVsbG8="}],"metadata":{"sourceContexts":[{"kind":"note","sourceId":"note-1","version":"3","title":"Brief"}]}},{"id":"a1","role":"assistant","turnId":"turn-1","content":"Done","deliveries":[{"version":2,"operation":"created","primary":{"kind":"task","id":"task-1","title":"Ship","capabilities":["open"]}}],"metadata":{"turnOutcome":{"version":1,"outcomeId":"out-1","runId":"run-1","turnId":"turn-1","status":"succeeded","summary":"Created report","deliverables":[{"artifactId":"artifact-1","title":"report.md","kind":"document","mimeType":"text/markdown","sizeBytes":6,"availability":"available","location":"artifact_store","capabilities":["preview"],"uri":"media://outbound/report.md"}],"evidence":[],"createdAt":"2026-10-05T00:00:00Z"}}}]}}"""
    val messages = ConversationRepository.parseHistory(id, raw).messages
    assertEquals("Brief", messages.first().references.single().title)
    assertEquals("brief.txt", messages.first().media.single().name)
    assertEquals("task-1", messages.last().targets.single().id)
    assertEquals("report.md", messages.last().outcome?.artifacts?.single()?.title)
    assertEquals(true, messages.all { it.hasNonTextContent })
  }

  @Test fun executionDetailUsesOnlyBoundedPublicProjection() {
    val detail = ConversationRepository.parseExecutionDetail("turn-1", """{"detail":{"turnId":"turn-1","steps":[{"id":"a","kind":"thinking"},{"id":"b","kind":"tool","category":"search","preview":"weather report","status":"done"},{"id":"c","kind":"tool","category":"search","preview":"latest forecast","status":"done"}]}}""")
    assertEquals("weather report", detail.steps[1].preview)
    assertEquals("search", detail.steps[2].category)
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseExecutionDetail("another-turn", """{"detail":{"turnId":"turn-1","steps":[]}}""")
    }
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseExecutionDetail("turn-1", """{"detail":{"turnId":"turn-1","steps":[{"id":"x","kind":"raw"}]}}""")
    }
  }

  @Test fun emptyPageEndsPaginationEvenIfGatewayClaimsMore() {
    val page = ConversationRepository.parseList("""{"items":[],"hasMore":true}""")
    assertEquals(0, page.remoteCount)
    assertEquals(false, page.hasMore)
  }

  @Test fun sessionListRetainsTaskChildrenForReturnedParentsOnly() {
    val parent = "11111111-2222-3333-4444-555555555555"
    val child = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    val page = ConversationRepository.parseList("""{"items":[{"key":"$parent","title":"Parent",
      "updatedAt":"2026-10-05T00:00:00Z","messageCount":1}],"hasMore":false,
      "childrenByConversationId":{"$parent":{"total":1,"activeCount":1,"items":[{"taskId":"task-1",
      "title":"Research","phase":"active","runStatus":"running","activeConversationId":"$child"}]},
      "other":{"total":0,"activeCount":0,"items":[]}}}""")
    assertEquals(setOf(parent), page.taskGroups.keys)
    assertEquals("task-1", page.taskGroups.getValue(parent).items.single().taskId)
    assertEquals(child, page.taskGroups.getValue(parent).items.single().activeConversationId)
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseList("""{"items":[{"key":"$parent","title":"Parent",
        "updatedAt":"2026-10-05T00:00:00Z","messageCount":1}],"hasMore":false,
        "childrenByConversationId":{"$parent":{"total":0,"activeCount":0,"items":[{"taskId":"task-1",
        "title":"Research","phase":"active"}]}}}""")
    }
  }

  @Test fun contextSummaryRetainsScopeAndRejectsAnotherConversation() {
    val id = "11111111-2222-3333-4444-555555555555"
    val raw = """{"summary":{"conversationId":"$id","work":{"project":{"id":"project-1","title":"Alpha"},"task":{"id":"task-1","title":"Review"}},"environment":{"kind":"managed_worktree","rootPath":"/work/alpha","available":true,"branch":"main"},"sources":[{"id":"note-1","title":"Brief","unavailable":false}],"sourcesHasMore":true,"unavailableSections":["attachments"]}}"""
    val config = """{"ok":true,"payload":{"workingDirectoryLocked":true}}"""
    val summary = ConversationRepository.parseContext(id, raw, config)
    assertEquals("Alpha", summary.project?.title)
    assertEquals("Review", summary.task?.title)
    assertEquals("/work/alpha", summary.environment?.rootPath)
    assertEquals("Brief", summary.sources.single().title)
    assertEquals(true, summary.sourcesHasMore)
    assertEquals(true, summary.workingDirectoryLocked)
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseContext("other", raw, config)
    }
  }

  @Test fun taskWelcomeRequiresMatchingTaskAndKeepsOnlyRelevantPublicFields() {
    val raw = """{"ok":true,"task":{"id":"task-1","title":"Review release","phase":"review"},"operationalState":"verifying","attention":[{"summary":"Approve the release"}],"receipts":[{"nextAction":"Run checks","failure":{"recoveryAction":"Retry build"}}]}"""
    val detail = ConversationRepository.parseTaskWelcome("task-1", raw)
    assertEquals("Review release", detail.taskTitle)
    assertEquals("Approve the release", detail.attentionSummary)
    assertEquals("Retry build", detail.recentFailure)
    assertEquals("Run checks", detail.nextAction)
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseTaskWelcome("another-task", raw)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseTaskWelcome("task-1", raw.replace("\"review\"", "\"unknown\""))
    }
  }

  @Test fun projectWelcomeRequiresBothResponsesToMatchAndUsesAttentionFailure() {
    val detail = """{"ok":true,"project":{"id":"project-1","name":"Alpha"}}"""
    val view = """{"ok":true,"view":{"project":{"id":"project-1"},"digest":{"health":"attention","recommendedAction":"Ship release"},"blockers":[{"title":"Waiting","detail":"Approval needed"}],"recentResults":[{"receipt":{"status":"failed","summary":"Build failed","failure":{"recoveryAction":"Retry build"},"verification":{"status":"failed"}}}]}}"""
    val result = ConversationRepository.parseProjectWelcome("project-1", detail, view)
    assertEquals("Alpha", result.projectName)
    assertEquals("Approval needed", result.blockedReason)
    assertEquals("Retry build", result.recentFailure)
    assertEquals("Ship release", result.recommendedAction)
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseProjectWelcome("project-2", detail, view)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseProjectWelcome("project-1", detail,
        view.replace("\"id\":\"project-1\"", "\"id\":\"other\""))
    }
    val healthy = ConversationRepository.parseProjectWelcome("project-1", detail,
      view.replace("\"health\":\"attention\"", "\"health\":\"healthy\""))
    assertEquals(null, healthy.recentFailure)
  }

  @Test fun rejectsMismatchedConversationIdentity() {
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseHistory("expected", """{"session":{"key":"other","messages":[]}}""")
    }
  }

  @Test fun preservesMillisecondSizedConfigVersion() {
    assertEquals(1_780_550_000_123L, ConversationRepository.parseConfigVersion(
      """{"ok":true,"payload":{"configVersion":1780550000123}}"""))
  }

  @Test fun parsesActiveRunAndRejectsCrossConversationState() {
    val id = "11111111-2222-3333-4444-555555555555"
    assertEquals("run-1", ConversationRepository.parseActiveRun(id,
      """{"ok":true,"payload":{"conversationId":"$id","activeRunId":"run-1","inputs":[]}}"""))
    assertEquals(null, ConversationRepository.parseActiveRun(id,
      """{"ok":true,"payload":{"conversationId":"$id","activeRunId":null,"inputs":[]}}"""))
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseActiveRun(id,
        """{"ok":true,"payload":{"conversationId":"other","activeRunId":"run-1","inputs":[]}}""")
    }
  }

  @Test fun pendingInputRequiresStableCommandIdentityAndContent() {
    val id = "11111111-2222-3333-4444-555555555555"
    val raw = """{"kind":"append","clientMessageId":"$id","input":{"content":"Retry me"}}"""
    assertEquals(PendingInput(id, "Retry me"), ConversationRepository.parsePendingInput(raw))
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parsePendingInput(raw.replace(id, "not-a-uuid"))
    }
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parsePendingInput(raw.replace("Retry me", ""))
    }
    val withRef = """{"kind":"start","clientMessageId":"$id","input":{"content":"Update me","contextRefs":[{"kind":"user_assertion","sourceId":"assertion-1","expectedVersion":"123"}]}}"""
    assertEquals(listOf(ConversationContextRef("user_assertion", "assertion-1", "123", "")),
      ConversationRepository.parsePendingInput(withRef).contextRefs)
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parsePendingInput(withRef.replace("user_assertion", "unknown"))
    }
  }

  @Test fun attachmentOnlyPendingInputKeepsBoundedMetadataWithoutWireData() {
    val attachment = ChatAttachment("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "document",
      "brief.txt", "text/plain", 3)
    val metadata = ConversationRepository.attachmentsJson(listOf(attachment))
    val pending = ConversationRepository.parsePendingInput(JSONObject()
      .put("kind", "start")
      .put("clientMessageId", "11111111-2222-3333-4444-555555555555")
      .put("localAttachments", metadata)
      .put("input", JSONObject().put("content", "")).toString())
    assertEquals(listOf(attachment), pending.attachments)
    assertEquals(false, metadata.getJSONObject(0).has("data"))
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseAttachments(org.json.JSONArray().put(metadata.getJSONObject(0))
        .put(metadata.getJSONObject(0)))
    }
  }

  @Test fun noteAndTaskReferencesKeepKindsVersionsAndBoundedUniqueness() {
    val refs = listOf(ConversationContextRef("note", "same-id", "123", "Brief"),
      ConversationContextRef("task", "same-id", "7", "Ship"))
    val stored = ConversationRepository.contextRefsJson(refs)
    assertEquals(refs, ConversationRepository.parseContextRefs(stored))
    val wire = ConversationRepository.contextRefsJson(refs, includeTitle = false)
    assertEquals(false, wire.getJSONObject(0).has("title"))
    assertEquals(refs.map { it.copy(title = "") }, ConversationRepository.parseContextRefs(wire))
    val pending = """{"kind":"start","clientMessageId":"11111111-2222-3333-4444-555555555555","input":{"content":"","contextRefs":$wire}}"""
    assertEquals(refs.map { it.copy(title = "") },
      ConversationRepository.parsePendingInput(pending).contextRefs)
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.contextRefsJson(refs + refs.first())
    }
  }

  @Test fun modelCatalogAndVersionedConfigUseGatewayIdentity() {
    val models = ConversationRepository.parseModels("""{"ok":true,"payload":{"defaultId":"test/one","models":[{"id":"test/one","name":"One","thinking":{"initialValue":"low"}},{"id":"test/two","name":"Two"}]}}""")
    assertEquals("test/one", models.selectedId)
    assertEquals(listOf("low", "off"), models.models.map { it.initialThinkingLevel })
    assertEquals("test/two" to 12L, ConversationRepository.parseModelConfig(
      """{"ok":true,"payload":{"model":"test/two","configVersion":12}}"""))
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseModels("""{"ok":true,"payload":{"models":[{"id":"","name":"Invalid"}]}}""")
    }
  }

  @Test fun agentCatalogRequiresDefaultToBeAnAvailableAgent() {
    val catalog = ConversationRepository.parseAgents("""{"ok":true,"payload":{"defaultId":"main","agents":[{"id":"main","name":"Main"},{"id":"research","name":"Research","description":"Explore sources"}]}}""")
    assertEquals("main", catalog.defaultId)
    assertEquals(listOf("main", "research"), catalog.agents.map { it.id })
    assertThrows(IllegalArgumentException::class.java) {
      ConversationRepository.parseAgents("""{"ok":true,"payload":{"defaultId":"missing","agents":[{"id":"main"}]}}""")
    }
  }
}
