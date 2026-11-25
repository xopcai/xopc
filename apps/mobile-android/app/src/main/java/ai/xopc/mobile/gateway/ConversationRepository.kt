package ai.xopc.mobile.gateway

import android.content.Context
import android.net.Uri
import android.graphics.Bitmap
import android.util.Base64
import java.net.URLEncoder
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import org.json.JSONArray
import org.json.JSONObject

private const val MIN_SIDEBAR_PAGE_ROWS = 8

sealed interface ConversationHistoryScope {
  data object Recent : ConversationHistoryScope
  data object Unassigned : ConversationHistoryScope
  data class Project(val id: String) : ConversationHistoryScope
  data class Expert(val id: String) : ConversationHistoryScope
}

data class ConversationSummary(
  val id: String,
  val title: String,
  val updatedAt: String,
  val messageCount: Int,
  val agentId: String?,
  val isLocalDraft: Boolean = false,
  val status: String = "active",
  val agentSetup: Boolean = false,
) {
  internal val isRecentSidebarCandidate: Boolean get() = !isLocalDraft && status != "archived" && messageCount > 0
}
data class ConversationTaskChild(val taskId: String, val title: String, val phase: String,
  val runStatus: String?, val activeConversationId: String?)
data class ConversationTaskGroup(val total: Int, val activeCount: Int, val items: List<ConversationTaskChild>)
data class ConversationPage(val items: List<ConversationSummary>, val remoteCount: Int, val hasMore: Boolean,
  val taskGroups: Map<String, ConversationTaskGroup> = emptyMap())
internal data class RecentConversationPage(val items: List<ConversationSummary>, val nextOffset: Int?)
data class ConversationShareMessage(val id: String, val role: String, val markdown: String)
data class ConversationShareAttachment(val id: String, val fileName: String)
data class ConversationSharePreview(val conversationId: String, val transcriptId: String,
  val cutoffSeq: Long, val metadataUpdatedAt: String, val title: String,
  val messageCount: Int, val attachmentCount: Int,
  val messages: List<ConversationShareMessage> = emptyList(),
  val attachments: List<ConversationShareAttachment> = emptyList())
data class ConversationShare(val conversationId: String, val id: String, val title: String,
  val url: String, val reachability: String, val hint: String, val expiresAt: String,
  val messageCount: Int = 0, val attachmentCount: Int = 0)
data class ContextWorkItem(val id: String, val title: String)
data class ContextSource(val id: String, val title: String, val unavailable: Boolean)
data class ContextEnvironment(val kind: String, val rootPath: String, val available: Boolean, val branch: String?)
data class ConversationContext(val conversationId: String, val project: ContextWorkItem?, val task: ContextWorkItem?,
  val environment: ContextEnvironment?, val sources: List<ContextSource>, val sourcesHasMore: Boolean,
  val unavailableSections: List<String>, val workingDirectoryLocked: Boolean,
  val effectiveWorkspacePath: String = "")
data class ContextEnvironmentOptions(val localAvailable: Boolean, val worktreeUnavailableReason: String?)
data class ContextDirectory(val name: String, val absolutePath: String, val isDirectory: Boolean)
data class ContextDirectoryPage(val currentPath: String, val parentPath: String?, val entries: List<ContextDirectory>)
data class TaskWelcomeInfo(val taskTitle: String, val phase: String, val operationalState: String,
  val attentionSummary: String?, val recentFailure: String?, val nextAction: String?)
data class ProjectWelcomeInfo(val projectName: String, val blockedReason: String?,
  val recentFailure: String?, val recommendedAction: String?)

data class ConversationMedia(val id: String, val name: String, val type: String, val mimeType: String,
  val size: Long, val uri: String, val workspaceRelativePath: String? = null,
  val durationSeconds: Double? = null, val fileId: String? = null)
data class ConversationReference(val kind: String, val sourceId: String, val version: String,
  val title: String, val url: String? = null)
data class ConversationTarget(val kind: String, val id: String, val title: String,
  val summary: String? = null, val status: String? = null, val capabilities: List<String> = emptyList())
data class ConversationArtifact(val artifactId: String, val title: String, val kind: String,
  val mimeType: String?, val sizeBytes: Long?, val availability: String, val location: String,
  val capabilities: List<String>, val uri: String?, val workspaceRelativePath: String?, val shareUrl: String?)
data class ConversationOutcome(val status: String, val summary: String?,
  val artifacts: List<ConversationArtifact>)
data class AgentMessageReaction(val emoji: String, val actorName: String)
data class ChatProjectComparison(val surfaceId: String, val messages: List<String>)
data class ConversationMessage(val id: String, val role: String, val text: String, val turnId: String? = null,
  val hasNonTextContent: Boolean = false, val media: List<ConversationMedia> = emptyList(),
  val references: List<ConversationReference> = emptyList(),
  val targets: List<ConversationTarget> = emptyList(), val outcome: ConversationOutcome? = null,
  val sourceIds: Set<String> = setOf(id), val renderId: String = id, val answerConfirmed: Boolean = true,
  val narrations: List<ConversationNarration> = emptyList(), val generatedMediaIds: List<String> = emptyList(),
  val agentReaction: AgentMessageReaction? = null,
  val projectComparisons: List<ChatProjectComparison> = emptyList())
data class ConversationNarration(val id: String, val text: String)
data class ConversationHistory(val conversationId: String, val transcriptId: String?, val messages: List<ConversationMessage>,
  val agentId: String? = null, val nextBeforeCursor: String? = null, val lastSeq: Long? = null)
data class ExecutionStep(val id: String, val kind: String, val category: String, val text: String,
  val preview: String, val failure: String, val status: String)
data class ExecutionDetail(val turnId: String, val steps: List<ExecutionStep>)
data class ConversationContextRef(val kind: String, val sourceId: String,
  val expectedVersion: String, val title: String)
data class PendingInput(val clientMessageId: String, val content: String, val taskId: String? = null,
  val contextRefs: List<ConversationContextRef> = emptyList(),
  val attachments: List<ChatAttachment> = emptyList())
data class ConversationAgent(val id: String, val name: String, val description: String, val avatar: String = "",
  val purpose: String? = null)
data class AgentCatalog(val agents: List<ConversationAgent>, val defaultId: String)
data class ConversationModel(val id: String, val name: String, val initialThinkingLevel: String,
  val thinkingMode: String = "none", val thinkingOptions: List<String> = emptyList(),
  val displayNames: Map<String, String> = emptyMap()) {
  fun localizedName(language: String): String = displayNames[if (language == "zh") "zh-CN" else "en"] ?: name
}

internal fun JSONObject.modelDisplayNames(): Map<String, String> {
  val names = optJSONObject("displayNames") ?: return emptyMap()
  return names.keys().asSequence().mapNotNull { key ->
    names.optString(key).takeIf(String::isNotBlank)?.let { key to it }
  }.toMap()
}
data class ModelSelection(val models: List<ConversationModel>, val selectedId: String,
  val configVersion: Long?, val thinkingLevel: String = "off")
