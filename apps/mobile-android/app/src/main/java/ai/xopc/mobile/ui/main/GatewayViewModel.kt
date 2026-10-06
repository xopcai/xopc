package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.GatewayProbe
import ai.xopc.mobile.gateway.GatewaySession
import ai.xopc.mobile.gateway.GatewayHttpException
import ai.xopc.mobile.gateway.VoiceCallConnection
import ai.xopc.mobile.gateway.ConversationRepository
import ai.xopc.mobile.gateway.ConversationSummary
import ai.xopc.mobile.gateway.ConversationTaskGroup
import ai.xopc.mobile.gateway.ConversationSharePreview
import ai.xopc.mobile.gateway.ConversationShare
import ai.xopc.mobile.gateway.ConversationContextRef
import ai.xopc.mobile.gateway.ChatAttachment
import ai.xopc.mobile.gateway.CameraCaptureStore
import ai.xopc.mobile.gateway.LocalConversationDraft
import ai.xopc.mobile.gateway.ConversationMessage
import ai.xopc.mobile.gateway.ConversationMedia
import ai.xopc.mobile.gateway.ExecutionDetail
import ai.xopc.mobile.gateway.PendingInput
import ai.xopc.mobile.gateway.ConversationModel
import ai.xopc.mobile.gateway.ConversationAgent
import ai.xopc.mobile.gateway.ConversationContext
import ai.xopc.mobile.gateway.ContextEnvironmentOptions
import ai.xopc.mobile.gateway.ContextDirectoryPage
import ai.xopc.mobile.gateway.ConnectionWaitRepository
import ai.xopc.mobile.gateway.ConnectionWaitSnapshot
import ai.xopc.mobile.gateway.TaskWelcomeInfo
import ai.xopc.mobile.gateway.ProjectWelcomeInfo
import ai.xopc.mobile.gateway.ProgressRepository
import ai.xopc.mobile.gateway.ProgressItem
import ai.xopc.mobile.gateway.ProgressHomeAction
import ai.xopc.mobile.gateway.ProgressTask
import ai.xopc.mobile.gateway.ProgressProject
import ai.xopc.mobile.gateway.ProgressProjectSession
import ai.xopc.mobile.gateway.AutomationRepository
import ai.xopc.mobile.gateway.AutomationMetrics
import ai.xopc.mobile.gateway.AutomationSummary
import ai.xopc.mobile.gateway.AutomationRunSummary
import ai.xopc.mobile.gateway.AutomationRunEvent
import ai.xopc.mobile.gateway.NoteRepository
import ai.xopc.mobile.gateway.FileRepository
import ai.xopc.mobile.gateway.ManagedFile
import ai.xopc.mobile.gateway.ManagedFileSpace
import ai.xopc.mobile.gateway.NoteSummary
import ai.xopc.mobile.gateway.NoteDetail
import ai.xopc.mobile.gateway.NoteSyncResult
import ai.xopc.mobile.gateway.NoteMetadataPatch
import ai.xopc.mobile.gateway.NoteHistoryEntry
import ai.xopc.mobile.gateway.NoteSnapshot
import ai.xopc.mobile.gateway.NoteShare
import ai.xopc.mobile.gateway.NoteAiPreview
import ai.xopc.mobile.gateway.NoteDraft
import ai.xopc.mobile.gateway.NoteDraftStore
import ai.xopc.mobile.gateway.ShareRepository
import ai.xopc.mobile.gateway.ShareItem
import ai.xopc.mobile.gateway.PersonalRepository
import ai.xopc.mobile.gateway.PersonalSummary
import ai.xopc.mobile.gateway.PersonalAssertion
import ai.xopc.mobile.gateway.PersonalProfile
import ai.xopc.mobile.gateway.RealtimeClient
import ai.xopc.mobile.gateway.RunStreamEvent
import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import java.util.Locale
import java.util.UUID

data class ProgressUiState(
  val gatewayId: String? = null,
  val needsUser: List<ProgressItem> = emptyList(),
  val background: List<ProgressItem> = emptyList(),
  val tasks: List<ProgressTask> = emptyList(),
  val recentClosedTasks: List<ProgressTask> = emptyList(),
  val taskTotal: Int = 0,
  val loading: Boolean = false,
  val homeLoading: Boolean = false,
  val homeError: Boolean = false,
  val homeActionBusy: Boolean = false,
  val homeActionError: Boolean = false,
  val tasksError: Boolean = false,
  val loadingMore: Boolean = false,
  val moreError: Boolean = false,
  val detailTaskId: String? = null,
  val detailTask: ProgressTask? = null,
  val detailLoading: Boolean = false,
  val detailError: Boolean = false,
  val taskSearchText: String = "",
  val taskSearch: String = "",
  val commandBusy: Boolean = false,
  val commandError: Boolean = false,
  val editBusy: Boolean = false,
  val editError: Boolean = false,
  val editSavedRevision: Int = 0,
  val creatingTaskChat: Boolean = false,
  val createTaskChatError: Boolean = false,
  val projects: List<ProgressProject> = emptyList(),
  val projectsLoading: Boolean = false,
  val projectsError: Boolean = false,
  val projectId: String? = null,
  val project: ProgressProject? = null,
  val projectTasks: List<ProgressTask> = emptyList(),
  val projectSessions: List<ProgressProjectSession> = emptyList(),
  val projectSessionsLoading: Boolean = false,
  val projectSessionsError: Boolean = false,
  val projectLoading: Boolean = false,
  val projectError: Boolean = false,
  val createBusy: Boolean = false,
  val createError: Boolean = false,
  val createSavedRevision: Int = 0,
  val taskChatBusy: Boolean = false,
  val taskChatError: Boolean = false,
  val automationMetrics: AutomationMetrics? = null,
  val automations: AutomationUiState = AutomationUiState(),
)
data class AutomationUiState(
  val items: List<AutomationSummary> = emptyList(),
  val listLoading: Boolean = false,
  val listError: Boolean = false,
  val selectedId: String? = null,
  val detail: AutomationSummary? = null,
  val detailLoading: Boolean = false,
  val detailError: Boolean = false,
  val runs: List<AutomationRunSummary> = emptyList(),
  val runsError: Boolean = false,
  val selectedRunId: String? = null,
  val run: AutomationRunSummary? = null,
  val runLoading: Boolean = false,
  val runError: Boolean = false,
  val events: List<AutomationRunEvent> = emptyList(),
  val eventsError: Boolean = false,
  val actionBusy: Boolean = false,
  val actionError: Boolean = false,
  val createBusy: Boolean = false,
  val createError: Boolean = false,
  val createdId: String? = null,
  val editBusy: Boolean = false,
  val editError: Boolean = false,
  val editedRevision: Int = 0,
  val deleteBusy: Boolean = false,
  val deleteError: Boolean = false,
  val deletedId: String? = null,
  val runActionBusy: Boolean = false,
  val runActionError: Boolean = false,
  val rerunNavigationId: String? = null,
)
data class NotesUiState(
  val gatewayId: String? = null,
  val items: List<NoteSummary> = emptyList(),
  val search: String = "",
  val status: String = "",
  val total: Int = 0,
  val hasMore: Boolean = false,
  val loading: Boolean = false,
  val loadingMore: Boolean = false,
  val listError: Boolean = false,
  val moreError: Boolean = false,
  val selectedId: String? = null,
  val detail: NoteDetail? = null,
  val detailLoading: Boolean = false,
  val detailError: Boolean = false,
  val metadataBusy: Boolean = false,
  val metadataError: Boolean = false,
  val deleteBusy: Boolean = false,
  val deleteError: Boolean = false,
  val shareBusy: Boolean = false,
  val shareError: Boolean = false,
  val share: NoteShare? = null,
  val deletedNoteId: String? = null,
  val history: List<NoteHistoryEntry> = emptyList(),
  val historyLoading: Boolean = false,
  val historyError: Boolean = false,
  val snapshot: NoteSnapshot? = null,
  val snapshotLoading: Boolean = false,
  val snapshotError: Boolean = false,
  val restoreBusy: Boolean = false,
  val restoreError: Boolean = false,
  val restoredSnapshotId: String? = null,
  val draft: NoteDraft? = null,
  val drafts: List<NoteDraft> = emptyList(),
  val draftLoading: Boolean = false,
  val draftSaving: Boolean = false,
  val draftError: Boolean = false,
  val draftLimitReached: Boolean = false,
  val draftConflict: NoteDetail? = null,
  val draftSavedVersion: Long = 0,
  val draftSyncedVersion: Long = 0,
  val createdNoteId: String? = null,
)
data class PersonalUiState(val gatewayId: String? = null, val summary: PersonalSummary? = null,
  val loading: Boolean = false, val error: Boolean = false, val savingGoal: Boolean = false,
  val goalError: Boolean = false, val savedGoalRevision: Int = 0,
  val savingProfile: Boolean = false, val profileError: Boolean = false,
  val savedProfileRevision: Int = 0,
  val assertions: List<PersonalAssertion> = emptyList(), val assertionFilter: String = "all",
  val assertionQuery: String = "", val assertionCursor: String? = null,
  val assertionsLoading: Boolean = false, val assertionsMoreLoading: Boolean = false,
  val assertionsError: Boolean = false, val selectedAssertion: PersonalAssertion? = null,
  val selectedAssertionId: String? = null, val assertionDetailLoading: Boolean = false,
  val assertionDetailError: Boolean = false, val assertionSaving: Boolean = false,
  val assertionSaveError: Boolean = false, val assertionSavedRevision: Int = 0,
  val assertionDeletedRevision: Int = 0, val understandingChatError: Boolean = false)

data class ConnectionUiState(
  val profile: GatewayProfile? = null,
  val gatewayProfiles: List<GatewayProfile> = emptyList(),
  val gatewayProbes: Map<String, GatewayProbeUiState> = emptyMap(),
  val gatewayBusy: Boolean = false,
  val gatewayError: String? = null,
  val restoring: Boolean = false,
  val pairing: Boolean = false,
  val confirmationCode: String? = null,
  val error: String? = null,
  val conversations: List<ConversationSummary> = emptyList(),
  val conversationTaskGroups: Map<String, ConversationTaskGroup> = emptyMap(),
  val conversationSearch: String = "",
  val selectedConversationId: String? = null,
  val requestedReferenceKind: String? = null,
  val requestedReferenceConversationId: String? = null,
  val taskConversationTaskId: String? = null,
  val taskScopeLoading: Boolean = false,
  val messages: List<ConversationMessage> = emptyList(),
  val executionMessageId: String? = null,
  val executionDetail: ExecutionDetail? = null,
  val executionLoading: Boolean = false,
  val executionError: Boolean = false,
  val savingMessageNoteId: String? = null,
  val messageNoteFeedback: MessageNoteFeedback? = null,
  val conversationsLoading: Boolean = false,
  val conversationsLoadingMore: Boolean = false,
  val conversationsHasMore: Boolean = false,
  val conversationsMoreError: Boolean = false,
  val conversationSharePreview: ConversationSharePreview? = null,
  val conversationShareBusy: Boolean = false,
  val conversationShareError: Boolean = false,
  val conversationShareResult: ConversationShare? = null,
  val discardingDraftId: String? = null,
  val discardDraftError: Boolean = false,
  val renameDraftId: String? = null,
  val renameDraftText: String = "",
  val renamingConversation: Boolean = false,
  val renameError: Boolean = false,
  val pinningConversationId: String? = null,
  val pinActionError: Boolean = false,
  val archivingConversationId: String? = null,
  val archiveActionError: Boolean = false,
  val pendingDeleteId: String? = null,
  val deleteCommitting: Boolean = false,
  val deleteActionError: Boolean = false,
  val batchConversationBusy: Boolean = false,
  val batchConversationFailedIds: List<String> = emptyList(),
  val batchConversationRevision: Int = 0,
  val historyLoading: Boolean = false,
  val historyTranscriptId: String? = null,
  val historyBefore: String? = null,
  val historyLoadingOlder: Boolean = false,
  val historyOlderError: Boolean = false,
  val chatError: Boolean = false,
  val realtimeStatus: String = "offline",
  val sending: Boolean = false,
  val sendError: Boolean = false,
  val sendErrorDetail: String? = null,
  val sendRejected: Boolean = false,
  val pendingInput: PendingInput? = null,
  val draftText: String = "",
  val draftRefs: List<ConversationContextRef> = emptyList(),
  val draftAttachments: List<ChatAttachment> = emptyList(),
  val attachmentLoading: Boolean = false,
  val attachmentError: Boolean = false,
  val referencePicker: ReferencePickerUiState = ReferencePickerUiState(),
  val quickDraftText: String = "",
  val quickAttachments: List<ChatAttachment> = emptyList(),
  val quickAttachmentLoading: Boolean = false,
  val quickAttachmentError: Boolean = false,
  val quickSending: Boolean = false,
  val quickError: Boolean = false,
  val quickOpenedConversationId: String? = null,
  val creatingConversation: Boolean = false,
  val draftModelLoading: Boolean = false,
  val draftModelReady: Boolean = true,
  val activeRunId: String? = null,
  val stoppingRun: Boolean = false,
  val stopError: Boolean = false,
  val runError: Boolean = false,
  val liveText: String = "",
  val liveMessageId: String? = null,
  val models: List<ConversationModel> = emptyList(),
  val selectedModelId: String = "",
  val modelConfigVersion: Long? = null,
  val modelsLoading: Boolean = false,
  val modelSaving: Boolean = false,
  val modelError: Boolean = false,
  val agents: List<ConversationAgent> = emptyList(),
  val selectedAgentId: String = "",
  val defaultAgentId: String = "main",
  val agentsLoading: Boolean = false,
  val agentError: Boolean = false,
  val context: ConversationContext? = null,
  val contextLoading: Boolean = false,
  val contextError: Boolean = false,
  val contextPanel: ContextPanelUiState = ContextPanelUiState(),
  val connectionWait: ConnectionWaitUiState = ConnectionWaitUiState(),
  val taskWelcome: TaskWelcomeInfo? = null,
  val projectWelcome: ProjectWelcomeInfo? = null,
  val progress: ProgressUiState = ProgressUiState(),
  val notes: NotesUiState = NotesUiState(),
  val shares: ShareCenterUiState = ShareCenterUiState(),
  val personal: PersonalUiState = PersonalUiState(),
)

data class ConnectionWaitUiState(val gatewayId: String? = null, val conversationId: String? = null,
  val snapshot: ConnectionWaitSnapshot? = null, val loading: Boolean = false, val error: Boolean = false)

data class MessageNoteFeedback(val messageId: String, val saved: Boolean)

data class ReferencePickerItem(val kind: String, val id: String, val title: String,
  val description: String, val version: String)
data class ReferencePickerUiState(val gatewayId: String? = null, val conversationId: String? = null,
  val kind: String = "", val query: String = "", val items: List<ReferencePickerItem> = emptyList(),
  val loading: Boolean = false, val error: Boolean = false)
data class ContextPanelUiState(val gatewayId: String? = null, val conversationId: String? = null,
  val mode: String = "", val loading: Boolean = false, val error: Boolean = false,
  val projects: List<ProgressProject> = emptyList(),
  val environment: ContextEnvironmentOptions? = null,
  val directories: ContextDirectoryPage? = null,
  val files: List<ManagedFile> = emptyList(), val filePath: String = "", val fileQuery: String = "",
  val saving: Boolean = false)

data class ShareCenterUiState(val gatewayId: String? = null, val items: List<ShareItem> = emptyList(),
  val loading: Boolean = false, val busyId: String? = null, val error: Boolean = false)

data class GatewayProbeUiState(val phase: String = "checking", val result: GatewayProbe? = null,
  val error: String? = null)

private data class PendingNoteDeletion(val gatewayId: String, val id: String,
  val revision: Long, val mutationId: String)

private data class RestoredComposer(val draft: LocalConversationDraft?, val text: String,
  val refs: List<ConversationContextRef>, val attachments: List<ChatAttachment>,
  val pending: PendingInput?)

private data class RestoredGateway(val profile: GatewayProfile?, val conversationId: String?,
  val quickDraft: String, val quickAttachments: List<ChatAttachment>, val recoveredId: String?)

class GatewayViewModel(application: Application) : AndroidViewModel(application) {
  private val session = GatewaySession(application)
  private val conversations = ConversationRepository(session, application)
  private val connectionWaitRepository = ConnectionWaitRepository(session)
  private val progressRepository = ProgressRepository(session)
  private val automationRepository = AutomationRepository(session)
  private val noteRepository = NoteRepository(session)
  private val fileRepository = FileRepository(session)
  private val shareRepository = ShareRepository(session)
  private val personalRepository = PersonalRepository(session)
  private val noteDraftStore = NoteDraftStore(application)
  private val realtime = RealtimeClient(session)
  private val mutableState = MutableStateFlow(ConnectionUiState())
  val state = mutableState.asStateFlow()
  private var listRevision = 0
  private var listSearch = ""
  private var searchJob: Job? = null
  private var remoteConversationOffset = 0
  private var historyRevision = 0
  private var contextRevision = 0
  private var historyJob: Job? = null
  private var olderHistoryJob: Job? = null
  private var executionJob: Job? = null
  private var executionRevision = 0
  private var runStateJob: Job? = null
  private var modelJob: Job? = null
  private var agentJob: Job? = null
  private var contextJob: Job? = null
  private var contextPanelJob: Job? = null
  private var contextPanelRevision = 0
  private var connectionWaitJob: Job? = null
  private var connectionWaitRevision = 0
  private var referenceJob: Job? = null
  private var referenceRevision = 0
  private var progressJob: Job? = null
  private var progressHomeJob: Job? = null
  private var progressMetricsJob: Job? = null
  private var progressMoreJob: Job? = null
  private var progressDetailJob: Job? = null
  private var progressCommandJob: Job? = null
  private var progressEditJob: Job? = null
  private var projectsJob: Job? = null
  private var projectDetailJob: Job? = null
  private var automationJob: Job? = null
  private var notesJob: Job? = null
  private var sharesJob: Job? = null
  private var sharesRevision = 0
  private var personalJob: Job? = null
  private var personalRevision = 0
  private var personalListJob: Job? = null
  private var personalListRevision = 0
  private var personalDetailJob: Job? = null
  private var personalDetailRevision = 0
  private var noteDetailJob: Job? = null
  private var noteHistoryJob: Job? = null
  private var noteSnapshotJob: Job? = null
  private var noteRestoreJob: Job? = null
  private var pendingNoteDeletion: PendingNoteDeletion? = null
  private var noteDraftJob: Job? = null
  private var noteAutoSaveJob: Job? = null
  private var noteCloseAfterSave = false
  private val noteDraftLock = Mutex()
  private var notesRevision = 0
  private var noteDetailRevision = 0
  private var automationRevision = 0
  private var progressRevision = 0
  private var progressHomeRevision = 0
  private var progressDetailRevision = 0
  private var progressCommandRevision = 0
  private var projectsRevision = 0
  private var projectDetailRevision = 0
  private var createTaskSignature = ""
  private var createTaskKey = ""
  private var realtimeJob: Job? = null
  private var pairingJob: Job? = null
  private var cancelPairingJob: Job? = null
  private var gatewayProbeGeneration = 0
  private var draftWriteJob: Job? = null
  private var refWriteJob: Job? = null
  private var quickDraftWriteJob: Job? = null
  private var quickAttachmentJob: Job? = null
  private var deleteJob: Job? = null
  private val draftWriteLock = Mutex()

