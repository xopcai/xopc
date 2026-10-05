package ai.xopc.mobile.gateway

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.nio.ByteBuffer
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.Base64
import java.util.UUID
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.bouncycastle.asn1.ASN1EncodableVector
import org.bouncycastle.asn1.ASN1Integer
import org.bouncycastle.asn1.DERSequence
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class GatewaySessionTest {
  @Test fun compactHistoryMarksUserMediaAndReferencesAsNonTextForReuse() {
    val id = "11111111-2222-3333-4444-555555555555"
    val history = ConversationRepository.parseHistory(id,
      """{"session":{"key":"$id","messages":[
        {"id":"plain","role":"user","content":"Plain"},
        {"id":"photo","role":"user","content":"Photo","media":[{"name":"a.jpg"}]},
        {"id":"ref","role":"user","content":"Reference","metadata":{"sourceContexts":[{"sourceId":"n1"}]}},
        {"id":"image","role":"user","content":"","rawContent":[{"type":"image"}]}
      ]}}""")
    assertEquals(listOf(false, true, true, true), history.messages.map { it.hasNonTextContent })
    assertEquals(4, history.messages.size)
  }
  private val gatewayId = UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
  private val pairingId = UUID.fromString("11111111-2222-3333-4444-555555555555")
  private val signingKey = Ed25519PrivateKeyParameters(ByteArray(32) { (it + 1).toByte() }, 0)
  private val origin = "https://gateway.example"

  @Test fun assistantMessageQuickCaptureUsesHarmonyNoteContractAndStableMutationKey() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = AndroidSecureStore(context, "message_note_credentials_test_v1",
      "xopc.gateway.credentials.message.note.test.v1")
    clear(store)
    try {
      val fake = FakeGateway()
      val session = GatewaySession(context, fake,
        DeviceIdentity("xopc.gateway.device.message.note.p256.test.v1"), store)
      session.pair(invitation()) {}
      val notes = NoteRepository(session)
      val mutationId = "12345678-1234-1234-1234-123456789abc"
      assertEquals("note-captured", notes.quickCaptureMessage("Answer to keep", mutationId))
      assertEquals(listOf("/api/notes/quick-capture"), fake.noteCapturePaths)
      assertThrows(IllegalArgumentException::class.java) {
        notes.quickCaptureMessage("   ", mutationId)
      }
    } finally { clear(store) }
  }

  @Test fun shareCenterReadsAndConfirmsExtendAndRevokeWithGatewayShape() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = AndroidSecureStore(context, "share_center_credentials_test_v1",
      "xopc.gateway.credentials.share.center.test.v1")
    clear(store)
    try {
      val fake = FakeGateway()
      val session = GatewaySession(context, fake,
        DeviceIdentity("xopc.gateway.device.share.center.p256.test.v1"), store)
      session.pair(invitation()) {}
      val repository = ShareRepository(session)
      val item = repository.list().single()
      assertEquals("share-1", item.id)
      assertEquals(true, item.active)
      assertEquals(null, item.lanUrl)
      assertEquals("", item.hint)
      val extended = repository.extend(item, 1)
      assertEquals("https://share.example/s/test", extended.url)
      assertEquals(fake.shareExpiresAt, extended.expiresAt)
      repository.revoke(item.id)
      assertEquals(false, repository.list().single().active)
      assertEquals(listOf("PATCH /api/shares/share-1", "DELETE /api/shares/share-1"), fake.shareMutations)
      assertEquals(2, fake.shareReadCount)
      assertThrows(IllegalArgumentException::class.java) { repository.revoke("../bad") }
      assertThrows(IllegalArgumentException::class.java) { repository.extend(item, 9) }
      assertThrows(IllegalArgumentException::class.java) {
        ShareRepository.parseList("""{"ok":true,"payload":{"shares":[{"id":"share-1",
          "kind":"note","fileName":"Bad","shareUrl":"javascript:alert(1)",
          "reachability":"public","expiresAt":"2030-01-01T00:00:00Z",
          "revoked":false,"expired":false}]}}""")
      }
    } finally { clear(store) }
  }

  @Test fun conversationShareRequiresPreviewAndSendsHarmonySnapshotFingerprint() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = AndroidSecureStore(context, "conversation_share_credentials_test_v1",
      "xopc.gateway.credentials.conversation.share.test.v1")
    clear(store)
    try {
      val fake = FakeGateway()
      val session = GatewaySession(context, fake,
        DeviceIdentity("xopc.gateway.device.conversation.share.p256.test.v1"), store)
      session.pair(invitation()) {}
      val repository = ConversationRepository(session, context)
      val id = "11111111-2222-3333-4444-555555555555"
      val preview = repository.sharePreview(id)
      assertEquals(2, preview.messageCount)
      assertEquals(1, preview.attachmentCount)
      assertEquals(0, fake.sessionShareWrites)
      val result = repository.share(preview)
      assertEquals("share-session-1", result.id)
      assertEquals("https://share.example/s/session", result.url)
      assertEquals(1, fake.sessionShareReads)
      assertEquals(1, fake.sessionShareWrites)
      assertThrows(IllegalArgumentException::class.java) {
        ConversationRepository.parseConversationShare(preview,
          """{"ok":true,"payload":{"id":"bad","kind":"session","shareUrl":"javascript:bad",
            "reachability":"public","expiresAt":"2030-01-01T00:00:00Z"}}""")
      }
    } finally { clear(store) }
  }

  @Test fun personalGoalWritesFollowHarmonyRequestShapeAndConfirmIdentity() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = AndroidSecureStore(context, "goal_credentials_test_v1", "xopc.gateway.credentials.goal.test.v1")
    clear(store)
    try {
      val fake = FakeGateway()
      val session = GatewaySession(context, fake, DeviceIdentity("xopc.gateway.device.goal.p256.test.v1"), store)
      session.pair(invitation()) {}
      val repository = PersonalRepository(session)
      assertThrows(IllegalArgumentException::class.java) {
        repository.saveGoal(null, " ", "Outcome", "active", null)
      }
      assertThrows(IllegalArgumentException::class.java) {
        repository.saveGoal("../bad", "Title", "Outcome", "active", null)
      }
      assertEquals("goal-created", repository.saveGoal(null, " New goal ", " Done ", "active", 9000L))
      assertEquals("goal-created", repository.saveGoal("goal-created", "New goal", "Done", "paused", null))
      assertEquals(listOf("POST /api/user-model/goals", "PATCH /api/user-model/goals/goal-created"),
        fake.goalWrites)
    } finally { clear(store) }
  }

  @Test fun understandingReadsUseMobileFilterSearchCursorAndVerifiedDetail() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = AndroidSecureStore(context, "understanding_credentials_test_v1",
      "xopc.gateway.credentials.understanding.test.v1")
    clear(store)
    try {
      val fake = FakeGateway()
      val session = GatewaySession(context, fake,
        DeviceIdentity("xopc.gateway.device.understanding.p256.test.v1"), store)
      session.pair(invitation()) {}
      val repository = PersonalRepository(session)
      assertThrows(IllegalArgumentException::class.java) { repository.assertions("invalid", "") }
      assertThrows(IllegalArgumentException::class.java) { repository.assertion("../bad") }
      assertEquals("assertion-1", repository.assertions("review", "alpha beta", "next+page")
        .items.single().id)
      assertEquals("Project chat", repository.assertion("assertion-1").sources.single())
      assertThrows(java.time.DateTimeException::class.java) {
        repository.updateProfile(PersonalProfile("Mia", "Designer", "they", "Not/AZone", "zh"))
      }
      assertEquals("Mia", repository.updateProfile(PersonalProfile(" Mia ", " Designer ",
        "they", "Asia/Shanghai", "zh")).callName)
      assertEquals(1, fake.profileWrites)
      assertThrows(IllegalArgumentException::class.java) {
        repository.updateStatement("assertion-1", " ")
      }
      val corrected = repository.updateStatement("assertion-1", "Prefers short answers")
      assertEquals("assertion-2", corrected.id)
      repository.deleteAssertion(corrected.id)
      assertEquals(listOf("PATCH /api/user-model/assertions/assertion-1",
        "DELETE /api/user-model/assertions/assertion-2"), fake.assertionWrites)
      assertEquals(listOf("/api/user-model/assertions?view=mobile&limit=20&filter=review&q=alpha+beta&cursor=next%2Bpage",
        "/api/user-model/assertions/assertion-1", "/api/user-model/assertions/assertion-2"),
        fake.assertionReadPaths)
    } finally { clear(store) }
  }

  @Test fun understandingChatKeepsVersionedReferenceAcrossStoreRecreationAndSendsOnlyProtocolFields() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val credentials = AndroidSecureStore(context, "understanding_chat_credentials_test_v1",
      "xopc.gateway.credentials.understanding.chat.test.v1")
    val local = AndroidSecureStore(context)
    val indexKey = "draft-index.$gatewayId"
    val previousIndex = local.read(indexKey)
    clear(credentials)
    val draftIds = mutableListOf<String>()
    try {
      val fake = FakeGateway().apply { expectedInputContent = "I want to update this understanding to: " }
      val session = GatewaySession(context, fake,
        DeviceIdentity("xopc.gateway.device.understanding.chat.p256.test.v1"), credentials)
      session.pair(invitation()) {}
      val repository = ConversationRepository(session, context)
      val draft = repository.createDraft("main")
      draftIds += draft.conversationId
      val ref = ConversationContextRef("user_assertion", "assertion-1", "123", "Prefers concise answers")
      repository.saveComposerDraft(draft.conversationId, fake.expectedInputContent)
      repository.saveComposerRefs(draft.conversationId, listOf(ref))
      val restored = ConversationRepository(session, context)
      assertEquals(fake.expectedInputContent, restored.composerDraft(draft.conversationId))
      assertEquals(listOf(ref), restored.composerRefs(draft.conversationId))
      assertEquals(0, fake.inputPostCount)
      restored.prepareDraftModel(draft.conversationId)
      assertEquals("run-restored", restored.send(draft.conversationId,
        fake.expectedInputContent, TurnClaim("endpoint", "claim"), restored.composerRefs(draft.conversationId)))
      val sentRefs = fake.lastInputCommand!!.getJSONObject("input").getJSONArray("contextRefs")
      assertEquals(1, sentRefs.length())
      assertEquals("user_assertion", sentRefs.getJSONObject(0).getString("kind"))
      assertEquals("assertion-1", sentRefs.getJSONObject(0).getString("sourceId"))
      assertEquals("123", sentRefs.getJSONObject(0).getString("expectedVersion"))
      assertEquals(false, sentRefs.getJSONObject(0).has("title"))
      assertEquals(emptyList<ConversationContextRef>(), restored.composerRefs(draft.conversationId))
      assertEquals(null, restored.draft(draft.conversationId))
      val retryDraft = restored.createDraft("main")
      draftIds += retryDraft.conversationId
      restored.saveComposerDraft(retryDraft.conversationId, fake.expectedInputContent)
      restored.saveComposerRefs(retryDraft.conversationId, listOf(ref))
      val messageId = UUID.randomUUID().toString()
      local.write("pending-input.$gatewayId.${retryDraft.conversationId}", JSONObject()
        .put("kind", "start").put("clientMessageId", messageId)
        .put("input", JSONObject().put("content", fake.expectedInputContent)
          .put("contextRefs", ConversationRepository.contextRefsJson(listOf(ref), includeTitle = false))).toString())
      val afterRestart = ConversationRepository(session, context)
      assertEquals(listOf(ref.copy(title = "")), afterRestart.pendingInput(retryDraft.conversationId)?.contextRefs)
      assertEquals("run-restored", afterRestart.send(retryDraft.conversationId,
        fake.expectedInputContent, TurnClaim("endpoint", "claim"), listOf(ref)))
      assertEquals(1, fake.inputPostCount)
      assertEquals(null, afterRestart.pendingInput(retryDraft.conversationId))
      assertEquals(emptyList<ConversationContextRef>(), afterRestart.composerRefs(retryDraft.conversationId))
    } finally {
      draftIds.forEach { id ->
        listOf("draft.$gatewayId.$id", "composer.$gatewayId.$id",
          "composer-refs.$gatewayId.$id", "pending-input.$gatewayId.$id").forEach(local::remove)
      }
      if (previousIndex == null) local.remove(indexKey) else local.write(indexKey, previousIndex)
      clear(credentials)
    }
  }

  @Test fun attachmentOnlyInputSurvivesRecreationAndReceiptRetryDoesNotRepost() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val credentials = AndroidSecureStore(context, "chat_attachment_credentials_test_v1",
      "xopc.gateway.credentials.chat.attachment.test.v1")
    val local = AndroidSecureStore(context)
    val attachmentStore = ChatAttachmentStore(context)
    val indexKey = "draft-index.$gatewayId"
    val previousIndex = local.read(indexKey)
    clear(credentials)
    val draftIds = mutableListOf<String>()
    try {
      val fake = FakeGateway().apply { expectedInputContent = "" }
      val session = GatewaySession(context, fake,
        DeviceIdentity("xopc.gateway.device.chat.attachment.p256.test.v1"), credentials)
      session.pair(invitation()) {}
      val repository = ConversationRepository(session, context)
      val draft = repository.createDraft("main")
      draftIds += draft.conversationId
      val item = attachmentStore.addBytes(gatewayId.toString(), draft.conversationId,
        "brief.txt", "text/plain", "hello attachment".toByteArray())
      val restored = ConversationRepository(session, context)
      assertEquals(listOf(item), restored.composerAttachments(draft.conversationId))
      restored.prepareDraftModel(draft.conversationId)
      assertEquals("run-restored", restored.send(draft.conversationId, "",
        TurnClaim("endpoint", "claim"), attachments = restored.composerAttachments(draft.conversationId)))
      val command = fake.lastInputCommand!!
      assertEquals(false, command.has("localAttachments"))
      assertEquals("hello attachment", String(Base64.getDecoder().decode(command
        .getJSONObject("input").getJSONArray("attachments").getJSONObject(0).getString("data"))))
      assertEquals(emptyList<ChatAttachment>(), restored.composerAttachments(draft.conversationId))
      assertEquals(1, fake.inputPostCount)

      val retryDraft = restored.createDraft("main")
      draftIds += retryDraft.conversationId
      val retryItem = attachmentStore.addBytes(gatewayId.toString(), retryDraft.conversationId,
        "retry.png", "image/png", byteArrayOf(1, 2, 3))
      val messageId = UUID.randomUUID().toString()
      local.write("pending-input.$gatewayId.${retryDraft.conversationId}", JSONObject()
        .put("kind", "start").put("clientMessageId", messageId)
        .put("localAttachments", ConversationRepository.attachmentsJson(listOf(retryItem)))
        .put("input", JSONObject().put("content", "")).toString())
      val afterRestart = ConversationRepository(session, context)
      assertEquals(listOf(retryItem), afterRestart.pendingInput(retryDraft.conversationId)?.attachments)
      assertEquals("run-restored", afterRestart.send(retryDraft.conversationId, "",
        TurnClaim("endpoint", "claim"), attachments = listOf(retryItem)))
      assertEquals(1, fake.inputPostCount)
      assertEquals(null, afterRestart.pendingInput(retryDraft.conversationId))
      assertEquals(emptyList<ChatAttachment>(), afterRestart.composerAttachments(retryDraft.conversationId))
    } finally {
      draftIds.forEach { id ->
        attachmentStore.removeConversation(gatewayId.toString(), id)
        listOf("draft.$gatewayId.$id", "composer.$gatewayId.$id",
          "composer-refs.$gatewayId.$id", "pending-input.$gatewayId.$id").forEach(local::remove)
      }
      if (previousIndex == null) local.remove(indexKey) else local.write(indexKey, previousIndex)
      clear(credentials)
    }
  }

  @Test fun noteAndTaskReferencesSurviveRecreationAndSendWithVersions() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val credentials = AndroidSecureStore(context, "source_ref_credentials_test_v1",
      "xopc.gateway.credentials.source.ref.test.v1")
    val local = AndroidSecureStore(context)
    val indexKey = "draft-index.$gatewayId"
    val previousIndex = local.read(indexKey)
    clear(credentials)
    var draftId: String? = null
    try {
      val fake = FakeGateway().apply { expectedInputContent = "" }
      val session = GatewaySession(context, fake,
        DeviceIdentity("xopc.gateway.device.source.ref.p256.test.v1"), credentials)
      session.pair(invitation()) {}
      val repository = ConversationRepository(session, context)
      val draft = repository.createDraft("main")
      draftId = draft.conversationId
      val refs = listOf(ConversationContextRef("note", "note-1", "123", "Brief"),
        ConversationContextRef("task", "task-1", "7", "Ship"))
      repository.saveComposerDraft(draft.conversationId, fake.expectedInputContent)
      repository.saveComposerRefs(draft.conversationId, refs)
      val restored = ConversationRepository(session, context)
      assertEquals(refs, restored.composerRefs(draft.conversationId))
      restored.prepareDraftModel(draft.conversationId)
      assertEquals("run-restored", restored.send(draft.conversationId,
        fake.expectedInputContent, TurnClaim("endpoint", "claim"), refs))
      val wire = fake.lastInputCommand!!.getJSONObject("input").getJSONArray("contextRefs")
      assertEquals(listOf("note", "task"), (0 until wire.length()).map { wire.getJSONObject(it).getString("kind") })
      assertEquals(listOf("123", "7"), (0 until wire.length()).map {
        wire.getJSONObject(it).getString("expectedVersion") })
      assertEquals(false, wire.getJSONObject(0).has("title"))
      assertEquals(emptyList<ConversationContextRef>(), restored.composerRefs(draft.conversationId))
    } finally {
      draftId?.let { id ->
        listOf("draft.$gatewayId.$id", "composer.$gatewayId.$id",
          "composer-refs.$gatewayId.$id", "pending-input.$gatewayId.$id").forEach(local::remove)
      }
      if (previousIndex == null) local.remove(indexKey) else local.write(indexKey, previousIndex)
      clear(credentials)
    }
  }

  @Test fun pairsAfterApprovalAndRestoresRotatingCredential() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = AndroidSecureStore(context, "gateway_credentials_test_v1", "xopc.gateway.credentials.test.v1")
    clear(store)
    try {
      val fake = FakeGateway()
      val session = GatewaySession(context, fake, DeviceIdentity("xopc.gateway.device.p256.test.v1"), store)
      var code = ""
      val paired = session.pair(invitation()) { code = it }
      assertEquals("123456", code)
      assertEquals(gatewayId.toString(), paired.gatewayId)
      assertEquals("device-1", paired.deviceId)
      assertNotNull(store.read("refresh.$gatewayId"))
      assertEquals("{\"status\":\"ok\"}", session.request("/api/status"))
      assertEquals("access-test", fake.lastBearer)
      assertNotNull(store.read("refresh.$gatewayId"))
      assertEquals(null, store.read("refresh-attempt.$gatewayId"))
      val conversationId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
      session.saveMainConversationId(conversationId)
      val restored = GatewaySession(context, fake, DeviceIdentity("xopc.gateway.device.p256.test.v1"), store)
      assertEquals(paired, restored.restore())
      assertEquals(conversationId, restored.mainConversationId())
      assertEquals("{\"status\":\"ok\"}", restored.request("/api/status"))
      assertEquals(listOf("main", "research"), ConversationRepository(restored, context).agents().agents.map { it.id })
      val modelResult = ConversationRepository(restored, context).setModel(conversationId,
        ConversationModel("test/two", "Two", "off"), 12)
      assertEquals("test/two", modelResult.selectedId)
      assertEquals(13L, modelResult.configVersion)
      assertEquals(12L, fake.lastModelPatch?.getLong("configVersion"))
      assertEquals("test/two", fake.lastModelPatch?.getString("model"))
      val pendingStore = AndroidSecureStore(context)
      val draftIndexKey = "draft-index.$gatewayId"
      val previousDraftIndex = pendingStore.read(draftIndexKey)
      var newDraftId: String? = null
      val pendingKey = "pending-input.$gatewayId.$conversationId"
      val messageId = "99999999-aaaa-bbbb-cccc-dddddddddddd"
      try {
        pendingStore.write(pendingKey, JSONObject().put("kind", "append").put("clientMessageId", messageId)
          .put("input", JSONObject().put("content", "Unconfirmed message")).toString())
        val repository = ConversationRepository(restored, context)
        assertThrows(IllegalArgumentException::class.java) { repository.rename(conversationId, "  ") }
        repository.rename(conversationId, "  Renamed test chat  ")
        assertEquals("Renamed test chat", fake.lastRename)
        repository.setPinned(conversationId, true)
        repository.setPinned(conversationId, false)
        assertEquals(listOf("pin", "unpin"), fake.pinActions)
        repository.setArchived(conversationId, true)
        repository.setArchived(conversationId, false)
        assertEquals(listOf("archive", "unarchive"), fake.archiveActions)
        val execution = repository.executionDetail(conversationId, "turn-1")
        assertEquals("turn-1", execution.turnId)
        assertEquals("search", execution.steps.single().category)
        val projectWelcome = repository.projectWelcome(ContextWorkItem("project-1", "Alpha"))
        assertEquals("Approval needed", projectWelcome.blockedReason)
        assertEquals("Ship release", projectWelcome.recommendedAction)
        assertEquals(listOf("/api/projects/project-1", "/api/projects/project-1/operating-view"),
          fake.projectReadPaths)
        fake.progressProjectPaths.clear()
        val progress = ProgressRepository(restored)
        assertEquals("Alpha", progress.projects().single().name)
        assertEquals("Alpha", progress.project("project-1").name)
        assertEquals("task-project", progress.projectTasks("project-1").items.single().id)
        assertThrows(IllegalArgumentException::class.java) {
          progress.createTask(" ", "Description", "project-1", "fixed-create-key")
        }
        assertEquals("task-created", progress.createTask(" New task ", "Description", "project-1",
          "fixed-create-key").id)
        assertEquals(listOf("/api/projects?limit=100&sortBy=updatedAt&sortOrder=desc&includeOperating=true",
          "/api/projects/project-1", "/api/tasks?projectId=project-1&limit=30&offset=0"),
          fake.progressProjectPaths)
        assertEquals(listOf("/api/tasks"), fake.progressCreatePaths)
        assertEquals("Review task", progress.home("en").needsUser.single().title)
        assertThrows(IllegalArgumentException::class.java) {
          progress.act(ProgressHomeAction("connector_decision", "Approve", "../bad", "approve"))
        }
        progress.act(ProgressHomeAction("connector_decision", "Approve", "approval-1", "approve"))
        progress.act(ProgressHomeAction("retry_run", "Retry", subjectKind = "automation_run", runId = "run-1"))
        progress.act(ProgressHomeAction("acknowledge_run", "Ignore", subjectKind = "workflow_run", runId = "run-2"))
        assertEquals(listOf("/api/home/decisions/respond", "/api/home/attention/retry",
          "/api/home/attention/acknowledge"), fake.progressHomeActionPaths)
        assertEquals("task-2", progress.tasks().items.single().id)
        assertEquals("task-2", progress.tasks(search = "alpha beta").items.single().id)
        val task = progress.task("task-2")
        assertEquals("high", task.priority)
        assertEquals("Changed task", progress.updateTask(task, " Changed task ", "Edited body", "").title)
        assertEquals(listOf("/api/tasks/task-2"), fake.progressEditPaths)
        assertThrows(IllegalArgumentException::class.java) { progress.command(task, "reopen", "invalid") }
        assertEquals("closed", progress.command(task, "close", "fixed-test-command-key").phase)
        val startTask = progress.task("task-start")
        assertThrows(IllegalArgumentException::class.java) {
          progress.command(startTask, "start", "invalid", " ")
        }
        assertEquals("active", progress.command(startTask, "start", "fixed-start-command-key", " research ").phase)
        assertEquals(listOf("/api/tasks/task-2/commands", "/api/tasks/task-start/commands"), fake.progressCommandPaths)
        assertEquals(listOf("/api/home?locale=en", "/api/tasks?limit=50&offset=0",
          "/api/tasks?limit=50&offset=0&search=alpha+beta", "/api/tasks/task-2", "/api/tasks/task-start"),
          fake.progressReadPaths)
        val automations = AutomationRepository(restored)
        assertEquals("Morning brief", automations.list().single().name)
        assertEquals("0 9 * * *", automations.detail("auto-1").schedule)
        assertEquals("run-1", automations.runs("auto-1").single().id)
        assertEquals("succeeded", automations.run("run-1").status)
        assertEquals("Queued", automations.events("run-1").single().message)
        assertEquals(listOf("/api/automations", "/api/automations/auto-1",
          "/api/automation-runs?limit=30&automationId=auto-1", "/api/automation-runs/run-1",
          "/api/automation-runs/run-1/events"), fake.automationReadPaths)
        val automation = automations.detail("auto-1")
        assertEquals("run-new", automations.runNow(automation).id)
        val pausedAutomation = automations.setEnabled(automation, false)
        assertEquals(false, pausedAutomation.enabled)
        assertEquals(true, automations.setEnabled(pausedAutomation, true).enabled)
        assertEquals(listOf("/api/automations/auto-1/run", "/api/automations/auto-1/pause",
          "/api/automations/auto-1/resume"), fake.automationActionPaths)
        val createdAutomation = automations.create(" New brief ", " Summarize today ", "0 8 * * *",
          "11111111-2222-3333-4444-555555555555")
        assertEquals("auto-created", createdAutomation.id)
        assertEquals(listOf("/api/automations"), fake.automationCreatePaths)
        val updatedAutomation = automations.update(automation, " Updated brief ", " Plan tomorrow ",
          "0 10 * * *", "22222222-3333-4444-5555-666666666666")
        assertEquals("Updated brief", updatedAutomation.name)
        assertEquals("0 10 * * *", updatedAutomation.schedule)
        automations.delete(updatedAutomation, "33333333-4444-5555-6666-777777777777")
        assertEquals(listOf("PATCH", "DELETE"), fake.automationEditMethods)
        val notes = NoteRepository(restored)
        assertEquals("note-1", notes.list("idea", "inbox").items.single().id)
        assertEquals("# Idea", notes.detail("note-1").markdown)
        assertEquals(listOf("/api/notes?limit=30&offset=0&sortBy=updatedAt&sortOrder=desc&search=idea&status=inbox",
          "/api/notes/note-1"), fake.noteReadPaths)
        val noteDraft = NoteDraft("local-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", " New idea ",
          "Body", "44444444-5555-6666-7777-888888888888", 1)
        assertEquals("note-created", notes.create(noteDraft).id)
        assertEquals(listOf("/api/notes"), fake.noteCreatePaths)
        val edited = NoteDraft("note-1", " Revised idea ", "Updated body",
          "44444444-5555-6666-7777-999999999999", 4, 3)
        assertEquals(false, notes.sync(edited).conflict)
        assertEquals(4L, notes.sync(edited).note.remoteVersion)
        val conflict = notes.sync(edited.copy(id = "note-conflict", baseRemoteVersion = 2))
        assertEquals(true, conflict.conflict)
        assertEquals(5L, conflict.note.remoteVersion)
        assertEquals(listOf("note-1", "note-1", "note-conflict"), fake.noteSyncIds)
        val noteForMetadata = notes.detail("note-1")
        assertEquals(true, notes.updateMetadata(noteForMetadata,
          NoteMetadataPatch(pinned = true)).pinned)
        assertEquals("archived", notes.updateMetadata(noteForMetadata,
          NoteMetadataPatch(status = "archived")).status)
        assertEquals(listOf("mobile", "ideas"), notes.updateMetadata(noteForMetadata,
          NoteMetadataPatch(tags = listOf("mobile", "ideas"))).tags)
        assertEquals(listOf("pinned", "status", "tags"), fake.noteMetadataFields)
        assertEquals(1234L, notes.history("note-1").single().timestamp)
        assertEquals("Earlier", notes.snapshot("note-1", 1234L).title)
        assertEquals(listOf("/api/notes/note-1/history",
          "/api/notes/note-1/history/1234"), fake.noteHistoryPaths)
        assertEquals("https://share.example/s/test", notes.share(noteForMetadata).url)
        assertEquals(listOf("/api/notes/note-1/shares"), fake.noteSharePaths)
        notes.delete(noteForMetadata, "55555555-6666-7777-8888-999999999999")
        assertEquals(listOf("/api/notes/note-1"), fake.noteDeletePaths)
        val activeRun = AutomationRunSummary("run-active", "auto-1", "Morning brief", "running",
          null, null, null, null, 1000L, 1100L, null)
        val cancellation = automations.cancelRun(activeRun)
        assertEquals(true, cancellation.accepted)
        assertEquals(false, cancellation.confirmed)
        val failedRun = activeRun.copy(id = "run-failed", status = "failed")
        assertEquals("run-retry", automations.rerun(failedRun).id)
        assertThrows(IllegalArgumentException::class.java) { automations.rerun(activeRun) }
        assertEquals(listOf("/api/automation-runs/run-active/cancel",
          "/api/automation-runs/run-failed/rerun"), fake.automationRunActionPaths)
        assertThrows(IllegalArgumentException::class.java) { repository.delete(conversationId) }
        repository.saveQuickDraft("New topic")
        assertEquals("New topic", ConversationRepository(restored, context).quickDraft())
        repository.saveQuickDraft("")
        assertEquals("", repository.quickDraft())
        assertEquals(PendingInput(messageId, "Unconfirmed message"), repository.pendingInput(conversationId))
        assertEquals("run-restored", repository.send(conversationId, "Unconfirmed message", TurnClaim("endpoint", "claim")))
        assertNull(repository.pendingInput(conversationId))
        assertEquals(0, fake.inputPostCount)
        assertEquals(conversationId, repository.ensureTaskConversation("task-2"))
        repository.saveComposerDraft(conversationId, "Task instruction")
        val taskRef = ConversationContextRef("note", "note-1", "43", "Brief")
        repository.saveComposerRefs(conversationId, listOf(taskRef))
        val taskAttachment = ChatAttachmentStore(context).addBytes(gatewayId.toString(), conversationId,
          "task.txt", "text/plain", "task attachment".toByteArray())
        assertEquals("run-task", repository.sendTask("task-2", conversationId, "Task instruction",
          TurnClaim("endpoint", "claim"), listOf(taskRef), listOf(taskAttachment)))
        assertEquals(1, fake.taskInputPostCount)
        assertEquals("", repository.composerDraft(conversationId))
        assertEquals(emptyList<ConversationContextRef>(), repository.composerRefs(conversationId))
        assertEquals(emptyList<ChatAttachment>(), repository.composerAttachments(conversationId))
        assertNull(repository.pendingInput(conversationId))
        repository.delete(conversationId)
        assertEquals(listOf(conversationId), fake.deletedIds)
        val agentDraft = repository.createDraft("research")
        newDraftId = agentDraft.conversationId
        assertThrows(IllegalArgumentException::class.java) { repository.setPinned(agentDraft.conversationId, true) }
        assertThrows(IllegalArgumentException::class.java) { repository.setArchived(agentDraft.conversationId, true) }
        assertThrows(IllegalArgumentException::class.java) { repository.delete(agentDraft.conversationId) }
        assertEquals("research", ConversationRepository(restored, context).draft(agentDraft.conversationId)?.agentId)
        repository.saveComposerDraft(agentDraft.conversationId, "unsent text")
        restored.saveMainConversationId(agentDraft.conversationId)
        restored.clearMainConversationId(conversationId)
        assertEquals(agentDraft.conversationId, restored.mainConversationId())
        val draftPendingKey = "pending-input.$gatewayId.${agentDraft.conversationId}"
        pendingStore.write(draftPendingKey, JSONObject().put("kind", "append").put("clientMessageId", messageId)
          .put("input", JSONObject().put("content", "Unconfirmed message")).toString())
        try {
          assertThrows(IllegalArgumentException::class.java) { repository.discardDraft(agentDraft.conversationId) }
          assertNotNull(repository.draft(agentDraft.conversationId))
        } finally {
          pendingStore.remove(draftPendingKey)
        }
        repository.discardDraft(agentDraft.conversationId)
        restored.clearMainConversationId(agentDraft.conversationId)
        assertNull(restored.mainConversationId())
        assertNull(repository.draft(agentDraft.conversationId))
        assertEquals("", repository.composerDraft(agentDraft.conversationId))
        val creationDraft = repository.createDraft("main")
        newDraftId = creationDraft.conversationId
        repository.saveComposerDraft(creationDraft.conversationId, "Create a task in “Project name”: task details")
        assertEquals("Create a task in “Project name”: task details",
          ConversationRepository(restored, context).composerDraft(creationDraft.conversationId))
        assertEquals(0, fake.inputPostCount)
        repository.discardDraft(creationDraft.conversationId)
        repository.saveQuickDraft("Quick handoff")
        val quickAttachment = ChatAttachmentStore(context).addBytes(gatewayId.toString(),
          "00000000-0000-0000-0000-000000000000", "quick.txt", "text/plain",
          "snapshot".toByteArray())
        val handoffDraft = repository.stageQuickDraft("main", "Quick handoff")
        newDraftId = handoffDraft.conversationId
        val afterHandoff = ConversationRepository(restored, context)
        assertEquals("Quick handoff", afterHandoff.composerDraft(handoffDraft.conversationId))
        assertEquals(listOf(quickAttachment), afterHandoff.composerAttachments(handoffDraft.conversationId))
        assertEquals(emptyList<ChatAttachment>(), afterHandoff.quickAttachments())
        assertEquals("", afterHandoff.quickDraft())
        assertEquals(handoffDraft.conversationId, restored.mainConversationId())
        assertNull(afterHandoff.recoverQuickHandoff())
        assertEquals(0, fake.inputPostCount)
        repository.discardDraft(handoffDraft.conversationId)
        val interrupted = repository.createDraft("main")
        newDraftId = interrupted.conversationId
        repository.saveQuickDraft("Resume once")
        pendingStore.write("quick-handoff.$gatewayId", JSONObject()
          .put("conversationId", interrupted.conversationId).put("content", "Resume once").toString())
        val resumed = ConversationRepository(restored, context).recoverQuickHandoff()
        assertEquals(interrupted.conversationId, resumed?.conversationId)
        assertEquals("Resume once", repository.composerDraft(interrupted.conversationId))
        assertEquals(interrupted.conversationId, restored.mainConversationId())
        assertNull(repository.recoverQuickHandoff())
        assertEquals("", repository.quickDraft())
        repository.discardDraft(interrupted.conversationId)
        val quickDraft = repository.createDraft("main")
        newDraftId = quickDraft.conversationId
        repository.saveComposerDraft(quickDraft.conversationId, "Quick topic")
        repository.prepareDraftModel(quickDraft.conversationId)
        assertEquals("run-restored", repository.send(quickDraft.conversationId, "Quick topic", TurnClaim("endpoint", "claim")))
        assertEquals(1, fake.inputPostCount)
        assertEquals("", repository.composerDraft(quickDraft.conversationId))
        assertNull(repository.draft(quickDraft.conversationId))
      } finally {
        pendingStore.remove(pendingKey)
        pendingStore.remove("quick-composer.$gatewayId")
        newDraftId?.let { pendingStore.remove("draft.$gatewayId.$it") }
        if (previousDraftIndex == null) pendingStore.remove(draftIndexKey)
        else pendingStore.write(draftIndexKey, previousDraftIndex)
      }
    } finally {
      clear(store)
    }
  }

  @Test fun rejectsGatewayWithDifferentSigningKeyBeforeSavingCredential() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = AndroidSecureStore(context, "gateway_credentials_test_v1", "xopc.gateway.credentials.test.v1")
    clear(store)
    try {
      assertThrows(IllegalStateException::class.java) {
        GatewaySession(context, FakeGateway(corruptSignature = true), DeviceIdentity("xopc.gateway.device.p256.test.v1"), store).pair(invitation())
      }
      assertNull(store.read("pairing"))
      assertNull(store.read("profile"))
      assertNull(store.read("refresh.$gatewayId"))
    } finally {
      clear(store)
    }
  }

  @Test fun savedGatewaysProbeAndSwitchWithoutPublishingAFailedCandidate() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = AndroidSecureStore(context, "gateway_catalog_test_v1", "xopc.gateway.catalog.test.v1")
    val secondId = UUID.fromString("bbbbbbbb-cccc-dddd-eeee-ffffffffffff")
    val secondPairing = UUID.fromString("22222222-3333-4444-5555-666666666666")
    val secondKey = Ed25519PrivateKeyParameters(ByteArray(32) { (it + 32).toByte() }, 0)
    val secondOrigin = "https://second.example"
    clear(store)
    try {
      val first = FakeGateway()
      val second = FakeGateway(fakeId = secondId, fakePairingId = secondPairing,
        fakeSigningKey = secondKey, fakeOrigin = secondOrigin)
      val transport = object : GatewayHttp {
        override fun request(origin: String, path: String, method: String, body: String, bearer: String): String =
          (if (origin == secondOrigin) second else first).request(origin, path, method, body, bearer)
        override fun requestWithHeaders(origin: String, path: String, method: String, body: String,
          bearer: String, headers: Map<String, String>): String =
          (if (origin == secondOrigin) second else first).requestWithHeaders(origin, path, method, body, bearer, headers)
      }
      val identity = DeviceIdentity("xopc.gateway.device.catalog.p256.test.v1")
      val session = GatewaySession(context, transport, identity, store)
      session.pair(invitation())
      session.pair(invitation(secondId, secondPairing, secondKey, secondOrigin))
      session.saveMainConversationId("cccccccc-dddd-eeee-ffff-000000000000")
      assertEquals(listOf(secondId.toString(), gatewayId.toString()), session.savedProfiles().map { it.gatewayId })
      assertEquals(secondId.toString(), GatewaySession(context, transport, identity, store).restore()?.gatewayId)
      assertEquals(gatewayId.toString(), session.probeProfile(gatewayId.toString()).gatewayId)
      assertEquals(secondId.toString(), session.currentProfile()?.gatewayId)
      session.renameProfile(secondId.toString(), " Office ")
      assertEquals("Office", session.savedProfiles().first().name)
      session.activate(gatewayId.toString())
      second.rejectStatus = true
      assertThrows(Exception::class.java) { session.activate(secondId.toString()) }
      assertEquals(gatewayId.toString(), session.currentProfile()?.gatewayId)
      assertEquals(gatewayId.toString(), GatewaySession(context, transport, identity, store).restore()?.gatewayId)
      second.rejectStatus = false
      session.activate(secondId.toString())
      assertEquals(secondId.toString(), session.currentProfile()?.gatewayId)
      session.removeProfile(secondId.toString())
      assertEquals(gatewayId.toString(), session.currentProfile()?.gatewayId)
      assertNull(store.read("refresh.$secondId"))
      assertNull(store.read("main-chat.$secondId"))
      assertNotNull(store.read("identity.$secondId"))
    } finally {
      listOf("identity.$secondId", "refresh.$secondId", "refresh-attempt.$secondId",
        "main-chat.$secondId").forEach(store::remove)
      clear(store)
    }
  }

  private fun clear(store: AndroidSecureStore) {
    listOf("profile", "gateway-catalog", "pairing", "identity.$gatewayId", "refresh.$gatewayId", "refresh-attempt.$gatewayId",
      "main-chat.$gatewayId").forEach(store::remove)
  }

  private fun invitation(id: UUID = gatewayId, pairing: UUID = pairingId,
    key: Ed25519PrivateKeyParameters = signingKey, gatewayOrigin: String = origin): String {
    val originBytes = gatewayOrigin.toByteArray(Charsets.US_ASCII)
    val buffer = ByteBuffer.allocate(102 + 2 + originBytes.size)
    buffer.put(4)
    buffer.putLong(pairing.mostSignificantBits).putLong(pairing.leastSignificantBits)
    buffer.put(ByteArray(32) { it.toByte() })
    buffer.putLong(id.mostSignificantBits).putLong(id.leastSignificantBits)
    buffer.put(key.generatePublicKey().encoded)
    buffer.putInt((System.currentTimeMillis() / 1000 + 600).toInt())
    buffer.put(1)
    buffer.putShort(originBytes.size.toShort()).put(originBytes)
    return "https://link.xopc.ai/c#${encode(buffer.array())}"
  }

  private fun encode(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

  private inner class FakeGateway(private val corruptSignature: Boolean = false,
    private val fakeId: UUID = gatewayId, private val fakePairingId: UUID = pairingId,
    private val fakeSigningKey: Ed25519PrivateKeyParameters = signingKey,
    private val fakeOrigin: String = origin) : GatewayHttp {
    var rejectStatus = false
    var lastBearer = ""
    var inputPostCount = 0
    var expectedInputContent = "Quick topic"
    var lastInputCommand: JSONObject? = null
    var taskInputPostCount = 0
    var lastModelPatch: JSONObject? = null
    var lastRename: String? = null
    val pinActions = mutableListOf<String>()
    val archiveActions = mutableListOf<String>()
    val deletedIds = mutableListOf<String>()
    val projectReadPaths = mutableListOf<String>()
    val progressReadPaths = mutableListOf<String>()
    val progressCommandPaths = mutableListOf<String>()
    val progressEditPaths = mutableListOf<String>()
    val progressProjectPaths = mutableListOf<String>()
    val progressCreatePaths = mutableListOf<String>()
    val progressHomeActionPaths = mutableListOf<String>()
    val automationReadPaths = mutableListOf<String>()
    val automationActionPaths = mutableListOf<String>()
    val automationCreatePaths = mutableListOf<String>()
    val automationEditMethods = mutableListOf<String>()
    val noteReadPaths = mutableListOf<String>()
    val noteCreatePaths = mutableListOf<String>()
    val noteCapturePaths = mutableListOf<String>()
    val noteSyncIds = mutableListOf<String>()
    val noteMetadataFields = mutableListOf<String>()
    val noteHistoryPaths = mutableListOf<String>()
    val noteDeletePaths = mutableListOf<String>()
    val noteSharePaths = mutableListOf<String>()
    val shareMutations = mutableListOf<String>()
    var shareReadCount = 0
    var shareRevoked = false
    var shareExpiresAt: String = java.time.Instant.now().plusSeconds(7 * 86_400).toString()
    val automationRunActionPaths = mutableListOf<String>()
    val goalWrites = mutableListOf<String>()
    val assertionReadPaths = mutableListOf<String>()
    val assertionWrites = mutableListOf<String>()
    var sessionShareReads = 0
    var sessionShareWrites = 0
    var profileWrites = 0
    private var deviceKey: DevicePublicKey? = null
    override fun requestWithHeaders(origin: String, path: String, method: String, body: String,
      bearer: String, headers: Map<String, String>): String {
      if (path == "/api/tasks/task-2/inputs") assertEquals(
        mapOf("X-Xopc-Expected-Session-Key" to "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"), headers)
      if (path == "/api/automations" && method == "POST") assertEquals(
        "11111111-2222-3333-4444-555555555555", headers["Idempotency-Key"])
      if (path == "/api/notes" && method == "POST") assertEquals(
        "44444444-5555-6666-7777-888888888888", headers["Idempotency-Key"])
      if (path == "/api/notes/quick-capture" && method == "POST") assertEquals(
        "12345678-1234-1234-1234-123456789abc", headers["Idempotency-Key"])
      if (path == "/api/notes/note-1" && method == "DELETE") assertEquals(
        "55555555-6666-7777-8888-999999999999", headers["Idempotency-Key"])
      if (path == "/api/automations/auto-1" && method in setOf("PATCH", "DELETE")) {
        assertEquals(if (method == "PATCH") "22222222-3333-4444-5555-666666666666"
          else "33333333-4444-5555-6666-777777777777", headers["Idempotency-Key"])
      }
      return request(origin, path, method, body, bearer)
    }
    override fun request(origin: String, path: String, method: String, body: String, bearer: String): String {
      assertEquals(fakeOrigin, origin)
      val input = if (body.isEmpty()) JSONObject() else JSONObject(body)
      return when {
        path == "/api/device-pairing/probe" -> signed(JSONObject()
          .put("gatewayId", fakeId.toString()).put("pairingId", fakePairingId.toString()).put("issuedAt", System.currentTimeMillis()))
        path.startsWith("/api/device-pairing/requests") -> {
          verifyDeviceProof(path, input)
          val status = when {
            path.endsWith("/status") -> "approved"
            path.endsWith("/complete") -> "completed"
            else -> "pending"
          }
          val response = JSONObject().put("gateway", JSONObject().put("id", fakeId.toString()).put("name", "Test Gateway"))
            .put("nonce", input.getString("nonce"))
            .put("request", JSONObject().put("requestId", input.getString("requestId")).put("status", status)
              .put("confirmationCode", "123456").put("expiresAt", System.currentTimeMillis() + 120_000)
              .put("deviceId", "device-1"))
          if (status == "completed") response.put("routes", org.json.JSONArray().put(
            JSONObject().put("id", "test").put("kind", "custom-https").put("url", fakeOrigin)))
          signed(response)
        }
        path == "/api/gateway-identity/challenge" -> signed(JSONObject().put("purpose", "gateway-route-v1")
          .put("gatewayId", fakeId.toString()).put("nonce", input.getString("nonce"))
          .put("expiresAt", System.currentTimeMillis() + 30_000))
        path == "/api/device-auth/refresh" -> signed(JSONObject().put("purpose", "device-refresh-v3")
          .put("gatewayId", fakeId.toString()).put("nonce", input.getString("nonce"))
          .put("requestId", input.getString("requestId")).put("expiresAt", System.currentTimeMillis() + 30_000)
          .put("tokens", JSONObject().put("accessToken", "access-test")
            .put("accessTokenExpiresAt", System.currentTimeMillis() + 300_000)
            .put("refreshToken", input.getString("nextRefreshToken"))
            .put("refreshTokenExpiresAt", System.currentTimeMillis() + 86_400_000)))
        path == "/api/status" -> {
          if (rejectStatus) throw GatewayHttpException(503, "Unavailable")
          lastBearer = bearer
          "{\"status\":\"ok\"}"
        }
        path == "/api/user-model/goals" && method == "POST" -> {
          goalWrites += "$method $path"
          assertEquals("global", input.getJSONObject("scope").getString("type"))
          assertEquals("New goal", input.getString("title"))
          assertEquals("Done", input.getString("desiredOutcome"))
          assertEquals(9000L, input.getLong("targetAt"))
          """{"goal":{"id":"goal-created","title":"New goal","desiredOutcome":"Done","status":"active"}}"""
        }
        path == "/api/user-model/goals/goal-created" && method == "PATCH" -> {
          goalWrites += "$method $path"
          assertEquals("paused", input.getString("status"))
          assertEquals(true, input.isNull("targetAt"))
          """{"goal":{"id":"goal-created","title":"New goal","desiredOutcome":"Done","status":"paused"}}"""
        }
        path.startsWith("/api/user-model/assertions?view=mobile") && method == "GET" -> {
          assertionReadPaths += path
          """{"items":[{"id":"assertion-1","statement":"Prefers concise answers",
            "authority":"user_explicit","status":"needs_review","scope":{"type":"global"},
            "confidence":0.9,"sources":[{"label":"Project chat"}]}]}"""
        }
        path == "/api/user-model/assertions/assertion-1" && method == "GET" -> {
          assertionReadPaths += path
          """{"assertion":{"id":"assertion-1","statement":"Prefers concise answers",
            "authority":"user_explicit","status":"needs_review","scope":{"type":"global"},
            "confidence":0.9,"sources":[{"label":"Project chat"}]}}"""
        }
        path == "/api/user-model/assertions/assertion-1" && method == "PATCH" -> {
          assertionWrites += "$method $path"
          assertEquals("Prefers short answers", input.getString("statement"))
          """{"action":"superseded","assertion":{"id":"assertion-2"}}"""
        }
        path == "/api/user-model/assertions/assertion-2" && method == "GET" -> {
          assertionReadPaths += path
          """{"assertion":{"id":"assertion-2","statement":"Prefers short answers",
            "authority":"user_explicit","status":"active","scope":{"type":"global"},
            "confidence":1,"sources":[{"label":"Project chat"}]}}"""
        }
        path == "/api/user-model/assertions/assertion-2" && method == "DELETE" -> {
          assertionWrites += "$method $path"
          """{"ok":true}"""
        }
        path == "/api/user-model/profile" && method == "PATCH" -> {
          profileWrites++
          assertEquals("Mia", input.getString("callName"))
          assertEquals("Asia/Shanghai", input.getString("timezone"))
          """{"profile":{"callName":"Mia","role":"Designer","pronouns":"they",
            "timezone":"Asia/Shanghai","locale":"zh"}}"""
        }
        path == "/api/projects/project-1" && method == "GET" -> {
          projectReadPaths += path
          progressProjectPaths += path
          """{"ok":true,"project":{"id":"project-1","name":"Alpha"}}"""
        }
        path == "/api/projects?limit=100&sortBy=updatedAt&sortOrder=desc&includeOperating=true" && method == "GET" -> {
          progressProjectPaths += path
          """{"ok":true,"items":[{"id":"project-1","name":"Alpha","status":"active"}]}"""
        }
        path == "/api/projects/project-1/operating-view" && method == "GET" -> {
          projectReadPaths += path
          """{"ok":true,"view":{"project":{"id":"project-1"},"digest":{"health":"attention","recommendedAction":"Ship release"},"blockers":[{"title":"Waiting","detail":"Approval needed"}],"recentResults":[]}}"""
        }
        path == "/api/home?locale=en" && method == "GET" -> {
          progressReadPaths += path
          """{"needsUser":[{"id":"work-1","title":"Review task","summary":"Waiting",
            "openAction":{"type":"open","label":"Open","href":"/tasks/task-2"}}],"background":[]}"""
        }
        path == "/api/automations" && method == "GET" -> {
          automationReadPaths += path
          """{"automations":[{"id":"auto-1","name":"Morning brief","enabled":true,
            "trigger":{"kind":"schedule","schedule":{"kind":"cron","expr":"0 9 * * *"}},
            "action":{"kind":"agent","instruction":"Summarize my day"},"state":{},"updatedAtMs":123}]}"""
        }
        path == "/api/automations" && method == "POST" -> {
          automationCreatePaths += path
          assertEquals("New brief", input.getString("name"))
          assertEquals(true, input.getBoolean("enabled"))
          assertEquals("new_session", input.getString("conversationMode"))
          assertEquals("0 8 * * *", input.getJSONObject("trigger").getJSONObject("schedule").getString("expr"))
          assertEquals("Summarize today", input.getJSONObject("action").getString("instruction"))
          """{"automation":{"id":"auto-created","name":"New brief","enabled":true,
            "trigger":{"kind":"schedule","schedule":{"kind":"cron","expr":"0 8 * * *"}},
            "action":{"kind":"agent","instruction":"Summarize today"},"state":{},"updatedAtMs":200}}"""
        }
        path == "/api/automations/auto-1" && method == "GET" -> {
          automationReadPaths += path
          """{"automation":{"id":"auto-1","name":"Morning brief","enabled":true,
            "trigger":{"kind":"schedule","schedule":{"kind":"cron","expr":"0 9 * * *","tz":"Asia/Shanghai"}},
            "action":{"kind":"agent","instruction":"Summarize my day","model":"test/model"},"state":{},"updatedAtMs":123}}"""
        }
        path == "/api/automations/auto-1" && method == "PATCH" -> {
          automationEditMethods += method
          assertEquals(123L, input.getLong("expectedRevision"))
          assertEquals("Updated brief", input.getString("name"))
          assertEquals("Asia/Shanghai", input.getJSONObject("trigger").getJSONObject("schedule").getString("tz"))
          assertEquals("0 10 * * *", input.getJSONObject("trigger").getJSONObject("schedule").getString("expr"))
          assertEquals("test/model", input.getJSONObject("action").getString("model"))
          assertEquals("Plan tomorrow", input.getJSONObject("action").getString("instruction"))
          """{"automation":{"id":"auto-1","name":"Updated brief","enabled":true,
            "trigger":{"kind":"schedule","schedule":{"kind":"cron","expr":"0 10 * * *","tz":"Asia/Shanghai"}},
            "action":{"kind":"agent","instruction":"Plan tomorrow","model":"test/model"},
            "state":{},"updatedAtMs":126}}"""
        }
        path == "/api/automations/auto-1" && method == "DELETE" -> {
          automationEditMethods += method
          assertEquals(126L, input.getLong("expectedRevision"))
          """{"removed":true}"""
        }
        path.startsWith("/api/notes?") && method == "GET" -> {
          noteReadPaths += path
          """{"items":[{"id":"note-1","title":"Idea","snippet":"A thought",
            "kind":"thought","status":"inbox","createdAt":1000,"updatedAt":2000}],
            "total":1,"hasMore":false}"""
        }
        path == "/api/notes/note-1" && method == "GET" -> {
          noteReadPaths += path
          """{"note":{"id":"note-1","title":"Idea","markdown":"# Idea",
            "kind":"thought","status":"inbox","createdAt":1000,"updatedAt":2000,
            "remoteVersion":3}}"""
        }
        path == "/api/notes/note-1" && method == "PATCH" -> {
          assertEquals(3L, input.getLong("expectedRevision"))
          val field = listOf("pinned", "status", "tags").single { input.has(it) }
          noteMetadataFields += field
          val pinned = if (field == "pinned") input.getBoolean("pinned") else false
          val status = if (field == "status") input.getString("status") else "inbox"
          val tags = if (field == "tags") input.getJSONArray("tags").toString() else "[]"
          """{"note":{"id":"note-1","title":"Idea","markdown":"# Idea",
            "kind":"thought","status":"$status","createdAt":1000,"updatedAt":3000,
            "pinned":$pinned,"tags":$tags,"remoteVersion":4}}"""
        }
        path == "/api/notes/note-1/history" && method == "GET" -> {
          noteHistoryPaths += path
          """{"entries":[{"timestamp":1234,"trigger":"sync","snippet":"Old body"}]}"""
        }
        path == "/api/notes/note-1/history/1234" && method == "GET" -> {
          noteHistoryPaths += path
          """{"snapshot":{"noteId":"note-1","timestamp":1234,"trigger":"sync",
            "title":"Earlier","markdown":"Old body","kind":"thought","status":"inbox"}}"""
        }
        path == "/api/notes/note-1" && method == "DELETE" -> {
          noteDeletePaths += path
          assertEquals(3L, input.getLong("expectedRevision"))
          """{"deleted":true,"revokedShares":0}"""
        }
        path == "/api/notes/note-1/shares" && method == "POST" -> {
          noteSharePaths += path
          assertEquals(2000L, input.getLong("expectedNoteVersion"))
          assertEquals(86_400_000L, input.getLong("ttlMs"))
          """{"ok":true,"payload":{"id":"share-1","kind":"note",
            "shareUrl":"https://share.example/s/test","reachability":"public",
            "expiresAt":"2026-10-05T00:00:00Z"}}"""
        }
        path == "/api/shares" && method == "GET" -> {
          shareReadCount++
          JSONObject().put("ok", true).put("payload", JSONObject().put("shares",
            org.json.JSONArray().put(JSONObject().put("id", "share-1").put("kind", "note")
              .put("fileName", "Test note").put("shareUrl", "https://share.example/s/test")
              .put("lanUrl", JSONObject.NULL).put("reachability", "public")
              .put("expiresAt", shareExpiresAt).put("revoked", shareRevoked)
              .put("expired", false)))).toString()
        }
        path == "/api/shares/share-1" && method == "PATCH" -> {
          shareMutations += "$method $path"
          assertEquals(86_400_000L, input.getLong("extendTtlMs"))
          shareExpiresAt = java.time.Instant.now().plusSeconds(86_400).toString()
          JSONObject().put("ok", true).put("payload", JSONObject().put("id", "share-1")
            .put("expiresAt", shareExpiresAt).put("shareUrl", "https://share.example/s/test"))
            .toString()
        }
        path == "/api/shares/share-1" && method == "DELETE" -> {
          shareMutations += "$method $path"
          shareRevoked = true
          """{"ok":true}"""
        }
        path == "/api/notes/note-conflict" && method == "GET" -> {
          """{"note":{"id":"note-conflict","title":"Remote title","markdown":"Remote body",
            "kind":"thought","status":"inbox","createdAt":1000,"updatedAt":3000,
            "remoteVersion":5}}"""
        }
        path == "/api/notes" && method == "POST" -> {
          noteCreatePaths += path
          assertEquals("New idea", input.getString("title"))
          assertEquals("Body", input.getString("markdown"))
          assertEquals("thought", input.getString("kind"))
          assertEquals("app", input.getString("channel"))
          assertEquals("android", input.getString("platform"))
          """{"note":{"id":"note-created","title":"New idea","markdown":"Body",
            "kind":"thought","status":"inbox","createdAt":1000,"updatedAt":2000,
            "remoteVersion":1}}"""
        }
        path == "/api/notes/quick-capture" && method == "POST" -> {
          noteCapturePaths += path
          assertEquals("Answer to keep", input.getString("text"))
          assertEquals("app", input.getString("channel"))
          assertEquals("android", input.getString("platform"))
          """{"note":{"id":"note-captured"}}"""
        }
        path == "/api/notes/sync" && method == "POST" -> {
          val id = input.getString("noteId")
          noteSyncIds += id
          assertEquals("Revised idea", input.getString("title"))
          assertEquals("Updated body", input.getString("markdown"))
          assertEquals(4L, input.getLong("localVersion"))
          if (id == "note-conflict") {
            assertEquals(2L, input.getLong("baseRemoteVersion"))
            throw GatewayHttpException(409)
          }
          assertEquals("note-1", id)
          assertEquals(3L, input.getLong("baseRemoteVersion"))
          """{"conflict":false,"note":{"id":"note-1","title":"Revised idea",
            "markdown":"Updated body","kind":"thought","status":"inbox",
            "createdAt":1000,"updatedAt":3000,"remoteVersion":4}}"""
        }
        path == "/api/automations/auto-1/run" && method == "POST" -> {
          automationActionPaths += path
          """{"run":{"id":"run-new","automationId":"auto-1","automationName":"Morning brief",
            "status":"queued","createdAtMs":2000}}"""
        }
        path == "/api/automations/auto-1/pause" && method == "POST" -> {
          automationActionPaths += path
          assertEquals(123L, input.getLong("expectedRevision"))
          """{"automation":{"id":"auto-1","name":"Morning brief","enabled":false,
            "trigger":{"kind":"schedule","schedule":{"kind":"cron","expr":"0 9 * * *"}},
            "action":{"kind":"agent","instruction":"Summarize my day"},"state":{},"updatedAtMs":124}}"""
        }
        path == "/api/automations/auto-1/resume" && method == "POST" -> {
          automationActionPaths += path
          assertEquals(124L, input.getLong("expectedRevision"))
          """{"automation":{"id":"auto-1","name":"Morning brief","enabled":true,
            "trigger":{"kind":"schedule","schedule":{"kind":"cron","expr":"0 9 * * *"}},
            "action":{"kind":"agent","instruction":"Summarize my day"},"state":{},"updatedAtMs":125}}"""
        }
        path == "/api/automation-runs?limit=30&automationId=auto-1" && method == "GET" -> {
          automationReadPaths += path
          """{"runs":[{"id":"run-1","automationId":"auto-1","automationName":"Morning brief",
            "status":"succeeded","summary":"Done","createdAtMs":1000}]}"""
        }
        path == "/api/automation-runs/run-1" && method == "GET" -> {
          automationReadPaths += path
          """{"run":{"id":"run-1","automationId":"auto-1","automationName":"Morning brief",
            "status":"succeeded","summary":"Done","createdAtMs":1000}}"""
        }
        path == "/api/automation-runs/run-1/events" && method == "GET" -> {
          automationReadPaths += path
          """{"events":[{"id":"event-1","message":"Queued","createdAtMs":1000}]}"""
        }
        path == "/api/automation-runs/run-active/cancel" && method == "POST" -> {
          automationRunActionPaths += path
          """{"cancelled":true,"confirmed":false}"""
        }
        path == "/api/automation-runs/run-failed/rerun" && method == "POST" -> {
          automationRunActionPaths += path
          """{"run":{"id":"run-retry","automationId":"auto-1","automationName":"Morning brief",
            "status":"queued","createdAtMs":3000}}"""
        }
        path in setOf("/api/home/decisions/respond", "/api/home/attention/retry",
          "/api/home/attention/acknowledge") && method == "POST" -> {
          progressHomeActionPaths += path
          when (path) {
            "/api/home/decisions/respond" -> {
              assertEquals("connector_approval", input.getString("kind"))
              assertEquals("approval-1", input.getString("approvalId"))
              assertEquals("approve", input.getString("decision"))
            }
            "/api/home/attention/retry" -> {
              assertEquals("automation_run", input.getString("kind"))
              assertEquals("run-1", input.getString("runId"))
            }
            else -> {
              assertEquals("workflow_run", input.getString("kind"))
              assertEquals("run-2", input.getString("runId"))
            }
          }
          """{"ok":true}"""
        }
        path == "/api/tasks?limit=50&offset=0" && method == "GET" -> {
          progressReadPaths += path
          """{"ok":true,"total":1,"items":[{"task":{"id":"task-2","title":"Review task",
            "phase":"review","updatedAt":42,"version":2}}]}"""
        }
        path == "/api/tasks?projectId=project-1&limit=30&offset=0" && method == "GET" -> {
          progressProjectPaths += path
          """{"ok":true,"total":1,"items":[{"task":{"id":"task-project","title":"Project task",
            "phase":"backlog","projectId":"project-1","updatedAt":42,"version":1}}]}"""
        }
        path == "/api/tasks" && method == "POST" -> {
          progressCreatePaths += path
          assertEquals("fixed-create-key", input.getString("idempotencyKey"))
          assertEquals("New task", input.getString("title"))
          assertEquals("Description", input.getString("body"))
          assertEquals("project-1", input.getString("projectId"))
          val contract = input.getJSONObject("contract")
          assertEquals("Description", contract.getString("objective"))
          assertEquals("manual", contract.getString("acceptancePolicy"))
          assertEquals(0, contract.getJSONArray("expectedOutputs").length())
          assertEquals("capture", input.getJSONObject("activation").getString("mode"))
          assertEquals("backlog", input.getJSONObject("activation").getString("phase"))
          """{"ok":true,"task":{"id":"task-created","title":"New task","body":"Description",
            "phase":"backlog","projectId":"project-1","updatedAt":44,"version":1}}"""
        }
        path == "/api/tasks?limit=50&offset=0&search=alpha+beta" && method == "GET" -> {
          progressReadPaths += path
          """{"ok":true,"total":1,"items":[{"task":{"id":"task-2","title":"Review task",
            "phase":"review","updatedAt":42,"version":2}}]}"""
        }
        path == "/api/tasks/task-2" && method == "GET" -> {
          progressReadPaths += path
          """{"ok":true,"task":{"id":"task-2","title":"Review task","phase":"review",
            "priority":"high","updatedAt":43,"version":2},"allowedCommands":["close"]}"""
        }
        path == "/api/tasks/task-2/conversation" && method == "POST" ->
          """{"ok":true,"conversationId":"bbbbbbbb-cccc-dddd-eeee-ffffffffffff","created":false}"""
        path == "/api/sessions/bbbbbbbb-cccc-dddd-eeee-ffffffffffff/history?view=compact&limit=20" && method == "GET" ->
          """{"session":{"key":"bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
            "transcriptId":"transcript-task","messages":[]}}"""
        path == "/api/sessions/bbbbbbbb-cccc-dddd-eeee-ffffffffffff/agent-config" && method == "GET" ->
          """{"ok":true,"payload":{"model":"test/one","configVersion":13}}"""
        path == "/api/sessions/11111111-2222-3333-4444-555555555555/share-preview" && method == "GET" -> {
          sessionShareReads++
          """{"ok":true,"payload":{"transcriptId":"transcript-share","cutoffSeq":9,
            "metadataUpdatedAt":"2026-10-05T00:00:00Z","title":"A chat","messageCount":2,
            "attachmentCandidates":[{"id":"attachment-1"}]}}"""
        }
        path == "/api/sessions/11111111-2222-3333-4444-555555555555/shares" && method == "POST" -> {
          sessionShareWrites++
          assertEquals("transcript-share", input.getString("expectedTranscriptId"))
          assertEquals(9L, input.getLong("expectedCutoffSeq"))
          assertEquals("2026-10-05T00:00:00Z", input.getString("expectedMetadataUpdatedAt"))
          assertEquals(86_400_000L, input.getLong("ttlMs"))
          assertEquals(true, input.isNull("maxViews"))
          assertEquals(true, input.getBoolean("includeToolActivities"))
          assertEquals(false, input.has("attachmentIds"))
          """{"ok":true,"payload":{"id":"share-session-1","kind":"session",
            "shareUrl":"https://share.example/s/session","reachability":"public",
            "expiresAt":"2030-01-01T00:00:00Z"}}"""
        }
        path == "/api/tasks/task-2/inputs" && method == "POST" -> {
          taskInputPostCount++
          assertEquals("Task instruction", input.getString("content"))
          assertEquals("task attachment", String(Base64.getDecoder().decode(input
            .getJSONArray("attachments").getJSONObject(0).getString("data"))))
          assertEquals("note", input.getJSONArray("contextRefs").getJSONObject(0).getString("kind"))
          assertEquals("43", input.getJSONArray("contextRefs").getJSONObject(0).getString("expectedVersion"))
          assertEquals(false, input.getJSONArray("contextRefs").getJSONObject(0).has("title"))
          assertEquals("transcript-task", input.getString("expectedTranscriptId"))
          assertEquals(13, input.getInt("configVersion"))
          assertEquals("next", input.getString("delivery"))
          assertEquals("endpoint", input.getJSONObject("origin").getString("endpointId"))
          """{"ok":true,"payload":{"conversationId":"bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
            "state":{"activeRunId":"run-task"}}}"""
        }
        path == "/api/tasks/task-start" && method == "GET" -> {
          progressReadPaths += path
          """{"ok":true,"task":{"id":"task-start","title":"Start task","phase":"ready",
            "updatedAt":43,"version":5},"allowedCommands":["start"]}"""
        }
        path == "/api/tasks/task-2" && method == "PATCH" -> {
          progressEditPaths += path
          assertEquals(2, input.getInt("expectedVersion"))
          assertEquals("Changed task", input.getString("title"))
          assertEquals("Edited body", input.getString("body"))
          assertEquals(true, input.isNull("projectId"))
          """{"ok":true,"task":{"id":"task-2","title":"Changed task","body":"Edited body",
            "phase":"review","updatedAt":44,"version":3}}"""
        }
        path == "/api/tasks/task-2/commands" && method == "POST" -> {
          progressCommandPaths += path
          assertEquals("fixed-test-command-key", input.getString("idempotencyKey"))
          assertEquals(2, input.getInt("expectedVersion"))
          assertEquals("close", input.getJSONObject("command").getString("type"))
          assertEquals("done", input.getJSONObject("command").getString("resolution"))
          """{"ok":true,"task":{"id":"task-2","title":"Review task","phase":"closed",
            "resolution":"done","priority":"high","updatedAt":44,"closedAt":44,"version":3},
            "allowedCommands":["reopen"]}"""
        }
        path == "/api/tasks/task-start/commands" && method == "POST" -> {
          progressCommandPaths += path
          assertEquals("fixed-start-command-key", input.getString("idempotencyKey"))
          assertEquals(5, input.getInt("expectedVersion"))
          val command = input.getJSONObject("command")
          assertEquals("start", command.getString("type"))
          assertEquals("agent", command.getJSONObject("executor").getString("kind"))
          assertEquals("research", command.getJSONObject("executor").getString("agentId"))
          """{"ok":true,"task":{"id":"task-start","title":"Start task","phase":"active",
            "updatedAt":44,"version":6},"allowedCommands":[]}"""
        }
        path == "/api/agents" -> JSONObject().put("ok", true).put("payload", JSONObject()
          .put("defaultId", "main").put("agents", org.json.JSONArray()
            .put(JSONObject().put("id", "main").put("name", "Main"))
            .put(JSONObject().put("id", "research").put("name", "Research")))).toString()
        path.startsWith("/api/models?") -> JSONObject().put("ok", true).put("payload", JSONObject()
          .put("defaultId", "test/one").put("models", org.json.JSONArray()
            .put(JSONObject().put("id", "test/one").put("name", "One")))).toString()
        path.endsWith("/agent-config") && method == "PATCH" -> {
          lastModelPatch = input
          JSONObject().put("ok", true).put("payload", JSONObject()
            .put("model", input.getString("model")).put("configVersion", 13)).toString()
        }
        path.endsWith("/rename") && method == "POST" -> {
          lastRename = input.getString("name")
          JSONObject().put("renamed", true).toString()
        }
        path.contains("/execution-detail?turnId=") && method == "GET" -> {
          assertEquals("turn-1", path.substringAfter("turnId="))
          JSONObject().put("detail", JSONObject().put("turnId", "turn-1")
            .put("steps", org.json.JSONArray().put(JSONObject().put("id", "step-1")
              .put("kind", "tool").put("category", "search").put("preview", "public query")
              .put("status", "done")))).toString()
        }
        (path.endsWith("/pin") || path.endsWith("/unpin")) && method == "POST" -> {
          val action = path.substringAfterLast('/')
          pinActions += action
          JSONObject().put(if (action == "pin") "pinned" else "unpinned", true).toString()
        }
        (path.endsWith("/archive") || path.endsWith("/unarchive")) && method == "POST" -> {
          val action = path.substringAfterLast('/')
          archiveActions += action
          JSONObject().put(if (action == "archive") "archived" else "unarchived", true).toString()
        }
        path.startsWith("/api/sessions/") && method == "DELETE" -> {
          deletedIds += path.removePrefix("/api/sessions/")
          JSONObject().put("deleted", true).toString()
        }
        path.endsWith("/inputs") -> {
          inputPostCount++
          lastInputCommand = input
          assertEquals("start", input.getString("kind"))
          assertEquals(expectedInputContent, input.getJSONObject("input").getString("content"))
          val conversationId = path.removePrefix("/api/sessions/").substringBefore('/')
          JSONObject().put("ok", true).put("payload", JSONObject()
            .put("receipt", JSONObject().put("conversationId", conversationId)
              .put("clientMessageId", input.getString("clientMessageId")).put("transcriptId", "transcript-restored"))
            .put("session", JSONObject().put("transcriptId", "transcript-restored"))
            .put("inputState", JSONObject().put("activeRunId", "run-restored"))).toString()
        }
        path.contains("/input-receipts/") -> {
          val conversationId = path.removePrefix("/api/sessions/").substringBefore('/')
          val messageId = path.substringAfterLast('/')
          JSONObject().put("ok", true).put("payload", JSONObject()
            .put("receipt", JSONObject().put("conversationId", conversationId)
              .put("clientMessageId", messageId).put("transcriptId", "transcript-restored"))
            .put("session", JSONObject().put("transcriptId", "transcript-restored"))
            .put("inputState", JSONObject().put("activeRunId", "run-restored"))).toString()
        }
        else -> error("Unexpected API path: $path")
      }
    }

    private fun verifyDeviceProof(path: String, input: JSONObject) {
      val action = when {
        path.endsWith("/status") -> "status"
        path.endsWith("/complete") -> "complete"
        else -> "request"
      }
      if (action == "request") {
        val jwk = input.getJSONObject("device").getJSONObject("publicKeyJwk")
        assertEquals("android", input.getJSONObject("device").getString("platform"))
        deviceKey = DevicePublicKey(x = jwk.getString("x"), y = jwk.getString("y"))
      }
      val key = deviceKey ?: error("Device key missing")
      val body = PairingProofBody(gatewayId = input.getString("gatewayId"), requestId = input.getString("requestId"),
        pairingToken = input.getString("pairingToken"), timestamp = input.getLong("timestamp"), nonce = input.getString("nonce"),
        device = if (action == "request") key else null,
        idempotencyKey = input.optString("idempotencyKey").takeIf(String::isNotBlank),
        initialRefreshToken = input.optString("initialRefreshToken").takeIf(String::isNotBlank))
      val params = AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
        .getParameterSpec(ECParameterSpec::class.java)
      val point = ECPoint(BigInteger(1, Base64.getUrlDecoder().decode(key.x)), BigInteger(1, Base64.getUrlDecoder().decode(key.y)))
      val publicKey = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, params))
      val raw = Base64.getUrlDecoder().decode(input.getString("signature"))
      val pair = ASN1EncodableVector().apply {
        add(ASN1Integer(BigInteger(1, raw.copyOfRange(0, 32))))
        add(ASN1Integer(BigInteger(1, raw.copyOfRange(32, 64))))
      }
      val verifier = Signature.getInstance("SHA256withECDSA")
      verifier.initVerify(publicKey)
      verifier.update(DeviceProof.pairing(action, body).toByteArray(Charsets.UTF_8))
      check(verifier.verify(DERSequence(pair).encoded)) { "Device proof did not match Gateway contract" }
    }

    private fun signed(value: JSONObject): String {
      val payload = encode(value.toString().toByteArray(Charsets.UTF_8))
      val signer = Ed25519Signer()
      signer.init(true, fakeSigningKey)
      val bytes = payload.toByteArray(Charsets.UTF_8)
      signer.update(bytes, 0, bytes.size)
      val signature = signer.generateSignature()
      if (corruptSignature) signature[0] = (signature[0].toInt() xor 1).toByte()
      return JSONObject().put("ok", true).put("signedPayload", payload)
        .put("signature", encode(signature)).toString()
    }
  }
}
