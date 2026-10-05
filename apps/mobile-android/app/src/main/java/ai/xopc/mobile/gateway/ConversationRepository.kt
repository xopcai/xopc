package ai.xopc.mobile.gateway

import android.content.Context
import android.net.Uri
import java.net.URLEncoder
import java.time.Instant
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

data class ConversationSummary(
  val id: String,
  val title: String,
  val updatedAt: String,
  val messageCount: Int,
  val agentId: String?,
  val isLocalDraft: Boolean = false,
  val status: String = "active",
)
data class ConversationPage(val items: List<ConversationSummary>, val remoteCount: Int, val hasMore: Boolean)
data class ContextWorkItem(val id: String, val title: String)
data class ContextSource(val id: String, val title: String, val unavailable: Boolean)
data class ContextEnvironment(val kind: String, val rootPath: String, val available: Boolean, val branch: String?)
data class ConversationContext(val conversationId: String, val project: ContextWorkItem?, val task: ContextWorkItem?,
  val environment: ContextEnvironment?, val sources: List<ContextSource>, val sourcesHasMore: Boolean,
  val unavailableSections: List<String>, val workingDirectoryLocked: Boolean)
data class TaskWelcomeInfo(val taskTitle: String, val phase: String, val operationalState: String,
  val attentionSummary: String?, val recentFailure: String?, val nextAction: String?)
data class ProjectWelcomeInfo(val projectName: String, val blockedReason: String?,
  val recentFailure: String?, val recommendedAction: String?)

data class ConversationMessage(val id: String, val role: String, val text: String, val turnId: String? = null)
data class ConversationHistory(val conversationId: String, val transcriptId: String?, val messages: List<ConversationMessage>,
  val agentId: String? = null)
data class ExecutionStep(val id: String, val kind: String, val category: String, val text: String,
  val preview: String, val failure: String, val status: String)
data class ExecutionDetail(val turnId: String, val steps: List<ExecutionStep>)
data class ConversationContextRef(val kind: String, val sourceId: String,
  val expectedVersion: String, val title: String)
data class PendingInput(val clientMessageId: String, val content: String, val taskId: String? = null,
  val contextRefs: List<ConversationContextRef> = emptyList(),
  val attachments: List<ChatAttachment> = emptyList())
data class ConversationAgent(val id: String, val name: String, val description: String)
data class AgentCatalog(val agents: List<ConversationAgent>, val defaultId: String)
data class ConversationModel(val id: String, val name: String, val initialThinkingLevel: String)
data class ModelSelection(val models: List<ConversationModel>, val selectedId: String, val configVersion: Long?)
data class LocalConversationDraft(
  val conversationId: String,
  val agentId: String,
  val model: String,
  val thinkingLevel: String,
  val createdAt: String,
)