  fun loadPersonal() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    personalJob?.cancel()
    val revision = ++personalRevision
    mutableState.update { state ->
      val previous = state.personal.takeIf { it.gatewayId == gatewayId } ?: PersonalUiState(gatewayId)
      state.copy(personal = previous.copy(loading = true, error = false))
    }
    personalJob = viewModelScope.launch {
      try {
        val summary = runInterruptible(Dispatchers.IO) { personalRepository.summary() }
        if (revision == personalRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(personal = it.personal.copy(summary = summary, loading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == personalRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(personal = it.personal.copy(loading = false, error = true))
        }
      }
    }
  }

  fun loadPersonalAssertions(filter: String, query: String, append: Boolean = false) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val current = mutableState.value.personal
    if (append && (current.assertionCursor == null || current.assertionsMoreLoading ||
        current.assertionFilter != filter || current.assertionQuery != query)) return
    personalListJob?.cancel()
    val revision = ++personalListRevision
    val cursor = if (append) current.assertionCursor else null
    mutableState.update { state -> state.copy(personal = state.personal.copy(
      assertionFilter = filter, assertionQuery = query,
      assertions = if (append) state.personal.assertions else emptyList(),
      assertionCursor = if (append) state.personal.assertionCursor else null,
      assertionsLoading = !append, assertionsMoreLoading = append, assertionsError = false)) }
    personalListJob = viewModelScope.launch {
      try {
        val page = runInterruptible(Dispatchers.IO) { personalRepository.assertions(filter, query, cursor) }
        if (revision == personalListRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(personal = it.personal.copy(
            assertions = if (append) it.personal.assertions + page.items else page.items,
            assertionCursor = page.nextCursor, assertionsLoading = false,
            assertionsMoreLoading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == personalListRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(personal = it.personal.copy(assertionsLoading = false,
            assertionsMoreLoading = false, assertionsError = true))
        }
      }
    }
  }

  fun openPersonalAssertion(id: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    personalDetailJob?.cancel()
    val revision = ++personalDetailRevision
    mutableState.update { it.copy(personal = it.personal.copy(selectedAssertionId = id,
      selectedAssertion = null, assertionDetailLoading = true, assertionDetailError = false)) }
    personalDetailJob = viewModelScope.launch {
      try {
        val assertion = runInterruptible(Dispatchers.IO) { personalRepository.assertion(id) }
        if (revision == personalDetailRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.personal.selectedAssertionId == id) mutableState.update {
          it.copy(personal = it.personal.copy(selectedAssertion = assertion, assertionDetailLoading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == personalDetailRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.personal.selectedAssertionId == id) mutableState.update {
          it.copy(personal = it.personal.copy(assertionDetailLoading = false, assertionDetailError = true))
        }
      }
    }
  }

  fun closePersonalAssertion() {
    personalDetailJob?.cancel()
    personalDetailRevision++
    mutableState.update { it.copy(personal = it.personal.copy(selectedAssertionId = null,
      selectedAssertion = null, assertionDetailLoading = false, assertionDetailError = false)) }
  }

  fun savePersonalProfile(profile: PersonalProfile) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    if (mutableState.value.personal.savingProfile) return
    mutableState.update { it.copy(personal = it.personal.copy(savingProfile = true,
      profileError = false)) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { personalRepository.updateProfile(profile) }
        val refreshed = try {
          runInterruptible(Dispatchers.IO) { personalRepository.summary() }
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { null }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(personal = it.personal.copy(savingProfile = false,
            summary = refreshed ?: it.personal.summary, error = refreshed == null,
            savedProfileRevision = it.personal.savedProfileRevision + 1))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(personal = it.personal.copy(savingProfile = false, profileError = true))
        }
      }
    }
  }

  fun savePersonalStatement(statement: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val id = mutableState.value.personal.selectedAssertionId ?: return
    if (mutableState.value.personal.assertionSaving) return
    mutableState.update { it.copy(personal = it.personal.copy(assertionSaving = true,
      assertionSaveError = false)) }
    viewModelScope.launch {
      try {
        val updated = runInterruptible(Dispatchers.IO) { personalRepository.updateStatement(id, statement) }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.personal.selectedAssertionId == id) {
          mutableState.update { it.copy(personal = it.personal.copy(selectedAssertionId = updated.id,
            selectedAssertion = updated, assertionSaving = false,
            assertionSavedRevision = it.personal.assertionSavedRevision + 1)) }
          loadPersonal()
          val current = mutableState.value.personal
          loadPersonalAssertions(current.assertionFilter, current.assertionQuery)
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(personal = it.personal.copy(assertionSaving = false, assertionSaveError = true))
        }
      }
    }
  }

  fun deletePersonalAssertion() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val id = mutableState.value.personal.selectedAssertionId ?: return
    if (mutableState.value.personal.assertionSaving) return
    mutableState.update { it.copy(personal = it.personal.copy(assertionSaving = true,
      assertionSaveError = false)) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { personalRepository.deleteAssertion(id) }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.personal.selectedAssertionId == id) {
          mutableState.update { it.copy(personal = it.personal.copy(selectedAssertionId = null,
            selectedAssertion = null, assertionSaving = false,
            assertionDeletedRevision = it.personal.assertionDeletedRevision + 1)) }
          loadPersonal()
          val current = mutableState.value.personal
          loadPersonalAssertions(current.assertionFilter, current.assertionQuery)
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(personal = it.personal.copy(assertionSaving = false, assertionSaveError = true))
        }
      }
    }
  }

  fun savePersonalGoal(id: String?, title: String, outcome: String, status: String, targetAt: Long?) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    if (mutableState.value.personal.savingGoal) return
    mutableState.update { it.copy(personal = it.personal.copy(savingGoal = true, goalError = false)) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { personalRepository.saveGoal(id, title, outcome, status, targetAt) }
        val refreshed = try {
          runInterruptible(Dispatchers.IO) { personalRepository.summary() }
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { null }
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          mutableState.update { it.copy(personal = it.personal.copy(savingGoal = false,
            summary = refreshed ?: it.personal.summary, error = refreshed == null,
            savedGoalRevision = it.personal.savedGoalRevision + 1)) }
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(personal = it.personal.copy(savingGoal = false, goalError = true))
        }
      }
    }
  }

  suspend fun noteFileSpaces(): List<ManagedFileSpace> = withContext(Dispatchers.IO) {
    fileRepository.spaces()
  }

  suspend fun noteFiles(spaceId: String? = null, path: String = "", search: String = ""):
    List<ManagedFile> = withContext(Dispatchers.IO) { fileRepository.list(spaceId, path, search) }

  suspend fun noteFileText(id: String): String = withContext(Dispatchers.IO) {
    fileRepository.text(id)
  }

  suspend fun noteFileContent(id: String): ByteArray = withContext(Dispatchers.IO) {
    fileRepository.content(id)
  }

  fun loadNotes(search: String = mutableState.value.notes.search,
    status: String = mutableState.value.notes.status) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    restoreNoteDraft(gatewayId)
    notesJob?.cancel()
    val revision = ++notesRevision
    mutableState.update { state ->
      val previous = state.notes.takeIf { it.gatewayId == gatewayId } ?: NotesUiState(gatewayId = gatewayId)
      val sameQuery = previous.search == search.trim() && previous.status == status
      state.copy(notes = previous.copy(search = search.trim(), status = status,
        items = if (sameQuery) previous.items else emptyList(),
        total = if (sameQuery) previous.total else 0, hasMore = if (sameQuery) previous.hasMore else false,
        loading = true, listError = false, moreError = false))
    }
    notesJob = viewModelScope.launch {
      try {
        val page = runInterruptible(Dispatchers.IO) { noteRepository.list(search, status) }
        if (revision == notesRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(items = page.items, total = page.total,
            hasMore = page.hasMore, loading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == notesRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(loading = false, listError = true))
        }
      }
    }
  }

  private fun restoreNoteDraft(gatewayId: String) {
    viewModelScope.launch {
      try {
        val drafts = withContext(Dispatchers.IO) { noteDraftLock.withLock { noteDraftStore.pending(gatewayId) } }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          val active = it.notes.draft
          val merged = drafts.map { saved ->
            active?.takeIf { current -> current.id == saved.id && current.version > saved.version } ?: saved
          }
          it.copy(notes = it.notes.copy(drafts = if (active != null &&
            active.version != it.notes.draftSyncedVersion && merged.none { saved -> saved.id == active.id })
            listOf(active) + merged else merged))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draftError = true))
        }
      }
    }
  }

  fun beginNoteDraft() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    if (mutableState.value.notes.draftLoading || mutableState.value.notes.draftSaving ||
      mutableState.value.notes.metadataBusy) return
    val previous = mutableState.value.notes.draft
    val previousSynced = mutableState.value.notes.draftSyncedVersion
    noteDraftJob?.cancel()
    noteAutoSaveJob?.cancel()
    noteCloseAfterSave = false
    mutableState.update { it.copy(notes = it.notes.copy(draft = null, draftLoading = true, draftError = false,
      selectedId = null, detail = null, createdNoteId = null,
      draftSyncedVersion = 0)) }
    viewModelScope.launch {
      try {
        val draft = withContext(Dispatchers.IO) { noteDraftLock.withLock {
          if (previous != null && previous.version != previousSynced) noteDraftStore.save(gatewayId, previous)
          noteDraftStore.create(gatewayId)
        } }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draft = draft, draftLoading = false,
            draftSavedVersion = draft.version, draftSyncedVersion = 0,
            drafts = listOf(draft) + it.notes.drafts))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draft = previous, draftLoading = false, draftError = true))
        }
      }
    }
  }

  fun openNoteDraft(id: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val previous = mutableState.value.notes.draft
    val previousSynced = mutableState.value.notes.draftSyncedVersion
    noteDraftJob?.cancel()
    noteAutoSaveJob?.cancel()
    noteCloseAfterSave = false
    mutableState.update { it.copy(notes = it.notes.copy(draft = null, draftLoading = true,
      draftError = false, draftConflict = null)) }
    viewModelScope.launch {
      try {
        val draft = withContext(Dispatchers.IO) { noteDraftLock.withLock {
          if (previous != null && previous.version != previousSynced) noteDraftStore.save(gatewayId, previous)
          noteDraftStore.load(gatewayId, id)
        } }
          ?: throw IllegalStateException("NOTE_DRAFT_NOT_FOUND")
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draft = draft, draftLoading = false,
            draftSavedVersion = draft.version, draftSyncedVersion = 0))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draft = previous, draftLoading = false, draftError = true))
        }
      }
    }
  }

  fun beginEditNote() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val detail = mutableState.value.notes.detail ?: return
    val revision = detail.remoteVersion ?: return
    if (mutableState.value.notes.draftLoading || mutableState.value.notes.draftSaving ||
      mutableState.value.notes.metadataBusy) return
    val previous = mutableState.value.notes.draft
    val previousSynced = mutableState.value.notes.draftSyncedVersion
    noteDraftJob?.cancel()
    noteAutoSaveJob?.cancel()
    noteCloseAfterSave = false
    mutableState.update { it.copy(notes = it.notes.copy(draft = null, draftLoading = true,
      draftError = false, draftConflict = null)) }
    viewModelScope.launch {
      try {
        val draft = withContext(Dispatchers.IO) { noteDraftLock.withLock {
          if (previous != null && previous.version != previousSynced) noteDraftStore.save(gatewayId, previous)
          noteDraftStore.load(gatewayId, detail.id) ?: NoteDraft(detail.id, detail.title,
            detail.markdown, UUID.randomUUID().toString(), 1, revision).also {
            noteDraftStore.save(gatewayId, it)
          }
        } }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draft = draft, draftLoading = false,
            draftSavedVersion = draft.version,
            draftSyncedVersion = if (draft.title == detail.title && draft.markdown == detail.markdown &&
              draft.baseRemoteVersion == revision) draft.version else 0,
            draftConflict = detail.takeIf { remote -> draft.baseRemoteVersion != revision },
            drafts = listOf(draft) + it.notes.drafts.filterNot { saved -> saved.id == draft.id }))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draft = previous, draftLoading = false, draftError = true))
        }
      }
    }
  }

  fun changeNoteDraft(title: String, markdown: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val current = mutableState.value.notes.draft ?: return
    if (mutableState.value.notes.draftSaving && mutableState.value.notes.draftConflict != null) return
    if (title == current.title && markdown == current.markdown) return
    if (title.length > 1000 || markdown.length > 2_000_000 ||
      markdown.toByteArray(Charsets.UTF_8).size > 4_500_000) {
      mutableState.update { it.copy(notes = it.notes.copy(draftLimitReached = true)) }
      return
    }
    val next = current.copy(title = title, markdown = markdown, version = current.version + 1)
    mutableState.update { it.copy(notes = it.notes.copy(draft = next, draftError = false,
      draftLimitReached = false, draftConflict = null,
      drafts = if (it.notes.drafts.any { saved -> saved.id == next.id })
        it.notes.drafts.map { saved -> if (saved.id == next.id) next else saved }
      else listOf(next) + it.notes.drafts)) }
    noteAutoSaveJob?.cancel()
    noteDraftJob?.cancel()
    noteDraftJob = viewModelScope.launch {
      try {
        withContext(Dispatchers.IO) { noteDraftLock.withLock {
          val latest = mutableState.value.notes.draft?.takeIf { it.id == next.id } ?: return@withLock
          noteDraftStore.save(gatewayId, latest)
          if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
            val active = it.notes.draft
            if (active?.id == latest.id && active.version == latest.version)
              it.copy(notes = it.notes.copy(draftSavedVersion = latest.version)) else it
          }
        } }
        if (mutableState.value.notes.draft?.id == next.id &&
          mutableState.value.notes.draft?.version == next.version) scheduleNoteAutoSave(gatewayId, next)
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draftError = true))
        }
      }
    }
  }

  suspend fun previewNoteAi(instruction: String): NoteAiPreview {
    val notes = mutableState.value.notes
    val note = requireNotNull(notes.detail?.takeIf { it.id == notes.selectedId }) { "NOTE_UNAVAILABLE" }
    val markdown = notes.draft?.takeIf { it.id == note.id }?.markdown ?: note.markdown
    return runInterruptible(Dispatchers.IO) { noteRepository.previewAiEdit(note, instruction, markdown) }
  }

  fun applyNoteAi(preview: NoteAiPreview) {
    val notes = mutableState.value.notes
    val draft = notes.draft ?: return
    if (draft.id != notes.selectedId || draft.markdown != preview.originalMarkdown) return
    changeNoteDraft(preview.title ?: draft.title, preview.proposedMarkdown)
    if (preview.tags != null || preview.status != null) viewModelScope.launch {
      val synced = withTimeoutOrNull(30_000) { state.first { current ->
        val active = current.notes.draft
        current.profile?.gatewayId == notes.gatewayId && current.notes.selectedId == draft.id &&
          active?.id == draft.id && active.version == current.notes.draftSyncedVersion &&
          !current.notes.draftSaving && !current.notes.metadataBusy
      } }
      if (synced != null) updateNoteMetadata(NoteMetadataPatch(tags = preview.tags,
        status = preview.status))
    }
  }

  suspend fun openNoteConversation(id: String): String {
    val conversationId = runInterruptible(Dispatchers.IO) { noteRepository.openConversation(id) }
    selectConversation(conversationId)
    return conversationId
  }

  suspend fun attachNoteFile(uri: Uri) {
    require(uri.scheme == "content") { "INVALID_ATTACHMENT_URI" }
    val media = runInterruptible(Dispatchers.IO) {
      val resolver = getApplication<Application>().contentResolver
      val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { if (it.moveToFirst()) it.getString(0) else null }
        ?.substringAfterLast('/')?.substringAfterLast('\\')?.take(255)?.ifBlank { null }
        ?: "attachment"
      val mimeType = resolver.getType(uri)?.takeIf {
        it.matches(Regex("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+"))
      } ?: "application/octet-stream"
      val output = java.io.ByteArrayOutputStream()
      resolver.openInputStream(uri)?.use { input ->
        val buffer = ByteArray(8192)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          require(output.size() + count <= 8 * 1024 * 1024) { "UPLOAD_LIMIT_8_MB" }
          output.write(buffer, 0, count)
        }
      } ?: throw IllegalStateException("ATTACHMENT_UNAVAILABLE")
      Triple(name, mimeType, output.toByteArray())
    }
    attachNoteBytes(media.first, media.second, media.third)
  }

  suspend fun attachNoteVoice(bytes: ByteArray, durationSeconds: Int) {
    require(durationSeconds in 1..600 && bytes.size in 1..(8 * 1024 * 1024)) {
      "INVALID_VOICE_ATTACHMENT"
    }
    attachNoteBytes("voice.m4a", "audio/mp4", bytes, durationSeconds)
  }

  private suspend fun attachNoteBytes(name: String, mimeType: String, bytes: ByteArray,
    durationSeconds: Int? = null) {
    val initial = mutableState.value.notes
    val localDraft = initial.draft?.takeIf { it.id.startsWith("local-") }
    if (localDraft != null) {
      require(localDraft.title.isNotBlank() || localDraft.markdown.isNotBlank()) {
        "EMPTY_NOTE"
      }
      if (!initial.draftSaving) submitNoteDraft()
      withTimeoutOrNull(30_000) { state.first { current ->
        val notes = current.notes
        notes.draftError || (notes.draft?.id != localDraft.id &&
          notes.draft?.baseRemoteVersion?.let { it > 0 } == true &&
          notes.detail?.id == notes.draft.id && !notes.draftSaving)
      } } ?: throw IllegalStateException("NOTE_SAVE_PENDING")
      require(!mutableState.value.notes.draftError) { "NOTE_SAVE_FAILED" }
    }
    val notes = mutableState.value.notes
    val note = notes.detail?.takeIf { it.id == notes.selectedId }
      ?: throw IllegalStateException("NOTE_UNAVAILABLE")
    require(notes.draft?.id == note.id && note.remoteVersion != null) { "SAVE_NOTE_FIRST" }
    if (notes.draft.version != notes.draftSyncedVersion && !notes.draftSaving) submitNoteDraft()
    withTimeoutOrNull(30_000) { state.first { current ->
      val draft = current.notes.draft
      current.notes.selectedId == note.id && draft?.id == note.id &&
        draft.version == current.notes.draftSyncedVersion && !current.notes.draftSaving
    } } ?: throw IllegalStateException("NOTE_SAVE_PENDING")
    val attachment = runInterruptible(Dispatchers.IO) {
      noteRepository.addMedia(note.id, name, mimeType, bytes,
        UUID.randomUUID().toString(), durationSeconds)
    }
    val latest = mutableState.value.notes
    if (latest.selectedId != note.id || latest.draft?.id != note.id) return
    mutableState.update { current -> current.copy(notes = current.notes.copy(
      detail = current.notes.detail?.takeIf { it.id == note.id }?.let {
        it.copy(attachments = it.attachments + attachment)
      } ?: current.notes.detail)) }
    val escaped = attachment.fileName.replace("\\", "\\\\")
      .replace("[", "\\[").replace("]", "\\]")
    val target = "xopc-attachment://notes/${note.id}/${attachment.id}"
    val markdown = if (attachment.type == "image") "![$escaped]($target)"
      else "[$escaped]($target)"
    changeNoteDraft(latest.draft.title, latest.draft.markdown.trimEnd() +
      (if (latest.draft.markdown.isBlank()) "" else "\n\n") + markdown)
  }

  suspend fun noteAttachmentBytes(noteId: String, attachmentId: String): ByteArray =
    runInterruptible(Dispatchers.IO) { noteRepository.mediaBytes(noteId, attachmentId) }

  suspend fun createVoiceCall(conversationId: String, mode: String): VoiceCallConnection =
    runInterruptible(Dispatchers.IO) {
      require(mode == "natural" || mode == "assistant") { "INVALID_VOICE_MODE" }
      conversations.materializeForVoice(conversationId)
      val status = org.json.JSONObject(session.request("/api/voice/realtime/status"))
        .getJSONObject("payload")
      val availability = status.getJSONObject("capabilities").getJSONObject(mode)
      require(status.getBoolean("enabled") && availability.getBoolean("available")) {
        availability.optString("reasonCode", "VOICE_UNAVAILABLE")
      }
      val body = org.json.JSONObject().put("purpose", "conversation")
        .put("conversationId", conversationId).put("mode", mode)
        .put("supportedProtocolVersions", org.json.JSONArray().put(3))
        .put("mediaPreferences", org.json.JSONArray().put("websocket-pcm")).toString()
      session.request("/api/voice/realtime/preflight", "POST", body)
      val result = org.json.JSONObject(session.request("/api/voice/realtime/sessions", "POST", body))
        .getJSONObject("payload")
      require(result.getInt("protocolVersion") == 3 &&
        result.getJSONObject("inputFormat").getInt("sampleRate") == 16_000 &&
        result.getString("websocketPath") == "/api/voice/realtime/v3/ws") { "UNSUPPORTED_VOICE_SESSION" }
      val auth = session.voiceAuth()
      VoiceCallConnection(result.getString("sessionId"), result.getString("ticket"),
        result.getString("websocketPath"), result.getInt("connectionEpoch"), auth.origin,
        auth.bearer, result.getJSONObject("limits").getLong("maxSessionMs"),
        result.getJSONObject("route").getString("engine"))
    }

  suspend fun cancelVoiceCall(call: VoiceCallConnection) = runInterruptible(Dispatchers.IO) {
    val body = org.json.JSONObject().put("sessionId", call.sessionId).put("ticket", call.ticket)
    session.request("/api/voice/realtime/sessions/cancel", "POST", body.toString())
    Unit
  }

  suspend fun respondToVoiceClarification(requestId: String, version: Int,
    action: String, answer: String) = runInterruptible(Dispatchers.IO) {
    require(requestId.matches(Regex("[A-Za-z0-9_-]{1,128}")) && version > 0 &&
      action in setOf("answer", "agent_decide")) { "INVALID_CLARIFICATION" }
    val body = org.json.JSONObject().put("action", action).put("expectedVersion", version)
      .put("idempotencyKey", UUID.randomUUID().toString())
    if (action == "answer") body.put("answer", answer.take(10_000))
    session.request("/api/clarifications/$requestId/responses", "POST", body.toString())
    Unit
  }

  suspend fun pendingVoiceApproval(conversationId: String): VoiceApproval? =
    runInterruptible(Dispatchers.IO) {
      require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
      val rows = org.json.JSONObject(session.request(
        "/api/connectors/approvals?status=pending&conversationId=$conversationId"))
        .getJSONObject("payload").getJSONArray("approvals")
      (0 until rows.length()).asSequence().map(rows::getJSONObject).firstOrNull { row ->
        row.optString("conversationId") == conversationId && row.optString("status") == "pending" &&
          runCatching { java.time.Instant.parse(row.getString("expiresAt"))
            .isAfter(java.time.Instant.now()) }.getOrDefault(false)
      }?.let { VoiceApproval(it.getString("id"), it.optString("actionId"), conversationId) }
    }

  suspend fun respondToVoiceApproval(approval: VoiceApproval, allow: Boolean) =
    runInterruptible(Dispatchers.IO) {
      val body = org.json.JSONObject().put("id", approval.id)
        .put("decision", if (allow) "approved" else "denied")
        .put("conversationId", approval.conversationId)
      session.request("/api/connectors/approvals/respond", "POST", body.toString())
      Unit
    }

  private fun scheduleNoteAutoSave(gatewayId: String, draft: NoteDraft) {
    noteAutoSaveJob?.cancel()
    noteAutoSaveJob = viewModelScope.launch {
      delay(650)
      val current = mutableState.value.notes
      val active = current.draft
      if (mutableState.value.profile?.gatewayId == gatewayId && active?.id == draft.id &&
        active.version == draft.version && current.draftConflict == null &&
        !current.draftSaving) submitNoteDraft()
    }
  }

  fun saveNoteDraft() {
    if (mutableState.value.profile == null || mutableState.value.notes.draft == null) return
    noteCloseAfterSave = true
    submitNoteDraft()
  }

  private fun submitNoteDraft() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val notes = mutableState.value.notes
    val draft = notes.draft ?: return
    if (notes.draftSaving || notes.draftConflict != null) return
    if (draft.version == notes.draftSyncedVersion ||
      (draft.baseRemoteVersion > 0 && notes.detail?.let { remote ->
        remote.id == draft.id && remote.remoteVersion == draft.baseRemoteVersion &&
          remote.title == draft.title && remote.markdown == draft.markdown
      } == true)) {
      if (!noteCloseAfterSave) return
      mutableState.update { it.copy(notes = it.notes.copy(draftSaving = true, draftError = false)) }
      viewModelScope.launch {
        try {
          withContext(Dispatchers.IO) { noteDraftLock.withLock {
            val latest = mutableState.value.notes.draft
            if (latest?.id == draft.id && latest.version > draft.version)
              noteDraftStore.save(gatewayId, latest)
            else noteDraftStore.remove(gatewayId, draft.id)
          } }
          if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update { state ->
            val active = state.notes.draft
            if (active?.id == draft.id && active.version > draft.version)
              state.copy(notes = state.notes.copy(draftSaving = false))
            else state.copy(notes = state.notes.copy(draft = null, draftSaving = false,
              draftSavedVersion = 0, draftSyncedVersion = 0, createdNoteId = draft.id,
              drafts = state.notes.drafts.filterNot { saved -> saved.id == draft.id }))
          }
          val latest = mutableState.value.notes.draft
          if (latest?.id == draft.id && latest.version > draft.version)
            scheduleNoteAutoSave(gatewayId, latest)
          else noteCloseAfterSave = false
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) {
          if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
            it.copy(notes = it.notes.copy(draftError = true))
          }
        }
      }
      return
    }
    if (draft.id.startsWith("local-") && draft.title.isBlank() && draft.markdown.isBlank()) return
    noteAutoSaveJob?.cancel()
    mutableState.update { it.copy(notes = it.notes.copy(draftSaving = true, draftError = false)) }
    viewModelScope.launch {
      try {
        noteDraftJob?.cancelAndJoin()
        withContext(Dispatchers.IO) { noteDraftLock.withLock {
          val latest = mutableState.value.notes.draft?.takeIf { it.id == draft.id &&
            it.version >= draft.version } ?: draft
          noteDraftStore.save(gatewayId, latest)
        } }
        val result = runInterruptible(Dispatchers.IO) {
          if (draft.id.startsWith("local-")) NoteSyncResult(noteRepository.create(draft), false)
          else noteRepository.sync(draft)
        }
        if (mutableState.value.profile?.gatewayId != gatewayId) return@launch
        if (result.conflict) {
          mutableState.update {
            it.copy(notes = it.notes.copy(draftSaving = false, draftConflict = result.note))
          }
          noteCloseAfterSave = false
          return@launch
        }
        val nextMutationId = UUID.randomUUID().toString()
        val closeRequested = noteCloseAfterSave
        mutableState.update { state ->
          state.copy(notes = applyNoteSave(state.notes, draft, result.note,
            nextMutationId, closeRequested))
        }
        val persistedVersion = withContext(Dispatchers.IO) { noteDraftLock.withLock {
          val latest = mutableState.value.notes
          val remaining = latest.draft?.takeIf { it.id == result.note.id &&
            it.version > latest.draftSyncedVersion }
          noteDraftStore.replaceAfterSave(gatewayId, draft.id, remaining)
          remaining?.version
        } }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draftSaving = false,
            draftSavedVersion = if (persistedVersion != null &&
              it.notes.draft?.version == persistedVersion) persistedVersion
              else it.notes.draftSavedVersion))
        }
        val latest = mutableState.value.notes.draft
        if (latest != null && latest.version > mutableState.value.notes.draftSyncedVersion) {
          scheduleNoteAutoSave(gatewayId, latest)
        } else {
          noteCloseAfterSave = false
        }
        loadNotes()
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draftSaving = false, draftError = true))
        }
        noteCloseAfterSave = false
      }
    }
  }

  fun resolveNoteConflict(useLocal: Boolean) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val notes = mutableState.value.notes
    val draft = notes.draft ?: return
    val remote = notes.draftConflict ?: return
    val revision = remote.remoteVersion ?: return
    if (draft.id != remote.id || notes.draftSaving) return
    mutableState.update { it.copy(notes = it.notes.copy(draftSaving = true, draftError = false)) }
    viewModelScope.launch {
      try {
        if (useLocal) {
          val rebased = draft.copy(baseRemoteVersion = revision, version = draft.version + 1)
          withContext(Dispatchers.IO) { noteDraftLock.withLock { noteDraftStore.save(gatewayId, rebased) } }
          if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
            it.copy(notes = it.notes.copy(draft = rebased, draftSaving = false, draftConflict = null,
              draftSavedVersion = rebased.version,
              drafts = it.notes.drafts.map { saved -> if (saved.id == rebased.id) rebased else saved }))
          }
          noteCloseAfterSave = false
          submitNoteDraft()
        } else {
          withContext(Dispatchers.IO) { noteDraftLock.withLock { noteDraftStore.remove(gatewayId, draft.id) } }
          if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
            it.copy(notes = it.notes.copy(draft = null, draftSaving = false, draftConflict = null,
              draftSavedVersion = 0, draftSyncedVersion = 0, detail = remote,
              createdNoteId = remote.id,
              drafts = it.notes.drafts.filterNot { saved -> saved.id == draft.id }))
          }
          noteCloseAfterSave = false
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(draftSaving = false, draftError = true))
        }
      }
    }
  }

  fun noteCreationNavigationHandled(id: String) {
    mutableState.update { state ->
      if (state.notes.createdNoteId == id) state.copy(notes = state.notes.copy(createdNoteId = null))
      else state
    }
  }

  fun loadMoreNotes() {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val notes = current.notes
    if (notes.gatewayId != gatewayId || notes.loading || notes.loadingMore || !notes.hasMore) return
    notesJob?.cancel()
    val revision = ++notesRevision
    mutableState.update { it.copy(notes = it.notes.copy(loadingMore = true, moreError = false)) }
    notesJob = viewModelScope.launch {
      try {
        val page = runInterruptible(Dispatchers.IO) {
          noteRepository.list(notes.search, notes.status, notes.items.size)
        }
        if (revision == notesRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          val existing = it.notes.items
          it.copy(notes = it.notes.copy(items = existing + page.items.filter { next ->
            existing.none { old -> old.id == next.id }
          }, total = page.total, hasMore = page.hasMore, loadingMore = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == notesRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(loadingMore = false, moreError = true))
        }
      }
    }
  }

  fun openNote(id: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    noteDetailJob?.cancel()
    noteHistoryJob?.cancel()
    noteSnapshotJob?.cancel()
    noteRestoreJob?.cancel()
    val revision = ++noteDetailRevision
    mutableState.update { it.copy(notes = it.notes.copy(selectedId = id, detail = null,
      detailLoading = true, detailError = false, metadataError = false,
      history = emptyList(), historyLoading = false, historyError = false,
      snapshot = null, snapshotLoading = false, snapshotError = false,
      restoreBusy = false, restoreError = false, restoredSnapshotId = null,
      deleteError = false, deletedNoteId = null, share = null, shareError = false)) }
    noteDetailJob = viewModelScope.launch {
      try {
        val detail = runInterruptible(Dispatchers.IO) { noteRepository.detail(id) }
        if (revision == noteDetailRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(detail = detail, detailLoading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == noteDetailRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(detailLoading = false, detailError = true))
        }
      }
    }
  }

  fun loadNoteHistory() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val id = mutableState.value.notes.detail?.id?.takeIf { it == mutableState.value.notes.selectedId }
      ?: return
    noteHistoryJob?.cancel()
    noteSnapshotJob?.cancel()
    mutableState.update { it.copy(notes = it.notes.copy(historyLoading = true,
      historyError = false, snapshot = null, snapshotLoading = false, snapshotError = false)) }
    noteHistoryJob = viewModelScope.launch {
      try {
        val entries = runInterruptible(Dispatchers.IO) { noteRepository.history(id) }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.notes.selectedId == id) mutableState.update {
          it.copy(notes = it.notes.copy(history = entries, historyLoading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.notes.selectedId == id) mutableState.update {
          it.copy(notes = it.notes.copy(historyLoading = false, historyError = true))
        }
      }
    }
  }

  fun loadNoteSnapshot(timestamp: Long) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val notes = mutableState.value.notes
    val id = notes.detail?.id?.takeIf { it == notes.selectedId } ?: return
    if (notes.history.none { it.timestamp == timestamp }) return
    noteSnapshotJob?.cancel()
    mutableState.update { it.copy(notes = it.notes.copy(snapshot = null,
      snapshotLoading = true, snapshotError = false)) }
    noteSnapshotJob = viewModelScope.launch {
      try {
        val snapshot = runInterruptible(Dispatchers.IO) { noteRepository.snapshot(id, timestamp) }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.notes.selectedId == id) mutableState.update {
          it.copy(notes = it.notes.copy(snapshot = snapshot, snapshotLoading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.notes.selectedId == id) mutableState.update {
          it.copy(notes = it.notes.copy(snapshotLoading = false, snapshotError = true))
        }
      }
    }
  }

  fun restoreNoteSnapshotToDraft() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val notes = mutableState.value.notes
    val detail = notes.detail?.takeIf { it.id == notes.selectedId } ?: return
    val snapshot = notes.snapshot?.takeIf { it.noteId == detail.id } ?: return
    if (detail.remoteVersion == null) return
    if (notes.restoreBusy || notes.draftSaving || notes.metadataBusy) return
    noteDraftJob?.cancel()
    noteAutoSaveJob?.cancel()
    noteCloseAfterSave = false
    mutableState.update { it.copy(notes = it.notes.copy(restoreBusy = true, restoreError = false)) }
    noteRestoreJob = viewModelScope.launch {
      try {
        val restored = withContext(Dispatchers.IO) { noteDraftLock.withLock {
          val previous = noteDraftStore.load(gatewayId, detail.id)
          restoredNoteDraft(detail, snapshot, previous, UUID.randomUUID().toString()).also {
            if (it.needsSync) noteDraftStore.save(gatewayId, it.draft)
            else noteDraftStore.remove(gatewayId, detail.id)
          }
        } }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.notes.selectedId == detail.id) {
          mutableState.update { state -> state.copy(notes = state.notes.copy(
            draft = restored.draft, draftSavedVersion = restored.draft.version,
            draftSyncedVersion = if (restored.needsSync) 0 else restored.draft.version,
            draftConflict = null, draftError = false, draftLoading = false,
            drafts = (if (restored.needsSync) listOf(restored.draft) else emptyList()) +
              state.notes.drafts.filterNot { it.id == restored.draft.id },
            restoreBusy = false, restoredSnapshotId = detail.id)) }
          if (restored.needsSync) scheduleNoteAutoSave(gatewayId, restored.draft)
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(notes = it.notes.copy(restoreBusy = false, restoreError = true))
        }
      }
    }
  }

  fun noteSnapshotRestorationHandled(id: String) {
    mutableState.update { state -> if (state.notes.restoredSnapshotId == id)
      state.copy(notes = state.notes.copy(restoredSnapshotId = null)) else state }
  }

  fun updateNoteMetadata(patch: NoteMetadataPatch) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val current = mutableState.value.notes
    val note = current.detail?.takeIf { it.id == current.selectedId } ?: return
    if (current.metadataBusy || current.draftSaving ||
      current.draft?.takeIf { it.id == note.id && it.version != current.draftSyncedVersion } != null) return
    mutableState.update { it.copy(notes = it.notes.copy(metadataBusy = true, metadataError = false)) }
    viewModelScope.launch {
      try {
        val updated = runInterruptible(Dispatchers.IO) { noteRepository.updateMetadata(note, patch) }
        if (mutableState.value.profile?.gatewayId != gatewayId) return@launch
        withContext(Dispatchers.IO) { noteDraftLock.withLock {
          val notes = mutableState.value.notes
          val clean = notes.draft?.takeIf { it.id == note.id && it.version == notes.draftSyncedVersion }
          if (clean != null) noteDraftStore.save(gatewayId,
            clean.copy(baseRemoteVersion = updated.remoteVersion ?: clean.baseRemoteVersion))
        } }
        mutableState.update { state ->
          val notes = state.notes
          state.copy(notes = notes.copy(
            detail = if (notes.selectedId == note.id) updated else notes.detail,
            draft = notes.draft?.let { active ->
              if (active.id == note.id && active.version == notes.draftSyncedVersion)
                active.copy(baseRemoteVersion = updated.remoteVersion ?: active.baseRemoteVersion) else active
            },
            items = notes.items.map { item -> if (item.id == note.id) item.copy(
              title = updated.title, status = updated.status, pinned = updated.pinned,
              tags = updated.tags, updatedAt = updated.updatedAt) else item },
            metadataBusy = false))
        }
        loadNotes()
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          val latest = try { runInterruptible(Dispatchers.IO) { noteRepository.detail(note.id) } }
            catch (_: Exception) { null }
          mutableState.update { state -> state.copy(notes = state.notes.copy(
            detail = if (state.notes.selectedId == note.id) latest ?: state.notes.detail else state.notes.detail,
            metadataBusy = false, metadataError = true)) }
        }
      }
    }
  }

  fun deleteNote() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val current = mutableState.value.notes
    val note = current.detail?.takeIf { it.id == current.selectedId } ?: return
    val revision = note.remoteVersion ?: return
    if (current.deleteBusy || current.metadataBusy || current.draftSaving ||
      current.restoreBusy || current.draft?.takeIf {
        it.id == note.id && it.version != current.draftSyncedVersion
      } != null) {
      mutableState.update { it.copy(notes = it.notes.copy(deleteError = true)) }
      return
    }
    val command = pendingNoteDeletion?.takeIf { it.gatewayId == gatewayId &&
      it.id == note.id && it.revision == revision }
      ?: PendingNoteDeletion(gatewayId, note.id, revision, UUID.randomUUID().toString())
    pendingNoteDeletion = command
    mutableState.update { it.copy(notes = it.notes.copy(deleteBusy = true, deleteError = false)) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { noteRepository.delete(note, command.mutationId) }
        withContext(Dispatchers.IO) { noteDraftLock.withLock { noteDraftStore.remove(gatewayId, note.id) } }
        pendingNoteDeletion = null
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          if (mutableState.value.notes.selectedId == note.id) {
            ++noteDetailRevision
            noteDetailJob?.cancel()
            noteHistoryJob?.cancel()
            noteSnapshotJob?.cancel()
          }
          mutableState.update { state ->
            val notes = state.notes
            val selected = notes.selectedId == note.id
            val sameDraft = notes.draft?.id == note.id
            state.copy(notes = notes.copy(
              items = notes.items.filterNot { it.id == note.id },
              total = (notes.total - notes.items.count { it.id == note.id }).coerceAtLeast(0),
              selectedId = if (selected) null else notes.selectedId,
              detail = if (selected) null else notes.detail,
              draft = if (sameDraft) null else notes.draft,
              drafts = notes.drafts.filterNot { it.id == note.id },
              draftSavedVersion = if (sameDraft) 0 else notes.draftSavedVersion,
              draftSyncedVersion = if (sameDraft) 0 else notes.draftSyncedVersion,
              history = if (selected) emptyList() else notes.history,
              snapshot = if (selected) null else notes.snapshot,
              deleteBusy = false, deleteError = false,
              deletedNoteId = if (selected) note.id else notes.deletedNoteId))
          }
          loadNotes()
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          val latest = try { runInterruptible(Dispatchers.IO) { noteRepository.detail(note.id) } }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { null }
          if (latest != null && latest.remoteVersion != revision) pendingNoteDeletion = null
          mutableState.update { state -> state.copy(notes = state.notes.copy(
            detail = if (state.notes.selectedId == note.id) latest ?: state.notes.detail else state.notes.detail,
            deleteBusy = false, deleteError = true)) }
          loadNotes()
        }
      }
    }
  }

  fun noteDeletionHandled(id: String) {
    mutableState.update { state -> if (state.notes.deletedNoteId == id)
      state.copy(notes = state.notes.copy(deletedNoteId = null)) else state }
  }

  fun shareNote() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val notes = mutableState.value.notes
    val note = notes.detail?.takeIf { it.id == notes.selectedId } ?: return
    if (notes.shareBusy || notes.metadataBusy || notes.deleteBusy || notes.draftSaving ||
      notes.draft?.takeIf { it.id == note.id && it.version != notes.draftSyncedVersion } != null) {
      mutableState.update { it.copy(notes = it.notes.copy(shareError = true)) }
      return
    }
    mutableState.update { it.copy(notes = it.notes.copy(shareBusy = true, shareError = false, share = null)) }
    viewModelScope.launch {
      try {
        val result = runInterruptible(Dispatchers.IO) { noteRepository.share(note) }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update { state ->
          state.copy(notes = state.notes.copy(shareBusy = false,
            share = if (state.notes.selectedId == note.id) result else null))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          val latest = try { runInterruptible(Dispatchers.IO) { noteRepository.detail(note.id) } }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { null }
          mutableState.update { state -> state.copy(notes = state.notes.copy(
            detail = if (state.notes.selectedId == note.id) latest ?: state.notes.detail else state.notes.detail,
            shareBusy = false, shareError = state.notes.selectedId == note.id)) }
        }
      }
    }
  }

  fun dismissNoteShare() {
    mutableState.update { it.copy(notes = it.notes.copy(share = null, shareError = false)) }
  }

  fun loadShares() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    if (mutableState.value.shares.busyId != null) return
    sharesJob?.cancel()
    val revision = ++sharesRevision
    mutableState.update { state ->
      val previous = state.shares.takeIf { it.gatewayId == gatewayId }
        ?: ShareCenterUiState(gatewayId = gatewayId)
      state.copy(shares = previous.copy(loading = true, error = false))
    }
    sharesJob = viewModelScope.launch {
      try {
        val items = runInterruptible(Dispatchers.IO) { shareRepository.list() }
        if (sharesRevision == revision && mutableState.value.profile?.gatewayId == gatewayId)
          mutableState.update { it.copy(shares = it.shares.copy(items = items, loading = false)) }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (sharesRevision == revision && mutableState.value.profile?.gatewayId == gatewayId)
          mutableState.update { it.copy(shares = it.shares.copy(loading = false, error = true)) }
      }
    }
  }

  fun closeShareCenter() {
    if (mutableState.value.shares.busyId != null) return
    sharesRevision++
    sharesJob?.cancel()
    mutableState.update { it.copy(shares = it.shares.copy(loading = false)) }
  }

  fun revokeShare(id: String) = mutateShare(id) { item ->
    shareRepository.revoke(item.id)
    item.copy(revoked = true)
  }

  fun extendShare(id: String, days: Int) = mutateShare(id) { item ->
    val result = shareRepository.extend(item, days)
    item.copy(expiresAt = result.expiresAt, url = result.url, expired = false)
  }

  private fun mutateShare(id: String, mutation: (ShareItem) -> ShareItem) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    val shares = mutableState.value.shares
    val item = shares.items.firstOrNull { it.id == id } ?: return
    if (shares.gatewayId != gatewayId || shares.busyId != null || !item.active) return
    sharesJob?.cancel()
    val revision = ++sharesRevision
    mutableState.update { it.copy(shares = it.shares.copy(busyId = id, loading = false, error = false)) }
    viewModelScope.launch {
      var confirmed: ShareItem? = null
      try {
        val updated = runInterruptible(Dispatchers.IO) { mutation(item) }
        confirmed = updated
        if (revision == sharesRevision && mutableState.value.profile?.gatewayId == gatewayId)
          mutableState.update { state -> state.copy(shares = state.shares.copy(
            items = state.shares.items.map { if (it.id == id) updated else it })) }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { /* Re-read before reporting an uncertain write as failed. */ }
      try {
        val latest = runInterruptible(Dispatchers.IO) { shareRepository.list() }
        if (revision == sharesRevision && mutableState.value.profile?.gatewayId == gatewayId)
          mutableState.update { state -> state.copy(shares = state.shares.copy(
            items = latest, error = confirmed == null)) }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == sharesRevision && mutableState.value.profile?.gatewayId == gatewayId)
          mutableState.update { it.copy(shares = it.shares.copy(error = true)) }
      } finally {
        if (revision == sharesRevision && mutableState.value.profile?.gatewayId == gatewayId)
          mutableState.update { it.copy(shares = it.shares.copy(busyId = null)) }
      }
    }
  }

  fun refreshProgress() {
    refreshProgressHome()
    refreshProgressTasks()
  }

  fun refreshProgressHome() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    progressHomeJob?.cancel()
    progressMetricsJob?.cancel()
    val revision = ++progressHomeRevision
    mutableState.update { state ->
      val previous = state.progress.takeIf { it.gatewayId == gatewayId } ?: ProgressUiState(gatewayId = gatewayId)
      state.copy(progress = previous.copy(homeLoading = true, homeError = false))
    }
    progressHomeJob = viewModelScope.launch {
      val language = if (Locale.getDefault().language.startsWith("zh")) "zh" else "en"
      try {
        val home = runInterruptible(Dispatchers.IO) { progressRepository.home(language) }
        if (revision == progressHomeRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(needsUser = home.needsUser, background = home.background))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == progressHomeRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(homeError = true))
        }
      }
      if (revision == progressHomeRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
        it.copy(progress = it.progress.copy(homeLoading = false))
      }
    }
    progressMetricsJob = viewModelScope.launch {
      try {
        val metrics = runInterruptible(Dispatchers.IO) { automationRepository.metrics() }
        if (revision == progressHomeRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automationMetrics = metrics))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == progressHomeRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automationMetrics = null))
        }
      }
    }
  }

  fun actOnProgressHome(action: ProgressHomeAction) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    if (mutableState.value.progress.homeActionBusy) return
    mutableState.update { it.copy(progress = it.progress.copy(homeActionBusy = true, homeActionError = false)) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { progressRepository.act(action) }
        if (mutableState.value.profile?.gatewayId == gatewayId) refreshProgressHome()
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(homeActionError = true))
        }
      } finally {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(homeActionBusy = false))
        }
      }
    }
  }

  fun loadAutomations() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    automationJob?.cancel()
    val revision = ++automationRevision
    mutableState.update { state ->
      state.copy(progress = state.progress.copy(automations = state.progress.automations.copy(
        listLoading = true, listError = false)))
    }
    automationJob = viewModelScope.launch {
      try {
        val items = runInterruptible(Dispatchers.IO) { automationRepository.list() }
        if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(items = items)))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(listError = true)))
        }
      } finally {
        if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(listLoading = false)))
        }
      }
    }
  }

  fun openAutomation(id: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    automationJob?.cancel()
    val revision = ++automationRevision
    mutableState.update { state ->
      val previous = state.progress.automations
      state.copy(progress = state.progress.copy(automations = previous.copy(
        selectedId = id, detail = null, detailLoading = true, detailError = false,
        runs = emptyList(), runsError = false, selectedRunId = null, run = null, events = emptyList(),
        actionError = if (previous.selectedId == id) previous.actionError else false,
        editError = if (previous.selectedId == id) previous.editError else false,
        deleteError = if (previous.selectedId == id) previous.deleteError else false)))
    }
    automationJob = viewModelScope.launch {
      try {
        val detail = runInterruptible(Dispatchers.IO) { automationRepository.detail(id) }
        if (revision != automationRevision || mutableState.value.profile?.gatewayId != gatewayId) return@launch
        mutableState.update { it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(
          detail = detail, detailLoading = false))) }
        try {
          val runs = runInterruptible(Dispatchers.IO) { automationRepository.runs(id) }
          if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
            it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(runs = runs)))
          }
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) {
          if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
            it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(runsError = true)))
          }
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(detailError = true)))
        }
      } finally {
        if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(detailLoading = false)))
        }
      }
    }
  }

  fun openAutomationRun(id: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    automationJob?.cancel()
    val revision = ++automationRevision
    mutableState.update { state ->
      val previous = state.progress.automations
      val sameRun = previous.selectedRunId == id
      state.copy(progress = state.progress.copy(automations = state.progress.automations.copy(
        selectedRunId = id, run = if (sameRun) previous.run else null,
        runLoading = true, runError = false,
        events = if (sameRun) previous.events else emptyList(), eventsError = false,
        runActionError = if (sameRun) previous.runActionError else false,
        rerunNavigationId = null)))
    }
    automationJob = viewModelScope.launch {
      try {
        val run = runInterruptible(Dispatchers.IO) { automationRepository.run(id) }
        if (revision != automationRevision || mutableState.value.profile?.gatewayId != gatewayId) return@launch
        mutableState.update { it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(
          run = run, runLoading = false))) }
        try {
          val events = runInterruptible(Dispatchers.IO) { automationRepository.events(id) }
          if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
            it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(events = events)))
          }
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) {
          if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
            it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(eventsError = true)))
          }
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(runError = true)))
        }
      } finally {
        if (revision == automationRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(runLoading = false)))
        }
      }
    }
  }

  fun actOnAutomationRun(id: String, action: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val run = current.progress.automations.run?.takeIf {
      it.id == id && current.progress.automations.selectedRunId == id
    } ?: return
    if (current.progress.automations.runActionBusy) return
    mutableState.update { it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(
      runActionBusy = true, runActionError = false))) }
    viewModelScope.launch {
      var failed = false
      var rerunId: String? = null
      try {
        runInterruptible(Dispatchers.IO) {
          when (action) {
            "cancel" -> automationRepository.cancelRun(run)
            "rerun" -> automationRepository.rerun(run).also { rerunId = it.id }
            else -> throw IllegalArgumentException("INVALID_AUTOMATION_RUN_ACTION")
          }
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { failed = true }
      finally {
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.progress.automations.selectedRunId == id) {
          mutableState.update { it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(
            runActionBusy = false, runActionError = failed, rerunNavigationId = rerunId))) }
          if (rerunId == null) openAutomationRun(id)
        }
      }
    }
  }

  fun actOnAutomation(id: String, action: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val item = current.progress.automations.detail?.takeIf {
      it.id == id && current.progress.automations.selectedId == id
    } ?: return
    if (current.progress.automations.actionBusy) return
    mutableState.update { it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(
      actionBusy = true, actionError = false))) }
    viewModelScope.launch {
      var failed = false
      try {
        runInterruptible(Dispatchers.IO) {
          when (action) {
            "run" -> automationRepository.runNow(item)
            "pause" -> automationRepository.setEnabled(item, false)
            "resume" -> automationRepository.setEnabled(item, true)
            else -> throw IllegalArgumentException("INVALID_AUTOMATION_ACTION")
          }
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { failed = true }
      finally {
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.progress.automations.selectedId == id) {
          mutableState.update { it.copy(progress = it.progress.copy(automations = it.progress.automations.copy(
            actionBusy = false, actionError = failed))) }
          openAutomation(id)
        }
      }
    }
  }

  fun createAutomation(name: String, instruction: String, cron: String, key: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    if (mutableState.value.progress.automations.createBusy) return
    mutableState.update { it.copy(progress = it.progress.copy(automations =
      it.progress.automations.copy(createBusy = true, createError = false, createdId = null))) }
    viewModelScope.launch {
      try {
        val created = runInterruptible(Dispatchers.IO) {
          automationRepository.create(name, instruction, cron, key)
        }
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          mutableState.update { it.copy(progress = it.progress.copy(automations =
            it.progress.automations.copy(createBusy = false, createdId = created.id))) }
          loadAutomations()
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(automations =
            it.progress.automations.copy(createBusy = false, createError = true)))
        }
      }
    }
  }

  fun updateAutomation(id: String, name: String, instruction: String, cron: String, key: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val item = current.progress.automations.detail?.takeIf {
      it.id == id && current.progress.automations.selectedId == id
    } ?: return
    if (current.progress.automations.editBusy) return
    mutableState.update { it.copy(progress = it.progress.copy(automations =
      it.progress.automations.copy(editBusy = true, editError = false))) }
    viewModelScope.launch {
      try {
        val updated = runInterruptible(Dispatchers.IO) {
          automationRepository.update(item, name, instruction, cron, key)
        }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.progress.automations.selectedId == id) {
          mutableState.update { it.copy(progress = it.progress.copy(automations =
            it.progress.automations.copy(editBusy = false, detail = updated,
              editedRevision = it.progress.automations.editedRevision + 1))) }
          loadAutomations()
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.progress.automations.selectedId == id) mutableState.update {
          it.copy(progress = it.progress.copy(automations =
            it.progress.automations.copy(editBusy = false, editError = true)))
        }
      }
    }
  }

  fun deleteAutomation(id: String, key: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val item = current.progress.automations.detail?.takeIf {
      it.id == id && current.progress.automations.selectedId == id
    } ?: return
    if (current.progress.automations.deleteBusy) return
    mutableState.update { it.copy(progress = it.progress.copy(automations =
      it.progress.automations.copy(deleteBusy = true, deleteError = false, deletedId = null))) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { automationRepository.delete(item, key) }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.progress.automations.selectedId == id) {
          mutableState.update { it.copy(progress = it.progress.copy(automations =
            it.progress.automations.copy(deleteBusy = false, deletedId = id))) }
          loadAutomations()
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.progress.automations.selectedId == id) mutableState.update {
          it.copy(progress = it.progress.copy(automations =
            it.progress.automations.copy(deleteBusy = false, deleteError = true)))
        }
      }
    }
  }

  fun changeProgressTaskSearch(text: String) {
    mutableState.update { it.copy(progress = it.progress.copy(taskSearchText = text.take(4096))) }
  }

  fun submitProgressTaskSearch() {
    val query = mutableState.value.progress.taskSearchText.trim()
    mutableState.update { state ->
      val progress = state.progress
      state.copy(progress = progress.copy(taskSearch = query,
        tasks = if (query == progress.taskSearch) progress.tasks else emptyList(),
        taskTotal = if (query == progress.taskSearch) progress.taskTotal else 0))
    }
    refreshProgressTasks()
  }

  fun refreshProgressTasks() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    progressJob?.cancel()
    progressMoreJob?.cancel()
    val revision = ++progressRevision
    val query = mutableState.value.progress.taskSearch
    mutableState.update { state ->
      val previous = state.progress.takeIf { it.gatewayId == gatewayId } ?: ProgressUiState(gatewayId = gatewayId)
      state.copy(progress = previous.copy(loading = true, loadingMore = false,
        tasksError = false, moreError = false))
    }
    progressJob = viewModelScope.launch {
      try {
        val page = runInterruptible(Dispatchers.IO) { progressRepository.tasks(search = query) }
        if (revision == progressRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(tasks = page.items, taskTotal = page.total,
            recentClosedTasks = if (query.isBlank()) page.items.filter { task -> task.phase == "closed" }
              .sortedByDescending { task -> task.closedAt ?: task.updatedAt }.take(2)
            else it.progress.recentClosedTasks))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == progressRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(tasksError = true))
        }
      }
      if (revision == progressRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
        it.copy(progress = it.progress.copy(loading = false))
      }
    }
  }

  fun loadMoreProgressTasks() {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val progress = current.progress
    if (progress.gatewayId != gatewayId || progress.loading || progress.loadingMore || progress.tasksError ||
      progress.tasks.size >= progress.taskTotal) return
    val revision = progressRevision
    val offset = progress.tasks.size
    mutableState.update { it.copy(progress = it.progress.copy(loadingMore = true, moreError = false)) }
    progressMoreJob = viewModelScope.launch {
      try {
        val page = runInterruptible(Dispatchers.IO) { progressRepository.tasks(offset = offset, search = progress.taskSearch) }
        if (revision == progressRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update { state ->
          val seen = state.progress.tasks.mapTo(mutableSetOf()) { it.id }
          val newTasks = page.items.filter { seen.add(it.id) }
          state.copy(progress = state.progress.copy(tasks = state.progress.tasks + newTasks,
            taskTotal = if (newTasks.isEmpty()) state.progress.tasks.size else page.total, loadingMore = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == progressRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(loadingMore = false, moreError = true))
        }
      }
    }
  }

  fun openProgressTask(id: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    if (!id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) return
    progressDetailJob?.cancel()
    val revision = ++progressDetailRevision
    mutableState.update { state ->
      val current = state.progress.takeIf { it.gatewayId == gatewayId } ?: ProgressUiState(gatewayId = gatewayId)
      state.copy(progress = current.copy(detailTaskId = id, detailTask = null,
        detailLoading = true, detailError = false, commandError = false, editError = false))
    }
    progressDetailJob = viewModelScope.launch {
      try {
        val task = runInterruptible(Dispatchers.IO) { progressRepository.task(id) }
        if (revision == progressDetailRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(detailTask = task, detailLoading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == progressDetailRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(detailLoading = false, detailError = true))
        }
      }
    }
  }

  fun openTaskConversation(taskId: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    if (!taskId.matches(Regex("[A-Za-z0-9_-]{1,128}")) ||
      current.progress.taskChatBusy) return
    mutableState.update { it.copy(progress = it.progress.copy(taskChatBusy = true, taskChatError = false)) }
    viewModelScope.launch {
      try {
        val id = runInterruptible(Dispatchers.IO) { conversations.ensureTaskConversation(taskId) }
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          mutableState.update { it.copy(progress = it.progress.copy(taskChatBusy = false)) }
          selectConversationScoped(id, taskId)
          mutableState.update { it.copy(quickOpenedConversationId = id) }
          loadConversations()
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(taskChatBusy = false, taskChatError = true))
        }
      }
    }
  }

  fun commandProgressTask(action: String) = runProgressTaskCommand(action, "")

  fun startProgressTask(agentId: String) = runProgressTaskCommand("start", agentId)

  fun loadProgressProjects() {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    projectsJob?.cancel()
    val revision = ++projectsRevision
    mutableState.update { it.copy(progress = it.progress.copy(projectsLoading = true, projectsError = false)) }
    projectsJob = viewModelScope.launch {
      try {
        val items = runInterruptible(Dispatchers.IO) { progressRepository.projects() }
        if (revision == projectsRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(projects = items, projectsLoading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == projectsRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(projectsLoading = false, projectsError = true))
        }
      }
    }
  }

  fun openProgressProject(id: String) {
    val gatewayId = mutableState.value.profile?.gatewayId ?: return
    if (!id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) return
    projectDetailJob?.cancel()
    val revision = ++projectDetailRevision
    mutableState.update { it.copy(progress = it.progress.copy(projectId = id, project = null,
      projectTasks = emptyList(), projectSessions = emptyList(), projectSessionsLoading = true,
      projectSessionsError = false, projectLoading = true, projectError = false)) }
    projectDetailJob = viewModelScope.launch {
      try {
        val (project, tasks) = runInterruptible(Dispatchers.IO) {
          progressRepository.project(id) to progressRepository.projectTasks(id)
        }
        if (revision == projectDetailRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(project = project, projectTasks = tasks.items,
            projectLoading = false))
        }
        val local = runInterruptible(Dispatchers.IO) {
          conversations.projectDrafts(id).map { draft ->
            ProgressProjectSession(draft.conversationId, "", 0, isLocalDraft = true)
          }
        }
        if (revision == projectDetailRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(projectSessions = local))
        }
        val sessions = try { runInterruptible(Dispatchers.IO) {
          local + progressRepository.projectSessions(id).filterNot { row -> local.any { it.id == row.id } }
        } }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) {
          if (revision == projectDetailRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
            it.copy(progress = it.progress.copy(projectSessionsLoading = false, projectSessionsError = true))
          }
          return@launch
        }
        if (revision == projectDetailRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(projectSessions = sessions, projectSessionsLoading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == projectDetailRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(projectLoading = false, projectSessionsLoading = false,
            projectError = true))
        }
      }
    }
  }

  fun createProgressTask(title: String, body: String, projectId: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    if (current.progress.createBusy || current.progress.project == null || title.trim().isEmpty()) return
    val signature = listOf(gatewayId, title.trim(), body, projectId).joinToString("\u0000")
    if (signature != createTaskSignature) {
      createTaskSignature = signature
      createTaskKey = UUID.randomUUID().toString()
    }
    val key = createTaskKey
    mutableState.update { it.copy(progress = it.progress.copy(createBusy = true, createError = false)) }
    viewModelScope.launch {
      try {
        val created = runInterruptible(Dispatchers.IO) { progressRepository.createTask(title, body, projectId, key) }
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          require(created.projectId == projectId) { "MISMATCHED_PROGRESS_TASK_CREATE" }
          createTaskSignature = ""
          createTaskKey = ""
          mutableState.update { it.copy(progress = it.progress.copy(createBusy = false,
            createSavedRevision = it.progress.createSavedRevision + 1)) }
          openProgressProject(projectId)
          refreshProgressTasks()
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(createBusy = false, createError = true))
        }
      }
    }
  }

  fun createTaskWithChat() {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    if (current.creatingConversation || current.progress.creatingTaskChat) return
    val prompt = getApplication<Application>().getString(R.string.progress_create_task_prompt)
    mutableState.update { it.copy(creatingConversation = true,
      progress = it.progress.copy(creatingTaskChat = true, createTaskChatError = false)) }
    viewModelScope.launch {
      try {
        draftWriteJob?.join()
        val draft = runInterruptible(Dispatchers.IO) {
          conversations.createDraft(current.defaultAgentId).also {
            conversations.saveComposerDraft(it.conversationId, prompt)
          }
        }
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          mutableState.update { it.copy(creatingConversation = false,
            progress = it.progress.copy(creatingTaskChat = false)) }
          selectConversation(draft.conversationId)
          mutableState.update { it.copy(quickOpenedConversationId = draft.conversationId) }
          loadConversations()
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(creatingConversation = false,
            progress = it.progress.copy(creatingTaskChat = false, createTaskChatError = true))
        }
      }
    }
  }

  private fun runProgressTaskCommand(action: String, agentId: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val task = current.progress.detailTask ?: return
    if (current.progress.gatewayId != gatewayId || current.progress.detailTaskId != task.id ||
      current.progress.commandBusy || action !in task.allowedCommands ||
      (action == "start" && agentId.trim().isEmpty())) return
    val revision = ++progressCommandRevision
    val key = UUID.randomUUID().toString()
    mutableState.update { it.copy(progress = it.progress.copy(commandBusy = true, commandError = false)) }
    progressCommandJob = viewModelScope.launch {
      try {
        val updated = runInterruptible(Dispatchers.IO) { progressRepository.command(task, action, key, agentId) }
        if (revision == progressCommandRevision && mutableState.value.profile?.gatewayId == gatewayId) mutableState.update { state ->
          val progress = state.progress
          val selected = if (progress.detailTaskId == task.id) updated else progress.detailTask
          state.copy(progress = progress.copy(detailTask = selected, commandBusy = false,
            tasks = progress.tasks.map { if (it.id == updated.id) updated else it },
            recentClosedTasks = if (progress.taskSearch.isBlank())
              (progress.recentClosedTasks.filterNot { it.id == updated.id } +
                listOfNotNull(updated.takeIf { it.phase == "closed" }))
                .sortedByDescending { it.closedAt ?: it.updatedAt }.take(2)
            else progress.recentClosedTasks))
        }
        if (mutableState.value.profile?.gatewayId == gatewayId) refreshProgressHome()
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == progressCommandRevision && mutableState.value.profile?.gatewayId == gatewayId) {
          if (mutableState.value.progress.detailTaskId == task.id) openProgressTask(task.id)
          mutableState.update { it.copy(progress = it.progress.copy(commandBusy = false, commandError = true)) }
        }
      }
    }
  }

  fun saveProgressTask(id: String, expectedVersion: Int, title: String, body: String, projectId: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val task = current.progress.detailTask
    if (current.progress.gatewayId != gatewayId || current.progress.detailTaskId != id ||
      task?.id != id || task.version != expectedVersion || current.progress.editBusy ||
      current.progress.commandBusy) {
      mutableState.update { it.copy(progress = it.progress.copy(editError = true)) }
      return
    }
    mutableState.update { it.copy(progress = it.progress.copy(editBusy = true, editError = false)) }
    progressEditJob = viewModelScope.launch {
      try {
        val updated = runInterruptible(Dispatchers.IO) { progressRepository.updateTask(task, title, body, projectId) }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update { state ->
          val progress = state.progress
          state.copy(progress = progress.copy(editBusy = false, editSavedRevision = progress.editSavedRevision + 1,
            tasks = progress.tasks.map { if (it.id == updated.id) updated else it },
            recentClosedTasks = progress.recentClosedTasks.map { if (it.id == updated.id) updated else it }))
        }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.progress.detailTaskId == id) openProgressTask(id)
        if (mutableState.value.profile?.gatewayId == gatewayId) refreshProgressTasks()
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(progress = it.progress.copy(editBusy = false, editError = true))
        }
      }
    }
  }

  private fun connectRealtime() {
    if (realtimeJob?.isActive == true) return
    realtimeJob = viewModelScope.launch {
      realtime.run(
        onState = { status -> mutableState.update { it.copy(realtimeStatus = status) } },
        onInvalidation = { topic ->
          if (topic == "sessions") {
            if (searchJob?.isActive != true) loadConversations()
            mutableState.value.selectedConversationId?.let { id ->
              refreshSelectedHistory(id)
              refreshRunState(id)
            }
          } else if (topic.startsWith("run:")) {
            val current = mutableState.value
            if (topic == "run:${current.activeRunId}") {
              mutableState.update { it.copy(liveText = "", liveMessageId = null) }
              current.selectedConversationId?.let { id ->
                refreshSelectedHistory(id)
                refreshRunState(id)
              }
            }
          }
        },
        onRunEvent = ::handleRunEvent)
    }
  }

  private fun handleRunEvent(event: RunStreamEvent) {
    val current = mutableState.value
    if (event.runId != current.activeRunId || event.conversationId != current.selectedConversationId) return
    when (event.type) {
      "assistant_delta" -> {
        val delta = event.delta ?: return
        val previous = if (current.liveMessageId == event.messageId) current.liveText else ""
        val next = RunStreamEvent.appendDelta(previous, delta, event.offset)
        if (next == null) {
          mutableState.update { it.copy(liveText = "", liveMessageId = null) }
          refreshSelectedHistory(current.selectedConversationId)
          return
        }
        mutableState.update { it.copy(liveText = next, liveMessageId = event.messageId) }
      }
      "run_end" -> {
        realtime.watchRun(null)
        mutableState.update { it.copy(activeRunId = null, liveText = "", liveMessageId = null) }
        refreshSelectedHistory(current.selectedConversationId)
        refreshRunState(current.selectedConversationId)
      }
      "error" -> mutableState.update { it.copy(runError = true) }
    }
  }

  private fun gatewayMutationBusy(): Boolean {
    val current = mutableState.value
    return current.gatewayBusy || current.pairing || current.sending || current.quickSending ||
      current.attachmentLoading || current.quickAttachmentLoading ||
      current.creatingConversation || current.modelSaving || current.deleteCommitting ||
      current.batchConversationBusy ||
      current.personal.savingGoal || current.personal.savingProfile ||
      current.personal.assertionSaving || current.notes.draftSaving ||
      current.shares.busyId != null ||
      current.progress.commandBusy || current.progress.editBusy || current.progress.createBusy ||
      current.progress.automations.actionBusy || current.progress.automations.createBusy ||
      current.progress.automations.editBusy || current.progress.automations.deleteBusy
  }

  /** Persist visible local input before any connection identity is changed. */
  private suspend fun quiesceGateway() {
    draftWriteJob?.cancelAndJoin()
    refWriteJob?.cancelAndJoin()
    quickDraftWriteJob?.cancelAndJoin()
    quickAttachmentJob?.join()
    noteDraftJob?.cancelAndJoin()
    noteAutoSaveJob?.cancelAndJoin()
    val current = mutableState.value
    val oldId = current.profile?.gatewayId
    withContext(Dispatchers.IO) {
      if (!current.historyLoading && !current.chatError) current.selectedConversationId?.let { id ->
        conversations.saveComposerDraft(id, current.draftText)
        conversations.saveComposerRefs(id, current.draftRefs)
      }
      conversations.saveQuickDraft(current.quickDraftText)
      if (oldId != null) current.notes.draft?.let { draft ->
        noteDraftLock.withLock { noteDraftStore.save(oldId, draft) }
      }
    }
    val readers = listOf(searchJob, historyJob, olderHistoryJob, executionJob, runStateJob, modelJob, agentJob,
      contextJob, contextPanelJob, connectionWaitJob, referenceJob, progressJob, progressHomeJob, progressMetricsJob,
      progressMoreJob, progressDetailJob,
      projectsJob, projectDetailJob, automationJob, notesJob, sharesJob, noteDetailJob, noteHistoryJob,
      noteSnapshotJob, personalJob, personalListJob, personalDetailJob)
    readers.forEach { it?.cancel() }
    readers.forEach { it?.join() }
    realtimeJob?.cancelAndJoin()
    realtimeJob = null
    realtime.watchRun(null)
    listRevision++; historyRevision++; executionRevision++; contextRevision++; contextPanelRevision++
    connectionWaitRevision++; referenceRevision++
    progressRevision++; progressHomeRevision++; progressDetailRevision++
    projectsRevision++; projectDetailRevision++; automationRevision++
    notesRevision++; noteDetailRevision++; personalRevision++; personalListRevision++; personalDetailRevision++
    sharesRevision++
    listSearch = ""
    remoteConversationOffset = 0
    mutableState.update { it.copy(realtimeStatus = "offline") }
  }

  private suspend fun adoptGateway(profile: GatewayProfile?) {
    gatewayProbeGeneration++
    val profiles = withContext(Dispatchers.IO) { session.savedProfiles() }
    val recovered = if (profile == null) null else withContext(Dispatchers.IO) { conversations.recoverQuickHandoff() }
    val selectedId = recovered?.conversationId ?: withContext(Dispatchers.IO) { session.mainConversationId() }
    val quickDraft = if (profile == null) "" else withContext(Dispatchers.IO) { conversations.quickDraft() }
    val quickAttachments = if (profile == null) emptyList() else withContext(Dispatchers.IO) {
      conversations.quickAttachments()
    }
    mutableState.value = ConnectionUiState(profile = profile, gatewayProfiles = profiles,
      quickDraftText = quickDraft, quickAttachments = quickAttachments,
      quickOpenedConversationId = recovered?.conversationId)
    if (profile != null) {
      connectRealtime()
      loadConversations()
      selectedId?.let(::selectConversation)
    }
  }

  fun openGatewayProfiles() {
    val generation = ++gatewayProbeGeneration
    viewModelScope.launch {
      try {
        val profiles = withContext(Dispatchers.IO) { session.savedProfiles() }
        if (generation != gatewayProbeGeneration) return@launch
        mutableState.update { it.copy(gatewayProfiles = profiles, gatewayProbes = emptyMap(), gatewayError = null) }
        profiles.forEach { probeGateway(it.gatewayId) }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { if (generation == gatewayProbeGeneration)
        mutableState.update { it.copy(gatewayError = "LOAD_FAILED") } }
    }
  }

  fun probeGateway(gatewayId: String) {
    val generation = gatewayProbeGeneration
    val current = mutableState.value
    if (current.gatewayBusy || current.gatewayProfiles.none { it.gatewayId == gatewayId } ||
      current.gatewayProbes[gatewayId]?.phase == "checking") return
    mutableState.update { it.copy(gatewayProbes = it.gatewayProbes +
      (gatewayId to GatewayProbeUiState())) }
    viewModelScope.launch {
      try {
        val result = runInterruptible(Dispatchers.IO) { session.probeProfile(gatewayId) }
        if (generation == gatewayProbeGeneration &&
          mutableState.value.gatewayProfiles.any { it.gatewayId == gatewayId }) mutableState.update {
          it.copy(gatewayProbes = it.gatewayProbes + (gatewayId to GatewayProbeUiState(
            phase = if (result.status in setOf("healthy", "ok")) "online" else "degraded", result = result)))
        }
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        if (generation == gatewayProbeGeneration &&
          mutableState.value.gatewayProfiles.any { it.gatewayId == gatewayId }) mutableState.update {
          it.copy(gatewayProbes = it.gatewayProbes + (gatewayId to GatewayProbeUiState(
            phase = "offline", error = error.message)))
        }
      }
    }
  }

  fun renameGateway(gatewayId: String, name: String) {
    if (mutableState.value.gatewayBusy) return
    mutableState.update { it.copy(gatewayBusy = true, gatewayError = null) }
    viewModelScope.launch {
      try {
        val (updated, profiles) = withContext(Dispatchers.IO) {
          val updated = session.renameProfile(gatewayId, name)
          updated to session.savedProfiles()
        }
        mutableState.update { it.copy(profile = if (it.profile?.gatewayId == gatewayId) updated else it.profile,
          gatewayProfiles = profiles, gatewayBusy = false) }
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) { mutableState.update { it.copy(gatewayBusy = false,
        gatewayError = error.message ?: "RENAME_FAILED") } }
    }
  }

  fun activateGateway(gatewayId: String) {
    val old = mutableState.value.profile ?: return
    if (old.gatewayId == gatewayId || mutableState.value.gatewayBusy) return
    if (gatewayMutationBusy()) {
      mutableState.update { it.copy(gatewayError = "GATEWAY_OPERATION_BUSY") }
      return
    }
    mutableState.update { it.copy(gatewayBusy = true, gatewayError = null) }
    viewModelScope.launch {
      var quiesced = false
      try {
        runInterruptible(Dispatchers.IO) { session.probeProfile(gatewayId) }
        quiesceGateway(); quiesced = true
        val profile = runInterruptible(Dispatchers.IO) { session.activate(gatewayId) }
        adoptGateway(profile)
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        mutableState.update { it.copy(gatewayBusy = false,
          gatewayError = error.message ?: "SWITCH_FAILED") }
        if (quiesced && session.currentProfile()?.gatewayId == old.gatewayId) {
          connectRealtime(); loadConversations()
          mutableState.value.selectedConversationId?.let(::selectConversation)
        }
      }
    }
  }

  fun removeGateway(gatewayId: String) {
    if (mutableState.value.gatewayBusy) return
    if (gatewayMutationBusy() && mutableState.value.profile?.gatewayId == gatewayId) {
      mutableState.update { it.copy(gatewayError = "GATEWAY_OPERATION_BUSY") }
      return
    }
    mutableState.update { it.copy(gatewayBusy = true, gatewayError = null) }
    gatewayProbeGeneration++
    viewModelScope.launch {
      var quiesced = false
      try {
        if (mutableState.value.profile?.gatewayId == gatewayId) { quiesceGateway(); quiesced = true }
        val next = withContext(Dispatchers.IO) { session.removeProfile(gatewayId) }
        val cleanupFailed = runCatching { withContext(Dispatchers.IO) {
          conversations.removeGatewayLocal(gatewayId)
          noteDraftStore.removeGateway(gatewayId)
        } }.isFailure
        if (quiesced) adoptGateway(next)
        else {
          val profiles = withContext(Dispatchers.IO) { session.savedProfiles() }
          mutableState.update { it.copy(gatewayProfiles = profiles,
            gatewayProbes = it.gatewayProbes - gatewayId, gatewayBusy = false) }
        }
        if (cleanupFailed) mutableState.update { it.copy(gatewayError = "LOCAL_CLEANUP_FAILED") }
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        mutableState.update { it.copy(gatewayBusy = false,
          gatewayError = error.message ?: "REMOVE_FAILED") }
        if (quiesced) connectRealtime()
      }
    }
  }

  fun restore() {
    if (mutableState.value.restoring || mutableState.value.profile != null) return
    mutableState.update { it.copy(restoring = true, error = null) }
    viewModelScope.launch {
      try {
        val (profile, selectedConversationId, quickDraftText, quickAttachments, recoveredId) = runInterruptible(Dispatchers.IO) {
          val restored = session.restore { code -> mutableState.update { it.copy(confirmationCode = code) } }
          val recovered = if (restored != null) conversations.recoverQuickHandoff() else null
          RestoredGateway(restored, recovered?.conversationId ?: session.mainConversationId(),
            if (restored != null) conversations.quickDraft() else "",
            if (restored != null) conversations.quickAttachments() else emptyList<ChatAttachment>(),
            recovered?.conversationId)
        }
        val profiles = runInterruptible(Dispatchers.IO) { session.savedProfiles() }
        mutableState.update { it.copy(profile = profile, gatewayProfiles = profiles,
          restoring = false, quickDraftText = quickDraftText,
          quickAttachments = quickAttachments,
          quickOpenedConversationId = recoveredId) }
        if (profile != null) {
          connectRealtime()
          loadConversations()
          if (selectedConversationId != null) selectConversation(selectedConversationId)
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        mutableState.update { it.copy(restoring = false, error = "RESTORE_FAILED") }
      }
    }
  }

  fun pair(link: String) {
    if (mutableState.value.pairing) return
    val oldProfile = mutableState.value.profile
    if (oldProfile != null && gatewayMutationBusy()) {
      mutableState.update { it.copy(gatewayError = "GATEWAY_OPERATION_BUSY") }
      return
    }
    mutableState.update { it.copy(pairing = true, confirmationCode = null, error = null) }
    pairingJob = viewModelScope.launch {
      var quiesced = false
      try {
        if (oldProfile != null) { quiesceGateway(); quiesced = true }
        val profile = runInterruptible(Dispatchers.IO) {
          session.pair(link) { code -> mutableState.update { it.copy(confirmationCode = code) } }
        }
        adoptGateway(profile)
        createConversation()
      } catch (error: CancellationException) {
        mutableState.update { it.copy(pairing = false, confirmationCode = null) }
        if (quiesced && session.currentProfile()?.gatewayId == oldProfile?.gatewayId) {
          connectRealtime(); loadConversations()
        }
        throw error
      } catch (error: Exception) {
        val known = setOf("INVALID_INVITATION", "INVALID_SECURE_ORIGIN", "PAIRING_EXPIRED", "PAIRING_REJECTED",
          "PAIRING_CANCELLED", "PAIRING_ALREADY_PENDING", "GATEWAY_IDENTITY_MISMATCH", "NO_VERIFIED_ROUTE")
        mutableState.update { it.copy(pairing = false, confirmationCode = null,
          error = error.message?.takeIf(known::contains) ?: "PAIRING_FAILED") }
        if (quiesced && session.currentProfile()?.gatewayId == oldProfile?.gatewayId) {
          connectRealtime(); loadConversations()
          mutableState.value.selectedConversationId?.let(::selectConversation)
        }
      } finally {
        pairingJob = null
      }
    }
  }

  fun cancelPairing() {
    if (!mutableState.value.pairing || cancelPairingJob?.isActive == true) return
    val active = pairingJob
    cancelPairingJob = viewModelScope.launch {
      try {
        active?.cancelAndJoin()
        withContext(Dispatchers.IO) { session.cancelPairing() }
        mutableState.update { it.copy(pairing = false, confirmationCode = null, error = null) }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        mutableState.update { it.copy(pairing = false, confirmationCode = null,
          error = "PAIRING_CANCEL_FAILED") }
      } finally { cancelPairingJob = null }
    }
  }

  fun loadConversations(search: String = listSearch) {
    if (mutableState.value.profile == null) return
    listSearch = search.trim()
    val query = listSearch
    remoteConversationOffset = 0
    val revision = ++listRevision
    mutableState.update { it.copy(conversationsLoading = true, conversationsLoadingMore = false,
      conversationsHasMore = false, conversationsMoreError = false, chatError = false) }
    viewModelScope.launch {
      try {
        val result = runInterruptible(Dispatchers.IO) { conversations.list(search = query) }
        if (revision == listRevision) {
          remoteConversationOffset = result.remoteCount
          mutableState.update { it.copy(conversations = result.items, conversationTaskGroups = result.taskGroups,
            conversationsLoading = false,
            conversationsHasMore = result.hasMore) }
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (revision == listRevision) mutableState.update { it.copy(conversationsLoading = false, chatError = true) }
      }
    }
  }

  fun updateConversationSearch(text: String) {
    if (text == mutableState.value.conversationSearch) return
    searchJob?.cancel()
    listSearch = text.trim()
    remoteConversationOffset = 0
    listRevision++
    mutableState.update { it.copy(conversationSearch = text, conversationsLoading = true,
      conversationsLoadingMore = false, conversationsHasMore = false,
      conversationsMoreError = false, chatError = false) }
    searchJob = viewModelScope.launch {
      delay(250)
      loadConversations(text)
    }
  }

  fun loadMoreConversations() {
    val current = mutableState.value
    if (current.profile == null || current.conversationsLoading || current.conversationsLoadingMore || !current.conversationsHasMore) return
    val revision = listRevision
    val offset = remoteConversationOffset
    val search = listSearch
    mutableState.update { it.copy(conversationsLoadingMore = true, conversationsMoreError = false) }
    viewModelScope.launch {
      try {
        val page = runInterruptible(Dispatchers.IO) { conversations.list(search, offset) }
        if (revision == listRevision) {
          remoteConversationOffset = offset + page.remoteCount
          mutableState.update { state ->
            val seen = state.conversations.mapTo(mutableSetOf()) { it.id }
            state.copy(conversations = state.conversations + page.items.filter { seen.add(it.id) },
              conversationTaskGroups = state.conversationTaskGroups + page.taskGroups,
              conversationsLoadingMore = false, conversationsHasMore = page.hasMore)
          }
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (revision == listRevision) mutableState.update { it.copy(conversationsLoadingMore = false, conversationsMoreError = true) }
      }
    }
  }

  fun selectConversation(id: String) = selectConversationScoped(id, null)

  fun beginConversationShare(id: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    if (current.conversationShareBusy || current.conversations.none { it.id == id && !it.isLocalDraft }) return
    mutableState.update { it.copy(conversationShareBusy = true, conversationShareError = false,
      conversationSharePreview = null, conversationShareResult = null) }
    viewModelScope.launch {
      try {
        val preview = runInterruptible(Dispatchers.IO) { conversations.sharePreview(id) }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(conversationShareBusy = false, conversationSharePreview = preview)
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(conversationShareBusy = false, conversationShareError = true)
        }
      }
    }
  }

  fun confirmConversationShare() {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val preview = current.conversationSharePreview ?: return
    if (current.conversationShareBusy) return
    mutableState.update { it.copy(conversationShareBusy = true, conversationShareError = false,
      conversationSharePreview = null) }
    viewModelScope.launch {
      try {
        val result = runInterruptible(Dispatchers.IO) { conversations.share(preview) }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(conversationShareBusy = false, conversationShareResult = result)
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(conversationShareBusy = false, conversationShareError = true)
        }
      }
    }
  }

  fun dismissConversationShare() {
    if (!mutableState.value.conversationShareBusy) mutableState.update { it.copy(
      conversationSharePreview = null, conversationShareError = false, conversationShareResult = null) }
  }

  fun selectTaskChildConversation(taskId: String, conversationId: String) {
    val available = mutableState.value.conversationTaskGroups.values.any { group ->
      group.items.any { it.taskId == taskId && it.activeConversationId == conversationId }
    }
    if (available) selectConversationScoped(conversationId, taskId)
  }

  private fun selectConversationScoped(id: String, taskId: String?) {
    if (mutableState.value.profile == null || mutableState.value.discardingDraftId == id ||
      mutableState.value.pendingDeleteId == id) return
    historyJob?.cancel()
    olderHistoryJob?.cancel()
    executionJob?.cancel()
    executionRevision++
    runStateJob?.cancel()
    modelJob?.cancel()
    agentJob?.cancel()
    contextJob?.cancel()
    contextRevision++
    contextPanelJob?.cancel()
    contextPanelRevision++
    connectionWaitJob?.cancel()
    connectionWaitRevision++
    referenceJob?.cancel()
    referenceRevision++
    realtime.watchRun(null)
    val revision = ++historyRevision
    mutableState.update { it.copy(selectedConversationId = id, taskConversationTaskId = taskId,
      requestedReferenceKind = null, requestedReferenceConversationId = null,
      taskScopeLoading = taskId == null, messages = emptyList(), draftText = "", draftRefs = emptyList(),
      draftAttachments = emptyList(), attachmentLoading = false, attachmentError = false, historyLoading = true,
      historyTranscriptId = null, historyBefore = null, historyLoadingOlder = false,
      historyOlderError = false,
      executionMessageId = null, executionDetail = null, executionLoading = false, executionError = false,
      draftModelLoading = false, draftModelReady = false, chatError = false, activeRunId = null,
      stoppingRun = false, stopError = false, runError = false, liveText = "", liveMessageId = null,
      pendingInput = null, sendError = false, sendErrorDetail = null, sendRejected = false,
      referencePicker = ReferencePickerUiState(),
      contextPanel = ContextPanelUiState()) }
    mutableState.update { it.copy(models = emptyList(), selectedModelId = "", modelConfigVersion = null,
      modelsLoading = false, modelSaving = false, modelError = false, agents = emptyList(),
      selectedAgentId = "", agentsLoading = false, agentError = false) }
    mutableState.update { it.copy(context = null, contextLoading = false, contextError = false,
      connectionWait = ConnectionWaitUiState(it.profile?.gatewayId, id),
      taskWelcome = null, projectWelcome = null) }
    historyJob = viewModelScope.launch {
      try {
        draftWriteJob?.join()
        refWriteJob?.join()
        val restored = runInterruptible(Dispatchers.IO) {
          session.saveMainConversationId(id)
          RestoredComposer(conversations.draft(id), conversations.composerDraft(id),
            conversations.composerRefs(id), conversations.composerAttachments(id), conversations.pendingInput(id))
        }
        val (local, composer, refs, attachments, pending) = restored
        if (revision == historyRevision) mutableState.update {
          it.copy(draftText = composer, draftRefs = refs, draftAttachments = attachments, pendingInput = pending,
            taskConversationTaskId = taskId ?: pending?.taskId,
            taskScopeLoading = local == null && taskId == null && pending?.taskId == null,
            selectedAgentId = local?.agentId.orEmpty())
        }
        if (local != null) {
          if (revision == historyRevision) mutableState.update { it.copy(historyLoading = false,
            draftModelLoading = local.model.isBlank(), draftModelReady = local.model.isNotBlank()) }
          if (local.model.isBlank()) {
            runInterruptible(Dispatchers.IO) { conversations.prepareDraftModel(id) }
            if (revision == historyRevision) mutableState.update { it.copy(draftModelLoading = false, draftModelReady = true) }
          }
          if (revision == historyRevision) loadModels(id)
          if (revision == historyRevision) loadAgents(id)
        } else {
          val history = runInterruptible(Dispatchers.IO) { conversations.history(id) }
          if (revision == historyRevision) mutableState.update { it.copy(messages = history.messages,
            historyLoading = false, draftModelReady = true,
            historyTranscriptId = history.transcriptId,
            historyBefore = history.nextBeforeCursor?.takeIf { _ -> history.transcriptId != null },
            selectedAgentId = history.agentId ?: it.conversations.firstOrNull { item -> item.id == id }?.agentId.orEmpty()) }
          if (revision == historyRevision) refreshRunState(id)
          if (revision == historyRevision) loadModels(id)
          if (revision == historyRevision) loadAgents(id)
          if (revision == historyRevision) loadContext()
          if (revision == historyRevision) refreshConnectionWait()
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (revision == historyRevision) mutableState.update { it.copy(historyLoading = false,
          draftModelLoading = false, taskScopeLoading = false, chatError = true) }
      }
    }
  }

  fun loadOlderHistory() {
    val current = mutableState.value
    val id = current.selectedConversationId ?: return
    val transcriptId = current.historyTranscriptId ?: return
    val before = current.historyBefore ?: return
    if (current.historyLoading || current.historyLoadingOlder || current.profile == null) return
    val revision = historyRevision
    mutableState.update { it.copy(historyLoadingOlder = true, historyOlderError = false) }
    olderHistoryJob = viewModelScope.launch {
      try {
        val older = runInterruptible(Dispatchers.IO) { conversations.history(id, before) }
        if (revision != historyRevision) return@launch
        mutableState.update { state ->
          if (state.selectedConversationId != id || state.historyTranscriptId != transcriptId ||
            state.historyBefore != before) state
          else if (older.transcriptId != transcriptId || older.nextBeforeCursor == before) {
            state.copy(historyLoadingOlder = false, historyOlderError = true)
          } else {
            val existing = state.messages.mapTo(mutableSetOf()) { it.id }
            state.copy(messages = older.messages.filter { existing.add(it.id) } + state.messages,
              historyBefore = older.nextBeforeCursor, historyLoadingOlder = false,
              historyOlderError = false)
          }
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (revision == historyRevision) mutableState.update { state ->
          if (state.selectedConversationId == id && state.historyBefore == before)
            state.copy(historyLoadingOlder = false, historyOlderError = true) else state
        }
      }
    }
  }

  fun openExecution(messageId: String) {
    val current = mutableState.value
    val conversationId = current.selectedConversationId ?: return
    val message = current.messages.firstOrNull { it.id == messageId && it.role == "assistant" } ?: return
    val turnId = message.turnId ?: message.id
    mutableState.update { it.copy(executionMessageId = messageId, executionDetail = null,
      executionLoading = false, executionError = false) }
    loadExecution(conversationId, messageId, turnId)
  }

  fun saveMessageAsNote(messageId: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val conversationId = current.selectedConversationId ?: return
    val message = current.messages.firstOrNull { it.id == messageId && it.role == "assistant" } ?: return
    if (current.savingMessageNoteId != null || message.text.isBlank()) return
    val text = message.text
    val mutationId = UUID.nameUUIDFromBytes(
      "$gatewayId:$conversationId:$messageId:$text".toByteArray(Charsets.UTF_8)).toString()
    mutableState.update { it.copy(savingMessageNoteId = messageId, messageNoteFeedback = null) }
    viewModelScope.launch {
      val saved = try {
        runInterruptible(Dispatchers.IO) { noteRepository.quickCaptureMessage(text, mutationId) }
        true
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { false }
      mutableState.update { state ->
        if (state.savingMessageNoteId != messageId) state
        else state.copy(savingMessageNoteId = null,
          messageNoteFeedback = if (state.profile?.gatewayId == gatewayId &&
            state.selectedConversationId == conversationId) MessageNoteFeedback(messageId, saved) else null)
      }
    }
  }

  fun messageNoteFeedbackHandled(feedback: MessageNoteFeedback) {
    mutableState.update { state ->
      if (state.messageNoteFeedback == feedback) state.copy(messageNoteFeedback = null) else state
    }
  }

  fun retryExecution() {
    val current = mutableState.value
    val conversationId = current.selectedConversationId ?: return
    val messageId = current.executionMessageId ?: return
    val message = current.messages.firstOrNull { it.id == messageId } ?: return
    val turnId = message.turnId ?: message.id
    loadExecution(conversationId, messageId, turnId)
  }

  fun closeExecution() {
    executionJob?.cancel()
    executionRevision++
    mutableState.update { it.copy(executionMessageId = null, executionDetail = null,
      executionLoading = false, executionError = false) }
  }

  suspend fun readMessageMedia(conversationId: String, media: ConversationMedia): ByteArray =
    withContext(Dispatchers.IO) { conversations.readMessageMedia(conversationId, media) }

  private fun loadExecution(conversationId: String, messageId: String, turnId: String) {
    executionJob?.cancel()
    val revision = ++executionRevision
    mutableState.update { it.copy(executionLoading = true, executionError = false) }
    executionJob = viewModelScope.launch {
      try {
        val detail = runInterruptible(Dispatchers.IO) { conversations.executionDetail(conversationId, turnId) }
        if (revision == executionRevision && mutableState.value.selectedConversationId == conversationId &&
          mutableState.value.executionMessageId == messageId) mutableState.update {
          it.copy(executionDetail = detail, executionLoading = false)
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (revision == executionRevision && mutableState.value.selectedConversationId == conversationId &&
          mutableState.value.executionMessageId == messageId) mutableState.update {
          it.copy(executionLoading = false, executionError = true)
        }
      }
    }
  }

  fun loadContext() {
    val id = mutableState.value.selectedConversationId ?: return
    contextJob?.cancel()
    val revision = ++contextRevision
    mutableState.update { it.copy(contextLoading = true, contextError = false,
      taskWelcome = null, projectWelcome = null) }
    contextJob = viewModelScope.launch {
      try {
        val result = runInterruptible(Dispatchers.IO) { conversations.context(id) }
        if (revision == contextRevision && mutableState.value.selectedConversationId == id) mutableState.update {
          val expectedTask = it.taskConversationTaskId
          if (expectedTask != null && result.task?.id != expectedTask) it.copy(
            contextLoading = false, contextError = true, taskScopeLoading = true)
          else it.copy(context = result, contextLoading = false, taskScopeLoading = false,
            taskConversationTaskId = result.task?.id)
        }
        val taskWelcome = result.task?.let { task ->
          try { runInterruptible(Dispatchers.IO) { conversations.taskWelcome(task) } }
          catch (error: CancellationException) { throw error }
          catch (_: Exception) { null }
        }
        val projectWelcome = if (result.task == null) result.project?.let { project ->
          try { runInterruptible(Dispatchers.IO) { conversations.projectWelcome(project) } }
          catch (error: CancellationException) { throw error }
          catch (_: Exception) { null }
        } else null
        if (revision == contextRevision && mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(taskWelcome = taskWelcome, projectWelcome = projectWelcome)
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (revision == contextRevision && mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(contextLoading = false, contextError = true, taskScopeLoading = true)
        }
      }
    }
  }

  fun loadContextPanel(mode: String, path: String = "", query: String = "") {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val conversationId = current.selectedConversationId ?: return
    if (mode !in setOf("project", "environment", "directory", "files") ||
      path.length > 4096 || query.length > 4096) return
    contextPanelJob?.cancel()
    val revision = ++contextPanelRevision
    mutableState.update { it.copy(contextPanel = ContextPanelUiState(gatewayId, conversationId,
      mode = mode, loading = true, filePath = path, fileQuery = query)) }
    contextPanelJob = viewModelScope.launch {
      try {
        val loaded = runInterruptible(Dispatchers.IO) {
          when (mode) {
            "project" -> ContextPanelUiState(gatewayId, conversationId, mode,
              projects = progressRepository.projects().filter { it.status != "archived" })
            "environment" -> ContextPanelUiState(gatewayId, conversationId, mode,
              environment = conversations.contextEnvironmentOptions(
                requireNotNull(current.context?.project?.id)))
            "directory" -> ContextPanelUiState(gatewayId, conversationId, mode,
              directories = conversations.contextDirectories(path))
            else -> {
              conversations.materialize(conversationId, "session_resources")
              val root = org.json.JSONObject(session.request(
                "/api/files/contexts/session/${java.net.URLEncoder.encode(conversationId, "UTF-8")}"))
              val spaceId = root.getJSONObject("space").getString("id")
              ContextPanelUiState(gatewayId, conversationId, mode,
                files = fileRepository.list(spaceId, path, query), filePath = path, fileQuery = query)
            }
          }
        }
        if (revision == contextPanelRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == conversationId) mutableState.update {
          it.copy(contextPanel = loaded)
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == contextPanelRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == conversationId) mutableState.update {
          it.copy(contextPanel = it.contextPanel.copy(loading = false, error = true))
        }
      }
    }
  }

  fun setContextDirectory() {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val id = current.selectedConversationId ?: return
    val path = current.contextPanel.directories?.currentPath ?: return
    if (current.context?.workingDirectoryLocked == true || current.contextPanel.saving ||
      current.contextPanel.loading || path.isBlank()) return
    contextPanelJob?.cancel()
    val revision = ++contextPanelRevision
    mutableState.update { it.copy(contextPanel = it.contextPanel.copy(saving = true, error = false)) }
    contextPanelJob = viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { conversations.setContextDirectory(id, path) }
        if (revision == contextPanelRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == id) {
          mutableState.update { it.copy(contextPanel = ContextPanelUiState()) }
          loadContext()
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == contextPanelRevision && mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(contextPanel = it.contextPanel.copy(saving = false, error = true))
        }
      }
    }
  }

  fun addContextFile(file: ManagedFile) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val id = current.selectedConversationId ?: return
    if (file.kind == "directory" || current.contextPanel.saving || current.sending ||
      current.pendingInput != null || current.draftAttachments.any {
        it.workspaceRelativePath == file.relativePath
      }) return
    if (file.size !in 1..(10 * 1024 * 1024) ||
      current.draftAttachments.sumOf { it.size.toLong() } + file.size > 20 * 1024 * 1024) {
      mutableState.update { it.copy(contextPanel = it.contextPanel.copy(error = true)) }
      return
    }
    contextPanelJob?.cancel()
    val revision = ++contextPanelRevision
    mutableState.update { it.copy(contextPanel = it.contextPanel.copy(saving = true, error = false)) }
    contextPanelJob = viewModelScope.launch {
      try {
        val attachment = runInterruptible(Dispatchers.IO) {
          conversations.addComposerFile(gatewayId, id, file)
        }
        if (revision == contextPanelRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(draftAttachments = it.draftAttachments + attachment,
            contextPanel = it.contextPanel.copy(saving = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == contextPanelRevision && mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(contextPanel = it.contextPanel.copy(saving = false, error = true))
        }
      }
    }
  }

  fun createContextConversation(projectId: String?, mode: String?) {
    val current = mutableState.value
    if (current.sending || current.historyLoading || current.pendingInput != null) return
    if (projectId == current.context?.project?.id &&
      (mode == null || mode == current.context?.environment?.kind)) return
    createConversationFor(current.selectedAgentId.ifBlank { current.defaultAgentId }, false,
      projectId = projectId, executionMode = mode)
  }

  fun refreshConnectionWait() {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val id = current.selectedConversationId ?: return
    if (current.historyLoading || current.connectionWait.loading) return
    connectionWaitJob?.cancel()
    val revision = ++connectionWaitRevision
    mutableState.update { it.copy(connectionWait = it.connectionWait.copy(gatewayId = gatewayId,
      conversationId = id, loading = it.connectionWait.snapshot == null, error = false)) }
    connectionWaitJob = viewModelScope.launch {
      try {
        val snapshot = runInterruptible(Dispatchers.IO) {
          if (conversations.draft(id) != null) null else connectionWaitRepository.snapshot(id)
        }
        if (revision == connectionWaitRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == id) mutableState.update {
          val previous = it.connectionWait.snapshot
          val accepted = if (snapshot != null && previous != null &&
            previous.transcriptId == snapshot.transcriptId && previous.revision > snapshot.revision) previous
          else snapshot
          it.copy(connectionWait = ConnectionWaitUiState(gatewayId, id, accepted))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == connectionWaitRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(connectionWait = it.connectionWait.copy(loading = false, error = true))
        }
      }
    }
  }

  fun loadAgents() {
    val id = mutableState.value.selectedConversationId ?: return
    loadAgents(id)
  }

  private fun loadAgents(id: String) {
    if (mutableState.value.selectedConversationId != id) return
    agentJob?.cancel()
    mutableState.update { it.copy(agentsLoading = true, agentError = false) }
    agentJob = viewModelScope.launch {
      try {
        val catalog = runInterruptible(Dispatchers.IO) { conversations.agents() }
        if (mutableState.value.selectedConversationId == id) mutableState.update { it.copy(
          agents = catalog.agents, defaultAgentId = catalog.defaultId, agentsLoading = false,
          selectedAgentId = it.selectedAgentId.ifBlank { catalog.defaultId }) }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(agentsLoading = false, agentError = true)
        }
      }
    }
  }

  fun loadModels() {
    val id = mutableState.value.selectedConversationId ?: return
    loadModels(id)
  }

  private fun loadModels(id: String) {
    if (mutableState.value.selectedConversationId != id) return
    modelJob?.cancel()
    mutableState.update { it.copy(modelsLoading = true, modelError = false) }
    modelJob = viewModelScope.launch {
      try {
        val agentId = mutableState.value.conversations.firstOrNull { it.id == id }?.agentId
        val selection = runInterruptible(Dispatchers.IO) { conversations.modelSelection(id, agentId) }
        if (mutableState.value.selectedConversationId == id) mutableState.update { it.copy(
          models = selection.models, selectedModelId = selection.selectedId,
          modelConfigVersion = selection.configVersion, modelsLoading = false) }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(modelsLoading = false, modelError = true)
        }
      }
    }
  }

  fun selectModel(modelId: String) {
    val current = mutableState.value
    val id = current.selectedConversationId ?: return
    val model = current.models.firstOrNull { it.id == modelId } ?: return
    if (current.modelSaving || current.modelsLoading || current.sending || current.activeRunId != null ||
      current.pendingInput != null || modelId == current.selectedModelId) return
    mutableState.update { it.copy(modelSaving = true, modelError = false) }
    viewModelScope.launch {
      try {
        val result = runInterruptible(Dispatchers.IO) { conversations.setModel(id, model, current.modelConfigVersion) }
        if (mutableState.value.selectedConversationId == id) mutableState.update { it.copy(
          selectedModelId = result.selectedId, modelConfigVersion = result.configVersion,
          modelSaving = false, modelError = false) }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (mutableState.value.selectedConversationId == id) {
          mutableState.update { it.copy(modelSaving = false, modelError = true) }
        }
      }
    }
  }

  private fun refreshSelectedHistory(id: String) {
    if (mutableState.value.selectedConversationId != id || mutableState.value.draftModelLoading) return
    historyJob?.cancel()
    olderHistoryJob?.cancel()
    val revision = ++historyRevision
    mutableState.update { it.copy(historyLoadingOlder = false) }
    historyJob = viewModelScope.launch {
      try {
        val (history, pending) = runInterruptible(Dispatchers.IO) {
          (if (conversations.draft(id) != null) null else conversations.history(id)) to conversations.pendingInput(id)
        }
        if (revision == historyRevision) mutableState.update { state ->
          val overlap = history?.messages?.firstNotNullOfOrNull { latest ->
            state.messages.indexOfFirst { it.id == latest.id }.takeIf { it >= 0 }
          }
          val retainOlder = history != null && history.transcriptId != null &&
            history.transcriptId == state.historyTranscriptId && overlap != null
          state.copy(messages = when {
              history == null -> state.messages
              retainOlder -> state.messages.take(overlap) + history.messages
              else -> history.messages
            }, pendingInput = pending,
            historyTranscriptId = history?.transcriptId ?: state.historyTranscriptId,
            historyBefore = when {
              history == null || retainOlder -> state.historyBefore
              else -> history.nextBeforeCursor?.takeIf { _ -> history.transcriptId != null }
            }, historyLoadingOlder = false, historyOlderError = false,
            historyLoading = false, chatError = false)
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (revision == historyRevision) mutableState.update { it.copy(historyLoading = false, chatError = true) }
      }
    }
  }

  private fun refreshRunState(id: String) {
    if (mutableState.value.selectedConversationId != id) return
    runStateJob?.cancel()
    runStateJob = viewModelScope.launch {
      try {
        val runId = runInterruptible(Dispatchers.IO) { conversations.activeRun(id) }
        if (mutableState.value.selectedConversationId == id) {
          mutableState.update {
            it.copy(activeRunId = runId, stoppingRun = false, stopError = false,
              runError = if (runId != it.activeRunId) false else it.runError,
              liveText = if (runId == it.activeRunId) it.liveText else "",
              liveMessageId = if (runId == it.activeRunId) it.liveMessageId else null)
          }
          realtime.watchRun(runId)
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (mutableState.value.selectedConversationId == id) mutableState.update { it.copy(stopError = true) }
      }
    }
  }

  fun changeDraft(text: String) {
    val id = mutableState.value.selectedConversationId ?: return
    if (mutableState.value.pendingDeleteId == id) return
    if (text.length > 32_000) return
    mutableState.update { it.copy(draftText = text) }
    draftWriteJob?.cancel()
    draftWriteJob = viewModelScope.launch {
      try {
        delay(150)
        draftWriteLock.withLock {
          if (mutableState.value.selectedConversationId == id && mutableState.value.draftText == text) {
            withContext(Dispatchers.IO) { conversations.saveComposerDraft(id, text) }
          }
        }
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        Log.w("XopcAndroid", "Draft save failed: ${error.javaClass.simpleName}:${error.message}")
        mutableState.update { it.copy(chatError = true) }
      }
    }
  }

  fun reuseMessage(messageId: String): Boolean {
    val current = mutableState.value
    val message = current.messages.firstOrNull { it.id == messageId && it.role == "user" } ?: return false
    if (message.text.isBlank() || message.text.length > 32_000 || message.hasNonTextContent ||
      current.selectedConversationId == null ||
      current.sending || current.pendingInput != null || current.attachmentLoading ||
      current.draftAttachments.isNotEmpty() || current.draftRefs.isNotEmpty() ||
      current.pendingDeleteId == current.selectedConversationId) return false
    changeDraft(message.text)
    return true
  }

  fun regenerateMessage(messageId: String): Boolean {
    val current = mutableState.value
    val assistantIndex = current.messages.indexOfFirst { it.id == messageId && it.role == "assistant" }
    if (assistantIndex <= 0 || current.activeRunId != null || current.sending ||
      current.pendingInput != null || current.realtimeStatus != "connected") return false
    val source = current.messages.subList(0, assistantIndex).lastOrNull { it.role == "user" } ?: return false
    if (source.text.isBlank() || source.hasNonTextContent || source.text.length > 32_000) return false
    val id = current.selectedConversationId ?: return false
    return sendContent(id, source.text, refsOverride = emptyList(), attachmentsOverride = emptyList(),
      preserveDraft = true)
  }

  fun addDraftAttachment(gatewayId: String, conversationId: String, uri: Uri) =
    importDraftAttachment(gatewayId, conversationId, uri, captured = false)

  suspend fun previewDraftImage(conversationId: String, item: ChatAttachment): Bitmap? {
    if (mutableState.value.selectedConversationId != conversationId ||
      mutableState.value.profile == null) return null
    return withContext(Dispatchers.IO) {
      if (item.workspaceRelativePath == null || item.workspaceFileId == null ||
        !item.mimeType.startsWith("image/")) conversations.composerImagePreview(conversationId, item)
      else runCatching {
        val bytes = fileRepository.content(item.workspaceFileId)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) null else {
          var sample = 1
          while (bounds.outWidth / sample > 1024 || bounds.outHeight / sample > 1024) sample *= 2
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.RGB_565
          })
        }
      }.getOrNull()
    }
  }

  suspend fun previewQuickImage(item: ChatAttachment): Bitmap? {
    if (mutableState.value.profile == null) return null
    return withContext(Dispatchers.IO) { conversations.quickImagePreview(item) }
  }

  suspend fun speechChunk(text: String, language: String): ByteArray =
    withContext(Dispatchers.IO) { session.requestSpeech(text, language) }

  suspend fun transcribeAudio(bytes: ByteArray, language: String): String =
    withContext(Dispatchers.IO) { session.transcribeAudio(bytes, language) }

  suspend fun addVoiceDraftAttachment(bytes: ByteArray, durationSeconds: Int) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    val conversationId = current.selectedConversationId ?: throw IllegalStateException("NO_CONVERSATION")
    require(!current.sending && current.pendingInput == null && !current.attachmentLoading) {
      "COMPOSER_BUSY"
    }
    mutableState.update { it.copy(attachmentLoading = true, attachmentError = false) }
    try {
      val items = runInterruptible(Dispatchers.IO) {
        conversations.addComposerVoice(gatewayId, conversationId, bytes, durationSeconds)
        conversations.composerAttachments(conversationId)
      }
      if (mutableState.value.profile?.gatewayId == gatewayId &&
        mutableState.value.selectedConversationId == conversationId) mutableState.update {
        it.copy(draftAttachments = items, attachmentLoading = false)
      }
    } catch (failure: Exception) {
      mutableState.update { it.copy(attachmentLoading = false, attachmentError = true) }
      throw failure
    }
  }

  suspend fun sendVoiceRecording(bytes: ByteArray, durationSeconds: Int) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    val conversationId = current.selectedConversationId ?: throw IllegalStateException("NO_CONVERSATION")
    require(!current.sending && current.pendingInput == null && !current.attachmentLoading) {
      "COMPOSER_BUSY"
    }
    val attachment = runInterruptible(Dispatchers.IO) {
      conversations.addComposerVoice(gatewayId, conversationId, bytes, durationSeconds)
    }
    if (!sendContent(conversationId, "", refsOverride = emptyList(),
        attachmentsOverride = listOf(attachment), preserveDraft = true)) {
      throw IllegalStateException("COMPOSER_BUSY")
    }
  }

  fun addCapturedDraftAttachment(gatewayId: String, conversationId: String, uri: Uri) =
    importDraftAttachment(gatewayId, conversationId, uri, captured = true)

  private fun importDraftAttachment(gatewayId: String, conversationId: String, uri: Uri,
    captured: Boolean) {
    val current = mutableState.value
    if (current.profile?.gatewayId != gatewayId || current.selectedConversationId != conversationId ||
      current.attachmentLoading || current.sending || current.pendingInput != null) {
      if (captured) CameraCaptureStore.discard(getApplication(), uri)
      return
    }
    mutableState.update { it.copy(attachmentLoading = true, attachmentError = false) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) {
          conversations.addComposerAttachment(gatewayId, conversationId, uri)
        }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == conversationId) {
          val items = runInterruptible(Dispatchers.IO) { conversations.composerAttachments(conversationId) }
          mutableState.update { it.copy(draftAttachments = items, attachmentLoading = false) }
        }
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        Log.w("XopcAndroid", "Attachment import failed: ${error.javaClass.simpleName}:${error.message}")
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == conversationId) mutableState.update {
          it.copy(attachmentLoading = false, attachmentError = true)
        }
      } finally {
        if (captured) CameraCaptureStore.discard(getApplication(), uri)
      }
    }
  }

  fun removeDraftAttachment(attachmentId: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val conversationId = current.selectedConversationId ?: return
    if (current.sending || current.pendingInput != null || current.attachmentLoading ||
      current.draftAttachments.none { it.id == attachmentId }) return
    mutableState.update { it.copy(attachmentLoading = true, attachmentError = false) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) {
          conversations.removeComposerAttachment(gatewayId, conversationId, attachmentId)
        }
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == conversationId) mutableState.update {
          it.copy(draftAttachments = it.draftAttachments.filterNot { item -> item.id == attachmentId },
            attachmentLoading = false)
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == conversationId) mutableState.update {
          it.copy(attachmentLoading = false, attachmentError = true)
        }
      }
    }
  }

  fun loadReferences(kind: String, query: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    val conversationId = current.selectedConversationId ?: return
    if (kind !in setOf("note", "task") || query.length > 4096) return
    referenceJob?.cancel()
    val revision = ++referenceRevision
    val search = query.trim()
    mutableState.update { it.copy(referencePicker = ReferencePickerUiState(
      gatewayId = gatewayId, conversationId = conversationId, kind = kind, query = search,
      loading = true)) }
    referenceJob = viewModelScope.launch {
      try {
        val items = runInterruptible(Dispatchers.IO) {
          if (kind == "note") noteRepository.list(search, limit = 50).items
            .filter { it.status != "trashed" }
            .map { ReferencePickerItem("note", it.id,
              it.title.ifBlank { it.snippet }.take(300), it.snippet.take(300),
              it.updatedAt.toString()) }
          else progressRepository.tasks(search = search).items.map {
            ReferencePickerItem("task", it.id, it.title.take(300), it.body.take(300),
              it.version.takeIf { version -> version > 0 }?.toString().orEmpty())
          }
        }
        if (revision == referenceRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == conversationId) mutableState.update {
          it.copy(referencePicker = it.referencePicker.copy(items = items, loading = false))
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (revision == referenceRevision && mutableState.value.profile?.gatewayId == gatewayId &&
          mutableState.value.selectedConversationId == conversationId) mutableState.update {
          it.copy(referencePicker = it.referencePicker.copy(loading = false, error = true))
        }
      }
    }
  }

  fun addDraftRef(item: ReferencePickerItem): Boolean {
    val current = mutableState.value
    val id = current.selectedConversationId ?: return false
    if (current.sending || current.pendingInput != null || current.draftRefs.size >= 5 ||
      current.referencePicker.gatewayId != current.profile?.gatewayId ||
      current.referencePicker.conversationId != id || current.referencePicker.kind != item.kind ||
      current.referencePicker.items.none { it == item } ||
      current.draftRefs.any { it.kind == item.kind && it.sourceId == item.id }) return false
    val refs = current.draftRefs + ConversationContextRef(item.kind, item.id, item.version, item.title)
    if (runCatching { ConversationRepository.contextRefsJson(refs) }.isFailure) return false
    persistDraftRefs(id, refs, current.draftRefs)
    return true
  }

  fun removeDraftRef(kind: String, sourceId: String) {
    val current = mutableState.value
    val id = current.selectedConversationId ?: return
    if (current.sending || current.pendingInput != null) return
    val refs = current.draftRefs.filterNot { it.kind == kind && it.sourceId == sourceId }
    if (refs == current.draftRefs) return
    persistDraftRefs(id, refs, current.draftRefs)
  }

  private fun persistDraftRefs(id: String, refs: List<ConversationContextRef>,
    previous: List<ConversationContextRef>) {
    mutableState.update { it.copy(draftRefs = refs) }
    refWriteJob?.cancel()
    refWriteJob = viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { conversations.saveComposerRefs(id, refs) }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { if (mutableState.value.selectedConversationId == id)
        mutableState.update { it.copy(chatError = true, draftRefs = previous) } }
    }
  }

  fun startUnderstandingChat(item: PersonalAssertion?) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    if (current.creatingConversation) return
    val prompt = getApplication<Application>().getString(if (item == null)
      R.string.about_you_chat_general_prompt else R.string.about_you_chat_item_prompt)
    val refs = item?.let { listOf(ConversationContextRef("user_assertion", it.id,
      it.recordedAt.toString(), it.statement.take(300))) } ?: emptyList()
    mutableState.update { it.copy(creatingConversation = true,
      personal = it.personal.copy(understandingChatError = false)) }
    viewModelScope.launch {
      try {
        draftWriteJob?.join()
        val draft = runInterruptible(Dispatchers.IO) {
          conversations.createDraft(current.defaultAgentId).also {
            conversations.saveComposerDraft(it.conversationId, prompt)
            conversations.saveComposerRefs(it.conversationId, refs)
          }
        }
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          mutableState.update { it.copy(creatingConversation = false) }
          selectConversation(draft.conversationId)
          mutableState.update { it.copy(quickOpenedConversationId = draft.conversationId) }
          loadConversations()
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(creatingConversation = false,
            personal = it.personal.copy(understandingChatError = true))
        }
      }
    }
  }

  fun createConversation() {
    createConversationFor(mutableState.value.selectedAgentId.ifBlank { mutableState.value.defaultAgentId }, false)
  }

  fun createProjectConversation(projectId: String) {
    val current = mutableState.value
    val project = current.progress.project
    if (project?.id != projectId ||
      !projectId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) return
    createConversationFor(project.defaultAgentId?.takeIf(String::isNotBlank) ?: "main", false,
      projectId = projectId,
      executionMode = if (project.workspaceRoot.isNullOrBlank()) null else project.executionMode)
  }

  fun createConversationForReference(kind: String) {
    if (kind !in setOf("note", "task")) return
    createConversationFor(mutableState.value.selectedAgentId.ifBlank { mutableState.value.defaultAgentId },
      false, kind)
  }

  fun referenceRequestHandled(conversationId: String, kind: String) {
    mutableState.update { current ->
      if (current.requestedReferenceConversationId == conversationId &&
        current.requestedReferenceKind == kind) current.copy(
        requestedReferenceConversationId = null, requestedReferenceKind = null)
      else current
    }
  }

  fun changeQuickDraft(text: String) {
    if (text.length > 4_000 || mutableState.value.quickSending) return
    mutableState.update { it.copy(quickDraftText = text, quickError = false) }
    quickDraftWriteJob?.cancel()
    quickDraftWriteJob = viewModelScope.launch {
      try {
        delay(150)
        runInterruptible(Dispatchers.IO) { conversations.saveQuickDraft(text) }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        mutableState.update { it.copy(quickError = true) }
      }
    }
  }

  fun addQuickAttachment(gatewayId: String, uri: Uri) =
    importQuickAttachment(gatewayId, uri, captured = false)

  fun addCapturedQuickAttachment(gatewayId: String, uri: Uri) =
    importQuickAttachment(gatewayId, uri, captured = true)

  private fun importQuickAttachment(gatewayId: String, uri: Uri, captured: Boolean) {
    val current = mutableState.value
    if (current.profile?.gatewayId != gatewayId || current.quickAttachmentLoading ||
      current.quickSending || current.quickAttachments.size >= 10) {
      if (captured) CameraCaptureStore.discard(getApplication(), uri)
      return
    }
    mutableState.update { it.copy(quickAttachmentLoading = true, quickAttachmentError = false) }
    quickAttachmentJob = viewModelScope.launch {
      try {
        val items = runInterruptible(Dispatchers.IO) {
          conversations.addQuickAttachment(gatewayId, uri)
          conversations.quickAttachments()
        }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(quickAttachments = items, quickAttachmentLoading = false)
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(quickAttachmentLoading = false, quickAttachmentError = true)
        }
      } finally {
        if (captured) CameraCaptureStore.discard(getApplication(), uri)
      }
    }
  }

  fun removeQuickAttachment(id: String) {
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    if (current.quickAttachmentLoading || current.quickSending ||
      current.quickAttachments.none { it.id == id }) return
    mutableState.update { it.copy(quickAttachmentLoading = true, quickAttachmentError = false) }
    quickAttachmentJob = viewModelScope.launch {
      try {
        val items = runInterruptible(Dispatchers.IO) {
          conversations.removeQuickAttachment(gatewayId, id)
          conversations.quickAttachments()
        }
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(quickAttachments = items, quickAttachmentLoading = false)
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        if (mutableState.value.profile?.gatewayId == gatewayId) mutableState.update {
          it.copy(quickAttachmentLoading = false, quickAttachmentError = true)
        }
      }
    }
  }

  fun submitQuickDraft() {
    val current = mutableState.value
    val content = current.quickDraftText.trim()
    if (current.profile == null || (content.isEmpty() && current.quickAttachments.isEmpty()) ||
      current.quickAttachmentLoading || current.quickSending || current.creatingConversation ||
      current.sending || current.realtimeStatus != "connected") return
    mutableState.update { it.copy(quickSending = true, quickError = false) }
    viewModelScope.launch {
      var stagedId: String? = null
      try {
        quickDraftWriteJob?.cancelAndJoin()
        val draft = runInterruptible(Dispatchers.IO) {
          conversations.saveQuickDraft(content)
          val created = conversations.stageQuickDraft(current.defaultAgentId, content)
          stagedId = created.conversationId
          conversations.prepareDraftModel(created.conversationId)
        }
        mutableState.update { it.copy(quickDraftText = "", quickSending = false,
          quickAttachments = emptyList(), quickOpenedConversationId = draft.conversationId) }
        selectConversation(draft.conversationId)
        historyJob?.join()
        mutableState.update { it.copy(draftModelReady = true) }
        loadConversations()
        if (!sendContent(draft.conversationId, content, modelPrepared = true)) {
          mutableState.update { it.copy(sendError = true) }
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        mutableState.update { it.copy(quickSending = false, quickError = true,
          quickDraftText = if (stagedId != null) "" else it.quickDraftText,
          quickAttachments = if (stagedId != null) emptyList() else it.quickAttachments,
          quickOpenedConversationId = stagedId ?: it.quickOpenedConversationId) }
        stagedId?.let(::selectConversation)
        loadConversations()
      }
    }
  }

  fun quickNavigationHandled(id: String) {
    mutableState.update { if (it.quickOpenedConversationId == id) it.copy(quickOpenedConversationId = null) else it }
  }

  fun discardLocalDraft(id: String) {
    val current = mutableState.value
    if (current.profile == null || current.discardingDraftId != null || current.creatingConversation ||
      current.sending || current.conversations.none { it.id == id && it.isLocalDraft }) return
    mutableState.update { it.copy(discardingDraftId = id, discardDraftError = false) }
    viewModelScope.launch {
      try {
        if (mutableState.value.selectedConversationId == id) {
          draftWriteJob?.cancelAndJoin()
          historyJob?.cancelAndJoin()
          historyRevision++
        }
        runInterruptible(Dispatchers.IO) {
          conversations.discardDraft(id)
          session.clearMainConversationId(id)
        }
        if (mutableState.value.selectedConversationId == id) {
          runStateJob?.cancel()
          modelJob?.cancel()
          agentJob?.cancel()
          contextJob?.cancel()
          contextRevision++
          realtime.watchRun(null)
          mutableState.update { it.copy(selectedConversationId = null, messages = emptyList(), draftText = "",
            historyLoading = false, draftModelLoading = false, draftModelReady = true,
            activeRunId = null, liveText = "", liveMessageId = null, pendingInput = null,
            models = emptyList(), selectedModelId = "", agents = emptyList(), selectedAgentId = "",
            context = null, contextLoading = false, taskWelcome = null, projectWelcome = null) }
        }
        mutableState.update { it.copy(discardingDraftId = null) }
        loadConversations()
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        mutableState.update { it.copy(discardingDraftId = null, discardDraftError = true) }
        if (mutableState.value.selectedConversationId == id) selectConversation(id)
      }
    }
  }

  fun beginRename(id: String) {
    val current = mutableState.value
    val item = current.conversations.firstOrNull { it.id == id && !it.isLocalDraft } ?: return
    if (current.renamingConversation) return
    mutableState.update { it.copy(renameDraftId = id, renameDraftText = item.title, renameError = false) }
  }

  fun changeRenameDraft(text: String) {
    if (text.length > 200 || mutableState.value.renamingConversation) return
    mutableState.update { it.copy(renameDraftText = text, renameError = false) }
  }

  fun cancelRename() {
    if (mutableState.value.renamingConversation) return
    mutableState.update { it.copy(renameDraftId = null, renameDraftText = "", renameError = false) }
  }

  fun saveRename() {
    val current = mutableState.value
    val id = current.renameDraftId ?: return
    val name = current.renameDraftText.trim()
    if (current.profile == null || current.renamingConversation || name.isEmpty()) return
    mutableState.update { it.copy(renamingConversation = true, renameError = false) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { conversations.rename(id, name) }
        mutableState.update { it.copy(renamingConversation = false, renameDraftId = null,
          renameDraftText = "", conversations = it.conversations.map { item ->
            if (item.id == id) item.copy(title = name) else item
          }) }
        loadConversations()
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        mutableState.update { it.copy(renamingConversation = false, renameError = true) }
      }
    }
  }

  fun togglePin(id: String) {
    val current = mutableState.value
    val item = current.conversations.firstOrNull { it.id == id && !it.isLocalDraft } ?: return
    if (current.profile == null || current.pinningConversationId != null || current.archivingConversationId != null ||
      current.renamingConversation) return
    val pinned = item.status != "pinned"
    mutableState.update { it.copy(pinningConversationId = id, pinActionError = false) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { conversations.setPinned(id, pinned) }
        mutableState.update { it.copy(pinningConversationId = null,
          conversations = it.conversations.map { row ->
            if (row.id == id) row.copy(status = if (pinned) "pinned" else "active") else row
          }) }
        loadConversations()
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        mutableState.update { it.copy(pinningConversationId = null, pinActionError = true) }
      }
    }
  }

  fun toggleArchive(id: String) {
    val current = mutableState.value
    val item = current.conversations.firstOrNull { it.id == id && !it.isLocalDraft } ?: return
    if (current.profile == null || current.archivingConversationId != null || current.pinningConversationId != null ||
      current.renamingConversation) return
    val archived = item.status != "archived"
    mutableState.update { it.copy(archivingConversationId = id, archiveActionError = false) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { conversations.setArchived(id, archived) }
        mutableState.update { it.copy(archivingConversationId = null,
          conversations = it.conversations.map { row ->
            if (row.id == id) row.copy(status = if (archived) "archived" else "active") else row
          }) }
        loadConversations()
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        mutableState.update { it.copy(archivingConversationId = null, archiveActionError = true) }
      }
    }
  }

  fun batchConversations(ids: List<String>, action: String) {
    if (action !in setOf("pin", "archive", "delete")) return
    val current = mutableState.value
    val gatewayId = current.profile?.gatewayId ?: return
    if (current.batchConversationBusy || current.pendingDeleteId != null || current.deleteCommitting ||
      current.pinningConversationId != null || current.archivingConversationId != null ||
      current.renamingConversation || current.sending) return
    val targets = ids.distinct().mapNotNull { id ->
      current.conversations.firstOrNull { it.id == id && !it.isLocalDraft }
    }
    if (targets.isEmpty() || (action == "delete" && targets.any {
      it.id == current.selectedConversationId && (current.activeRunId != null || current.pendingInput != null)
    })) return
    mutableState.update { it.copy(batchConversationBusy = true, batchConversationFailedIds = emptyList()) }
    viewModelScope.launch {
      val failed = mutableListOf<String>()
      val completed = mutableListOf<String>()
      try {
        for (item in targets) {
          if (mutableState.value.profile?.gatewayId != gatewayId) break
          try {
            runInterruptible(Dispatchers.IO) {
              when (action) {
                "pin" -> if (item.status != "pinned") conversations.setPinned(item.id, true)
                "archive" -> conversations.setArchived(item.id, item.status != "archived")
                else -> conversations.delete(item.id)
              }
            }
            completed += item.id
          } catch (error: CancellationException) { throw error }
          catch (_: Exception) { failed += item.id }
        }
        if (mutableState.value.profile?.gatewayId == gatewayId) {
          if (action == "delete" && mutableState.value.selectedConversationId in completed) {
            val selectedId = mutableState.value.selectedConversationId!!
            runCatching { runInterruptible(Dispatchers.IO) { session.clearMainConversationId(selectedId) } }
            realtime.watchRun(null)
            mutableState.update { it.copy(selectedConversationId = null, messages = emptyList(),
              draftText = "", draftRefs = emptyList(), draftAttachments = emptyList(),
              activeRunId = null, liveText = "", pendingInput = null) }
          }
          mutableState.update { state -> state.copy(
            conversations = state.conversations.filterNot { it.id in completed && action == "delete" }
              .map { row -> if (row.id !in completed) row else row.copy(status = when (action) {
                "pin" -> "pinned"
                "archive" -> if (row.status == "archived") "active" else "archived"
                else -> row.status
              }) },
            batchConversationBusy = false, batchConversationFailedIds = failed,
            batchConversationRevision = state.batchConversationRevision + 1) }
          // Keep failed rows from later pages visible until the user retries or changes the list.
          if (failed.isEmpty()) loadConversations()
        }
      } catch (error: CancellationException) {
        mutableState.update { it.copy(batchConversationBusy = false) }
        throw error
      }
    }
  }

  fun scheduleDelete(id: String) {
    val current = mutableState.value
    val item = current.conversations.firstOrNull { it.id == id && !it.isLocalDraft } ?: return
    if (current.profile == null || current.pendingDeleteId != null || current.pinningConversationId != null ||
      current.archivingConversationId != null || current.renamingConversation || current.sending ||
      (current.selectedConversationId == id &&
        (current.activeRunId != null || current.pendingInput != null))) return
    mutableState.update { it.copy(pendingDeleteId = item.id, deleteActionError = false) }
    deleteJob = viewModelScope.launch {
      try {
        delay(5_000)
        mutableState.update { it.copy(deleteCommitting = true) }
        runInterruptible(Dispatchers.IO) { conversations.delete(id) }
        try {
          runInterruptible(Dispatchers.IO) { session.clearMainConversationId(id) }
        } catch (error: CancellationException) {
          throw error
        } catch (error: Exception) {
          Log.w("XopcAndroid", "Deleted conversation selection cleanup failed: ${error.javaClass.simpleName}")
        }
        if (mutableState.value.selectedConversationId == id) {
          historyJob?.cancel()
          executionJob?.cancel()
          executionRevision++
          runStateJob?.cancel()
          modelJob?.cancel()
          agentJob?.cancel()
          contextJob?.cancel()
          historyRevision++
          contextRevision++
          realtime.watchRun(null)
          mutableState.update { it.copy(selectedConversationId = null, messages = emptyList(), draftText = "",
            executionMessageId = null, executionDetail = null, executionLoading = false, executionError = false,
            historyLoading = false, activeRunId = null, liveText = "", liveMessageId = null,
            pendingInput = null, models = emptyList(), selectedModelId = "", agents = emptyList(),
            selectedAgentId = "", context = null, contextLoading = false,
            taskWelcome = null, projectWelcome = null) }
        }
        mutableState.update { it.copy(pendingDeleteId = null, deleteCommitting = false,
          conversations = it.conversations.filterNot { row -> row.id == id }) }
        loadConversations()
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        mutableState.update { it.copy(pendingDeleteId = null, deleteCommitting = false, deleteActionError = true) }
      }
    }
  }

  fun undoDelete() {
    val current = mutableState.value
    if (current.pendingDeleteId == null || current.deleteCommitting) return
    deleteJob?.cancel()
    mutableState.update { it.copy(pendingDeleteId = null) }
  }

  fun switchAgent(agentId: String, discardCurrentDraft: Boolean) {
    if (mutableState.value.agents.none { it.id == agentId }) return
    createConversationFor(agentId, discardCurrentDraft)
  }

  private fun createConversationFor(agentId: String, discardCurrentDraft: Boolean,
    referenceKind: String? = null, projectId: String? = null, executionMode: String? = null) {
    if (mutableState.value.profile == null || mutableState.value.creatingConversation) return
    val previousId = mutableState.value.selectedConversationId
    mutableState.update { it.copy(creatingConversation = true, chatError = false) }
    viewModelScope.launch {
      try {
        draftWriteJob?.join()
        val draft = runInterruptible(Dispatchers.IO) {
          val created = conversations.createDraft(agentId, projectId, executionMode)
          if (discardCurrentDraft && previousId != null) conversations.saveComposerDraft(previousId, "")
          created
        }
        mutableState.update { current -> current.copy(creatingConversation = false,
          progress = if (projectId != null && current.progress.projectId == projectId)
            current.progress.copy(projectSessions = listOf(ProgressProjectSession(
              draft.conversationId, "", 0, isLocalDraft = true)) +
              current.progress.projectSessions.filterNot { it.id == draft.conversationId })
          else current.progress) }
        selectConversation(draft.conversationId)
        if (referenceKind != null && mutableState.value.selectedConversationId == draft.conversationId) {
          mutableState.update { it.copy(requestedReferenceKind = referenceKind,
            requestedReferenceConversationId = draft.conversationId) }
        }
        loadConversations()
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        mutableState.update { it.copy(creatingConversation = false, chatError = true) }
      }
    }
  }

  fun sendMessage() {
    val id = mutableState.value.selectedConversationId ?: return
    if (mutableState.value.pendingInput != null) return
    val content = mutableState.value.draftText
    sendContent(id, content)
  }

  fun retryPendingInput() {
    val current = mutableState.value
    val id = current.selectedConversationId ?: return
    val pending = current.pendingInput ?: return
    sendContent(id, pending.content)
  }

  private fun sendContent(id: String, content: String, modelPrepared: Boolean = false,
    refsOverride: List<ConversationContextRef>? = null,
    attachmentsOverride: List<ChatAttachment>? = null, preserveDraft: Boolean = false): Boolean {
    val refs = refsOverride ?: mutableState.value.pendingInput?.contextRefs ?: mutableState.value.draftRefs
    val attachments = attachmentsOverride ?: mutableState.value.pendingInput?.attachments ?: mutableState.value.draftAttachments
    if ((content.isBlank() && refs.isEmpty() && attachments.isEmpty()) ||
      mutableState.value.selectedConversationId != id || mutableState.value.sending ||
      mutableState.value.attachmentLoading ||
      mutableState.value.pendingDeleteId == id ||
      mutableState.value.taskScopeLoading ||
      (!modelPrepared && !mutableState.value.draftModelReady) ||
      mutableState.value.realtimeStatus != "connected") return false
    mutableState.update { it.copy(sending = true, sendError = false, sendErrorDetail = null, sendRejected = false) }
    viewModelScope.launch {
      try {
        draftWriteJob?.join()
        refWriteJob?.join()
        val taskId = mutableState.value.taskConversationTaskId
        val runId = runInterruptible(Dispatchers.IO) {
          if (taskId != null) conversations.sendTask(taskId, id, content, realtime.turnClaim(), refs, attachments)
          else conversations.send(id, content, realtime.turnClaim(), refs, attachments)
        }
        if (mutableState.value.selectedConversationId == id) {
          val clearDraft = !preserveDraft && mutableState.value.draftText == content
          if (clearDraft) runInterruptible(Dispatchers.IO) { conversations.saveComposerDraft(id, "") }
          mutableState.update { it.copy(sending = false, draftText = if (clearDraft) "" else it.draftText,
            draftRefs = if (clearDraft && it.draftRefs.map { ref -> ref.copy(title = "") } ==
              refs.map { ref -> ref.copy(title = "") }) emptyList() else it.draftRefs,
            draftAttachments = it.draftAttachments.filterNot { item -> attachments.any { sent -> sent.id == item.id } },
            pendingInput = null, activeRunId = runId.takeIf(String::isNotBlank),
            runError = false, liveText = "", liveMessageId = null) }
          realtime.watchRun(runId.takeIf(String::isNotBlank))
        } else mutableState.update { it.copy(sending = false) }
        refreshSelectedHistory(id)
        refreshRunState(id)
        loadModels(id)
        loadConversations()
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        Log.w("XopcAndroid", "Send failed: ${error.javaClass.simpleName}:${error.message}")
        val pending = try { runInterruptible(Dispatchers.IO) { conversations.pendingInput(id) } }
          catch (cancelled: CancellationException) { throw cancelled }
          catch (_: Exception) { null }
        if (mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(sending = false, sendError = true, pendingInput = pending,
            sendErrorDetail = (error as? GatewayHttpException)?.detail,
            sendRejected = error is GatewayHttpException && error.status in 400..499)
        }
      }
    }
    return true
  }

  fun stopRun() {
    val id = mutableState.value.selectedConversationId ?: return
    val runId = mutableState.value.activeRunId ?: return
    if (mutableState.value.stoppingRun) return
    mutableState.update { it.copy(stoppingRun = true, stopError = false) }
    viewModelScope.launch {
      try {
        runInterruptible(Dispatchers.IO) { conversations.abortRun(runId) }
        if (mutableState.value.selectedConversationId == id) {
          refreshRunState(id)
          refreshSelectedHistory(id)
        }
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        if (mutableState.value.selectedConversationId == id) mutableState.update {
          it.copy(stoppingRun = false, stopError = true)
        }
      }
    }
  }
}