data class LocalConversationDraft(
  val conversationId: String,
  val agentId: String,
  val model: String,
  val thinkingLevel: String,
  val createdAt: String,
  val projectId: String? = null,
  val executionMode: String? = null,
  val agentSetupLanguage: String? = null,
)

private const val RECENT_CACHE_AGE = 72 * 60 * 60 * 1000L

data class NextTurnSuggestion(
  val id: String, val conversationId: String, val transcriptId: String, val agentId: String,
  val locale: String, val prompt: String, val expiresAt: Long,
)

/** Assistant and Conversations read the same Gateway-backed conversation data. */
class ConversationRepository(private val gateway: GatewaySession, context: Context? = null,
  private val pendingStore: AndroidSecureStore? = context?.let(::AndroidSecureStore),
  private val attachmentStore: ChatAttachmentStore? = context?.let(::ChatAttachmentStore)) {

  @Synchronized
  fun removeGatewayLocal(gatewayId: String) {
    UUID.fromString(gatewayId)
    val store = pendingStore ?: return
    listOf("composer.$gatewayId.", "composer-refs.$gatewayId.",
      "pending-input.$gatewayId.", "draft.$gatewayId.").forEach(store::removeMatchingPrefix)
    store.remove("draft-index.$gatewayId")
    store.remove("quick-composer.$gatewayId")
    store.remove("quick-handoff.$gatewayId")
    store.remove("recent-sessions.$gatewayId")
    attachmentStore?.removeGateway(gatewayId)
  }

  @Synchronized
  fun cachedRecent(profile: GatewayProfile): List<ConversationSummary>? = runCatching {
    val raw = pendingStore?.read("recent-sessions.${profile.gatewayId}") ?: return null
    val record = JSONObject(raw)
    val elapsed = System.currentTimeMillis() - record.getLong("savedAt")
    if (record.getString("deviceId") != profile.deviceId || elapsed !in 0..RECENT_CACHE_AGE) return null
    parseList(raw).items
  }.getOrNull()

  @Synchronized
  fun cacheRecent(profile: GatewayProfile, rows: List<ConversationSummary>, requestedAt: Long) {
    val current = gateway.currentProfile()
    if (current?.gatewayId != profile.gatewayId || current.deviceId != profile.deviceId) return
    val store = pendingStore ?: return
    val key = "recent-sessions.${profile.gatewayId}"
    runCatching {
      val previous = runCatching { store.read(key)?.let(::JSONObject) }.getOrNull()
      if (previous?.optString("deviceId") == profile.deviceId && previous.optLong("savedAt") > requestedAt) return
      val items = rows.asSequence().filterNot { it.isLocalDraft }.take(20).map {
        JSONObject().put("key", it.id).put("displayName", it.title).put("updatedAt", it.updatedAt)
          .put("messageCount", it.messageCount).put("agentId", it.agentId).put("status", it.status)
      }.toList()
      store.write(key, JSONObject().put("deviceId", profile.deviceId).put("savedAt", requestedAt)
        .put("items", JSONArray(items)).put("hasMore", false).toString())
    }
  }

  fun composerAttachments(conversationId: String): List<ChatAttachment> {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return emptyList()
    return attachmentStore?.list(gatewayId, conversationId) ?: emptyList()
  }

  fun composerImagePreview(conversationId: String, item: ChatAttachment): Bitmap? {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return null
    return attachmentStore?.previewImage(gatewayId, conversationId, item)
  }

  fun composerFilePreview(conversationId: String, item: ChatAttachment): ByteArray? {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return null
    return attachmentStore?.previewFile(gatewayId, conversationId, item)
  }

  fun addComposerAttachment(gatewayId: String, conversationId: String, uri: Uri): ChatAttachment {
    require(gateway.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    return (attachmentStore ?: throw IllegalStateException("NO_ATTACHMENT_STORE"))
      .import(gatewayId, conversationId, uri)
  }

  fun addComposerVoice(gatewayId: String, conversationId: String, bytes: ByteArray,
    durationSeconds: Int): ChatAttachment {
    require(gateway.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    return (attachmentStore ?: throw IllegalStateException("NO_ATTACHMENT_STORE"))
      .addVoiceBytes(gatewayId, conversationId, bytes, durationSeconds)
  }

  fun addComposerFile(gatewayId: String, conversationId: String, file: ManagedFile): ChatAttachment {
    require(gateway.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    return (attachmentStore ?: throw IllegalStateException("NO_ATTACHMENT_STORE"))
      .addWorkspaceFile(gatewayId, conversationId, file)
  }

  fun addComposerFileBytes(gatewayId: String, conversationId: String, name: String, mimeType: String, bytes: ByteArray) {
    require(gateway.currentProfile()?.gatewayId == gatewayId) { "GATEWAY_CHANGED" }
    checkNotNull(attachmentStore).addBytes(gatewayId, conversationId, name, mimeType, bytes)
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

  private fun quickDraft(): String {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return ""
    return pendingStore?.read("quick-composer.$gatewayId") ?: ""
  }

  private fun quickAttachments(): List<ChatAttachment> {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return emptyList()
    return attachmentStore?.list(gatewayId, QUICK_ATTACHMENT_SCOPE) ?: emptyList()
  }

  private fun recoverQuickHandoff(): LocalConversationDraft? {
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
    val draft = draft(id) ?: if (record.optBoolean("migration")) {
      LocalConversationDraft(id, "main", "", "off", Instant.now().toString(), null, null).also {
        persistLocalDraft(gatewayId, it)
      }
    } else {
      store.remove(key)
      return null
    }
    if (id !in draftIds(gatewayId)) persistLocalDraft(gatewayId, draft)
    saveComposerDraft(id, content)
    (attachmentStore ?: throw IllegalStateException("NO_ATTACHMENT_STORE"))
      .moveAll(gatewayId, QUICK_ATTACHMENT_SCOPE, id)
    store.remove("quick-composer.$gatewayId")
    store.remove(key)
    return draft
  }

  /** Moves retired quick-composer text and attachment snapshots into an ordinary local draft. */
  @Synchronized
  fun migrateQuickComposerDraft(): LocalConversationDraft? {
    recoverQuickHandoff()?.let { return it }
    val content = quickDraft()
    if (content.isBlank() && quickAttachments().isEmpty()) return null
    require(content.length <= 4_000) { "INVALID_QUICK_HANDOFF" }
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return null
    val store = pendingStore ?: return null
    val id = UUID.randomUUID().toString()
    store.write("quick-handoff.$gatewayId", JSONObject().put("conversationId", id).put("migration", true)
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
  fun createDraft(agentId: String = "main", projectId: String? = null,
    executionMode: String? = null, agentSetupLanguage: String? = null): LocalConversationDraft {
    val gatewayId = gateway.currentProfile()?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    require(agentId.isNotBlank()) { "INVALID_AGENT_ID" }
    require(projectId == null || projectId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_PROJECT_ID" }
    require(executionMode == null || projectId != null &&
      executionMode in setOf("local_checkout", "managed_worktree")) { "INVALID_EXECUTION_MODE" }
    val resolvedMode = if (projectId != null && executionMode == null)
      defaultProjectExecutionMode(projectId) else executionMode
    val draft = LocalConversationDraft(UUID.randomUUID().toString(), agentId, "", "off", Instant.now().toString(),
      projectId, resolvedMode, agentSetupLanguage)
    persistLocalDraft(gatewayId, draft)
    return draft
  }

  private fun persistLocalDraft(gatewayId: String, draft: LocalConversationDraft) {
    val store = pendingStore ?: throw IllegalStateException("NO_SECURE_STORE")
    store.write(draftKey(gatewayId, draft.conversationId), draftJson(draft).toString())
    val ids = draftIds(gatewayId).filterNot { it == draft.conversationId }
    store.write("draft-index.$gatewayId", JSONArray(listOf(draft.conversationId) + ids).toString())
  }

  fun draft(conversationId: String): LocalConversationDraft? {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return null
    val raw = pendingStore?.read(draftKey(gatewayId, conversationId)) ?: return null
    val json = JSONObject(raw)
    require(json.getString("conversationId") == conversationId) { "INVALID_DRAFT" }
    return LocalConversationDraft(conversationId, json.getString("agentId"), json.getString("model"),
      json.getString("thinkingLevel"), json.getString("createdAt"),
      if (json.isNull("projectId")) null else json.optString("projectId").takeIf(String::isNotBlank),
      if (json.isNull("executionMode")) null else json.optString("executionMode").takeIf(String::isNotBlank),
      json.optString("agentSetupLanguage").takeIf { it in setOf("zh-CN", "en") })
  }

  fun projectDrafts(projectId: String): List<LocalConversationDraft> {
    require(projectId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_PROJECT_ID" }
    val gatewayId = gateway.currentProfile()?.gatewayId ?: return emptyList()
    return draftIds(gatewayId).mapNotNull(::draft).filter { it.projectId == projectId }
  }

  fun materializeForVoice(conversationId: String) = materialize(conversationId, "voice")

  fun materialize(conversationId: String, purpose: String) {
    require(purpose in setOf("voice", "session_resources")) { "INVALID_MATERIALIZATION_PURPOSE" }
    val existing = draft(conversationId) ?: return
    val gatewayId = gateway.currentProfile()?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    val ready = if (existing.model.isBlank()) prepareDraftModel(conversationId) else existing
    val creation = creationJson(ready)
    val body = JSONObject().put("commandId", conversationId).put("purpose", purpose)
      .put("creation", creation)
    val raw = gateway.request("/api/sessions/$conversationId/materialize", "POST", body.toString())
    val receipt = JSONObject(raw).getJSONObject("payload").getJSONObject("receipt")
    require(receipt.getString("conversationId") == conversationId &&
      receipt.getString("clientMessageId") == conversationId &&
      receipt.getString("lifecycle") == "ready") { "INVALID_VOICE_MATERIALIZATION" }
    removeDraft(conversationId, gatewayId)
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
    .put("projectId", draft.projectId ?: JSONObject.NULL)
    .put("executionMode", draft.executionMode ?: JSONObject.NULL)
    .putOpt("agentSetupLanguage", draft.agentSetupLanguage)

  private fun creationJson(draft: LocalConversationDraft) = JSONObject()
    .put("agentId", draft.agentId).put("projectId", draft.projectId ?: JSONObject.NULL)
    .put("execution", draft.executionMode?.let { JSONObject().put("mode", it) } ?: JSONObject.NULL)
    .put("temporary", false).put("model", draft.model).put("thinkingLevel", draft.thinkingLevel)
    .apply { draft.agentSetupLanguage?.let { put("agentSetup", true).put("agentSetupLanguage", it) } }

  private fun defaultProjectExecutionMode(projectId: String): String? {
    val result = JSONObject(gateway.request("/api/projects/${encode(projectId)}"))
    require(result.optBoolean("ok")) { "INVALID_PROJECT" }
    val project = result.getJSONObject("project")
    require(project.getString("id") == projectId && project.getString("name").isNotBlank()) {
      "INVALID_PROJECT"
    }
    return "local_checkout".takeIf { !project.isNull("workspaceRoot") && project.optString("workspaceRoot").isNotBlank() }
  }

  fun list(search: String = "", offset: Int = 0, limit: Int = 20,
    scope: ConversationHistoryScope? = null, pinnedOnly: Boolean = false): ConversationPage {
    require(offset >= 0 && limit in 1..100)
    val roots = if (search.isBlank() || scope is ConversationHistoryScope.Expert) "&rootConversationsOnly=true" else ""
    val filters = when (scope) {
      null -> "&channel=webchat"
      ConversationHistoryScope.Recent -> "&excludeArchived=true&excludeAutomationRuns=true"
      ConversationHistoryScope.Unassigned -> "&excludeArchived=true&excludeAutomationRuns=true&unassigned=true"
      is ConversationHistoryScope.Project -> "&excludeArchived=true&excludeAutomationRuns=true&projectId=" + encode(scope.id)
      is ConversationHistoryScope.Expert -> "&excludeArchived=true&sources=workbench&purposes=chat&activity=manual&agentId=" + encode(scope.id)
    }
    val status = if (pinnedOnly) "&status=pinned" else ""
    val query = "?limit=$limit&offset=$offset$filters$roots$status&sortBy=updatedAt&sortOrder=desc&search=${encode(search.trim())}"
    val remote = parseList(gateway.request("/api/sessions$query"))
    val items = if (scope is ConversationHistoryScope.Expert) remote.items.filterNot { it.agentSetup } else remote.items
    return remote.copy(items = (if (offset == 0 && scope == null) localDrafts(search) else emptyList()) + items)
  }

  internal suspend fun recent(startOffset: Int = 0): RecentConversationPage {
    val recent = mutableListOf<ConversationSummary>()
    val seen = mutableSetOf<String>()
    var offset = startOffset
    var hasMore: Boolean
    do {
      val page = runInterruptible(Dispatchers.IO) { list(offset = offset, scope = ConversationHistoryScope.Recent) }
      recent += page.items.filter { it.isRecentSidebarCandidate && seen.add(it.id) }
      offset += page.remoteCount
      hasMore = page.hasMore && page.remoteCount > 0
    } while (recent.size < MIN_SIDEBAR_PAGE_ROWS && hasMore)
    val pinned = if (startOffset == 0) pinnedRecents() else emptyList()
    return RecentConversationPage((pinned + recent).distinctBy { it.id }, offset.takeIf { hasMore })
  }

  private suspend fun pinnedRecents(): List<ConversationSummary> {
    val pinned = mutableListOf<ConversationSummary>()
    var offset = 0
    do {
      val page = runInterruptible(Dispatchers.IO) {
        list(offset = offset, scope = ConversationHistoryScope.Recent, pinnedOnly = true)
      }
      pinned += page.items.filter { it.isRecentSidebarCandidate && it.status == "pinned" }
      offset += page.remoteCount
    } while (page.hasMore && page.remoteCount > 0)
    return pinned
  }

  fun sharePreview(conversationId: String): ConversationSharePreview {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    return parseSharePreview(conversationId,
      gateway.request("/api/sessions/$conversationId/share-preview"))
  }

  fun activeShare(conversationId: String): ConversationShare? {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    val envelope = JSONObject(gateway.request("/api/sessions/$conversationId/shares"))
    require(envelope.getBoolean("ok")) { "INVALID_SESSION_SHARE_LIST" }
    val items = envelope.getJSONObject("payload").getJSONArray("shares")
    return (0 until items.length()).asSequence().map(items::getJSONObject)
      .firstOrNull { !it.getBoolean("revoked") && !it.getBoolean("expired") }
      ?.let { parseShareResult(conversationId, it.optString("fileName"), it) }
  }

  fun share(preview: ConversationSharePreview, ttlMs: Long = 86_400_000,
    attachmentIds: List<String> = emptyList()): ConversationShare {
    require(preview.conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    val body = JSONObject().put("expectedTranscriptId", preview.transcriptId)
      .put("expectedCutoffSeq", preview.cutoffSeq)
      .put("expectedMetadataUpdatedAt", preview.metadataUpdatedAt)
      .put("ttlMs", ttlMs).put("maxViews", JSONObject.NULL)
      .put("includeToolActivities", false).put("attachmentIds", JSONArray(attachmentIds))
    return parseConversationShare(preview,
      gateway.request("/api/sessions/${preview.conversationId}/shares", "POST", body.toString()))
  }

  fun history(conversationId: String, before: String? = null): ConversationHistory {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    require(before == null || before.matches(Regex("[1-9][0-9]{0,15}"))) { "INVALID_HISTORY_CURSOR" }
    val path = "/api/sessions/$conversationId/history?view=compact&limit=20" +
      (before?.let { "&before=$it" } ?: "")
    return parseHistory(conversationId, gateway.request(path))
  }

  fun executionDetail(conversationId: String, turnId: String): ExecutionDetail {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    require(turnId.isNotBlank() && turnId.length <= 256) { "INVALID_TURN_ID" }
    require(draft(conversationId) == null) { "LOCAL_DRAFT" }
    return parseExecutionDetail(turnId, gateway.request("/api/sessions/$conversationId/execution-detail?turnId=${encode(turnId)}"))
  }

  fun readMessageMedia(conversationId: String, media: ConversationMedia): ByteArray {
    val validConversationId = conversationId.matches(Regex("[0-9a-fA-F-]{36}"))
    require(validConversationId || conversationId.isEmpty()) { "INVALID_CONVERSATION_ID" }
    val uri = media.uri
    if (uri.startsWith("data:")) {
      require(validConversationId) { "INVALID_CONVERSATION_ID" }
      val match = Regex("^data:([A-Za-z0-9.+/-]+);base64,([A-Za-z0-9+/=_-]+)$").matchEntire(uri)
        ?: throw IllegalArgumentException("INVALID_MEDIA")
      require(match.groupValues[1] == media.mimeType && match.groupValues[2].length <= 22_369_624) {
        "INVALID_MEDIA"
      }
      return Base64.decode(match.groupValues[2], Base64.DEFAULT).also {
        require(it.size <= 16 * 1024 * 1024) { "INVALID_MEDIA" }
      }
    }
    fun validResourceSegment(value: String): Boolean =
      value.isNotEmpty() && value.length <= 256 && value != "." && value != ".." &&
        value.none { it.code < 0x20 || it.code == 0x7f || it == '\\' }
    val path = when {
      uri.isBlank() && !media.workspaceRelativePath.isNullOrBlank() -> {
        require(validConversationId) { "INVALID_CONVERSATION_ID" }
        val relative = requireNotNull(media.workspaceRelativePath)
        val parts = relative.split('/')
        require(!relative.startsWith('/') && !relative.endsWith('/') &&
          relative.none { it.code < 0x20 || it.code == 0x7f || it == '\\' } &&
          parts.isNotEmpty() && parts.all { it.isNotBlank() && it != "." && it != ".." }) { "INVALID_MEDIA" }
        val space = JSONObject(gateway.request("/api/files/contexts/session/$conversationId")).getJSONObject("space").getString("id")
        val body = JSONObject().put("spaceId", space).put("path", relative).toString()
        val resource = JSONObject(gateway.request("/api/files/resolve", "POST", body)).getJSONObject("resource").getString("id").trim()
        require(validResourceSegment(resource)) { "INVALID_MEDIA" }
        "/api/files/${encode(resource)}/content"
      }
      uri.startsWith("xopc-file:") -> {
        val raw = uri.removePrefix("xopc-file:")
        require(!raw.contains('?') && !raw.contains('#')) { "INVALID_MEDIA" }
        val id = Uri.decode(raw).trim()
        require(validResourceSegment(id)) { "INVALID_MEDIA" }
        "/api/files/${encode(id)}/content"
      }
      uri.startsWith("xopc-attachment://notes/") -> {
        val match = Regex("^xopc-attachment://notes/([^/?#]+)/([^/?#]+)$", RegexOption.IGNORE_CASE)
          .matchEntire(uri) ?: throw IllegalArgumentException("INVALID_MEDIA")
        val noteId = Uri.decode(match.groupValues[1]).trim()
        val attachmentId = Uri.decode(match.groupValues[2]).trim()
        require(validResourceSegment(noteId) && !noteId.contains('/') &&
          validResourceSegment(attachmentId) && !attachmentId.contains('/')) { "INVALID_MEDIA" }
        "/api/notes/${encode(noteId)}/media/${encode(attachmentId)}"
      }
      uri.startsWith("media://") -> {
        require(validConversationId) { "INVALID_CONVERSATION_ID" }
        "/api/media/read?uri=${encode(uri)}&conversationId=${encode(conversationId)}"
      }
      else -> throw IllegalArgumentException("INVALID_MEDIA")
    }
    return gateway.requestBytes(path)
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
    draft(conversationId)?.let { local ->
      val project = local.projectId?.let { id ->
        val response = JSONObject(gateway.request("/api/projects/${encode(id)}"))
        val item = response.getJSONObject("project")
        require(item.getString("id") == id) { "INVALID_PROJECT" }
        ContextWorkItem(id, item.getString("name")) to item.optString("workspaceRoot")
      }
      val environment = local.executionMode?.let { mode ->
        ContextEnvironment(mode, project?.second.orEmpty(), !project?.second.isNullOrBlank(), null)
      }
      return ConversationContext(conversationId, project?.first, null, environment,
        emptyList(), false, emptyList(), true)
    }
    val summary = gateway.request("/api/sessions/$conversationId/context-summary")
    val config = gateway.request("/api/sessions/$conversationId/agent-config")
    return parseContext(conversationId, summary, config)
  }

  fun contextEnvironmentOptions(projectId: String): ContextEnvironmentOptions {
    require(projectId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_PROJECT_ID" }
    val root = JSONObject(gateway.request("/api/projects/${encode(projectId)}/environment-options"))
    require(root.optBoolean("ok")) { "INVALID_ENVIRONMENT_OPTIONS" }
    val options = root.getJSONObject("options")
    return ContextEnvironmentOptions(options.optBoolean("localAvailable"),
      options.optString("worktreeUnavailableReason").takeIf(String::isNotBlank))
  }

  fun contextDirectories(path: String): ContextDirectoryPage {
    require(path.length <= 4096) { "INVALID_DIRECTORY" }
    val root = JSONObject(gateway.request("/api/host/fs/list" +
      if (path.isBlank()) "" else "?path=${encode(path)}"))
    require(root.optBoolean("ok")) { "INVALID_DIRECTORIES" }
    val payload = root.getJSONObject("payload")
    val rows = payload.getJSONArray("entries")
    require(rows.length() <= 2000) { "INVALID_DIRECTORIES" }
    return ContextDirectoryPage(payload.optString("currentPath"),
      payload.optString("parentPath").takeIf(String::isNotBlank),
      (0 until rows.length()).map { index ->
        val item = rows.getJSONObject(index)
        ContextDirectory(item.getString("name"), item.getString("absolutePath"), item.optBoolean("isDirectory"))
      })
  }

  fun setContextDirectory(conversationId: String, path: String) {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}")) && path.isNotBlank() && path.length <= 4096) {
      "INVALID_DIRECTORY"
    }
    require(draft(conversationId) == null) { "LOCAL_DRAFT" }
    val response = JSONObject(gateway.request("/api/sessions/$conversationId/agent-config", "PATCH",
      JSONObject().put("workingDirectory", path).toString()))
    require(response.optBoolean("ok")) { "DIRECTORY_UPDATE_FAILED" }
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
    if (local != null) return models.copy(selectedId = local.model.ifBlank { models.selectedId },
      thinkingLevel = local.thinkingLevel)
    val raw = gateway.request("/api/sessions/$conversationId/agent-config")
    val config = parseModelConfig(raw)
    return models.copy(selectedId = config.first, configVersion = config.second,
      thinkingLevel = JSONObject(raw).getJSONObject("payload").optString("thinkingLevel", "off"))
  }

  fun agentAvatar(agent: ConversationAgent): ByteArray? {
    if (agent.avatar.startsWith("xopc:loopi:")) return null
    val bytes = if (agent.avatar.startsWith("https://")) {
      val connection = java.net.URI(agent.avatar).toURL().openConnection() as java.net.HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 8_000
      connection.readTimeout = 12_000
      try {
        if (connection.responseCode != 200) return null
        connection.inputStream.use { input ->
          val output = java.io.ByteArrayOutputStream()
          val chunk = ByteArray(8192)
          while (true) {
            val count = input.read(chunk)
            if (count < 0) break
            require(output.size() + count <= 512 * 1024) { "AVATAR_TOO_LARGE" }
            output.write(chunk, 0, count)
          }
          output.toByteArray()
        }
      } finally { connection.disconnect() }
    } else {
      val id = java.net.URLEncoder.encode(agent.id, "UTF-8")
      gateway.requestBytes("/api/agents/$id/avatar?resolve=1")
    }
    require(bytes.size in 1..512 * 1024) { "INVALID_AVATAR" }
    return bytes
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
      return ModelSelection(emptyList(), model.id, null, model.initialThinkingLevel)
    }
    val body = JSONObject().put("model", model.id)
    if (configVersion != null) body.put("configVersion", configVersion)
    val response = JSONObject(gateway.request("/api/sessions/$conversationId/agent-config", "PATCH", body.toString()))
    require(response.optBoolean("ok")) { "MODEL_UPDATE_FAILED" }
    val payload = response.getJSONObject("payload")
    return ModelSelection(emptyList(), payload.getString("model"), payload.getLong("configVersion"),
      payload.optString("thinkingLevel", model.initialThinkingLevel))
  }

  @Synchronized
  fun setThinking(conversationId: String, level: String, configVersion: Long?): ModelSelection {
    require(level in setOf("off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")) {
      "INVALID_THINKING_LEVEL"
    }
    require(pendingInput(conversationId) == null) { "INPUT_PENDING" }
    val local = draft(conversationId)
    if (local != null) {
      val profile = gateway.currentProfile() ?: throw IllegalStateException("NOT_PAIRED")
      pendingStore?.write(draftKey(profile.gatewayId, conversationId),
        draftJson(local.copy(thinkingLevel = level)).toString())
      return ModelSelection(emptyList(), local.model, null, level)
    }
    val body = JSONObject().put("thinkingLevel", level)
    if (configVersion != null) body.put("configVersion", configVersion)
    val response = JSONObject(gateway.request("/api/sessions/$conversationId/agent-config", "PATCH", body.toString()))
    require(response.optBoolean("ok")) { "THINKING_UPDATE_FAILED" }
    val payload = response.getJSONObject("payload")
    return ModelSelection(emptyList(), payload.getString("model"), payload.getLong("configVersion"),
      payload.getString("thinkingLevel"))
  }

  fun nextTurnSuggestion(conversationId: String, locale: String): Pair<String, NextTurnSuggestion?> {
    val response = JSONObject(gateway.request("/api/sessions/${encode(conversationId)}/next-turn-suggestion?locale=$locale"))
    val status = response.getString("status")
    val item = response.optJSONObject("suggestion")
    return status to item?.let {
      NextTurnSuggestion(it.getString("id"), it.getString("conversationId"), it.getString("transcriptId"),
        it.getString("agentId"), it.getString("locale"), it.getString("prompt"), it.getLong("expiresAt"))
    }
  }

  fun nextTurnSuggestionFeedback(suggestion: NextTurnSuggestion, impressionId: String,
    event: String, edited: Boolean?) {
    val body = JSONObject().put("suggestionId", suggestion.id).put("impressionId", impressionId).put("event", event)
    if (edited != null) body.put("edited", edited)
    gateway.request("/api/sessions/${encode(suggestion.conversationId)}/next-turn-suggestion-feedback", "POST", body.toString())
  }

  fun abortRun(runId: String) {
    require(runId.isNotBlank()) { "INVALID_RUN_ID" }
    val response = JSONObject(gateway.request("/api/agent/abort", "POST", JSONObject().put("runId", runId).toString()))
    require(response.optBoolean("ok") && response.has("payload")) { "RUN_ABORT_FAILED" }
  }

  /** Replays the same command identity after an uncertain transport result. */
  fun send(conversationId: String, content: String, claim: TurnClaim,
    refs: List<ConversationContextRef> = emptyList(),
    attachments: List<ChatAttachment> = emptyList(), clientMessageId: String = UUID.randomUUID().toString()): String {
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
    val command = saved ?: (draft(conversationId)?.let { existing ->
      val local = if (existing.projectId != null && existing.executionMode == null) {
        existing.copy(executionMode = defaultProjectExecutionMode(existing.projectId)).also {
          pendingStore?.write(draftKey(profile.gatewayId, conversationId), draftJson(it).toString())
        }
      } else existing
      require(local.model.isNotBlank()) { "MODEL_UNAVAILABLE" }
      JSONObject().put("kind", "start").put("clientMessageId", clientMessageId)
        .put("localAttachments", localAttachments)
        .put("creation", creationJson(local))
        .put("input", JSONObject().put("content", content)
          .apply { if (refs.isNotEmpty()) put("contextRefs", contextRefs) })
    } ?: run {
      val transcriptId = history(conversationId).transcriptId ?: throw IllegalStateException("SESSION_IDENTITY_UNAVAILABLE")
      val configVersion = parseConfigVersion(gateway.request("/api/sessions/$conversationId/agent-config"))
      JSONObject().put("kind", "append").put("clientMessageId", clientMessageId)
        .put("localAttachments", localAttachments)
        .put("expectedTranscriptId", transcriptId).put("configVersion", configVersion)
        .put("delivery", "steer").put("interrupt", false).put("input", JSONObject().put("content", content)
          .apply { if (refs.isNotEmpty()) put("contextRefs", contextRefs) })
    }).also {
      if (claim.supportsClarificationV2) it.getJSONObject("input").put("interactionCapabilities", JSONObject().put("clarificationVersions", JSONArray(listOf(1, 2))))
      if (claim.supportsDeviceContext) it.getJSONObject("input").put("endpointContext", JSONObject()
        .put("version", 1).put("capturedAt", System.currentTimeMillis())
        .put("locale", java.util.Locale.getDefault().toLanguageTag()).put("timezone", java.util.TimeZone.getDefault().id))
      pendingStore?.write(key, it.toString())
    }
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
    attachments: List<ChatAttachment> = emptyList(), clientMessageId: String = UUID.randomUUID().toString()): String {
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
        .put("clientMessageId", clientMessageId)
        .put("expectedTranscriptId", transcriptId).put("configVersion", configVersion)
        .put("delivery", "steer").put("input", JSONObject().put("content", content)
          .apply { if (refs.isNotEmpty()) put("contextRefs", contextRefs) })
        .also { pendingStore?.write(key, it.toString()) }
    }
    val body = JSONObject().put("clientMessageId", command.getString("clientMessageId"))
      .put("expectedTranscriptId", command.getString("expectedTranscriptId"))
      .put("configVersion", command.getLong("configVersion"))
      .put("delivery", command.getString("delivery")).put("content", content).put("origin", claim.json())
      .apply { if (command.getString("delivery") == "steer") put("interrupt", false) }
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
        ConversationAgent(id, item.optString("name").ifBlank { id }, item.optString("description"), item.optString("avatar"),
          item.optJSONObject("override")?.optString("purpose"))
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
        val thinking = item.optJSONObject("thinking")
        val options = thinking?.optJSONArray("options")
        ConversationModel(id, item.optString("name").ifBlank { id },
          thinking?.optString("initialValue")?.takeIf(String::isNotBlank) ?: "off",
          thinking?.optString("mode") ?: "none",
          (0 until (options?.length() ?: 0)).map { options!!.getString(it) }, item.modelDisplayNames())
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
          item.optString("agentId").takeIf(String::isNotBlank), status = status,
          agentSetup = item.optJSONObject("customData")?.optBoolean("agentSetup") == true)
      }
      val groups = root.optJSONObject("childrenByConversationId")
      require(!root.has("childrenByConversationId") || groups != null) { "INVALID_SESSION_LIST" }
      val ids = parsed.mapTo(mutableSetOf()) { it.id }
      val taskGroups = mutableMapOf<String, ConversationTaskGroup>()
      if (groups != null) for (id in groups.keys()) {
        if (id !in ids) continue
        val group = groups.getJSONObject(id)
        val rows = group.getJSONArray("items")
        val total = group.getInt("total")
        val activeCount = group.getInt("activeCount")
        require(total >= 0 && activeCount in 0..total && rows.length() <= 500 && rows.length() <= total) {
          "INVALID_SESSION_LIST"
        }
        val children = (0 until rows.length()).map { index ->
          val row = rows.getJSONObject(index)
          val taskId = row.getString("taskId")
          val title = row.getString("title")
          require(taskId.isNotBlank() && title.isNotBlank()) { "INVALID_SESSION_LIST" }
          ConversationTaskChild(taskId, title, row.getString("phase"),
            row.optString("runStatus").takeIf(String::isNotBlank),
            row.optString("activeConversationId").takeIf(String::isNotBlank))
        }
        taskGroups[id] = ConversationTaskGroup(total, activeCount, children)
      }
      return ConversationPage(parsed, parsed.size, root.getBoolean("hasMore") && parsed.isNotEmpty(), taskGroups)
    }

    fun parseSharePreview(conversationId: String, raw: String): ConversationSharePreview {
      val envelope = JSONObject(raw)
      require(envelope.optBoolean("ok")) { "INVALID_SESSION_SHARE_PREVIEW" }
      val payload = envelope.getJSONObject("payload")
      val transcriptId = payload.getString("transcriptId")
      val cutoffSeq = payload.getLong("cutoffSeq")
      val updatedAt = payload.getString("metadataUpdatedAt")
      val title = payload.optString("title").ifBlank { "Conversation" }
      val messageCount = payload.getInt("messageCount")
      val attachments = payload.getJSONArray("attachmentCandidates")
      require(transcriptId.isNotBlank() && transcriptId.length <= 256 && cutoffSeq >= 0 &&
        updatedAt.isNotBlank() && updatedAt.length <= 100 && title.length <= 1000 &&
        messageCount >= 0 && attachments.length() <= 1000) { "INVALID_SESSION_SHARE_PREVIEW" }
      val messages = payload.optJSONArray("messages") ?: JSONArray()
      return ConversationSharePreview(conversationId, transcriptId, cutoffSeq, updatedAt,
        title, messageCount, attachments.length(),
        List(messages.length()) { index -> messages.getJSONObject(index).let {
          ConversationShareMessage(it.getString("id"), it.getString("role"), it.getString("markdown"))
        } }, List(attachments.length()) { index -> attachments.getJSONObject(index).let {
          ConversationShareAttachment(it.getString("id"), it.getString("fileName"))
        } })
    }

    fun parseConversationShare(preview: ConversationSharePreview, raw: String): ConversationShare {
      val envelope = JSONObject(raw)
      require(envelope.optBoolean("ok")) { "INVALID_SESSION_SHARE" }
      return parseShareResult(preview.conversationId, preview.title, envelope.getJSONObject("payload"))
    }

    private fun parseShareResult(conversationId: String, title: String, payload: JSONObject): ConversationShare {
      val id = payload.getString("id")
      val url = payload.getString("shareUrl")
      val reachability = payload.getString("reachability")
      val expiresAt = payload.getString("expiresAt")
      val uri = java.net.URI(url)
      require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")) && payload.getString("kind") == "session" &&
        uri.scheme in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null &&
        url.length <= 4096 && reachability in setOf("public", "lan", "local-only") &&
        expiresAt.length in 1..100) { "INVALID_SESSION_SHARE" }
      return ConversationShare(conversationId, id,
        payload.optString("title").ifBlank { title }.take(1000), url,
        reachability, payload.optString("reachabilityHint").take(500), expiresAt,
        payload.optInt("messageCount"), payload.optInt("attachmentCount"))
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
        sources, summary.getBoolean("sourcesHasMore"), unavailable, config.optBoolean("workingDirectoryLocked"),
        config.optString("effectiveWorkspacePath"))
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
      val root = JSONObject(raw)
      val session = root.getJSONObject("session")
      require(session.getString("key") == conversationId) { "INVALID_SESSION_HISTORY" }
      val messages = session.getJSONArray("messages")
      require(messages.length() <= 100) { "INVALID_SESSION_HISTORY" }
      val pagination = root.optJSONObject("pagination")
      val hasMore = pagination?.optBoolean("hasMore") == true
      val cursor = pagination?.optString("nextBeforeCursor")?.takeIf(String::isNotBlank)
      require(!hasMore || cursor?.matches(Regex("[1-9][0-9]{0,15}")) == true) {
        "INVALID_SESSION_HISTORY_CURSOR"
      }
      return ConversationHistory(conversationId, session.optString("transcriptId").takeIf(String::isNotBlank),
        parseMessages(messages), session.optString("agentId").takeIf(String::isNotBlank),
        if (hasMore) cursor else null, pagination?.optLong("revision", -1)?.takeIf { it >= 0 })
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

    private fun parseMessages(messages: JSONArray): List<ConversationMessage> {
      val parsed = (0 until messages.length()).mapNotNull { index ->
        val item = messages.getJSONObject(index)
        if (item.optBoolean("display", true) == false || item.optJSONObject("metadata")?.optBoolean("hiddenFromClient") == true) return@mapNotNull null
        val role = item.optString("role")
        if (role !in setOf("user", "assistant")) return@mapNotNull null
        val content = item.opt("content")
        val raw = item.optJSONArray("rawContent")
        val textContent = raw ?: (content as? JSONArray)
        val hasToolCall = (item.optJSONArray("toolCalls")?.length() ?: 0) > 0 || (0 until (textContent?.length() ?: 0)).any { part ->
          textContent?.optJSONObject(part)?.optString("type") in setOf("toolCall", "tool_use", "tool_call")
        }
        val narration = role == "assistant" && (0 until (textContent?.length() ?: 0)).any { part ->
          textContent?.optJSONObject(part)?.optString("presentation") == "narration"
        }
        val text = when {
          role == "assistant" && textContent != null -> (0 until textContent.length()).mapNotNull { part ->
            textContent.optJSONObject(part)?.takeIf { block ->
              block.optString("type") == "text" && (block.optString("presentation") == "answer" ||
                (block.isNull("presentation") && !hasToolCall))
            }?.optString("text")
          }.joinToString("\n")
          role == "assistant" && hasToolCall -> ""
          content is String -> content
          content is JSONArray -> (0 until content.length()).mapNotNull { part ->
            content.optJSONObject(part)?.takeIf { it.optString("type") == "text" }?.optString("text")
          }.joinToString("\n")
          else -> ""
        }
        val media = parseMessageMedia(item.optJSONArray("media"))
        val metadata = item.optJSONObject("metadata")
        val references = parseMessageReferences(metadata?.optJSONArray("sourceContexts"))
        val outcome = parseMessageOutcome(metadata?.optJSONObject("turnOutcome"))
        val deliveries = item.optJSONArray("deliveries")
        val targets = parseMessageTargets(deliveries)
        val comparisons = parseProjectComparisons(deliveries)
        val ids = item.optJSONArray("generatedMediaIds")
        val generatedMediaIds = (0 until (ids?.length() ?: 0)).mapNotNull { part -> ids?.optString(part)?.takeIf(String::isNotBlank) }
        val hasNonTextContent = narration || hasToolCall || generatedMediaIds.isNotEmpty() || (item.optJSONArray("media")?.length() ?: 0) > 0 ||
          (metadata?.optJSONArray("sourceContexts")?.length() ?: 0) > 0 ||
          outcome != null || targets.isNotEmpty() || comparisons.isNotEmpty() ||
          (raw != null && (0 until raw.length()).any { part ->
            raw.optJSONObject(part)?.optString("type")?.let { it != "text" } == true
          })
        val messageId = item.optString("id").ifBlank { item.optString("messageId").ifBlank { "$index" } }
        val narrations = if (role != "assistant") emptyList() else (0 until (textContent?.length() ?: 0)).mapNotNull { part ->
          textContent?.optJSONObject(part)?.takeIf {
            it.optString("type") == "text" && it.optString("presentation") == "narration"
          }?.let { block -> ConversationNarration(block.optString("segmentId").ifBlank { messageId },
            block.optString("text").replace(Regex("\\s+"), " ").trim().take(160)) }?.takeIf { it.text.isNotBlank() }
        }
        if (text.isBlank() && !hasNonTextContent) null else
          ConversationMessage(messageId, role, text,
            item.optString("turnId").takeIf(String::isNotBlank), hasNonTextContent, media, references, targets, outcome,
            renderId = metadata?.optString("clientMessageId")?.takeIf { role == "user" && it.isNotBlank() } ?: messageId,
            narrations = narrations, generatedMediaIds = generatedMediaIds,
            projectComparisons = comparisons,
            agentReaction = item.optJSONObject("agentReaction")?.takeIf { role == "user" &&
              it.optString("entryId") == item.optString("transcriptEntryId") }?.let {
              val emoji = it.optString("emoji")
              if (emoji.isBlank()) null else AgentMessageReaction(emoji, it.optString("actorName"))
            })
      }
      val grouped = mutableListOf<ConversationMessage>()
      parsed.forEach { message ->
        val previous = grouped.lastOrNull()
        if (message.role != "assistant" || previous?.role != "assistant" ||
          (message.turnId != null && previous.turnId != null && message.turnId != previous.turnId)) {
          grouped += message
        } else {
          grouped[grouped.lastIndex] = previous.copy(
            id = message.id,
            sourceIds = previous.sourceIds + message.sourceIds,
            renderId = message.id,
            text = listOf(previous.text, message.text).filter(String::isNotBlank).joinToString("\n"),
            turnId = message.turnId ?: previous.turnId,
            hasNonTextContent = previous.hasNonTextContent || message.hasNonTextContent,
            media = (previous.media + message.media).distinctBy { it.id to it.uri },
            references = (previous.references + message.references).distinctBy { it.kind to it.sourceId },
            targets = (previous.targets + message.targets).distinctBy { it.kind to it.id },
            projectComparisons = (previous.projectComparisons + message.projectComparisons).distinctBy { it.surfaceId },
            outcome = message.outcome ?: previous.outcome,
            narrations = (previous.narrations + message.narrations).distinctBy { it.id },
            generatedMediaIds = (previous.generatedMediaIds + message.generatedMediaIds).distinct(),
          )
        }
      }
      return grouped
    }

    private fun parseMessageMedia(rows: JSONArray?): List<ConversationMedia> {
      if (rows == null) return emptyList()
      return (0 until minOf(rows.length(), 20)).mapNotNull { index ->
        val row = rows.optJSONObject(index) ?: return@mapNotNull null
        val name = row.optString("name").take(240)
        val uri = row.optString("uri").take(16_384)
        if (name.isBlank() || uri.isBlank()) return@mapNotNull null
        ConversationMedia(row.optString("id").ifBlank { "media-$index" }.take(256), name,
          row.optString("type", "file").take(40), row.optString("mimeType").take(160),
          row.optLong("size").coerceAtLeast(0), uri,
          row.optString("workspaceRelativePath").takeIf(String::isNotBlank)?.take(2_048),
          row.optDouble("duration", row.optDouble("durationSeconds", Double.NaN))
            .takeIf { it.isFinite() && it > 0 },
          row.optString("fileId").takeIf(String::isNotBlank)?.take(512))
      }
    }

    private fun parseMessageReferences(rows: JSONArray?): List<ConversationReference> {
      if (rows == null) return emptyList()
      val allowed = setOf("note", "task", "file", "session", "browser_tab", "browser_page",
        "mcp_resource", "user_assertion")
      return (0 until minOf(rows.length(), 20)).mapNotNull { index ->
        val row = rows.optJSONObject(index) ?: return@mapNotNull null
        val kind = row.optString("kind")
        val id = row.optString("sourceId").take(512)
        if (kind !in allowed || id.isBlank()) return@mapNotNull null
        ConversationReference(kind, id, row.optString("version").take(256),
          row.optString("title").ifBlank { id }.take(240),
          row.optString("url").takeIf { it.startsWith("https://") }?.take(4_096))
      }.distinctBy { "${it.kind}:${it.sourceId}" }
    }

    private fun parseProjectComparisons(deliveries: JSONArray?): List<ChatProjectComparison> =
      (0 until minOf(deliveries?.length() ?: 0, 20)).mapNotNull { index ->
        val panel = deliveries?.optJSONObject(index)?.optJSONObject("projectComparison") ?: return@mapNotNull null
        val surfaceId = panel.optString("surfaceId").takeIf { it.matches(Regex("comparison_[a-f0-9-]{36}")) } ?: return@mapNotNull null
        val payloads = panel.optJSONArray("messages")?.takeIf { it.length() == 3 } ?: return@mapNotNull null
        val messages = (0 until payloads.length()).mapNotNull { payloads.optJSONObject(it)?.toString() }
        ChatProjectComparison(surfaceId, messages).takeIf { messages.size == 3 }
      }.distinctBy { it.surfaceId }

    private fun parseMessageTargets(deliveries: JSONArray?): List<ConversationTarget> {
      if (deliveries == null) return emptyList()
      val out = mutableListOf<ConversationTarget>()
      fun add(row: JSONObject?) {
        row ?: return
        val kind = row.optString("kind").take(80)
        val id = row.optString("id").take(1_024)
        val title = row.optString("title").take(240)
        if (kind.isBlank() || id.isBlank() || title.isBlank()) return
        val capabilities = row.optJSONArray("capabilities")?.let { values ->
          (0 until minOf(values.length(), 20)).mapNotNull { values.optString(it).takeIf(String::isNotBlank)?.take(80) }
        } ?: emptyList()
        out += ConversationTarget(kind, id, title,
          row.optString("summary").takeIf(String::isNotBlank)?.take(500),
          row.optString("status").takeIf(String::isNotBlank)?.take(120), capabilities)
      }
      for (index in 0 until minOf(deliveries.length(), 20)) {
        val delivery = deliveries.optJSONObject(index) ?: continue
        add(delivery.optJSONObject("primary"))
        delivery.optJSONArray("related")?.let { related ->
          for (relatedIndex in 0 until minOf(related.length(), 50)) add(related.optJSONObject(relatedIndex))
        }
        delivery.optJSONObject("presentation")?.takeIf { it.optString("kind") == "table" }
          ?.optJSONArray("items")?.let { items ->
            for (itemIndex in 0 until minOf(items.length(), 50)) add(items.optJSONObject(itemIndex))
          }
      }
      return out.distinctBy { "${it.kind}:${it.id}" }.take(50)
    }

    private fun parseMessageOutcome(row: JSONObject?): ConversationOutcome? {
      if (row == null) return null
      val status = row.optString("status")
      if (status !in setOf("succeeded", "partial", "failed")) return null
      val artifacts = row.optJSONArray("deliverables")?.let { values ->
        (0 until minOf(values.length(), 50)).mapNotNull { index ->
          val item = values.optJSONObject(index) ?: return@mapNotNull null
          val id = item.optString("artifactId").take(1_024)
          val title = item.optString("title").take(240)
          val availability = item.optString("availability")
          if (id.isBlank() || title.isBlank() || availability !in
            setOf("materializing", "available", "expired", "missing", "failed")) return@mapNotNull null
          val capabilities = item.optJSONArray("capabilities")?.let { caps ->
            (0 until minOf(caps.length(), 20)).mapNotNull { caps.optString(it).takeIf(String::isNotBlank)?.take(80) }
          } ?: emptyList()
          ConversationArtifact(id, title, item.optString("kind", "file").take(80),
            item.optString("mimeType").takeIf(String::isNotBlank)?.take(160),
            item.optLong("sizeBytes").takeIf { item.has("sizeBytes") && it >= 0 }, availability,
            item.optString("location").take(80), capabilities,
            item.optString("uri").takeIf(String::isNotBlank)?.take(16_384),
            item.optString("workspaceRelativePath").takeIf(String::isNotBlank)?.take(2_048),
            item.optString("shareUrl").takeIf { it.startsWith("https://") }?.take(4_096))
        }
      } ?: emptyList()
      return ConversationOutcome(status, row.optString("summary").takeIf(String::isNotBlank)?.take(1_000), artifacts)
    }

    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
  }
}