/** Assistant and Conversations read the same Gateway-backed conversation data. */
class ConversationRepository(private val gateway: GatewaySession, context: Context? = null,
  private val pendingStore: AndroidSecureStore? = context?.let(::AndroidSecureStore),
  private val attachmentStore: ChatAttachmentStore? = context?.let(::ChatAttachmentStore)) {

  fun removeGatewayLocal(gatewayId: String) {
    UUID.fromString(gatewayId)
    val store = pendingStore ?: return
    listOf("composer.$gatewayId.", "composer-refs.$gatewayId.",
      "pending-input.$gatewayId.", "draft.$gatewayId.").forEach(store::removeMatchingPrefix)
    store.remove("draft-index.$gatewayId")
    store.remove("quick-composer.$gatewayId")
    store.remove("quick-handoff.$gatewayId")
    attachmentStore?.removeGateway(gatewayId)
  }

  fun composerAttachments(conversationId: String): List<ChatAttachment> {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return emptyList()
    return attachmentStore?.list(gatewayId, conversationId) ?: emptyList()
  }

  fun addComposerAttachment(gatewayId: String, conversationId: String, uri: Uri): ChatAttachment {
    require(gateway.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    return (attachmentStore ?: throw IllegalStateException("NO_ATTACHMENT_STORE"))
      .import(gatewayId, conversationId, uri)
  }

  fun removeComposerAttachment(gatewayId: String, conversationId: String, attachmentId: String) {
    require(gateway.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    attachmentStore?.remove(gatewayId, conversationId, attachmentId)
  }

  fun composerDraft(conversationId: String): String {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return ""
    return pendingStore?.read("composer.$gatewayId.$conversationId") ?: ""
  }

  fun composerRefs(conversationId: String): List<ConversationContextRef> {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return emptyList()
    val raw = pendingStore?.read("composer-refs.$gatewayId.$conversationId") ?: return emptyList()
    return parseContextRefs(JSONArray(raw))
  }

  fun saveComposerRefs(conversationId: String, refs: List<ConversationContextRef>) {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    val gatewayId = gateway.currentProfile()?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    val key = "composer-refs.$gatewayId.$conversationId"
    val array = contextRefsJson(refs)
    if (refs.isEmpty()) pendingStore?.remove(key) else pendingStore?.write(key, array.toString())
  }

  fun quickDraft(): String {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return ""
    return pendingStore?.read("quick-composer.$gatewayId") ?: ""
  }

  fun saveQuickDraft(content: String) {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    val store = pendingStore ?: throw IllegalStateException("NO_SECURE_STORE")
    val key = "quick-composer.$gatewayId"
    if (content.isEmpty()) store.remove(key) else store.write(key, content)
  }

  fun quickAttachments(): List<ChatAttachment> {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return emptyList()
    return attachmentStore?.list(gatewayId, QUICK_ATTACHMENT_SCOPE) ?: emptyList()
  }

  fun addQuickAttachment(gatewayId: String, uri: Uri): ChatAttachment {
    require(gateway.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    return (attachmentStore ?: throw IllegalStateException("NO_ATTACHMENT_STORE"))
      .import(gatewayId, QUICK_ATTACHMENT_SCOPE, uri)
  }

  fun removeQuickAttachment(gatewayId: String, attachmentId: String) {
    require(gateway.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    attachmentStore?.remove(gatewayId, QUICK_ATTACHMENT_SCOPE, attachmentId)
  }

  /** Finishes a previously interrupted quick-composer handoff before another draft can be created. */
  @Synchronized
  fun recoverQuickHandoff(): LocalConversationDraft? {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return null
    val store = pendingStore ?: return null
    val key = "quick-handoff.$gatewayId"
    val raw = store.read(key) ?: return null
    val record = JSONObject(raw)
    val id = record.getString("conversationId")
    val content = record.getString("content")
    require(runCatching { UUID.fromString(id) }.isSuccess && content.length <= 4_000) {
      "INVALID_QUICK_HANDOFF"
    }
    val draft = draft(id)
    if (draft == null) { store.remove(key); return null }
    saveComposerDraft(id, content)
    (attachmentStore ?: throw IllegalStateException("NO_ATTACHMENT_STORE"))
      .moveAll(gatewayId, QUICK_ATTACHMENT_SCOPE, id)
    saveQuickDraft("")
    gateway.saveMainConversationId(id)
    store.remove(key)
    return draft
  }

  /** Creates one local conversation and durably hands it the quick text and attachment snapshots. */
  @Synchronized
  fun stageQuickDraft(agentId: String, content: String): LocalConversationDraft {
    recoverQuickHandoff()?.let { return it }
    require(content.length <= 4_000 && (content.isNotBlank() || quickAttachments().isNotEmpty())) {
      "EMPTY_QUICK_INPUT"
    }
    val gatewayId = gateway.currentProfile()?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    val store = pendingStore ?: throw IllegalStateException("NO_SECURE_STORE")
    val draft = createDraft(agentId)
    store.write("quick-handoff.$gatewayId", JSONObject().put("conversationId", draft.conversationId)
      .put("content", content).toString())
    return recoverQuickHandoff() ?: throw IllegalStateException("QUICK_HANDOFF_FAILED")
  }

  fun pendingInput(conversationId: String): PendingInput? {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return null
    val raw = pendingStore?.read("pending-input.$gatewayId.$conversationId") ?: return null
    return parsePendingInput(raw)
  }

  fun saveComposerDraft(conversationId: String, content: String) {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    val key = "composer.$gatewayId.$conversationId"
    if (content.isEmpty()) pendingStore?.remove(key) else pendingStore?.write(key, content)
  }

  @Synchronized
  fun createDraft(agentId: String = "main"): LocalConversationDraft {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    require(agentId.isNotBlank()) { "INVALID_AGENT_ID" }
    val draft = LocalConversationDraft(UUID.randomUUID().toString(), agentId, "", "off", Instant.now().toString())
    val store = pendingStore ?: throw IllegalStateException("NO_SECURE_STORE")
    store.write(draftKey(gatewayId, draft.conversationId), draftJson(draft).toString())
    val ids = draftIds(gatewayId).filterNot { it == draft.conversationId }
    store.write("draft-index.$gatewayId", JSONArray(listOf(draft.conversationId) + ids).toString())
    return draft
  }

  fun draft(conversationId: String): LocalConversationDraft? {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return null
    val raw = pendingStore?.read(draftKey(gatewayId, conversationId)) ?: return null
    val json = JSONObject(raw)
    require(json.getString("conversationId") == conversationId) { "INVALID_DRAFT" }
    return LocalConversationDraft(conversationId, json.getString("agentId"), json.getString("model"),
      json.getString("thinkingLevel"), json.getString("createdAt"))
  }

  @Synchronized
  fun prepareDraftModel(conversationId: String): LocalConversationDraft {
    val current = draft(conversationId) ?: throw IllegalStateException("DRAFT_NOT_FOUND")
    if (current.model.isNotBlank()) return current
    val raw = gateway.request("/api/models?agentId=${encode(current.agentId)}")
    val payload = JSONObject(raw).getJSONObject("payload")
    val models = payload.optJSONArray("models") ?: payload.optJSONArray("items") ?: JSONArray()
    val chosen = payload.optString("defaultId").takeIf(String::isNotBlank)
      ?: models.optJSONObject(0)?.optString("id")?.takeIf(String::isNotBlank)
      ?: throw IllegalStateException("MODEL_UNAVAILABLE")
    val selected = (0 until models.length()).mapNotNull(models::optJSONObject).firstOrNull { it.optString("id") == chosen }
    val thinking = selected?.optJSONObject("thinking")?.optString("initialValue")?.takeIf(String::isNotBlank) ?: "off"
    val updated = current.copy(model = chosen, thinkingLevel = thinking)
    val gatewayId = gateway.currentProfile()?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    pendingStore?.write(draftKey(gatewayId, conversationId), draftJson(updated).toString())
    return updated
  }

  fun localDrafts(search: String = ""): List<ConversationSummary> {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return emptyList()
    val title = "New conversation"
    if (search.isNotBlank() && !title.contains(search.trim(), ignoreCase = true)) return emptyList()
    return draftIds(gatewayId).mapNotNull { id -> draft(id) }
      .map { ConversationSummary(it.conversationId, title, it.createdAt, 0, it.agentId, isLocalDraft = true) }
  }

  @Synchronized
  fun discardDraft(conversationId: String) {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    require(draft(conversationId) != null) { "DRAFT_NOT_FOUND" }
    require(pendingInput(conversationId) == null) { "INPUT_PENDING" }
    val store = pendingStore ?: throw IllegalStateException("NO_SECURE_STORE")
    removeDraft(conversationId, gatewayId)
    store.remove("composer.$gatewayId.$conversationId")
    store.remove("composer-refs.$gatewayId.$conversationId")
    attachmentStore?.removeConversation(gatewayId, conversationId)
  }

  @Synchronized
  private fun removeDraft(conversationId: String, gatewayId: String) {
    val store = pendingStore ?: return
    store.remove(draftKey(gatewayId, conversationId))
    store.write("draft-index.$gatewayId", JSONArray(draftIds(gatewayId).filterNot { it == conversationId }).toString())
  }

  private fun draftIds(gatewayId: String): List<String> {
    val json = pendingStore?.read("draft-index.$gatewayId")?.let(::JSONArray) ?: return emptyList()
    return (0 until json.length()).mapNotNull { json.optString(it).takeIf { id -> id.matches(Regex("[0-9a-fA-F-]{36}")) } }
  }

  private fun draftKey(gatewayId: String, conversationId: String) = "draft.$gatewayId.$conversationId"

  private fun draftJson(draft: LocalConversationDraft) = JSONObject()
    .put("conversationId", draft.conversationId).put("agentId", draft.agentId).put("model", draft.model)
    .put("thinkingLevel", draft.thinkingLevel).put("createdAt", draft.createdAt)

  fun list(search: String = "", offset: Int = 0, limit: Int = 20): ConversationPage {
    require(offset >= 0 && limit in 1..100)
    val query = "?limit=$limit&offset=$offset&channel=webchat&rootConversationsOnly=true&sortBy=updatedAt&sortOrder=desc&search=${encode(search.trim())}"
    val remote = parseList(gateway.request("/api/sessions$query"))
    return remote.copy(items = (if (offset == 0) localDrafts(search) else emptyList()) + remote.items)
  }

  fun history(conversationId: String): ConversationHistory {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    return parseHistory(conversationId, gateway.request("/api/sessions/$conversationId/history?view=compact&limit=20"))
  }

  fun executionDetail(conversationId: String, turnId: String): ExecutionDetail {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    require(turnId.isNotBlank() && turnId.length <= 256) { "INVALID_TURN_ID" }
    require(draft(conversationId) == null) { "LOCAL_DRAFT" }
    return parseExecutionDetail(turnId, gateway.request("/api/sessions/$conversationId/execution-detail?turnId=${encode(turnId)}"))
  }

  fun rename(conversationId: String, name: String) {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    val normalized = name.trim()
    require(normalized.isNotEmpty() && normalized.length <= 200) { "INVALID_NAME" }
    require(draft(conversationId) == null) { "LOCAL_DRAFT" }
    val response = JSONObject(gateway.request("/api/sessions/$conversationId/rename", "POST",
      JSONObject().put("name", normalized).toString()))
    require(response.optBoolean("renamed")) { "RENAME_FAILED" }
  }

  fun setPinned(conversationId: String, pinned: Boolean) {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    require(draft(conversationId) == null) { "LOCAL_DRAFT" }
    val action = if (pinned) "pin" else "unpin"
    val response = JSONObject(gateway.request("/api/sessions/$conversationId/$action", "POST"))
    require(response.optBoolean(if (pinned) "pinned" else "unpinned")) { "PIN_FAILED" }
  }

  fun setArchived(conversationId: String, archived: Boolean) {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    require(draft(conversationId) == null) { "LOCAL_DRAFT" }
    val action = if (archived) "archive" else "unarchive"
    val response = JSONObject(gateway.request("/api/sessions/$conversationId/$action", "POST"))
    require(response.optBoolean(if (archived) "archived" else "unarchived")) { "ARCHIVE_FAILED" }
  }

  fun delete(conversationId: String) {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    require(draft(conversationId) == null) { "LOCAL_DRAFT" }
    require(pendingInput(conversationId) == null) { "INPUT_PENDING" }
    val response = JSONObject(gateway.request("/api/sessions/$conversationId", "DELETE"))
    require(response.optBoolean("deleted")) { "DELETE_FAILED" }
  }

  fun context(conversationId: String): ConversationContext {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    if (draft(conversationId) != null) return ConversationContext(conversationId, null, null, null,
      emptyList(), false, emptyList(), true)
    val summary = gateway.request("/api/sessions/$conversationId/context-summary")
    val config = gateway.request("/api/sessions/$conversationId/agent-config")
    return parseContext(conversationId, summary, config)
  }

  fun taskWelcome(task: ContextWorkItem): TaskWelcomeInfo =
    parseTaskWelcome(task.id, gateway.request("/api/tasks/${encode(task.id)}"))

  fun ensureTaskConversation(taskId: String): String {
    require(taskId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_TASK_ID" }
    val root = JSONObject(gateway.request("/api/tasks/$taskId/conversation", "POST"))
    require(root.optBoolean("ok")) { "INVALID_TASK_CONVERSATION" }
    val id = root.getString("conversationId")
    require(runCatching { UUID.fromString(id) }.isSuccess) { "INVALID_TASK_CONVERSATION" }
    return id
  }

  fun projectWelcome(project: ContextWorkItem): ProjectWelcomeInfo {
    val path = "/api/projects/${encode(project.id)}"
    return parseProjectWelcome(project.id, gateway.request(path), gateway.request("$path/operating-view"))
  }

  fun activeRun(conversationId: String): String? {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    if (draft(conversationId) != null) return null
    return parseActiveRun(conversationId, gateway.request("/api/sessions/$conversationId/input-state"))
  }

  fun modelSelection(conversationId: String, agentId: String? = null): ModelSelection {
    val local = draft(conversationId)
    val effectiveAgent = local?.agentId ?: agentId
    val query = effectiveAgent?.takeIf(String::isNotBlank)?.let { "?agentId=${encode(it)}" } ?: ""
    val models = parseModels(gateway.request("/api/models$query"))
    if (local != null) return models.copy(selectedId = local.model.ifBlank { models.selectedId })
    val config = parseModelConfig(gateway.request("/api/sessions/$conversationId/agent-config"))
    return models.copy(selectedId = config.first, configVersion = config.second)
  }

  fun agents(): AgentCatalog = parseAgents(gateway.request("/api/agents"))

  @Synchronized
  fun setModel(conversationId: String, model: ConversationModel, configVersion: Long?): ModelSelection {
    require(model.id.isNotBlank()) { "INVALID_MODEL" }
    val profile = gateway.currentProfile() ?: throw IllegalStateException("NOT_PAIRED")
    require(pendingInput(conversationId) == null) { "INPUT_PENDING" }
    val local = draft(conversationId)
    if (local != null) {
      val updated = local.copy(model = model.id, thinkingLevel = model.initialThinkingLevel)
      pendingStore?.write(draftKey(profile.gatewayId, conversationId), draftJson(updated).toString())
      return ModelSelection(emptyList(), model.id, null)
    }
    val body = JSONObject().put("model", model.id)
    if (configVersion != null) body.put("configVersion", configVersion)
    val response = JSONObject(gateway.request("/api/sessions/$conversationId/agent-config", "PATCH", body.toString()))
    require(response.optBoolean("ok")) { "MODEL_UPDATE_FAILED" }
    val payload = response.getJSONObject("payload")
    return ModelSelection(emptyList(), payload.getString("model"), payload.getLong("configVersion"))
  }

  fun abortRun(runId: String) {
    require(runId.isNotBlank()) { "INVALID_RUN_ID" }
    val response = JSONObject(gateway.request("/api/agent/abort", "POST", JSONObject().put("runId", runId).toString()))
    require(response.optBoolean("ok") && response.has("payload")) { "RUN_ABORT_FAILED" }
  }

  /** Replays the same command identity after an uncertain transport result. */
  fun send(conversationId: String, content: String, claim: TurnClaim,
    refs: List<ConversationContextRef> = emptyList(),
    attachments: List<ChatAttachment> = emptyList()): String {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    require(content.isNotBlank() || refs.isNotEmpty() || attachments.isNotEmpty()) { "EMPTY_INPUT" }
    val contextRefs = contextRefsJson(refs, includeTitle = false)
    val localAttachments = attachmentsJson(attachments)
    val profile = gateway.currentProfile() ?: throw IllegalStateException("NOT_PAIRED")
    val key = "pending-input.${profile.gatewayId}.$conversationId"
    val saved = pendingStore?.read(key)?.let(::JSONObject)
    require(saved == null || saved.getJSONObject("input").getString("content") == content) { "INPUT_PENDING" }
    if (saved != null) {
      require(saved.optString("kind") != "task") { "TASK_INPUT_PENDING" }
      require(parsePendingInput(saved.toString()).contextRefs == refs.map { it.copy(title = "") }) {
        "INPUT_PENDING"
      }
      require(parsePendingInput(saved.toString()).attachments == attachments) { "INPUT_PENDING" }
    }
    val command = saved ?: (draft(conversationId)?.let { local ->
      require(local.model.isNotBlank()) { "MODEL_UNAVAILABLE" }
      JSONObject().put("kind", "start").put("clientMessageId", UUID.randomUUID().toString())
        .put("localAttachments", localAttachments)
        .put("creation", JSONObject().put("agentId", local.agentId).put("projectId", JSONObject.NULL)
          .put("execution", JSONObject.NULL).put("temporary", false).put("model", local.model)
          .put("thinkingLevel", local.thinkingLevel))
        .put("input", JSONObject().put("content", content)
          .apply { if (refs.isNotEmpty()) put("contextRefs", contextRefs) })
    } ?: run {
      val transcriptId = history(conversationId).transcriptId ?: throw IllegalStateException("SESSION_IDENTITY_UNAVAILABLE")
      val configVersion = parseConfigVersion(gateway.request("/api/sessions/$conversationId/agent-config"))
      JSONObject().put("kind", "append").put("clientMessageId", UUID.randomUUID().toString())
        .put("localAttachments", localAttachments)
        .put("expectedTranscriptId", transcriptId).put("configVersion", configVersion)
        .put("delivery", "next").put("input", JSONObject().put("content", content)
          .apply { if (refs.isNotEmpty()) put("contextRefs", contextRefs) })
    }).also { pendingStore?.write(key, it.toString()) }
    val messageId = command.getString("clientMessageId")
    val path = "/api/sessions/$conversationId"
    var result: String? = null
    if (saved != null) {
      try {
        result = gateway.request("$path/input-receipts/$messageId")
      } catch (error: GatewayHttpException) {
        if (error.status == 410) pendingStore.remove(key)
        if (error.status != 404) throw error
      }
    }
    for (attempt in 0..1) {
      if (result != null) break
      val wire = JSONObject(command.toString()).apply {
        remove("localAttachments")
        put("origin", claim.json())
        if (attachments.isNotEmpty()) getJSONObject("input").put("attachments",
          attachmentPayloads(profile.gatewayId, conversationId, attachments))
      }
      try {
        result = gateway.request("$path/inputs", "POST", wire.toString())
        break
      } catch (error: GatewayHttpException) {
        if (error.status in setOf(400, 409, 410)) pendingStore?.remove(key)
        if (error.status !in setOf(408) && error.status < 500) throw error
        try {
          result = gateway.request("$path/input-receipts/$messageId")
          break
        } catch (receiptError: GatewayHttpException) {
          if (receiptError.status != 404 || attempt == 1) throw error
        }
      } catch (error: Exception) {
        try {
          result = gateway.request("$path/input-receipts/$messageId")
          break
        } catch (receiptError: GatewayHttpException) {
          if (receiptError.status != 404 || attempt == 1) throw error
        }
      }
    }
    val payload = JSONObject(result ?: throw IllegalStateException("INPUT_NOT_CONFIRMED")).getJSONObject("payload")
    val receipt = payload.getJSONObject("receipt")
    require(receipt.getString("conversationId") == conversationId && receipt.getString("clientMessageId") == messageId &&
      receipt.getString("transcriptId") == payload.getJSONObject("session").getString("transcriptId")) { "INVALID_INPUT_RESPONSE" }
    if (composerDraft(conversationId) == content) saveComposerDraft(conversationId, "")
    if (composerRefs(conversationId).map { it.copy(title = "") } == parsePendingInput(command.toString()).contextRefs)
      saveComposerRefs(conversationId, emptyList())
    attachments.forEach { attachmentStore?.remove(profile.gatewayId, conversationId, it.id) }
    pendingStore?.remove(key)
    if (command.getString("kind") == "start") removeDraft(conversationId, profile.gatewayId)
    return payload.getJSONObject("inputState").optString("activeRunId")
  }

  /** Task input uses the active Task conversation and replays one durable client message ID on retry. */
  fun sendTask(taskId: String, conversationId: String, content: String, claim: TurnClaim,
    refs: List<ConversationContextRef> = emptyList(),
    attachments: List<ChatAttachment> = emptyList()): String {
    require(taskId.matches(Regex("[A-Za-z0-9_-]{1,128}")) &&
      runCatching { UUID.fromString(conversationId) }.isSuccess &&
      (content.isNotBlank() || refs.isNotEmpty() || attachments.isNotEmpty())) { "INVALID_TASK_INPUT" }
    val contextRefs = contextRefsJson(refs, includeTitle = false)
    val localAttachments = attachmentsJson(attachments)
    val profile = gateway.currentProfile() ?: throw IllegalStateException("NOT_PAIRED")
    val key = "pending-input.${profile.gatewayId}.$conversationId"
    val saved = pendingStore?.read(key)?.let(::JSONObject)
    require(saved == null || saved.optString("kind") == "task" &&
      saved.optString("taskId") == taskId && saved.getJSONObject("input").getString("content") == content &&
      parsePendingInput(saved.toString()).contextRefs == refs.map { it.copy(title = "") } &&
      parsePendingInput(saved.toString()).attachments == attachments) {
      "INPUT_PENDING"
    }
    val command = saved ?: run {
      val transcriptId = history(conversationId).transcriptId ?: throw IllegalStateException("SESSION_IDENTITY_UNAVAILABLE")
      val configVersion = parseModelConfig(gateway.request("/api/sessions/$conversationId/agent-config")).second
      JSONObject().put("kind", "task").put("taskId", taskId).put("localAttachments", localAttachments)
        .put("clientMessageId", UUID.randomUUID().toString())
        .put("expectedTranscriptId", transcriptId).put("configVersion", configVersion)
        .put("delivery", "next").put("input", JSONObject().put("content", content)
          .apply { if (refs.isNotEmpty()) put("contextRefs", contextRefs) })
        .also { pendingStore?.write(key, it.toString()) }
    }
    val body = JSONObject().put("clientMessageId", command.getString("clientMessageId"))
      .put("expectedTranscriptId", command.getString("expectedTranscriptId"))
      .put("configVersion", command.getLong("configVersion"))
      .put("delivery", "next").put("content", content).put("origin", claim.json())
      .apply { if (refs.isNotEmpty()) put("contextRefs", contextRefs) }
      .apply { if (attachments.isNotEmpty()) put("attachments",
        attachmentPayloads(profile.gatewayId, conversationId, attachments)) }
    val raw = try {
      gateway.request("/api/tasks/$taskId/inputs", "POST", body.toString(),
        mapOf("X-Xopc-Expected-Session-Key" to conversationId))
    } catch (error: GatewayHttpException) {
      if (error.status in setOf(400, 409, 410)) pendingStore?.remove(key)
      throw error
    }
    val root = JSONObject(raw)
    require(root.optBoolean("ok")) { "INVALID_TASK_INPUT_RESPONSE" }
    val payload = root.getJSONObject("payload")
    require(payload.getString("conversationId") == conversationId) { "MISMATCHED_TASK_CONVERSATION" }
    if (composerDraft(conversationId) == content) saveComposerDraft(conversationId, "")
    if (composerRefs(conversationId).map { it.copy(title = "") } == refs.map { it.copy(title = "") })
      saveComposerRefs(conversationId, emptyList())
    attachments.forEach { attachmentStore?.remove(profile.gatewayId, conversationId, it.id) }
    pendingStore?.remove(key)
    return payload.getJSONObject("state").optString("activeRunId")
  }

  private fun attachmentPayloads(gatewayId: String, conversationId: String,
    attachments: List<ChatAttachment>): JSONArray =
    (attachmentStore ?: throw IllegalStateException("NO_ATTACHMENT_STORE"))
      .wirePayloads(gatewayId, conversationId, attachments)

  companion object {
    const val QUICK_ATTACHMENT_SCOPE = "00000000-0000-0000-0000-000000000000"
    fun parseAgents(raw: String): AgentCatalog {
      val root = JSONObject(raw)
      require(root.optBoolean("ok")) { "INVALID_AGENTS" }
      val payload = root.getJSONObject("payload")
      val items = payload.getJSONArray("agents")
      require(items.length() <= 200) { "INVALID_AGENTS" }
      val agents = (0 until items.length()).map { index ->
        val item = items.getJSONObject(index)
        val id = item.getString("id")
        require(id.matches(Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,63}"))) { "INVALID_AGENTS" }
        ConversationAgent(id, item.optString("name").ifBlank { id }, item.optString("description"))
      }
      val defaultId = payload.getString("defaultId")
      require(agents.any { it.id == defaultId }) { "INVALID_AGENTS" }
      return AgentCatalog(agents, defaultId)
    }

    fun parseModels(raw: String): ModelSelection {
      val root = JSONObject(raw)
      require(root.optBoolean("ok")) { "INVALID_MODELS" }
      val payload = root.getJSONObject("payload")
      val array = payload.optJSONArray("models") ?: payload.optJSONArray("items") ?: throw IllegalArgumentException("INVALID_MODELS")
      require(array.length() <= 1_000) { "INVALID_MODELS" }
      val models = (0 until array.length()).map { index ->
        val item = array.getJSONObject(index)
        val id = item.getString("id")
        require(id.isNotBlank()) { "INVALID_MODELS" }
        ConversationModel(id, item.optString("name").ifBlank { id },
          item.optJSONObject("thinking")?.optString("initialValue")?.takeIf(String::isNotBlank) ?: "off")
      }
      return ModelSelection(models, payload.optString("defaultId").ifBlank { models.firstOrNull()?.id.orEmpty() }, null)
    }

    fun parseModelConfig(raw: String): Pair<String, Long> {
      val root = JSONObject(raw)
      require(root.optBoolean("ok")) { "INVALID_AGENT_CONFIG" }
      val payload = root.getJSONObject("payload")
      val model = payload.getString("model")
      val version = payload.getLong("configVersion")
      require(model.isNotBlank() && version >= 0) { "INVALID_AGENT_CONFIG" }
      return model to version
    }

    fun parsePendingInput(raw: String): PendingInput {
      val command = JSONObject(raw)
      require(command.optString("kind") in setOf("start", "append", "task")) { "INVALID_PENDING_INPUT" }
      val id = command.getString("clientMessageId")
      val content = command.getJSONObject("input").getString("content")
      val taskId = if (command.optString("kind") == "task") command.getString("taskId") else null
      val refs = parseContextRefs(command.getJSONObject("input").optJSONArray("contextRefs"))
      val attachments = parseAttachments(command.optJSONArray("localAttachments"))
      require(runCatching { UUID.fromString(id) }.isSuccess &&
        (content.isNotBlank() || refs.isNotEmpty() || attachments.isNotEmpty())) { "INVALID_PENDING_INPUT" }
      require(taskId == null || taskId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_PENDING_INPUT" }
      return PendingInput(id, content, taskId, refs, attachments)
    }

    fun parseAttachments(array: JSONArray?): List<ChatAttachment> {
      if (array == null) return emptyList()
      require(array.length() <= ChatAttachmentStore.MAX_ATTACHMENTS) { "INVALID_ATTACHMENTS" }
      val items = (0 until array.length()).map { ChatAttachmentStore.parseMetadata(array.getJSONObject(it)) }
      require(items.map { it.id }.distinct().size == items.size &&
        items.sumOf { it.size } <= ChatAttachmentStore.MAX_TOTAL_BYTES) { "INVALID_ATTACHMENTS" }
      return items
    }

    fun attachmentsJson(items: List<ChatAttachment>): JSONArray = JSONArray().also { array ->
      items.forEach { array.put(ChatAttachmentStore.metadataJson(it)) }
      parseAttachments(array)
    }

    fun parseContextRefs(array: JSONArray?): List<ConversationContextRef> {
      if (array == null) return emptyList()
      require(array.length() <= 5) { "INVALID_CONTEXT_REFS" }
      val refs = (0 until array.length()).map { index ->
        val item = array.getJSONObject(index)
        val kind = item.getString("kind")
        val sourceId = item.getString("sourceId")
        val version = item.optString("expectedVersion")
        val title = item.optString("title")
        require(kind in setOf("note", "task", "user_assertion") &&
          sourceId.isNotBlank() && sourceId.length <= 256 &&
          (kind != "user_assertion" || version.isNotBlank()) &&
          version.length <= 64 && title.length <= 300) { "INVALID_CONTEXT_REFS" }
        ConversationContextRef(kind, sourceId, version, title)
      }
      require(refs.map { it.kind to it.sourceId }.distinct().size == refs.size) { "INVALID_CONTEXT_REFS" }
      return refs
    }

    fun contextRefsJson(refs: List<ConversationContextRef>, includeTitle: Boolean = true): JSONArray {
      val array = JSONArray()
      refs.forEach { ref -> array.put(JSONObject().put("kind", ref.kind).put("sourceId", ref.sourceId)
        .put("expectedVersion", ref.expectedVersion).apply { if (includeTitle) put("title", ref.title) }) }
      parseContextRefs(array)
      return array
    }

    fun parseActiveRun(conversationId: String, raw: String): String? {
      val root = JSONObject(raw)
      require(root.optBoolean("ok")) { "INVALID_INPUT_STATE" }
      val payload = root.getJSONObject("payload")
      require(payload.getString("conversationId") == conversationId) { "INVALID_INPUT_STATE" }
      return (payload.opt("activeRunId") as? String)?.takeIf(String::isNotBlank)
    }

    fun parseConfigVersion(raw: String): Long = JSONObject(raw).getJSONObject("payload").getLong("configVersion")

    fun parseList(raw: String): ConversationPage {
      val root = JSONObject(raw)
      val items = root.getJSONArray("items")
      require(root.has("hasMore") && items.length() <= 100) { "INVALID_SESSION_LIST" }
      val parsed = (0 until items.length()).map { index ->
        val item = items.getJSONObject(index)
        val id = item.getString("key")
        require(id.isNotBlank() && item.getInt("messageCount") >= 0) { "INVALID_SESSION_LIST" }
        val title = sequenceOf("displayName", "title", "name").mapNotNull { item.optString(it).takeIf(String::isNotBlank) }
          .firstOrNull() ?: id
        val status = item.optString("status").ifBlank { "active" }
        require(status in setOf("active", "idle", "pinned", "archived")) { "INVALID_SESSION_LIST" }
        ConversationSummary(id, title, item.getString("updatedAt"), item.getInt("messageCount"),
          item.optString("agentId").takeIf(String::isNotBlank), status = status)
      }
      return ConversationPage(parsed, parsed.size, root.getBoolean("hasMore") && parsed.isNotEmpty())
    }

    fun parseContext(conversationId: String, raw: String, configRaw: String): ConversationContext {
      val summary = JSONObject(raw).getJSONObject("summary")
      require(summary.getString("conversationId") == conversationId) { "INVALID_CONTEXT" }
      val work = summary.getJSONObject("work")
      fun workItem(key: String): ContextWorkItem? = work.optJSONObject(key)?.let { item ->
        ContextWorkItem(item.getString("id"), item.getString("title"))
      }
      val environment = summary.optJSONObject("environment")?.let {
        ContextEnvironment(it.getString("kind"), it.getString("rootPath"), it.getBoolean("available"),
          it.optString("branch").takeIf(String::isNotBlank))
      }
      val sourceRows = summary.getJSONArray("sources")
      require(sourceRows.length() <= 20) { "INVALID_CONTEXT" }
      val sources = (0 until sourceRows.length()).map { index ->
        val item = sourceRows.getJSONObject(index)
        ContextSource(item.getString("id"), item.optString("title"), item.optBoolean("unavailable"))
      }
      val sections = summary.getJSONArray("unavailableSections")
      val unavailable = (0 until sections.length()).map { sections.getString(it) }
      val config = JSONObject(configRaw).getJSONObject("payload")
      return ConversationContext(conversationId, workItem("project"), workItem("task"), environment,
        sources, summary.getBoolean("sourcesHasMore"), unavailable, config.optBoolean("workingDirectoryLocked"))
    }

    fun parseTaskWelcome(taskId: String, raw: String): TaskWelcomeInfo {
      val response = JSONObject(raw)
      require(response.getBoolean("ok")) { "INVALID_TASK_WELCOME" }
      val task = response.getJSONObject("task")
      require(task.getString("id") == taskId) { "INVALID_TASK_WELCOME" }
      val phase = task.getString("phase")
      require(phase in setOf("backlog", "ready", "active", "review", "closed")) { "INVALID_TASK_WELCOME" }
      val operationalState = response.getString("operationalState")
      require(operationalState in setOf("idle", "queued", "running", "waiting", "verifying", "blocked")) {
        "INVALID_TASK_WELCOME"
      }
      val attention = response.optJSONArray("attention")?.optJSONObject(0)?.optString("summary")
        ?.takeIf(String::isNotBlank)?.take(240)
      val receipt = response.optJSONArray("receipts")?.optJSONObject(0)
      val failure = receipt?.optJSONObject("failure")?.optString("recoveryAction")
        ?.takeIf(String::isNotBlank)?.take(240)
      val next = receipt?.optString("nextAction")?.takeIf(String::isNotBlank)?.take(240)
      return TaskWelcomeInfo(task.getString("title").take(120), phase, operationalState, attention, failure, next)
    }

    fun parseProjectWelcome(projectId: String, detailRaw: String, viewRaw: String): ProjectWelcomeInfo {
      val detail = JSONObject(detailRaw)
      require(detail.getBoolean("ok")) { "INVALID_PROJECT_WELCOME" }
      val project = detail.getJSONObject("project")
      require(project.getString("id") == projectId) { "INVALID_PROJECT_WELCOME" }
      val response = JSONObject(viewRaw)
      require(response.getBoolean("ok")) { "INVALID_PROJECT_WELCOME" }
      val view = response.getJSONObject("view")
      require(view.getJSONObject("project").getString("id") == projectId) { "INVALID_PROJECT_WELCOME" }
      val digest = view.getJSONObject("digest")
      val health = digest.getString("health")
      require(health in setOf("healthy", "attention", "idle", "empty")) { "INVALID_PROJECT_WELCOME" }
      val blockers = view.getJSONArray("blockers")
      val firstBlocker = if (blockers.length() > 0) blockers.getJSONObject(0) else null
      val blockedReason = firstBlocker?.optString("detail")?.takeIf(String::isNotBlank)
        ?: firstBlocker?.optString("title")?.takeIf(String::isNotBlank)
      val results = view.getJSONArray("recentResults")
      require(blockers.length() <= 100 && results.length() <= 100) { "INVALID_PROJECT_WELCOME" }
      val failed = if (health == "attention") (0 until results.length()).firstNotNullOfOrNull { index ->
        val receipt = results.getJSONObject(index).getJSONObject("receipt")
        if (receipt.optString("status") == "failed" ||
          receipt.optJSONObject("verification")?.optString("status") == "failed") receipt else null
      } else null
      val recentFailure = failed?.optJSONObject("failure")?.optString("recoveryAction")
        ?.takeIf(String::isNotBlank) ?: failed?.optString("summary")?.takeIf(String::isNotBlank)
      return ProjectWelcomeInfo(project.getString("name").take(120), blockedReason?.take(240),
        recentFailure?.take(240), digest.optString("recommendedAction").takeIf(String::isNotBlank)?.take(240))
    }

    fun parseHistory(conversationId: String, raw: String): ConversationHistory {
      val session = JSONObject(raw).getJSONObject("session")
      require(session.getString("key") == conversationId) { "INVALID_SESSION_HISTORY" }
      val messages = session.getJSONArray("messages")
      require(messages.length() <= 100) { "INVALID_SESSION_HISTORY" }
      return ConversationHistory(conversationId, session.optString("transcriptId").takeIf(String::isNotBlank),
        parseMessages(messages), session.optString("agentId").takeIf(String::isNotBlank))
    }

    fun parseExecutionDetail(turnId: String, raw: String): ExecutionDetail {
      val detail = JSONObject(raw).getJSONObject("detail")
      require(detail.getString("turnId") == turnId) { "INVALID_EXECUTION_DETAIL" }
      val rows = detail.getJSONArray("steps")
      require(rows.length() <= 200) { "INVALID_EXECUTION_DETAIL" }
      val steps = (0 until rows.length()).map { index ->
        val row = rows.getJSONObject(index)
        val kind = row.getString("kind")
        require(kind in setOf("tool", "progress", "thinking")) { "INVALID_EXECUTION_DETAIL" }
        ExecutionStep(row.getString("id"), kind, row.optString("category", "other"),
          row.optString("text").take(500), row.optString("preview").take(160),
          row.optString("failure").take(240), row.optString("status", "done"))
      }
      return ExecutionDetail(turnId, steps)
    }

    private fun parseMessages(messages: JSONArray): List<ConversationMessage> = (0 until messages.length()).mapNotNull { index ->
      val item = messages.getJSONObject(index)
      val role = item.optString("role")
      if (role !in setOf("user", "assistant")) return@mapNotNull null
      val content = item.opt("content")
      val text = when (content) {
        is String -> content
        is JSONArray -> (0 until content.length()).mapNotNull { part ->
          content.optJSONObject(part)?.takeIf { it.optString("type") == "text" }?.optString("text")
        }.joinToString("\n")
        else -> ""
      }
      if (text.isBlank()) null else
        ConversationMessage(item.optString("id").ifBlank { item.optString("messageId").ifBlank { "$index" } }, role, text,
          item.optString("turnId").takeIf(String::isNotBlank))
    }

    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
  }
}
