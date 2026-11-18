package ai.xopc.mobile.ui.main

import org.json.JSONObject

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.theme.CHAT_MESSAGE_WIDTH
import ai.xopc.mobile.theme.LocalChatColors
import ai.xopc.mobile.theme.LocalAttentionColors
import ai.xopc.mobile.gateway.ConversationAgent
import ai.xopc.mobile.gateway.ConversationHistoryScope
import ai.xopc.mobile.gateway.ClarificationCommand

import ai.xopc.mobile.gateway.ProgressTaskEdit

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.provider.Settings
import android.widget.Toast
import java.net.URI
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.CapabilityPage
import ai.xopc.mobile.gateway.ConversationSummary
import ai.xopc.mobile.gateway.ConversationTaskChild
import ai.xopc.mobile.gateway.ConversationTaskGroup
import ai.xopc.mobile.gateway.ConversationMedia
import ai.xopc.mobile.gateway.ConversationMessage
import ai.xopc.mobile.gateway.GeneratedMediaAccess
import ai.xopc.mobile.gateway.GeneratedMediaItem
import ai.xopc.mobile.gateway.GeneratedMediaKind
import ai.xopc.mobile.gateway.GeneratedMediaScope
import ai.xopc.mobile.playback.MusicPhase
import ai.xopc.mobile.playback.MusicPlayback
import ai.xopc.mobile.playback.MusicTrack
import ai.xopc.mobile.gateway.generatedMediaByReply
import ai.xopc.mobile.gateway.ConversationTarget
import ai.xopc.mobile.gateway.CameraCaptureStore
import ai.xopc.mobile.gateway.CameraTakePictureContract
import ai.xopc.mobile.gateway.ChatAttachment
import ai.xopc.mobile.gateway.ExecutionDetail
import ai.xopc.mobile.gateway.TaskWelcomeInfo
import ai.xopc.mobile.gateway.ProjectWelcomeInfo
import ai.xopc.mobile.gateway.ProgressHomeAction
import ai.xopc.mobile.gateway.NoteMetadataPatch
import ai.xopc.mobile.gateway.NoteAiPreview
import ai.xopc.mobile.gateway.VoiceCallConnection
import ai.xopc.mobile.gateway.ManagedFile
import ai.xopc.mobile.gateway.ManagedFileSpace
import ai.xopc.mobile.gateway.PersonalAssertion
import ai.xopc.mobile.gateway.PairingProtocol
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.Image
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.systemGestures
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.TextButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.produceState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.time.YearMonth
import java.util.Locale
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job

internal enum class HomeTab { Assistant, Conversations, Progress, Projects, Automations, Notes, Capabilities, Me }
private data class LinkedDetail(val source: HomeTab, val destination: HomeTab, val id: String)

private data class WelcomeRecommendation(val title: String, val reason: String, val prompt: String)

@Composable
private fun thinkingLevelLabel(level: String): String = stringResource(when (level) {
  "off" -> R.string.assistant_thinking_off
  "minimal" -> R.string.assistant_thinking_minimal
  "low" -> R.string.assistant_thinking_low
  "medium" -> R.string.assistant_thinking_medium
  "high" -> R.string.assistant_thinking_high
  "xhigh" -> R.string.assistant_thinking_xhigh
  "max" -> R.string.assistant_thinking_max
  "ultra" -> R.string.assistant_thinking_ultra
  else -> R.string.assistant_thinking_unknown
})

@Composable
private fun taskRecommendation(info: TaskWelcomeInfo?): WelcomeRecommendation? {
  if (info == null) return null
  val task = info.taskTitle
  return when {
    !info.attentionSummary.isNullOrBlank() -> WelcomeRecommendation(
      stringResource(R.string.welcome_task_attention_title, info.attentionSummary),
      stringResource(R.string.welcome_task_attention_reason, task),
      stringResource(R.string.welcome_task_attention_prompt, task, info.attentionSummary))
    !info.recentFailure.isNullOrBlank() -> WelcomeRecommendation(
      stringResource(R.string.welcome_task_failure_title, info.recentFailure),
      stringResource(R.string.welcome_task_failure_reason, task),
      stringResource(R.string.welcome_task_failure_prompt, task, info.recentFailure))
    info.phase == "review" || info.operationalState == "verifying" -> WelcomeRecommendation(
      stringResource(R.string.welcome_task_review_title),
      stringResource(R.string.welcome_task_review_reason, task),
      stringResource(R.string.welcome_task_review_prompt, task))
    info.phase == "closed" -> WelcomeRecommendation(
      stringResource(R.string.welcome_task_closed_title),
      stringResource(R.string.welcome_task_closed_reason, task),
      stringResource(R.string.welcome_task_closed_prompt, task))
    !info.nextAction.isNullOrBlank() -> WelcomeRecommendation(
      stringResource(R.string.welcome_task_next_title, info.nextAction),
      stringResource(R.string.welcome_task_next_reason, task),
      stringResource(R.string.welcome_task_next_prompt, task, info.nextAction))
    else -> null
  }
}

@Composable
private fun projectRecommendation(info: ProjectWelcomeInfo?): WelcomeRecommendation? {
  if (info == null) return null
  val project = info.projectName
  return when {
    !info.blockedReason.isNullOrBlank() -> WelcomeRecommendation(
      stringResource(R.string.welcome_project_blocked_title, info.blockedReason),
      stringResource(R.string.welcome_project_blocked_reason, project),
      stringResource(R.string.welcome_project_blocked_prompt, project, info.blockedReason))
    !info.recentFailure.isNullOrBlank() -> WelcomeRecommendation(
      stringResource(R.string.welcome_project_failure_title, info.recentFailure),
      stringResource(R.string.welcome_project_failure_reason, project),
      stringResource(R.string.welcome_project_failure_prompt, project, info.recentFailure))
    !info.recommendedAction.isNullOrBlank() -> WelcomeRecommendation(
      stringResource(R.string.welcome_project_next_title, info.recommendedAction),
      stringResource(R.string.welcome_project_next_reason, project),
      stringResource(R.string.welcome_project_next_prompt, project, info.recommendedAction))
    else -> null
  }
}

@Composable
private fun AssistantWelcome(viewportHeight: androidx.compose.ui.unit.Dp,
  recommendation: WelcomeRecommendation?, personalName: String?, standaloneDraft: Boolean,
  onChoose: (String) -> Unit) {
  Column(modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
    .heightIn(min = viewportHeight).padding(start = 8.dp, end = 8.dp,
      top = if (viewportHeight < 620.dp) 16.dp else 28.dp, bottom = 28.dp)
    .testTag("assistant-welcome"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically)) {
    if (personalName == null && !standaloneDraft) {
      LoopiIcon(extent = if (viewportHeight < 620.dp) 88.dp else 108.dp, active = true, interactive = true,
        modifier = Modifier.testTag("assistant-welcome-loopi"))
    } else if (standaloneDraft) {
      val mark = if (MaterialTheme.colorScheme.background.luminance() < 0.2f)
        R.drawable.sidebar_brand_dark else R.drawable.sidebar_brand_light
      Icon(painterResource(mark), null, Modifier.size(44.dp), tint = Color.Unspecified)
    }
    Text(when {
      personalName != null -> stringResource(R.string.personal_chat_greeting, personalName)
      standaloneDraft -> stringResource(R.string.chat_draft_greeting)
      else -> stringResource(R.string.assistant_welcome)
    }, fontSize = if (standaloneDraft) 26.sp else 20.sp, lineHeight = 28.sp,
      fontWeight = FontWeight.Medium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    if (personalName != null) Text(stringResource(R.string.personal_chat_invitation),
      color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    if (recommendation != null) {
      Card(onClick = { onChoose(recommendation.prompt) },
        modifier = Modifier.fillMaxWidth().testTag("assistant-welcome-recommendation")) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(recommendation.title, style = MaterialTheme.typography.titleMedium, maxLines = 2,
            overflow = TextOverflow.Ellipsis)
          Text(recommendation.reason, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
            overflow = TextOverflow.Ellipsis)
        }
      }
    }
  }
}

@Composable
private fun AssistantHistorySkeleton() {
  Column(modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("assistant-history-skeleton"),
    verticalArrangement = Arrangement.spacedBy(16.dp)) {
    repeat(4) { index ->
      Box(modifier = Modifier.fillMaxWidth(if (index % 2 == 0) 0.9f else 0.7f)
        .height(64.dp).background(MaterialTheme.colorScheme.surface, themedCorners(12)))
    }
  }
}

@Composable
fun MainScreen(
  modifier: Modifier = Modifier,
  connection: ConnectionUiState = ConnectionUiState(),
  phoneRepository: ai.xopc.mobile.gateway.PhoneRepository? = null,
  onPair: (String) -> Unit = {},
  onCancelPairing: () -> Unit = {},
  onConversationSearchChange: (String) -> Unit = {},
  onConversationScope: (ConversationHistoryScope?) -> Unit = {},
  onFetchConversationExperts: suspend () -> List<ConversationAgent> = { emptyList() },
  onRefreshConversations: () -> Unit = {},
  onRefreshRecentConversations: () -> Unit = {},
  onLoadCapabilities: suspend (String) -> CapabilityPage = { CapabilityPage(emptyList()) },
  onCapabilitySetupChat: (String, Boolean) -> Unit = { _, _ -> },
  onCapabilityPanel: suspend (String, String, JSONObject?) -> JSONObject = { _, _, _ -> JSONObject() },
  onCreateAgentConversation: (String) -> Unit = {},
  onLoadMoreConversations: () -> Unit = {},
  onLoadOlderHistory: () -> Unit = {},
  onSelectConversation: (String) -> Unit = {},
  onRestoreConversation: (String) -> Unit = onSelectConversation,
  onRetryConversation: (String) -> Unit = onSelectConversation,
  onSelectTaskChildConversation: (String, String) -> Unit = { _, _ -> },
  onCreateConversation: () -> Unit = {},
  onSearchExternalConversations: suspend (String) -> List<ConversationSummary> = { emptyList() },
  onAppendExternalFiles: suspend (ai.xopc.mobile.gateway.ExternalFileBatch, String?) -> Unit = { _, _ -> },
  onCreateProjectConversation: suspend (String) -> String = { error("UNAVAILABLE") },
  onDiscardDraft: (String) -> Unit = {},
  onBeginRename: (String) -> Unit = {},
  onRenameDraftChange: (String) -> Unit = {},
  onSaveRename: () -> Unit = {},
  onCancelRename: () -> Unit = {},
  onTogglePin: (String) -> Unit = {},
  onToggleArchive: (String) -> Unit = {},
  onBatchConversations: (List<String>, String) -> Unit = { _, _ -> },
  onBeginConversationShare: (String) -> Unit = {},
  onConfirmConversationShare: (Long, List<String>) -> Unit = { _, _ -> },
  onDismissConversationShare: () -> Unit = {},
  onRevokeConversationShare: () -> Unit = {},
  onScheduleDelete: (String) -> Unit = {},
  onUndoDelete: () -> Unit = {},
  onDismissComposerErrors: (String?, String?) -> Unit = { _, _ -> },
  onChatNavigationHandled: (String) -> Unit = {},
  onDraftChange: (String) -> Unit = {},
  onAddDraftAttachment: (String, String, Uri) -> Unit = { _, _, _ -> },
  onAddCapturedDraftAttachment: (String, String, Uri) -> Unit = { _, _, _ -> },
  onRemoveDraftAttachment: (String) -> Unit = {},
  onPreviewDraftImage: suspend (String, ChatAttachment) -> Bitmap? = { _, _ -> null },
  onPreviewDraftFile: suspend (String, ChatAttachment) -> ByteArray? = { _, _ -> null },
  onRemoveDraftRef: (String, String) -> Unit = { _, _ -> },
  onLoadReferences: (String, String) -> Unit = { _, _ -> },
  onAddDraftRef: (ReferencePickerItem) -> Boolean = { false },
  onSendMessage: () -> Unit = {},
  onRetryPendingInput: () -> Unit = {},
  onStopRun: () -> Unit = {},
  onReloadModels: () -> Unit = {},
  onSelectModel: (String) -> Unit = {},
  onSelectThinking: (String) -> Unit = {},
  onLoadQueuedInputs: () -> Unit = {},
  onUpdateQueuedInput: (String, String?, Int?) -> Unit = { _, _, _ -> },
  onCancelQueuedInput: (String) -> Unit = {},
  onReloadAgents: () -> Unit = {},
  onSwitchAgent: (String, Boolean) -> Unit = { _, _ -> },
  onReloadContext: () -> Unit = {},
  onLoadContextPanel: (String, String, String) -> Unit = { _, _, _ -> },
  onSetContextDirectory: () -> Unit = {},
  onAddContextFile: (ManagedFile) -> Unit = {},
  onCreateContextConversation: (String?, String?) -> Unit = { _, _ -> },
  onRefreshClarification: () -> Unit = {},
  onRespondToClarification: (ClarificationCommand) -> Unit = {},
  onRefreshConnectionWait: () -> Unit = {},
  onConnectionWaitAction: suspend (ai.xopc.mobile.gateway.ConnectionWaitSnapshot, String, String?, String?) -> String? = { _, _, _, _ -> null },
  onRefreshProgress: () -> Unit = {},
  onRefreshProgressHome: () -> Unit = {},
  onProgressHomeAction: (ProgressHomeAction) -> Unit = {},
  onLoadAutomations: () -> Unit = {},
  onOpenAutomation: (String) -> Unit = {},
  onOpenAutomationRun: (String) -> Unit = {},
  onAutomationAction: (String, String) -> Unit = { _, _ -> },
  personalOverviewAccess: ai.xopc.mobile.gateway.PersonalOverviewAccess? = null,
  onRequestAutomationConfiguration: suspend (String?, String?) -> String = { _, _ -> error("UNAVAILABLE") },
  onShowAutomationConfiguration: (String, String) -> Unit = { _, _ -> },
  onUpdateAutomation: (String, String, String, String, String) -> Unit = { _, _, _, _, _ -> },
  onDeleteAutomation: (String, String) -> Unit = { _, _ -> },
  onAutomationRunAction: (String, String) -> Unit = { _, _ -> },
  onRefreshProgressTasks: () -> Unit = {},
  onLoadMoreProgressTasks: () -> Unit = {},
  onOpenProgressTask: (String) -> Unit = {},
  onProgressTaskCommand: (String) -> Unit = {},
  onStartProgressTask: (String) -> Unit = {},
  onCreateTaskWithChat: () -> Unit = {},
  onLoadProgressProjects: () -> Unit = {},
  onOpenProgressProject: (String) -> Unit = {},
  onWriteProgressProject: suspend (ai.xopc.mobile.gateway.ProjectMutation) -> ai.xopc.mobile.gateway.ProgressProject = { error("UNAVAILABLE") },
  onCreateProjectNote: (String) -> Unit = {},
  onCreateProgressTask: (String, String, String) -> Unit = { _, _, _ -> },
  onOpenTaskChat: (String) -> Unit = {},
  onSaveProgressTask: (String, Int, ProgressTaskEdit) -> Unit = { _, _, _ -> },
  onProgressTaskSearchChange: (String) -> Unit = {},
  onSubmitProgressTaskSearch: () -> Unit = {},
  onOpenExecution: (String) -> Unit = {},
  onRetryExecution: () -> Unit = {},
  onCloseExecution: () -> Unit = {},
  onSaveMessageAsNote: (String) -> Unit = {},
  onReuseMessage: (String) -> Boolean = { false },
  onRegenerateMessage: (String) -> Boolean = { false },
  generatedMediaAccess: GeneratedMediaAccess? = null,
  modelSettingsAccess: ai.xopc.mobile.gateway.ModelSettingsAccess? = null,
  spaceLibraryAccess: ai.xopc.mobile.gateway.SpaceLibraryAccess? = null,
  onUseLibraryFile: suspend (String, ai.xopc.mobile.gateway.LibraryVersion, ai.xopc.mobile.gateway.LibraryOrigin?) -> Unit =
    { _, _, _ -> error("LIBRARY_UNAVAILABLE") },
  onLoadMessageMedia: suspend (String, ConversationMedia) -> ByteArray = { _, _ ->
    throw IllegalStateException("MEDIA_UNAVAILABLE")
  },
  onSpeechChunk: suspend (String, String) -> ByteArray = { _, _ ->
    throw IllegalStateException("SPEECH_UNAVAILABLE")
  },
  onTranscribeAudio: suspend (ByteArray, String) -> String = { _, _ ->
    throw IllegalStateException("TRANSCRIPTION_UNAVAILABLE")
  },
  onCreateVoiceCall: suspend (String, String, String, Boolean) -> VoiceCallConnection = { _, _, _, _ ->
    throw IllegalStateException("VOICE_UNAVAILABLE")
  },
  onCancelVoiceCall: suspend (VoiceCallConnection) -> Unit = {},
  onVoiceClarification: suspend (String, Int, String, String) -> Unit = { _, _, _, _ -> },
  onPendingVoiceApproval: suspend (String) -> VoiceApproval? = { null },
  onRespondVoiceApproval: suspend (VoiceApproval, Boolean) -> Unit = { _, _ -> },
  onSendVoiceRecording: suspend (ByteArray, Int) -> Unit = { _, _ ->
    throw IllegalStateException("VOICE_UNAVAILABLE")
  },
  onMessageNoteFeedbackHandled: (MessageNoteFeedback) -> Unit = {},
  onLoadNotes: (String, String) -> Unit = { _, _ -> },
  onNoteFileSpaces: suspend () -> List<ManagedFileSpace> = { emptyList() },
  onNoteFiles: suspend (String?, String, String) -> List<ManagedFile> = { _, _, _ -> emptyList() },
  onNoteFileText: suspend (String) -> String = { "" },
  onNoteFileContent: suspend (String) -> ByteArray = { byteArrayOf() },
  onLoadMoreNotes: () -> Unit = {},
  onOpenNote: (String) -> Unit = {},
  onNewNote: () -> Unit = {},
  onNoteDraftChange: (String, String) -> Unit = { _, _ -> },
  onSaveNoteDraft: () -> Unit = {},
  onCreatedNoteHandled: (String) -> Unit = {},
  onOpenNoteDraft: (String) -> Unit = {},
  onEditNote: () -> Unit = {},
  onResolveNoteConflict: (Boolean) -> Unit = {},
  onNoteMetadataChange: (NoteMetadataPatch) -> Unit = {},
  onLoadNoteHistory: () -> Unit = {},
  onLoadNoteSnapshot: (Long) -> Unit = {},
  onRestoreNoteSnapshot: () -> Unit = {},
  onNoteRestorationHandled: (String) -> Unit = {},
  onDeleteNote: () -> Unit = {},
  onNoteDeletionHandled: (String) -> Unit = {},
  onShareNote: () -> Unit = {},
  onDismissNoteShare: () -> Unit = {},
  onNoteAiPreview: suspend (String) -> NoteAiPreview = { throw IllegalStateException("AI_UNAVAILABLE") },
  onApplyNoteAi: (NoteAiPreview) -> Unit = {},
  onContinueNoteChat: suspend (String) -> String = { throw IllegalStateException("CHAT_UNAVAILABLE") },
  onAttachNoteFile: suspend (Uri) -> Unit = { throw IllegalStateException("MEDIA_UNAVAILABLE") },
  onAttachNoteVoice: suspend (ByteArray, Int) -> Unit = { _, _ ->
    throw IllegalStateException("MEDIA_UNAVAILABLE")
  },
  onLoadNoteAttachment: suspend (String, String) -> ByteArray = { _, _ -> byteArrayOf() },
  onLoadShares: () -> Unit = {},
  onCloseShares: () -> Unit = {},
  onRevokeShare: (String) -> Unit = {},
  onExtendShare: (String, Int) -> Unit = { _, _ -> },
  onLoadPersonal: () -> Unit = {},
  onLoadPersonalAgent: () -> Unit = {},
  onOpenPersonalAgent: () -> Unit = {},
  onLoadPersonalVoiceChoices: () -> Unit = {},
  onUpdatePersonalAgentProfile: (String, String, String?, Boolean, String) -> Unit = { _, _, _, _, _ -> },
  onLoadPersonalModel: LoadPersonalModel? = null,
  onSavePersonalModel: SavePersonalModel? = null,
  onLoadPersonalProactivity: suspend () -> ai.xopc.mobile.gateway.PersonalProactivitySettings = { error("UNAVAILABLE") },
  onSavePersonalProactivity: suspend (ai.xopc.mobile.gateway.PersonalProactivitySettings) -> ai.xopc.mobile.gateway.PersonalProactivitySettings = { error("UNAVAILABLE") },
  onUploadPersonalAvatar: suspend (ByteArray) -> Unit = {},
  onSavePersonalGoal: (String?, String, String, String, Long?) -> Unit = { _, _, _, _, _ -> },
  onLoadPersonalAssertions: (String, String, Boolean) -> Unit = { _, _, _ -> },
  onOpenPersonalAssertion: (String) -> Unit = {},
  onClosePersonalAssertion: () -> Unit = {},
  onSavePersonalProfile: (ai.xopc.mobile.gateway.PersonalProfile) -> Unit = {},
  onSavePersonalStatement: (String) -> Unit = {},
  onDeletePersonalAssertion: () -> Unit = {},
  onStartUnderstandingChat: (PersonalAssertion?) -> Unit = {},
  onOpenGatewayProfiles: () -> Unit = {},
  onProbeGateway: (String) -> Unit = {},
  onActivateGateway: (String) -> Unit = {},
  onRenameGateway: (String, String) -> Unit = { _, _ -> },
  onRemoveGateway: (String) -> Unit = {},
  appearanceMode: String = "system",
  onAppearanceModeChange: (String) -> Unit = {},
  colorScheme: String = "default",
  onColorSchemeChange: (String) -> Unit = {},
  language: String = "system",
  onLanguageChange: (String) -> Unit = {},
) {
  val context = LocalContext.current
  val copyLabel = stringResource(R.string.assistant_copy)
  val activity = context as? Activity
  val latestPair by rememberUpdatedState(onPair)
  var pairingScannerOpen by remember { mutableStateOf(false) }
  var pairingPermissionRequesting by remember { mutableStateOf(false) }
  var pairingPermissionRationale by remember { mutableStateOf(false) }
  var pairingPermissionPermanentlyDenied by remember { mutableStateOf(false) }
  var pairingScanError by remember { mutableStateOf(false) }
  val latestAddAttachment by rememberUpdatedState(onAddDraftAttachment)
  val latestAddCapturedAttachment by rememberUpdatedState(onAddCapturedDraftAttachment)
  var pickerGatewayId by rememberSaveable { mutableStateOf<String?>(null) }
  var pickerConversationId by rememberSaveable { mutableStateOf<String?>(null) }
  val handlePickedUri: (Uri?) -> Unit = { uri ->
    val gatewayId = pickerGatewayId
    val conversationId = pickerConversationId
    pickerGatewayId = null
    pickerConversationId = null
    if (uri != null && gatewayId != null && connection.profile?.gatewayId == gatewayId) {
      if (conversationId != null && connection.selectedConversationId == conversationId)
        latestAddAttachment(gatewayId, conversationId, uri)
    }
  }
  val documentPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) {
    handlePickedUri(it)
  }
  val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) {
    handlePickedUri(it)
  }
  val pairingCameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    pairingPermissionRequesting = false
    if (granted) pairingScannerOpen = true
    else if (activity != null && ActivityCompat.shouldShowRequestPermissionRationale(activity,
        Manifest.permission.CAMERA)) pairingPermissionRationale = true
    else pairingPermissionPermanentlyDenied = true
  }
  val scanPairingCode: () -> Unit = {
    if (!pairingScannerOpen && !pairingPermissionRequesting && !connection.pairing && !connection.restoring) {
      pairingScanError = false
      pairingPermissionPermanentlyDenied = false
      when {
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED ->
          pairingScannerOpen = true
        activity != null && ActivityCompat.shouldShowRequestPermissionRationale(activity,
          Manifest.permission.CAMERA) -> pairingPermissionRationale = true
        else -> {
          pairingPermissionRequesting = true
          pairingCameraPermission.launch(Manifest.permission.CAMERA)
        }
      }
    }
  }
  var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }
  var cameraGatewayId by rememberSaveable { mutableStateOf<String?>(null) }
  var cameraConversationId by rememberSaveable { mutableStateOf<String?>(null) }
  val cameraPicker = rememberLauncherForActivityResult(CameraTakePictureContract()) { saved ->
    val uri = cameraUri?.let(Uri::parse)
    val gatewayId = cameraGatewayId
    val conversationId = cameraConversationId
    cameraUri = null
    cameraGatewayId = null
    cameraConversationId = null
    if (uri != null) {
      if (saved && gatewayId != null && connection.profile?.gatewayId == gatewayId &&
        conversationId == connection.selectedConversationId) {
        if (conversationId != null) latestAddCapturedAttachment(gatewayId, conversationId, uri)
      } else CameraCaptureStore.discard(context, uri)
    }
  }
  val capturePhoto: (String, String) -> Unit = { gatewayId, conversationId ->
    var uri: Uri? = null
    try {
      uri = CameraCaptureStore.create(context)
      cameraUri = uri.toString()
      cameraGatewayId = gatewayId
      cameraConversationId = conversationId
      cameraPicker.launch(uri)
    } catch (_: Exception) {
      uri?.let { CameraCaptureStore.discard(context, it) }
      cameraUri = null
      cameraGatewayId = null
      cameraConversationId = null
      Toast.makeText(context, R.string.camera_capture_error, Toast.LENGTH_SHORT).show()
    }
  }
  var pendingCameraGatewayId by rememberSaveable { mutableStateOf<String?>(null) }
  var pendingCameraConversationId by rememberSaveable { mutableStateOf<String?>(null) }
  val capturePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    val gatewayId = pendingCameraGatewayId
    val conversationId = pendingCameraConversationId
    pendingCameraGatewayId = null
    pendingCameraConversationId = null
    if (granted && gatewayId != null && conversationId != null && connection.profile?.gatewayId == gatewayId &&
      conversationId == connection.selectedConversationId) {
      capturePhoto(gatewayId, conversationId)
    }
  }
  val launchCamera: (String, String) -> Unit = { gatewayId, conversationId ->
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      capturePhoto(gatewayId, conversationId)
    } else if (pendingCameraGatewayId == null) {
      pendingCameraGatewayId = gatewayId
      pendingCameraConversationId = conversationId
      capturePermission.launch(Manifest.permission.CAMERA)
    }
  }
  var selectedTab by remember { mutableStateOf(HomeTab.Assistant) }
  ExternalIntakeHost(connection, onSearchExternalConversations, onAppendExternalFiles) { selectedTab = HomeTab.Assistant }
  var wasUnpaired by remember { mutableStateOf(connection.profile == null) }
  LaunchedEffect(connection.profile?.gatewayId) {
    if (connection.profile == null) wasUnpaired = true
    else if (wasUnpaired) {
      selectedTab = HomeTab.Assistant
      wasUnpaired = false
    }
  }
  LaunchedEffect(connection.chatNavigationId, connection.selectedConversationId) {
    val id = connection.chatNavigationId
    if (id != null && id == connection.selectedConversationId) {
      selectedTab = HomeTab.Assistant
      onChatNavigationHandled(id)
    }
  }
  LaunchedEffect(connection.messageNoteFeedback) {
    val feedback = connection.messageNoteFeedback ?: return@LaunchedEffect
    Toast.makeText(context, if (feedback.saved) R.string.assistant_saved_note
      else R.string.assistant_save_note_error, Toast.LENGTH_SHORT).show()
    onMessageNoteFeedbackHandled(feedback)
  }
  MainContent(phoneRepository = phoneRepository, selectedTab = selectedTab, onSelectTab = { selectedTab = it }, connection = connection,
    onPair = onPair, onCancelPairing = onCancelPairing, onScanPairing = scanPairingCode,
    pairingScanning = pairingScannerOpen || pairingPermissionRequesting,
    pairingScanError = pairingScanError, onConversationSearchChange = onConversationSearchChange,
    onConversationScope = onConversationScope,
    onFetchConversationExperts = onFetchConversationExperts,
    onRefreshConversations = onRefreshConversations,
    onRefreshRecentConversations = onRefreshRecentConversations,
    onLoadCapabilities = onLoadCapabilities, onCapabilityPanel = onCapabilityPanel,
    onCapabilitySetupChat = onCapabilitySetupChat,
    onCreateAgentConversation = onCreateAgentConversation,
    onLoadMoreConversations = onLoadMoreConversations, onLoadOlderHistory = onLoadOlderHistory,
    onSelectConversation = onSelectConversation,
    onRestoreConversation = onRestoreConversation,
    onRetryConversation = onRetryConversation,
    onSelectTaskChildConversation = onSelectTaskChildConversation,
    onCreateConversation = onCreateConversation,
    onCreateProjectConversation = onCreateProjectConversation,
    onDiscardDraft = onDiscardDraft,
    onBeginRename = onBeginRename, onRenameDraftChange = onRenameDraftChange,
    onSaveRename = onSaveRename, onCancelRename = onCancelRename,
    onTogglePin = onTogglePin,
    onToggleArchive = onToggleArchive,
    onBatchConversations = onBatchConversations,
    onBeginConversationShare = onBeginConversationShare,
    onConfirmConversationShare = onConfirmConversationShare,
    onDismissConversationShare = onDismissConversationShare,
    onRevokeConversationShare = onRevokeConversationShare,
    onScheduleDelete = onScheduleDelete, onUndoDelete = onUndoDelete,
    onDismissComposerErrors = onDismissComposerErrors,
    onDraftChange = onDraftChange, onRemoveDraftRef = onRemoveDraftRef,
    onPickDraftAttachment = { kind ->
      val gatewayId = connection.profile?.gatewayId
      val conversationId = connection.selectedConversationId
      if (gatewayId != null && conversationId != null) {
        if (kind == "camera") launchCamera(gatewayId, conversationId)
        else {
          pickerGatewayId = gatewayId
          pickerConversationId = conversationId
          if (kind == "photos") photoPicker.launch(PickVisualMediaRequest(
            ActivityResultContracts.PickVisualMedia.ImageOnly))
          else documentPicker.launch(arrayOf("*/*"))
        }
      }
    },
    onRemoveDraftAttachment = onRemoveDraftAttachment,
    onPreviewDraftImage = onPreviewDraftImage,
    onPreviewDraftFile = onPreviewDraftFile,
    onLoadReferences = onLoadReferences, onAddDraftRef = onAddDraftRef,
    onSendMessage = onSendMessage,
    onRetryPendingInput = onRetryPendingInput, onStopRun = onStopRun,
    onReloadModels = onReloadModels, onSelectModel = onSelectModel,
    onSelectThinking = onSelectThinking,
    onLoadQueuedInputs = onLoadQueuedInputs,
    onUpdateQueuedInput = onUpdateQueuedInput,
    onCancelQueuedInput = onCancelQueuedInput,
    onReloadAgents = onReloadAgents, onSwitchAgent = onSwitchAgent,
    onReloadContext = onReloadContext, onLoadContextPanel = onLoadContextPanel,
    onSetContextDirectory = onSetContextDirectory, onAddContextFile = onAddContextFile,
    onCreateContextConversation = onCreateContextConversation,
    onRefreshClarification = onRefreshClarification,
    onRespondToClarification = onRespondToClarification,
    onRefreshConnectionWait = onRefreshConnectionWait,
    onConnectionWaitAction = onConnectionWaitAction,
    onRefreshProgress = onRefreshProgress, onLoadMoreProgressTasks = onLoadMoreProgressTasks,
    onRefreshProgressHome = onRefreshProgressHome, onRefreshProgressTasks = onRefreshProgressTasks,
    onProgressHomeAction = onProgressHomeAction,
    onLoadAutomations = onLoadAutomations,
    onOpenAutomation = onOpenAutomation,
    onOpenAutomationRun = onOpenAutomationRun,
    onAutomationAction = onAutomationAction,
    personalOverviewAccess = personalOverviewAccess,
    onRequestAutomationConfiguration = onRequestAutomationConfiguration,
    onShowAutomationConfiguration = onShowAutomationConfiguration,
    onUpdateAutomation = onUpdateAutomation,
    onDeleteAutomation = onDeleteAutomation,
    onAutomationRunAction = onAutomationRunAction,
    onOpenProgressTask = onOpenProgressTask, onProgressTaskSearchChange = onProgressTaskSearchChange,
    onProgressTaskCommand = onProgressTaskCommand,
    onStartProgressTask = onStartProgressTask,
    onCreateTaskWithChat = onCreateTaskWithChat,
    onLoadProgressProjects = onLoadProgressProjects,
    onOpenProgressProject = onOpenProgressProject,
    onWriteProgressProject = onWriteProgressProject, onCreateProjectNote = onCreateProjectNote,
    onCreateProgressTask = onCreateProgressTask,
    onOpenTaskChat = onOpenTaskChat,
    onSaveProgressTask = onSaveProgressTask,
    onSubmitProgressTaskSearch = onSubmitProgressTaskSearch,
    onOpenExecution = onOpenExecution, onRetryExecution = onRetryExecution,
    onCloseExecution = onCloseExecution,
    onSaveMessageAsNote = onSaveMessageAsNote, onReuseMessage = onReuseMessage,
    onRegenerateMessage = onRegenerateMessage,
    onLoadMessageMedia = onLoadMessageMedia,
    generatedMediaAccess = generatedMediaAccess,
    modelSettingsAccess = modelSettingsAccess, spaceLibraryAccess = spaceLibraryAccess, onUseLibraryFile = onUseLibraryFile,
    onSpeechChunk = onSpeechChunk,
    onTranscribeAudio = onTranscribeAudio,
    onCreateVoiceCall = onCreateVoiceCall, onCancelVoiceCall = onCancelVoiceCall,
    onVoiceClarification = onVoiceClarification,
    onPendingVoiceApproval = onPendingVoiceApproval,
    onRespondVoiceApproval = onRespondVoiceApproval,
    onSendVoiceRecording = onSendVoiceRecording,
    onCopyMessageText = { value ->
      (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
        .setPrimaryClip(ClipData.newPlainText(copyLabel, value))
      Toast.makeText(context, R.string.assistant_copied, Toast.LENGTH_SHORT).show()
    },
    onLoadNotes = onLoadNotes, onNoteFileSpaces = onNoteFileSpaces,
    onNoteFiles = onNoteFiles, onNoteFileText = onNoteFileText,
    onNoteFileContent = onNoteFileContent,
    onLoadMoreNotes = onLoadMoreNotes, onOpenNote = onOpenNote,
    onNewNote = onNewNote, onNoteDraftChange = onNoteDraftChange, onSaveNoteDraft = onSaveNoteDraft,
    onCreatedNoteHandled = onCreatedNoteHandled,
    onOpenNoteDraft = onOpenNoteDraft,
    onEditNote = onEditNote, onResolveNoteConflict = onResolveNoteConflict,
    onNoteMetadataChange = onNoteMetadataChange,
    onLoadNoteHistory = onLoadNoteHistory, onLoadNoteSnapshot = onLoadNoteSnapshot,
    onRestoreNoteSnapshot = onRestoreNoteSnapshot,
    onNoteRestorationHandled = onNoteRestorationHandled,
    onDeleteNote = onDeleteNote, onNoteDeletionHandled = onNoteDeletionHandled,
    onShareNote = onShareNote, onDismissNoteShare = onDismissNoteShare,
    onNoteAiPreview = onNoteAiPreview, onApplyNoteAi = onApplyNoteAi,
    onContinueNoteChat = onContinueNoteChat,
    onAttachNoteFile = onAttachNoteFile,
    onAttachNoteVoice = onAttachNoteVoice,
    onLoadNoteAttachment = onLoadNoteAttachment,
    onLoadShares = onLoadShares, onCloseShares = onCloseShares,
    onRevokeShare = onRevokeShare, onExtendShare = onExtendShare,
    onLoadPersonal = onLoadPersonal,
    onLoadPersonalAgent = onLoadPersonalAgent,
    onOpenPersonalAgent = onOpenPersonalAgent,
    onLoadPersonalVoiceChoices = onLoadPersonalVoiceChoices,
    onUpdatePersonalAgentProfile = onUpdatePersonalAgentProfile,
    onLoadPersonalModel = onLoadPersonalModel, onSavePersonalModel = onSavePersonalModel,
    onLoadPersonalProactivity = onLoadPersonalProactivity,
    onSavePersonalProactivity = onSavePersonalProactivity,
    onUploadPersonalAvatar = onUploadPersonalAvatar,
    onSavePersonalGoal = onSavePersonalGoal,
    onLoadPersonalAssertions = onLoadPersonalAssertions,
    onOpenPersonalAssertion = onOpenPersonalAssertion,
    onClosePersonalAssertion = onClosePersonalAssertion,
    onSavePersonalProfile = onSavePersonalProfile,
    onSavePersonalStatement = onSavePersonalStatement,
    onDeletePersonalAssertion = onDeletePersonalAssertion,
    onStartUnderstandingChat = onStartUnderstandingChat,
    onOpenGatewayProfiles = onOpenGatewayProfiles,
    onProbeGateway = onProbeGateway,
    onActivateGateway = onActivateGateway,
    onRenameGateway = onRenameGateway,
    onRemoveGateway = onRemoveGateway,
    appearanceMode = appearanceMode, onAppearanceModeChange = onAppearanceModeChange,
    colorScheme = colorScheme, onColorSchemeChange = onColorSchemeChange,
    language = language, onLanguageChange = onLanguageChange,
    modifier = modifier)
  if (pairingScannerOpen) PairingQrScannerDialog(onDetected = { invitation ->
    pairingScannerOpen = false
    val normalizedInvitation = invitation.trim()
    try {
      PairingProtocol.readInvitation(normalizedInvitation)
      latestPair(normalizedInvitation)
    } catch (_: IllegalArgumentException) {
      pairingScanError = true
    }
  }, onClose = { pairingScannerOpen = false }, onError = {
    pairingScannerOpen = false
    pairingScanError = true
  })
  if (pairingPermissionRationale) AlertDialog(
    onDismissRequest = { pairingPermissionRationale = false },
    title = { Text(stringResource(R.string.pairing_camera_permission_title)) },
    text = { Text(stringResource(R.string.pairing_camera_permission_message)) },
    confirmButton = { TextButton(onClick = {
      pairingPermissionRationale = false
      pairingPermissionRequesting = true
      pairingCameraPermission.launch(Manifest.permission.CAMERA)
    }) { Text(stringResource(R.string.pairing_camera_permission_continue)) } },
    dismissButton = { TextButton(onClick = { pairingPermissionRationale = false }) {
      Text(stringResource(R.string.progress_cancel))
    } })
  if (pairingPermissionPermanentlyDenied) AlertDialog(
    onDismissRequest = { pairingPermissionPermanentlyDenied = false },
    title = { Text(stringResource(R.string.pairing_camera_permission_title)) },
    text = { Text(stringResource(R.string.pairing_camera_permission_settings_message)) },
    confirmButton = { TextButton(onClick = {
      pairingPermissionPermanentlyDenied = false
      context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.fromParts("package", context.packageName, null)))
    }) { Text(stringResource(R.string.pairing_camera_permission_settings)) } },
    dismissButton = { TextButton(onClick = { pairingPermissionPermanentlyDenied = false }) {
      Text(stringResource(R.string.progress_cancel))
    } })
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
internal fun MainContent(
  selectedTab: HomeTab,
  onSelectTab: (HomeTab) -> Unit,
  connection: ConnectionUiState = ConnectionUiState(),
  phoneRepository: ai.xopc.mobile.gateway.PhoneRepository? = null,
  onPair: (String) -> Unit = {},
  onCancelPairing: () -> Unit = {},
  onScanPairing: () -> Unit = {},
  pairingScanning: Boolean = false,
  pairingScanError: Boolean = false,
  onConversationSearchChange: (String) -> Unit = {},
  onConversationScope: (ConversationHistoryScope?) -> Unit = {},
  onFetchConversationExperts: suspend () -> List<ConversationAgent> = { emptyList() },
  onRefreshConversations: () -> Unit = {},
  onRefreshRecentConversations: () -> Unit = {},
  onLoadCapabilities: suspend (String) -> CapabilityPage = { CapabilityPage(emptyList()) },
  onCapabilitySetupChat: (String, Boolean) -> Unit = { _, _ -> },
  onCapabilityPanel: suspend (String, String, JSONObject?) -> JSONObject = { _, _, _ -> JSONObject() },
  onCreateAgentConversation: (String) -> Unit = {},
  onLoadMoreConversations: () -> Unit = {},
  onLoadOlderHistory: () -> Unit = {},
  onSelectConversation: (String) -> Unit = {},
  onRestoreConversation: (String) -> Unit = onSelectConversation,
  onRetryConversation: (String) -> Unit = onSelectConversation,
  onSelectTaskChildConversation: (String, String) -> Unit = { _, _ -> },
  onCreateConversation: () -> Unit = {},
  onCreateProjectConversation: suspend (String) -> String = { error("UNAVAILABLE") },
  onDiscardDraft: (String) -> Unit = {},
  onBeginRename: (String) -> Unit = {},
  onRenameDraftChange: (String) -> Unit = {},
  onSaveRename: () -> Unit = {},
  onCancelRename: () -> Unit = {},
  onTogglePin: (String) -> Unit = {},
  onToggleArchive: (String) -> Unit = {},
  onBatchConversations: (List<String>, String) -> Unit = { _, _ -> },
  onBeginConversationShare: (String) -> Unit = {},
  onConfirmConversationShare: (Long, List<String>) -> Unit = { _, _ -> },
  onDismissConversationShare: () -> Unit = {},
  onRevokeConversationShare: () -> Unit = {},
  onScheduleDelete: (String) -> Unit = {},
  onUndoDelete: () -> Unit = {},
  onDismissComposerErrors: (String?, String?) -> Unit = { _, _ -> },
  onDraftChange: (String) -> Unit = {},
  onPickDraftAttachment: (String) -> Unit = {},
  onRemoveDraftAttachment: (String) -> Unit = {},
  onPreviewDraftImage: suspend (String, ChatAttachment) -> Bitmap? = { _, _ -> null },
  onPreviewDraftFile: suspend (String, ChatAttachment) -> ByteArray? = { _, _ -> null },
  onRemoveDraftRef: (String, String) -> Unit = { _, _ -> },
  onLoadReferences: (String, String) -> Unit = { _, _ -> },
  onAddDraftRef: (ReferencePickerItem) -> Boolean = { false },
  onSendMessage: () -> Unit = {},
  onRetryPendingInput: () -> Unit = {},
  onStopRun: () -> Unit = {},
  onReloadModels: () -> Unit = {},
  onSelectModel: (String) -> Unit = {},
  onSelectThinking: (String) -> Unit = {},
  onLoadQueuedInputs: () -> Unit = {},
  onUpdateQueuedInput: (String, String?, Int?) -> Unit = { _, _, _ -> },
  onCancelQueuedInput: (String) -> Unit = {},
  onReloadAgents: () -> Unit = {},
  onSwitchAgent: (String, Boolean) -> Unit = { _, _ -> },
  onReloadContext: () -> Unit = {},
  onLoadContextPanel: (String, String, String) -> Unit = { _, _, _ -> },
  onSetContextDirectory: () -> Unit = {},
  onAddContextFile: (ManagedFile) -> Unit = {},
  onCreateContextConversation: (String?, String?) -> Unit = { _, _ -> },
  onRefreshClarification: () -> Unit = {},
  onRespondToClarification: (ClarificationCommand) -> Unit = {},
  onRefreshConnectionWait: () -> Unit = {},
  onConnectionWaitAction: suspend (ai.xopc.mobile.gateway.ConnectionWaitSnapshot, String, String?, String?) -> String? = { _, _, _, _ -> null },
  onRefreshProgress: () -> Unit = {},
  onRefreshProgressHome: () -> Unit = {},
  onProgressHomeAction: (ProgressHomeAction) -> Unit = {},
  onLoadAutomations: () -> Unit = {},
  onOpenAutomation: (String) -> Unit = {},
  onOpenAutomationRun: (String) -> Unit = {},
  onAutomationAction: (String, String) -> Unit = { _, _ -> },
  personalOverviewAccess: ai.xopc.mobile.gateway.PersonalOverviewAccess? = null,
  onRequestAutomationConfiguration: suspend (String?, String?) -> String = { _, _ -> error("UNAVAILABLE") },
  onShowAutomationConfiguration: (String, String) -> Unit = { _, _ -> },
  onUpdateAutomation: (String, String, String, String, String) -> Unit = { _, _, _, _, _ -> },
  onDeleteAutomation: (String, String) -> Unit = { _, _ -> },
  onAutomationRunAction: (String, String) -> Unit = { _, _ -> },
  onRefreshProgressTasks: () -> Unit = {},
  onLoadMoreProgressTasks: () -> Unit = {},
  onOpenProgressTask: (String) -> Unit = {},
  onProgressTaskCommand: (String) -> Unit = {},
  onStartProgressTask: (String) -> Unit = {},
  onCreateTaskWithChat: () -> Unit = {},
  onLoadProgressProjects: () -> Unit = {},
  onOpenProgressProject: (String) -> Unit = {},
  onWriteProgressProject: suspend (ai.xopc.mobile.gateway.ProjectMutation) -> ai.xopc.mobile.gateway.ProgressProject = { error("UNAVAILABLE") },
  onCreateProjectNote: (String) -> Unit = {},
  onCreateProgressTask: (String, String, String) -> Unit = { _, _, _ -> },
  onOpenTaskChat: (String) -> Unit = {},
  onSaveProgressTask: (String, Int, ProgressTaskEdit) -> Unit = { _, _, _ -> },
  onProgressTaskSearchChange: (String) -> Unit = {},
  onSubmitProgressTaskSearch: () -> Unit = {},
  onOpenExecution: (String) -> Unit = {},
  onRetryExecution: () -> Unit = {},
  onCloseExecution: () -> Unit = {},
  onSaveMessageAsNote: (String) -> Unit = {},
  onReuseMessage: (String) -> Boolean = { false },
  onRegenerateMessage: (String) -> Boolean = { false },
  generatedMediaAccess: GeneratedMediaAccess? = null,
  modelSettingsAccess: ai.xopc.mobile.gateway.ModelSettingsAccess? = null,
  spaceLibraryAccess: ai.xopc.mobile.gateway.SpaceLibraryAccess? = null,
  onUseLibraryFile: suspend (String, ai.xopc.mobile.gateway.LibraryVersion, ai.xopc.mobile.gateway.LibraryOrigin?) -> Unit =
    { _, _, _ -> error("LIBRARY_UNAVAILABLE") },
  onLoadMessageMedia: suspend (String, ConversationMedia) -> ByteArray = { _, _ ->
    throw IllegalStateException("MEDIA_UNAVAILABLE")
  },
  onSpeechChunk: suspend (String, String) -> ByteArray = { _, _ ->
    throw IllegalStateException("SPEECH_UNAVAILABLE")
  },
  onTranscribeAudio: suspend (ByteArray, String) -> String = { _, _ ->
    throw IllegalStateException("TRANSCRIPTION_UNAVAILABLE")
  },
  onCreateVoiceCall: suspend (String, String, String, Boolean) -> VoiceCallConnection = { _, _, _, _ ->
    throw IllegalStateException("VOICE_UNAVAILABLE")
  },
  onCancelVoiceCall: suspend (VoiceCallConnection) -> Unit = {},
  onVoiceClarification: suspend (String, Int, String, String) -> Unit = { _, _, _, _ -> },
  onPendingVoiceApproval: suspend (String) -> VoiceApproval? = { null },
  onRespondVoiceApproval: suspend (VoiceApproval, Boolean) -> Unit = { _, _ -> },
  onSendVoiceRecording: suspend (ByteArray, Int) -> Unit = { _, _ ->
    throw IllegalStateException("VOICE_UNAVAILABLE")
  },
  onCopyMessageText: (String) -> Unit = {},
  onLoadNotes: (String, String) -> Unit = { _, _ -> },
  onNoteFileSpaces: suspend () -> List<ManagedFileSpace> = { emptyList() },
  onNoteFiles: suspend (String?, String, String) -> List<ManagedFile> = { _, _, _ -> emptyList() },
  onNoteFileText: suspend (String) -> String = { "" },
  onNoteFileContent: suspend (String) -> ByteArray = { byteArrayOf() },
  onLoadMoreNotes: () -> Unit = {},
  onOpenNote: (String) -> Unit = {},
  onNewNote: () -> Unit = {},
  onNoteDraftChange: (String, String) -> Unit = { _, _ -> },
  onSaveNoteDraft: () -> Unit = {},
  onCreatedNoteHandled: (String) -> Unit = {},
  onOpenNoteDraft: (String) -> Unit = {},
  onEditNote: () -> Unit = {},
  onResolveNoteConflict: (Boolean) -> Unit = {},
  onNoteMetadataChange: (NoteMetadataPatch) -> Unit = {},
  onLoadNoteHistory: () -> Unit = {},
  onLoadNoteSnapshot: (Long) -> Unit = {},
  onRestoreNoteSnapshot: () -> Unit = {},
  onNoteRestorationHandled: (String) -> Unit = {},
  onDeleteNote: () -> Unit = {},
  onNoteDeletionHandled: (String) -> Unit = {},
  onShareNote: () -> Unit = {},
  onDismissNoteShare: () -> Unit = {},
  onNoteAiPreview: suspend (String) -> NoteAiPreview = { throw IllegalStateException("AI_UNAVAILABLE") },
  onApplyNoteAi: (NoteAiPreview) -> Unit = {},
  onContinueNoteChat: suspend (String) -> String = { throw IllegalStateException("CHAT_UNAVAILABLE") },
  onAttachNoteFile: suspend (Uri) -> Unit = { throw IllegalStateException("MEDIA_UNAVAILABLE") },
  onAttachNoteVoice: suspend (ByteArray, Int) -> Unit = { _, _ ->
    throw IllegalStateException("MEDIA_UNAVAILABLE")
  },
  onLoadNoteAttachment: suspend (String, String) -> ByteArray = { _, _ -> byteArrayOf() },
  onLoadShares: () -> Unit = {},
  onCloseShares: () -> Unit = {},
  onRevokeShare: (String) -> Unit = {},
  onExtendShare: (String, Int) -> Unit = { _, _ -> },
  onLoadPersonal: () -> Unit = {},
  onLoadPersonalAgent: () -> Unit = {},
  onOpenPersonalAgent: () -> Unit = {},
  onLoadPersonalVoiceChoices: () -> Unit = {},
  onUpdatePersonalAgentProfile: (String, String, String?, Boolean, String) -> Unit = { _, _, _, _, _ -> },
  onLoadPersonalModel: LoadPersonalModel? = null,
  onSavePersonalModel: SavePersonalModel? = null,
  onLoadPersonalProactivity: suspend () -> ai.xopc.mobile.gateway.PersonalProactivitySettings = { error("UNAVAILABLE") },
  onSavePersonalProactivity: suspend (ai.xopc.mobile.gateway.PersonalProactivitySettings) -> ai.xopc.mobile.gateway.PersonalProactivitySettings = { error("UNAVAILABLE") },
  onUploadPersonalAvatar: suspend (ByteArray) -> Unit = {},
  onSavePersonalGoal: (String?, String, String, String, Long?) -> Unit = { _, _, _, _, _ -> },
  onLoadPersonalAssertions: (String, String, Boolean) -> Unit = { _, _, _ -> },
  onOpenPersonalAssertion: (String) -> Unit = {},
  onClosePersonalAssertion: () -> Unit = {},
  onSavePersonalProfile: (ai.xopc.mobile.gateway.PersonalProfile) -> Unit = {},
  onSavePersonalStatement: (String) -> Unit = {},
  onDeletePersonalAssertion: () -> Unit = {},
  onStartUnderstandingChat: (PersonalAssertion?) -> Unit = {},
  onOpenGatewayProfiles: () -> Unit = {},
  onProbeGateway: (String) -> Unit = {},
  onActivateGateway: (String) -> Unit = {},
  onRenameGateway: (String, String) -> Unit = { _, _ -> },
  onRemoveGateway: (String) -> Unit = {},
  appearanceMode: String = "system",
  onAppearanceModeChange: (String) -> Unit = {},
  colorScheme: String = "default",
  onColorSchemeChange: (String) -> Unit = {},
  language: String = "system",
  onLanguageChange: (String) -> Unit = {},
  modifier: Modifier = Modifier,
) {
  val gatewayId = connection.profile?.gatewayId
  val isPaired = gatewayId != null
  val conversationId = connection.selectedConversationId
  val inputVoicePermissionDeniedText = stringResource(R.string.voice_permission_denied)
  val voiceRecordError = stringResource(R.string.voice_record_error)
  val voiceContext = LocalContext.current
  val lifecycleOwner = LocalLifecycleOwner.current
  val voiceScope = rememberCoroutineScope()
  val currentSpeechFetch by rememberUpdatedState(onSpeechChunk)
  val reader = remember(gatewayId, connection.profile?.deviceId) {
    ReadAloudController(voiceContext, voiceScope) { text, language -> currentSpeechFetch(text, language) }
  }
  DisposableEffect(reader) { onDispose { reader.stop() } }
  val currentVoiceCreate by rememberUpdatedState(onCreateVoiceCall)
  val currentVoiceCancel by rememberUpdatedState(onCancelVoiceCall)
  val currentVoiceClarification by rememberUpdatedState(onVoiceClarification)
  val currentPendingVoiceApproval by rememberUpdatedState(onPendingVoiceApproval)
  val currentRespondVoiceApproval by rememberUpdatedState(onRespondVoiceApproval)
  val voiceCall = remember(gatewayId) {
    RealtimeVoiceController(voiceContext, voiceScope,
      { id, mode, callId, recovery -> currentVoiceCreate(id, mode, callId, recovery) }, { call -> currentVoiceCancel(call) },
      { id, version, action, answer -> currentVoiceClarification(id, version, action, answer) },
      { id -> currentPendingVoiceApproval(id) },
      { approval, allow -> currentRespondVoiceApproval(approval, allow) })
  }

  LaunchedEffect(voiceCall) {
    try { awaitCancellation() }
    finally { withContext(NonCancellable) { voiceCall.stop() } }
  }
  val inputVoice = remember(gatewayId, conversationId, selectedTab) {
    VoiceMemoRecorder(voiceContext)
  }
  var inputVoiceMode by remember(gatewayId, conversationId, selectedTab) {
    mutableStateOf(false)
  }
  var inputVoiceHeld by remember(inputVoice) { mutableStateOf(false) }
  var inputVoiceBusy by remember(inputVoice) { mutableStateOf(false) }
  val inputVoiceNotice = remember(inputVoice) { TransientComposerNotice(voiceScope) }
  val inputVoiceError = inputVoiceNotice.message
  val currentInputVoice by rememberUpdatedState(inputVoice)
  var permissionTarget by remember { mutableStateOf<VoiceMemoRecorder?>(null) }
  var inputVoiceDestination by remember(inputVoice) { mutableStateOf("send") }
  var inputVoiceRetryDestination by remember(inputVoice) { mutableStateOf("send") }
  var inputVoiceElapsed by remember(inputVoice) { mutableIntStateOf(0) }
  DisposableEffect(inputVoice) { onDispose { inputVoice.cancel(); inputVoiceNotice.clear() } }
  LaunchedEffect(inputVoiceHeld) {
    while (inputVoiceHeld) {
      inputVoiceElapsed = inputVoice.elapsedSeconds
      delay(250)
    }
  }
  val inputVoicePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    val target = permissionTarget
    permissionTarget = null
    if (target !== inputVoice) return@rememberLauncherForActivityResult
    if (granted) inputVoiceMode = true
    else inputVoiceNotice.show(inputVoicePermissionDeniedText)
  }
  val voiceFocusManager = LocalFocusManager.current
  DisposableEffect(lifecycleOwner, voiceCall, inputVoice) {
    val observer = LifecycleEventObserver { _, event ->
      if (event == Lifecycle.Event.ON_STOP) {
        permissionTarget = null; inputVoiceNotice.clear()
        onDismissComposerErrors(gatewayId, conversationId)
        if (voiceCall.phase != "idle") voiceCall.onBackground()
        if (inputVoice.phase != "idle") {
          inputVoice.cancel(); inputVoiceHeld = false
        }
      } else if (event == Lifecycle.Event.ON_START) {
        voiceScope.launch { voiceCall.onForeground() }
      }
    }
    lifecycleOwner.lifecycle.addObserver(observer)
    onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
  }
  var pendingVoiceMode by remember(gatewayId) { mutableStateOf<String?>(null) }
  var activeVoiceConversationId by remember(gatewayId) { mutableStateOf<String?>(null) }
  var voicePermissionDenied by remember(gatewayId) { mutableStateOf(false) }
  val voicePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) {
      pendingVoiceMode = pendingVoiceMode ?: "auto"
      if (conversationId == null) onCreateConversation()
    }
    else { pendingVoiceMode = null; voicePermissionDenied = true }
  }
  fun requestVoice(mode: String) {
    pendingVoiceMode = mode
    voicePermissionDenied = false
    if (ContextCompat.checkSelfPermission(voiceContext, Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED) voicePermission.launch(Manifest.permission.RECORD_AUDIO)
    else if (conversationId == null) onCreateConversation()
  }
  LaunchedEffect(pendingVoiceMode, conversationId) {
    val mode = pendingVoiceMode ?: return@LaunchedEffect
    val id = conversationId ?: return@LaunchedEffect
    if (ContextCompat.checkSelfPermission(voiceContext, Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED) return@LaunchedEffect
    pendingVoiceMode = null
    MusicPlayback.pause()
    activeVoiceConversationId = id
    voiceCall.start(id, mode)
  }
  var personalPage by rememberSaveable(gatewayId) { mutableStateOf("settings") }
  val taskNavigation = rememberTaskChatNavigation(connection)
  var personalOverviewOpen by rememberSaveable(gatewayId) { mutableStateOf(false) }
  var editingOverviewProfile by remember(gatewayId) { mutableStateOf(false) }
  var overviewMedia by remember(gatewayId) { mutableStateOf<MessagePreviewRequest?>(null) }
  val overviewAgent = connection.personal.agent?.takeIf { it.state == "ready" && it.conversationId == conversationId }
  val showOverview = personalOverviewOpen && selectedTab == HomeTab.Assistant && overviewAgent != null && !connection.automationConfigurationChat
  val overviewState = rememberSaveableStateHolder()
  val playback = MusicPlayback.state.collectAsStateWithLifecycle()
  val currentMusic by remember { derivedStateOf { playback.value?.track } }
  val activeMusic = currentMusic?.takeIf { it.gatewayId == gatewayId }
  var inlineMusicKey by remember(gatewayId) { mutableStateOf<String?>(null) }
  var musicPlayerOpen by rememberSaveable(gatewayId) { mutableStateOf(false) }
  val downloadMusic = rememberMusicDownload(generatedMediaAccess)
  LaunchedEffect(gatewayId, currentMusic?.gatewayId) {
    if (gatewayId != null && currentMusic?.gatewayId?.let { it != gatewayId } == true) MusicPlayback.stop()
  }
  var automationReturnTab by rememberSaveable(gatewayId) { mutableStateOf(HomeTab.Assistant) }
  var automationReturnProjectId by rememberSaveable(gatewayId) { mutableStateOf<String?>(null) }
  var automationReturnConversation by rememberSaveable(gatewayId) { mutableStateOf<String?>(null) }
  var openingAutomation by remember(gatewayId) { mutableStateOf(false) }
  val activeTab by rememberUpdatedState(selectedTab)
  val activeGateway by rememberUpdatedState(gatewayId)
  val activeConversation by rememberUpdatedState(conversationId)
  val activeProject by rememberUpdatedState(connection.progress.projectId)
  var projectChatId by rememberSaveable(gatewayId) { mutableStateOf<String?>(null) }
  var projectChatTitle by rememberSaveable(gatewayId) { mutableStateOf<String?>(null) }
  var projectChatReturnTab by rememberSaveable(gatewayId) { mutableStateOf(HomeTab.Projects) }
  var projectChatReturnConversation by rememberSaveable(gatewayId) { mutableStateOf<String?>(null) }
  var openingProjectChat by remember(gatewayId) { mutableStateOf(false) }
  val showingProjectChat = projectChatId != null && projectChatId == conversationId &&
    selectedTab == HomeTab.Assistant
  val newProjectChatTitle = stringResource(R.string.assistant_action_new_chat)
  fun openProjectChat(id: String, title: String) {
    projectChatId = id
    projectChatTitle = title
    projectChatReturnTab = selectedTab
    projectChatReturnConversation = conversationId
    onRestoreConversation(id)
    onSelectTab(HomeTab.Assistant)
  }
  fun closeProjectChat() {
    projectChatId = null
    projectChatTitle = null
    projectChatReturnConversation?.let(onRestoreConversation) ?: onOpenPersonalAgent()
    connection.progress.projectId?.let(onOpenProgressProject)
    onSelectTab(projectChatReturnTab)
  }
  val automationLocale = LocalConfiguration.current.locales[0].toLanguageTag()
  fun arrangeAutomation(projectId: String?, personal: Boolean, prompt: String) {
    if (openingAutomation || gatewayId == null || connection.automationConfigurationChat) return
    openingAutomation = true
    val sourceTab = selectedTab
    val sourceConversation = conversationId
    voiceScope.launch {
      try {
        val id = onRequestAutomationConfiguration(projectId, automationLocale.takeIf { personal })
        if (activeTab != sourceTab || activeGateway != gatewayId || activeConversation != sourceConversation ||
          projectId != null && activeProject != projectId) return@launch
        automationReturnTab = sourceTab
        automationReturnProjectId = projectId
        automationReturnConversation = sourceConversation
        onShowAutomationConfiguration(id, prompt)
        onSelectTab(HomeTab.Assistant)
      } catch (error: kotlinx.coroutines.CancellationException) {
        throw error
      } catch (error: Exception) {
        if (activeTab == sourceTab && activeGateway == gatewayId && activeConversation == sourceConversation)
          Toast.makeText(voiceContext, if (personal && (error as? ai.xopc.mobile.gateway.GatewayHttpException)?.status == 400)
            R.string.automation_setup_personal_update_gateway else R.string.automation_create_error, Toast.LENGTH_SHORT).show()
      } finally { openingAutomation = false }
    }
  }
  fun closeAutomationConfiguration() {
    automationReturnConversation?.let(onRestoreConversation) ?: onOpenPersonalAgent()
    when (automationReturnTab) {
      HomeTab.Progress, HomeTab.Projects -> {
        automationReturnProjectId?.let(onOpenProgressProject) ?: onLoadAutomations()
      }
      else -> Unit
    }
    onSelectTab(automationReturnTab)
  }
  val libraryDelivery = rememberSaveable(gatewayId) { mutableStateOf("") }
  val deliveryRoute = libraryDelivery.value
  val libraryDeliveryKind = deliveryRoute.substringBefore(':')
  val libraryDeliveryId = deliveryRoute.substringAfter(':', "")
  var linkedDetails by remember(gatewayId) { mutableStateOf(emptyList<LinkedDetail>()) }
  val linkedDetailId = linkedDetails.lastOrNull()?.takeIf { it.destination == selectedTab }?.id
  fun openLinkedDetail(destination: HomeTab, id: String) {
    if (selectedTab == HomeTab.Assistant) linkedDetails = emptyList()
    linkedDetails = linkedDetails + LinkedDetail(selectedTab, destination, id)
    onSelectTab(destination)
  }
  var personalReturnPage by rememberSaveable(gatewayId) { mutableStateOf("settings") }
  var personalStartSection by rememberSaveable(gatewayId) { mutableStateOf("overview") }
  var personalDetailId by rememberSaveable(gatewayId) { mutableStateOf("") }
  var previousGatewayId by remember { mutableStateOf(gatewayId) }
  LaunchedEffect(gatewayId) {
    if (previousGatewayId != null && gatewayId != null && previousGatewayId != gatewayId) {
      personalPage = "settings"
      onSelectTab(HomeTab.Assistant)
    }
    previousGatewayId = gatewayId
  }
  fun leavePersonalPage() {
    if (personalPage == "detail") {
      personalPage = personalReturnPage
      onClosePersonalAssertion()
    } else if (personalPage == "settings-appearance" || personalPage == "settings-language" ||
      personalPage == "settings-gateways" || personalPage == "settings-sharing" ||
      personalPage == "about" || personalPage == "goals" || personalPage == "settings-about" || personalPage == "settings-models") {
      if (personalPage == "settings-sharing") onCloseShares()
      personalPage = "settings"
    } else if (personalPage == "settings-add") {
      personalPage = "settings-gateways"
    } else {
      personalPage = "settings"
      onSelectTab(HomeTab.Assistant)
    }
  }
  LaunchedEffect(connection.personal.assertionDeletedRevision) {
    if (personalPage == "detail" && connection.personal.assertionDeletedRevision > 0 &&
      connection.personal.selectedAssertionId == null) personalPage = personalReturnPage
  }
  LaunchedEffect(gatewayId) {
    if (isPaired) {
      while (true) {
        onRefreshProgressHome()
        delay(30_000)
      }
    }
  }
  LaunchedEffect(selectedTab, gatewayId) {
    if (selectedTab == HomeTab.Progress && isPaired) onRefreshProgressTasks()
    if (linkedDetailId == null && selectedTab == HomeTab.Projects && isPaired) onLoadProgressProjects()
    if (linkedDetailId == null && selectedTab == HomeTab.Automations && isPaired) onLoadAutomations()
  }
  LaunchedEffect(selectedTab, gatewayId, linkedDetailId) {
    if (selectedTab == HomeTab.Notes && isPaired && linkedDetailId != null) {
      onLoadNotes(connection.notes.search, connection.notes.status)
    }
  }
  LaunchedEffect(selectedTab, gatewayId) {
    if (selectedTab == HomeTab.Me && isPaired) {
      onLoadPersonal()
    }
  }
  LaunchedEffect(selectedTab, gatewayId) {
    if (isPaired && selectedTab == HomeTab.Assistant) onLoadPersonalAgent()
  }
  val latestClarificationRefresh by rememberUpdatedState(onRefreshClarification)
  val latestConnectionWaitRefresh by rememberUpdatedState(onRefreshConnectionWait)
  LaunchedEffect(selectedTab, gatewayId, conversationId) {
    if (selectedTab == HomeTab.Assistant && isPaired &&
      conversationId != null) {
      while (true) {
        latestConnectionWaitRefresh()
        latestClarificationRefresh()
        delay(5_000)
      }
    }
  }
  LaunchedEffect(personalPage, gatewayId) {
    if (personalPage == "settings-gateways") onOpenGatewayProfiles()
    if (personalPage == "settings-sharing" && isPaired) onLoadShares()
  }
  var assistantActionsOpen by remember(selectedTab, conversationId) { mutableStateOf(false) }
  var agentPickerOpen by remember(gatewayId, selectedTab, conversationId) { mutableStateOf(false) }
  var assistantComposerValue by remember(conversationId) {
    mutableStateOf(TextFieldValue(connection.draftText, selection = TextRange(connection.draftText.length)))
  }
  val assistantComposerFocus = remember(conversationId) { FocusRequester() }
  var assistantFocusRevision by remember(conversationId) { mutableIntStateOf(0) }
  var assistantReferenceKind by remember(gatewayId, conversationId) {
    mutableStateOf<String?>(null)
  }
  var assistantReferenceQuery by remember(gatewayId, conversationId) {
    mutableStateOf("")
  }
  val keyboardController = LocalSoftwareKeyboardController.current
  val currentTab by rememberUpdatedState(selectedTab)
  val currentComposerConnection by rememberUpdatedState(connection)
  var restoreInputKeyboard by remember(inputVoice) { mutableStateOf(false) }
  LaunchedEffect(inputVoiceMode) {
    if (!inputVoiceMode && restoreInputKeyboard) {
      restoreInputKeyboard = false
      assistantComposerFocus.requestFocus()
      keyboardController?.show()
    }
    if (inputVoiceMode) {
      assistantActionsOpen = false
      voiceFocusManager.clearFocus(force = true)
      keyboardController?.hide()
    }
  }
  fun toggleInputVoice() {
    if (inputVoiceBusy || inputVoiceHeld || inputVoice.phase != "idle") return
    inputVoiceNotice.clear()
    if (inputVoiceMode) {
      restoreInputKeyboard = true
      inputVoiceMode = false
    } else if (ContextCompat.checkSelfPermission(voiceContext, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED) {
      assistantActionsOpen = false
      voiceFocusManager.clearFocus(force = true)
      keyboardController?.hide()
      inputVoiceMode = true
    } else { permissionTarget = inputVoice; inputVoicePermission.launch(Manifest.permission.RECORD_AUDIO) }
  }
  fun deliverInputVoice(destination: String) {
    if (inputVoiceBusy || inputVoice.phase != "ready") return
    val targetTab = selectedTab
    inputVoiceRetryDestination = destination
    inputVoiceNotice.clear()
    inputVoiceBusy = true
    voiceScope.launch {
      try {
        val (bytes, seconds) = withContext(Dispatchers.IO) { inputVoice.consume() }
        if (destination == "text") {
          val lang = when { language.startsWith("zh") -> "zh"; language.startsWith("en") -> "en"; else -> "" }
          val transcript = onTranscribeAudio(bytes, lang)
          if (inputVoice.phase != "ready" || !currentComposerConnection.matchesComposer(gatewayId, conversationId) || currentTab != targetTab) return@launch
          val next = if (assistantComposerValue.text.isBlank()) transcript
            else assistantComposerValue.text + "\n" + transcript
          assistantComposerValue = TextFieldValue(next, selection = TextRange(next.length))
          onDraftChange(next)
          restoreInputKeyboard = true
          inputVoiceMode = false
        } else {
          if (inputVoice.phase != "ready" || !currentComposerConnection.matchesComposer(gatewayId, conversationId) || currentTab != targetTab) return@launch
          onSendVoiceRecording(bytes, seconds)
        }
        inputVoice.cancel()
        inputVoiceNotice.clear()
      } catch (failure: Exception) {
        if (failure is CancellationException) throw failure
        if (currentInputVoice === inputVoice && inputVoice.phase == "ready")
          inputVoiceNotice.show(failure.message ?: voiceRecordError)
      } finally { inputVoiceBusy = false }
    }
  }
  fun startInputVoice(): Boolean {
    if (inputVoiceBusy || inputVoice.phase != "idle" || connection.sending) return false
    inputVoiceNotice.clear(); inputVoiceDestination = "send"; inputVoiceElapsed = 0
    inputVoice.start()
    inputVoiceHeld = inputVoice.phase == "recording"
    if (!inputVoiceHeld) {
      inputVoiceNotice.show(inputVoice.error)
      inputVoice.cancel()
    }
    return inputVoiceHeld
  }
  fun finishInputVoice(destination: String) {
    if (!inputVoiceHeld) return
    inputVoiceHeld = false
    inputVoiceDestination = "send"
    if (destination == "cancel" || inputVoice.elapsedMilliseconds < 380) {
      inputVoiceNotice.clear(); inputVoice.cancel()
      return
    }
    inputVoice.stopRecording()
    if (inputVoice.phase != "ready") {
      inputVoiceNotice.show(inputVoice.error.ifBlank { voiceRecordError })
      inputVoice.cancel()
      return
    }
    deliverInputVoice(destination)
  }
  LaunchedEffect(inputVoiceElapsed, inputVoiceHeld) {
    if (inputVoiceHeld && inputVoiceElapsed >= 120) finishInputVoice(inputVoiceDestination)
  }
  val focusManager = LocalFocusManager.current
  val openMusicPlayer: () -> Unit = {
    focusManager.clearFocus(force = true)
    keyboardController?.hide()
    musicPlayerOpen = true
  }
  var phonePage by remember(gatewayId, conversationId) { mutableStateOf(false) }
  var messageSearchOpen by remember(gatewayId, conversationId, selectedTab, phonePage) { mutableStateOf(false) }
  val phoneController = rememberPhoneWorkspace(phoneRepository, conversationId,
    gatewayId, selectedTab == HomeTab.Assistant, phonePage)
  val phoneUi = phoneWorkspaceState(phoneController)
  val showMusicMini = activeMusic != null &&
    (selectedTab != HomeTab.Assistant || phonePage || inlineMusicKey != activeMusic.key || activeMusic.conversationId != conversationId)
  val showBottomChrome = isPaired && selectedTab == HomeTab.Assistant && !phonePage && !showOverview &&
    (conversationId != null || !connection.restoringHomeChat)
  LaunchedEffect(showBottomChrome) {
    if (!showBottomChrome) {
      inputVoiceNotice.clear(); inputVoice.cancel(); inputVoiceHeld = false; inputVoiceMode = false
      assistantActionsOpen = false
      focusManager.clearFocus(force = true)
      keyboardController?.hide()
    }
  }
  LaunchedEffect(conversationId, connection.draftText) {
    if (assistantComposerValue.text != connection.draftText) assistantComposerValue =
      TextFieldValue(connection.draftText, selection = TextRange(connection.draftText.length))
  }
  LaunchedEffect(conversationId, assistantFocusRevision) {
    if (assistantFocusRevision > 0 && selectedTab == HomeTab.Assistant) {
      assistantComposerFocus.requestFocus()
      keyboardController?.show()
    }
  }
  LaunchedEffect(assistantReferenceKind, assistantReferenceQuery, gatewayId,
    conversationId) {
    val kind = assistantReferenceKind ?: return@LaunchedEffect
    if (kind == "file") return@LaunchedEffect
    if (assistantReferenceQuery.isNotEmpty()) delay(250)
    onLoadReferences(kind, assistantReferenceQuery)
  }
  val imeVisible = WindowInsets.isImeVisible
  val layoutDirection = LocalLayoutDirection.current
  val tabStateHolder = rememberSaveableStateHolder()
  val sidebar = remember(gatewayId) { ChatSidebarState() }
  var returnToSidebar by rememberSaveable(gatewayId) { mutableStateOf(false) }
  var startConversationSearch by rememberSaveable(gatewayId) { mutableStateOf(false) }
  val conversationsSearch by rememberUpdatedState(connection.conversationSearch)
  val clearConversationSearch by rememberUpdatedState(onConversationSearchChange)
  val refreshSidebarConversations by rememberUpdatedState(onRefreshRecentConversations)
  val closeKeyboard: () -> Unit = {
    focusManager.clearFocus(force = true)
    keyboardController?.hide()
  }
  val openSidebar: () -> Unit = {
    assistantActionsOpen = false
    closeKeyboard()
    if (conversationsSearch.isNotEmpty()) clearConversationSearch("")
    refreshSidebarConversations()
    sidebar.open = true
  }
  val exitDestination: () -> Unit = {
    val linkedDetail = linkedDetails.lastOrNull()?.takeIf { it.destination == selectedTab }
    if (linkedDetail != null) {
      linkedDetails = linkedDetails.dropLast(1)
      onSelectTab(linkedDetail.source)
    } else {
      onSelectTab(HomeTab.Assistant)
      if (returnToSidebar && selectedTab in listOf(HomeTab.Conversations, HomeTab.Progress, HomeTab.Automations)) openSidebar()
      returnToSidebar = false
    }
  }
  LaunchedEffect(selectedTab) {
    if (selectedTab != HomeTab.Assistant) sidebar.open = false
    if (selectedTab != HomeTab.Conversations) startConversationSearch = false
  }
  BackHandler(enabled = selectedTab != HomeTab.Assistant && isPaired) { exitDestination() }
  BackHandler(enabled = sidebar.open) { sidebar.open = false }
  BackHandler(enabled = selectedTab == HomeTab.Assistant && isTaskChat(connection) && !imeVisible) {
    taskNavigation.close(onRestoreConversation, onSelectTab)
  }
  BackHandler(enabled = selectedTab == HomeTab.Assistant && connection.automationConfigurationChat && !imeVisible) {
    closeAutomationConfiguration()
  }
  BackHandler(enabled = showingProjectChat && !imeVisible, onBack = ::closeProjectChat)
  BackHandler(enabled = showOverview) { personalOverviewOpen = false }
  BackHandler(enabled = assistantActionsOpen) { assistantActionsOpen = false }
  BackHandler(enabled = selectedTab == HomeTab.Me) { leavePersonalPage() }
  BoxWithConstraints(modifier.fillMaxSize()) {
  val sidebarWidth = (maxWidth * 0.84f).coerceAtMost(350.dp)
  val density = LocalDensity.current
  val leftBackEdge = maxOf(WindowInsets.systemGestures.getLeft(density, layoutDirection),
    with(density) { 24.dp.roundToPx() })
  val rightBackEdge = maxOf(WindowInsets.systemGestures.getRight(density, layoutDirection),
    with(density) { 24.dp.roundToPx() })
  val sidebarWidthPx = with(density) { sidebarWidth.toPx() }
  val minimumOpenDrag = with(density) { 96.dp.toPx() }
  val minimumFlickDistance = with(density) { 24.dp.toPx() }
  val minimumFlickVelocity = with(density) { 550.dp.toPx() }
  Scaffold(
    modifier = Modifier.imePadding().then(if (sidebar.open) Modifier.semantics { hideFromAccessibility() } else Modifier),
    containerColor = MaterialTheme.colorScheme.background,
    bottomBar = {
      if (showBottomChrome) Column(modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
          if (showMusicMini) MusicMiniPlayer(activeMusic, openMusicPlayer,
            Modifier.padding(horizontal = 12.dp).padding(bottom = 4.dp))
          if (conversationId != null) ConversationMcpAction(conversationId,
            connection.sending || connection.activeRunId != null, onCapabilityPanel)
          MainBottomSurface("assistant-bottom-surface", assistantActionsOpen) {
            AssistantComposer(connection, assistantComposerValue, { value ->
              inputVoiceNotice.clear()
              onDismissComposerErrors(gatewayId, conversationId)
              assistantComposerValue = value
              onDraftChange(value.text)
            }, assistantComposerFocus, assistantActionsOpen, { assistantActionsOpen = it },
              onRemoveDraftRef, onRemoveDraftAttachment, onPreviewDraftImage, onPreviewDraftFile,
              onSendMessage, onStopRun,
              inputVoiceMode, inputVoiceHeld, inputVoiceBusy, inputVoice.phase, inputVoiceError,
              inputVoiceDestination, inputVoiceElapsed,
              ::toggleInputVoice, onVoiceStart = ::startInputVoice, onVoiceMove = { dx, dy ->
                inputVoiceDestination = voiceRecordingDestination(dx, dy, inputVoiceDestination)
              }, onVoiceFinish = ::finishInputVoice, onVoiceCancel = {
                inputVoice.cancel(); inputVoiceNotice.clear(); inputVoiceHeld = false
              }, onVoiceRetry = { deliverInputVoice(inputVoiceRetryDestination) },
              onDismissVoiceError = inputVoiceNotice::clear,
              onDismissError = { onDismissComposerErrors(gatewayId, conversationId) })
            AnimatedVisibility(visible = assistantActionsOpen,
              enter = expandVertically(animationSpec = tween(220), expandFrom = Alignment.Bottom) +
                fadeIn(animationSpec = tween(220)),
              exit = shrinkVertically(animationSpec = tween(180), shrinkTowards = Alignment.Bottom) +
                fadeOut(animationSpec = tween(180)), label = "assistant-actions") {
              AssistantActionPanel(
                canSwitchAgent = !showingProjectChat && !connection.automationConfigurationChat &&
                  !isTaskChat(connection) && connection.personal.agent?.let {
                    it.state == "ready" && it.conversationId == conversationId
                  } != true,
                onOpenAgentPicker = {
                  assistantActionsOpen = false
                  agentPickerOpen = true
                },
                canRecord = !inputVoiceBusy && !inputVoiceMode && inputVoice.phase == "idle" && !connection.sending,
                canReference = !connection.sending && connection.pendingInput == null,
                canPick = !connection.sending && !connection.attachmentLoading &&
                  connection.pendingInput == null && connection.draftAttachments.size < 10,
                onPick = { kind ->
                  assistantActionsOpen = false
                  onPickDraftAttachment(kind)
                }, onVoiceAction = {
                  assistantActionsOpen = false
                  toggleInputVoice()
                }, onOpenReference = { kind ->
                  assistantActionsOpen = false
                  assistantReferenceQuery = ""
                  assistantReferenceKind = kind
                })
            }
          }
        Spacer(Modifier.fillMaxWidth().navigationBarsPadding().testTag("bottom-content-mask"))
      } else if (showMusicMini && !showOverview) {
        MusicMiniPlayer(activeMusic, openMusicPlayer, Modifier.navigationBarsPadding()
          .padding(horizontal = 12.dp, vertical = 7.dp))
      }
    },
  ) { insets ->
    val readingPosition = rememberChatReadingPosition(connection.profile?.gatewayId,
      connection.profile?.deviceId, connection.selectedConversationId)
    val rootInsets = if (showBottomChrome) PaddingValues(
      start = insets.calculateLeftPadding(layoutDirection),
      top = if (selectedTab == HomeTab.Assistant) 0.dp else insets.calculateTopPadding(),
      end = insets.calculateRightPadding(layoutDirection)) else insets
    if (!isPaired && selectedTab != HomeTab.Me) {
      PairingScreen(stringResource(R.string.pairing_title), connection, onPair, onCancelPairing,
        onScanPairing, pairingScanning, pairingScanError, insets,
        onSettings = {
          personalPage = "settings"
          onSelectTab(HomeTab.Me)
        })
    } else {
    val showLibraryDelivery = selectedTab == HomeTab.Notes && linkedDetailId == null && libraryDeliveryId.isNotEmpty()
    val contentTab = if (showLibraryDelivery) HomeTab.Progress else selectedTab
    val tabStateKey = when {
      showLibraryDelivery -> "library-delivery-${gatewayId}-$libraryDeliveryKind-$libraryDeliveryId"
      linkedDetailId != null -> "linked-detail-$gatewayId-${contentTab.name}-$linkedDetailId"
      selectedTab == HomeTab.Notes -> "library-root-${gatewayId}"
      else -> "${gatewayId}:${selectedTab.name}"
    }
    tabStateHolder.SaveableStateProvider(tabStateKey) {
    when (contentTab) {
      HomeTab.Assistant, HomeTab.Conversations -> {
        val title = stringResource(R.string.pairing_title)
        if (!isPaired) PairingScreen(title, connection, onPair, onCancelPairing,
          onScanPairing,
          pairingScanning, pairingScanError, insets)
        else if (selectedTab == HomeTab.Assistant) PhoneConversationPager(phoneController, phonePage, { phonePage = it }) {
          AssistantScreen(connection, readingPosition,
          rootInsets, insets, onRetryConversation,
          onCreateConversation, onLoadOlderHistory, onLoadReferences, onAddDraftRef,
          onNoteFileContent,
          onRetryPendingInput,
          onReloadModels, onSelectModel, onSelectThinking, onLoadQueuedInputs,
          onUpdateQueuedInput, onCancelQueuedInput, onReloadAgents, onSwitchAgent,
          onReloadContext,
          onLoadContextPanel, onSetContextDirectory, onAddContextFile, onCreateContextConversation,
          onRefreshClarification, onRespondToClarification, onRefreshConnectionWait, onConnectionWaitAction,
          onOpenExecution, onRetryExecution, onCloseExecution,
          onCopyMessageText, onSaveMessageAsNote, onReuseMessage, onRegenerateMessage,
          onLoadMessageMedia, reader, onOpenMessageTarget = { target ->
            when (target.kind) {
              "note" -> openLinkedDetail(HomeTab.Notes, target.id)
              "progress" -> onSelectTab(HomeTab.Progress)
              "task" -> taskNavigation.open(target.id, connection, onOpen = onOpenTaskChat)
              "project" -> openLinkedDetail(HomeTab.Projects, target.id)
              "automation" -> openLinkedDetail(HomeTab.Automations, target.id)
              "session" -> { onSelectConversation(target.id); onSelectTab(HomeTab.Assistant) }
              "user_assertion" -> {
                personalReturnPage = "settings"; personalDetailId = target.id; personalPage = "detail"
                onOpenPersonalAssertion(target.id); onSelectTab(HomeTab.Me)
              }
              "settings" -> { personalPage = "settings"; onSelectTab(HomeTab.Me) }
            }
          },
          { value ->
            assistantComposerValue = value
            onDraftChange(value.text)
          }, { assistantFocusRevision++ },
          assistantReferenceKind, { assistantReferenceKind = it },
          assistantReferenceQuery, { assistantReferenceQuery = it },
          agentPickerOpen, { agentPickerOpen = it },
          { assistantActionsOpen = it }, onLoadPersonalVoiceChoices, onUpdatePersonalAgentProfile,
          onLoadPersonalProactivity, onSavePersonalProactivity, onUploadPersonalAvatar, onLoadPersonalModel, onSavePersonalModel,
          phoneAvailable = phoneUi.summary?.available == true, phoneNeedsUser = phoneUi.summary?.access != "none" && phoneUi.attention,
          onOpenPhone = { phonePage = true },
          onShareConversation = onBeginConversationShare,
          messageSearchOpen = messageSearchOpen,
          onMessageSearchOpenChange = { messageSearchOpen = it },
          onOpenSidebar = openSidebar, onRetryHomeChat = onOpenPersonalAgent,
          onCloseAutomationConfiguration = ::closeAutomationConfiguration,
          projectChatTitle = projectChatTitle.takeIf { showingProjectChat },
          onCloseProjectChat = { closeKeyboard(); closeProjectChat() },
          onOpenPersonalOverview = {
            closeKeyboard()
            overviewState.removeState("personal-overview-$gatewayId")
            personalOverviewOpen = true
          },
          sidebarGesture = Modifier.horizontalSwipe(
            !sidebar.open && !assistantActionsOpen && !messageSearchOpen && !inputVoiceHeld &&
              !isTaskChat(connection) && !connection.automationConfigurationChat && !showingProjectChat &&
              !showOverview && !phonePage && sidebarWidthPx > 0,
            leftBackEdge, rightBackEdge, allowLeft = false,
            onDrag = {
              if (sidebar.dragFraction == null) closeKeyboard()
              sidebar.dragFraction = (it / sidebarWidthPx).coerceIn(0f, 1f)
            },
            onRelease = { distance, speed ->
              val open = distance >= minOf(sidebarWidthPx * 0.32f, minimumOpenDrag) ||
                distance >= minimumFlickDistance && speed >= minimumFlickVelocity
              val fraction = sidebar.dragFraction ?: 0f
              voiceScope.launch {
                sidebar.settled.snapTo(fraction)
                if (open) openSidebar()
                sidebar.dragFraction = null
              }
            }, onCancel = {
              val fraction = sidebar.dragFraction ?: 0f
              voiceScope.launch { sidebar.settled.snapTo(fraction); sidebar.dragFraction = null }
            }),
          canStartVoiceCall = voiceCall.phase == "idle" && pendingVoiceMode == null &&
            !connection.creatingConversation && conversationId != null && !connection.sending,
          onStartVoiceCall = {
            assistantActionsOpen = false
            requestVoice("auto")
          },
          generatedMediaAccess = generatedMediaAccess.takeUnless { phonePage },
          activeMusic = activeMusic,
          onInlineMusic = { inlineMusicKey = it },
          onExpandMusic = openMusicPlayer,
          taskChrome = { search, options ->
            TaskConversationChrome(connection, taskNavigation, onRestoreConversation, onSelectTab,
              onOpenProgressTask, onProgressTaskCommand, onStartProgressTask, onSaveProgressTask,
              onLoadProgressProjects, search, options, insets.calculateBottomPadding())
          })
        }
        else ConversationsScreen(connection, rootInsets,
          onConversationSearchChange,
          onRefreshConversations, onLoadMoreConversations, {
          onCreateConversation()
          onSelectTab(HomeTab.Assistant)
        }, { id ->
          onSelectConversation(id)
          onSelectTab(HomeTab.Assistant)
        }, { taskId, id ->
          taskNavigation.open(taskId, connection, sourceTab = HomeTab.Conversations, waitsForResult = false) {
            onSelectTaskChildConversation(taskId, id)
            onSelectTab(HomeTab.Assistant)
          }
        }, onBeginRename, onRenameDraftChange, onSaveRename, onCancelRename,
          onTogglePin, onToggleArchive, onBatchConversations,
          onBeginConversationShare, onScheduleDelete, onUndoDelete, exitDestination, startConversationSearch,
          onConversationScope, onLoadProgressProjects, onFetchConversationExperts)
      }
      HomeTab.Progress, HomeTab.Projects, HomeTab.Automations -> if (!isPaired) PairingScreen(
        stringResource(R.string.tab_progress), connection, onPair, onCancelPairing, onScanPairing,
        pairingScanning, pairingScanError, insets)
      else {
        ProgressScreen(connection.progress.takeIf { it.gatewayId == gatewayId }
          ?: ProgressUiState(gatewayId = gatewayId, loading = true),
          rootInsets, onRefreshProgressHome, onRefreshProgressTasks, onLoadMoreProgressTasks,
          onOpenProgressTask, onProgressTaskSearchChange, onSubmitProgressTaskSearch,
          onProgressTaskCommand, onStartProgressTask, onCreateTaskWithChat,
          onLoadProgressProjects, onOpenProgressProject, onCreateProgressTask,
          { taskId -> taskNavigation.open(taskId, connection, sourceTab = selectedTab, onOpen = onOpenTaskChat) },
          onSaveProgressTask, onHomeAction = onProgressHomeAction,
          onLoadAutomations = onLoadAutomations, onOpenAutomation = onOpenAutomation,
          onOpenAutomationRun = onOpenAutomationRun, onAutomationAction = onAutomationAction,
          onArrangeAutomation = { id, prompt -> arrangeAutomation(id, false, prompt) },
          onWriteProject = onWriteProgressProject,
          onCreateProjectNote = { projectId ->
            onCreateProjectNote(projectId)
            openLinkedDetail(HomeTab.Notes, "project-note-$projectId")
          },
          onUpdateAutomation = onUpdateAutomation,
          onDeleteAutomation = onDeleteAutomation,
          onAutomationRunAction = onAutomationRunAction,
          onOpenChat = { id ->
          onSelectConversation(id)
          onSelectTab(HomeTab.Assistant)
        }, onOpenProjectChat = { session ->
          openProjectChat(session.id, session.title.takeUnless { session.isLocalDraft || it.isBlank() } ?: newProjectChatTitle)
        }, onOpenNote = { id -> openLinkedDetail(HomeTab.Notes, id) }, onCreateProjectChat = { projectId ->
          if (!openingProjectChat && !connection.creatingConversation && connection.progress.project?.id == projectId) {
            openingProjectChat = true
            val sourceTab = selectedTab
            val sourceConversation = conversationId
            voiceScope.launch {
              fun sourceActive() = activeGateway == gatewayId && activeTab == sourceTab &&
                activeConversation == sourceConversation && activeProject == projectId
              try {
                val id = onCreateProjectConversation(projectId)
                if (sourceActive()) openProjectChat(id, newProjectChatTitle)
              } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
              } catch (_: Exception) {
                if (sourceActive())
                  Toast.makeText(voiceContext, R.string.project_save_error, Toast.LENGTH_SHORT).show()
              } finally { openingProjectChat = false }
            }
          }
        }, chatBusy = connection.creatingConversation || openingProjectChat,
          initialPage = when (selectedTab) {
            HomeTab.Projects -> if (linkedDetailId == null) "projects" else "project"
            HomeTab.Automations -> if (linkedDetailId == null) "automations" else "automation"
            else -> if (linkedDetailId == null) "overview" else "detail"
          },
          initialItemId = linkedDetailId,
          onExit = {
            if (linkedDetailId != null) tabStateHolder.removeState(tabStateKey)
            exitDestination()
          },
          initialDeliveryKind = libraryDeliveryKind.takeIf { showLibraryDelivery },
          initialDeliveryId = libraryDeliveryId.takeIf { showLibraryDelivery },
          onCloseDelivery = {
            tabStateHolder.removeState(tabStateKey)
            libraryDelivery.value = ""
          },
        )
      }
      HomeTab.Capabilities -> CapabilitiesScreen(rootInsets, connection.personal, connection.agentAvatars, onLoadCapabilities,
        onOpenAgent = { item ->
          if (item.personal) onOpenPersonalAgent() else onCreateAgentConversation(item.id)
          onSelectTab(HomeTab.Assistant)
        }, onExit = exitDestination,
        onPanel = onCapabilityPanel, onSetupChat = onCapabilitySetupChat)
      HomeTab.Notes -> if (!isPaired) PairingScreen(
        stringResource(R.string.library_title), connection, onPair, onCancelPairing, onScanPairing,
        pairingScanning, pairingScanError, insets)
      else if (linkedDetailId == null) {
        val profile = connection.profile
        if (spaceLibraryAccess != null) {
          SpaceLibraryScreen(rootInsets, profile, spaceLibraryAccess, onExit = exitDestination,
            onSource = { source ->
              when {
                source.kind == "task" && source.taskId != null -> libraryDelivery.value = "task:${source.taskId}"
                source.kind == "automation" && source.automationRunId != null -> libraryDelivery.value = "automation:${source.automationRunId}"
                else -> {
                  onSelectConversation(source.conversationId)
                  onSelectTab(HomeTab.Assistant)
                }
              }
            }, onUse = onUseLibraryFile)
        }
      } else {
        NotesScreen(connection.notes.takeIf { it.gatewayId == gatewayId }
        ?: NotesUiState(gatewayId = gatewayId), rootInsets,
        onLoadNotes, onLoadMoreNotes, onOpenNote, onNewNote,
        onNoteDraftChange, onSaveNoteDraft, onCreatedNoteHandled, onOpenNoteDraft,
        onEditNote, onResolveNoteConflict, onNoteMetadataChange,
        onLoadNoteHistory, onLoadNoteSnapshot, onRestoreNoteSnapshot,
        onNoteRestorationHandled, onDeleteNote, onNoteDeletionHandled,
        onShareNote, onDismissNoteShare,
        onAiPreview = onNoteAiPreview, onApplyAi = onApplyNoteAi,
        onContinueChat = onContinueNoteChat,
        onAttachFile = onAttachNoteFile,
        onAttachVoice = onAttachNoteVoice,
        onLoadAttachment = onLoadNoteAttachment,
        onOpenChat = { onSelectTab(HomeTab.Assistant) },
        onNoteFileSpaces = onNoteFileSpaces,
        onNoteFiles = onNoteFiles, onNoteFileText = onNoteFileText,
        onNoteFileContent = onNoteFileContent,
        initialNoteId = linkedDetailId.takeUnless { it.startsWith("project-note-") },
        initialProjectDraft = linkedDetailId.startsWith("project-note-"),
        onExit = {
          linkedDetailId.takeIf { it.startsWith("project-note-") }?.removePrefix("project-note-")
            ?.takeIf { it == connection.progress.projectId }?.let(onOpenProgressProject)
          tabStateHolder.removeState(tabStateKey)
          exitDestination()
        })
      }
      HomeTab.Me -> {
        val profile = connection.profile
        val personal = if (profile == null) PersonalUiState(gatewayId = "")
          else connection.personal.takeIf { it.gatewayId == profile.gatewayId }
            ?: PersonalUiState(gatewayId = profile.gatewayId, loading = true)
        if (personalPage == "goals") PersonalGoalsScreen(personal, rootInsets, onLoadPersonal,
          onSavePersonalGoal, ::leavePersonalPage)
        else if (personalPage == "settings-models" && profile != null && modelSettingsAccess != null)
          ModelSettingsScreen(profile, modelSettingsAccess, rootInsets, ::leavePersonalPage)
        else if (personalPage == "settings-gateways") GatewayProfilesScreen(connection, insets,
          onBack = ::leavePersonalPage, onAdd = { personalPage = "settings-add" },
          onProbe = onProbeGateway,
          onActivate = onActivateGateway, onRename = onRenameGateway,
          onRemove = onRemoveGateway)
        else if (personalPage == "settings-add") PairingScreen(
          stringResource(R.string.gateways_add), connection, onPair, onCancelPairing, onScanPairing,
          pairingScanning, pairingScanError, insets,
          onBack = ::leavePersonalPage)
        else if (personalPage == "settings-sharing") ShareCenterScreen(
          state = connection.shares.takeIf { it.gatewayId == profile?.gatewayId }
            ?: ShareCenterUiState(gatewayId = profile?.gatewayId, loading = profile != null),
          connected = profile != null, insets = insets, onBack = ::leavePersonalPage,
          onRefresh = onLoadShares, onRevoke = onRevokeShare, onExtend = onExtendShare)
        else if (personalPage.startsWith("settings")) SettingsScreen(
          profile = connection.profile, appearanceMode = appearanceMode, colorScheme = colorScheme,
          language = language, section = when (personalPage) {
            "settings-appearance" -> "appearance"
            "settings-language" -> "language"
            "settings-about" -> "about"
            else -> "root"
          }, insets = insets,
          onBack = ::leavePersonalPage,
          onOpenGateways = { personalPage = "settings-gateways" },
          onOpenModelSettings = modelSettingsAccess?.let { { personalPage = "settings-models" } },
          onOpenAppAbout = { personalPage = "settings-about" },
          onOpenAbout = { personalStartSection = "overview"; personalPage = "about" },
          onOpenGoals = { personalPage = "goals" },
          personalAgent = {
            PersonalAgentSettings(personal, onOpenPersonalAgent, onLoadPersonalVoiceChoices,
              onUpdatePersonalAgentProfile, onUploadPersonalAvatar, onLoadPersonalModel, onSavePersonalModel)
          },
          onOpenSharing = { personalPage = "settings-sharing" },
          onOpenAppearance = { personalPage = "settings-appearance" },
          onOpenLanguage = { personalPage = "settings-language" },
          onAppearanceModeChange = onAppearanceModeChange,
          onColorSchemeChange = onColorSchemeChange,
          onLanguageChange = onLanguageChange)
        else AboutYouScreen(personal, personalPage, insets, personalStartSection,
          onBack = ::leavePersonalPage, onOpenList = {}, onOpenDetail = { id ->
            personalReturnPage = "about"
            personalDetailId = id
            personalPage = "detail"
            onOpenPersonalAssertion(id)
          }, onLoadList = onLoadPersonalAssertions,
          onRetryDetail = { if (personalDetailId.isNotBlank()) onOpenPersonalAssertion(personalDetailId) },
          onOpenNotes = { personalPage = "settings"; onSelectTab(HomeTab.Notes) },
          onSaveProfile = onSavePersonalProfile,
          onSaveStatement = onSavePersonalStatement,
          onDeleteAssertion = onDeletePersonalAssertion,
          onStartChat = onStartUnderstandingChat,
          chatBusy = connection.creatingConversation)
      }
    }
    }
    }
  }
    if (showOverview) {
      overviewState.SaveableStateProvider("personal-overview-$gatewayId") {
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        PersonalAgentOverview(personalOverviewAccess, overviewAgent, connection.personal.agentAvatar,
          connection.clarification?.question, onClose = { personalOverviewOpen = false },
          onEdit = { editingOverviewProfile = true },
          onTask = { id -> openLinkedDetail(HomeTab.Progress, id) },
          onSchedule = { prompt -> arrangeAutomation(null, true, prompt) },
          onOpenSchedule = { id -> openLinkedDetail(HomeTab.Automations, id) },
          onDelivery = { delivery ->
            val source = delivery.conversationId ?: overviewAgent.conversationId
            val media = delivery.media
            val target = delivery.target
            when {
              delivery.musicJob != null && gatewayId != null && generatedMediaAccess != null -> {
                if (activeMusic == null || activeMusic.conversationId != source || activeMusic.id != delivery.musicJob)
                  playGeneratedMusic(voiceContext, generatedMediaAccess, MusicTrack(gatewayId, source, delivery.musicJob,
                    delivery.title, delivery.taskTitle ?: overviewAgent.displayName))
                musicPlayerOpen = true
              }
              media != null -> overviewMedia = MessagePreviewRequest(source, media)
              target?.kind == "note" -> openLinkedDetail(HomeTab.Notes, target.id)
              target?.kind == "task" -> openLinkedDetail(HomeTab.Progress, target.id)
              target?.kind == "automation" -> openLinkedDetail(HomeTab.Automations, target.id)
              target?.kind == "project" -> openLinkedDetail(HomeTab.Projects, target.id)
              else -> {
                personalOverviewOpen = false
                onSelectConversation(if (target?.kind == "session") target.id else source)
              }
            }
          }, modifier = Modifier.weight(1f))
          if (activeMusic != null) MusicMiniPlayer(activeMusic, openMusicPlayer,
            Modifier.padding(horizontal = 12.dp, vertical = 5.dp))
          Spacer(Modifier.navigationBarsPadding())
        }
      }
      if (editingOverviewProfile) PersonalAgentProfileSheet(connection.personal, { editingOverviewProfile = false },
        onLoadPersonalVoiceChoices, onUpdatePersonalAgentProfile,
        onUploadAvatar = onUploadPersonalAvatar, onLoadModel = onLoadPersonalModel, onSaveModel = onSavePersonalModel)
      overviewMedia?.let { request ->
        MobilePreviewSheet(onClose = { overviewMedia = null }, heightFraction = 0.95f) {
          MessageMediaPreview(request, onLoadMessageMedia) { overviewMedia = null }
        }
      }
    }
    ChatSidebar(sidebar, sidebarWidth, connection, onClose = { sidebar.open = false }, onRetry = onRefreshRecentConversations,
      onDestination = { destination ->
        sidebar.open = false
        linkedDetails = emptyList()
        returnToSidebar = destination in listOf(HomeTab.Conversations, HomeTab.Progress, HomeTab.Automations)
        if (destination == HomeTab.Progress) tabStateHolder.removeState("${gatewayId}:${destination.name}")
        if (destination == HomeTab.Me) personalPage = "settings"
        onSelectTab(destination)
      },
      onSearch = {
        sidebar.open = false
        linkedDetails = emptyList()
        returnToSidebar = true
        startConversationSearch = true
        onSelectTab(HomeTab.Conversations)
      },
      onPersonal = {
        sidebar.open = false
        onOpenPersonalAgent()
      },
      onNew = {
        sidebar.open = false
        onCreateConversation()
      },
      onConversation = { id ->
        sidebar.open = false
        onSelectConversation(id)
      })
  }
  if (isPaired) ConversationShareSheet(connection, onBeginConversationShare,
    onConfirmConversationShare, onRevokeConversationShare, onDismissConversationShare)
  if (musicPlayerOpen && activeMusic != null) MusicPlayerSheet(activeMusic, { musicPlayerOpen = false },
    onSource = {
      musicPlayerOpen = false
      personalOverviewOpen = false
      if (conversationId != activeMusic.conversationId) onSelectConversation(activeMusic.conversationId)
      onSelectTab(HomeTab.Assistant)
    }, onDownload = { downloadMusic(activeMusic) })
  LaunchedEffect(activeMusic) { if (activeMusic == null) musicPlayerOpen = false }
  var voiceExpanded by remember(voiceCall) { mutableStateOf(true) }
  var voiceMiniX by remember(voiceCall) { mutableStateOf(0f) }
  var voiceMiniY by remember(voiceCall) { mutableStateOf(0f) }
  val miniDensity = LocalDensity.current
  val miniConfiguration = LocalConfiguration.current
  val voiceMiniMaxX = with(miniDensity) { miniConfiguration.screenWidthDp.dp.toPx() * 0.05f }
  val voiceMiniMaxY = with(miniDensity) { miniConfiguration.screenHeightDp.dp.toPx() * 0.75f }
  LaunchedEffect(voiceCall.phase) { if (voiceCall.phase == "idle") voiceExpanded = true }
  if (voiceCall.phase != "idle" && voiceExpanded) AlertDialog(
    onDismissRequest = { voiceExpanded = false },
    modifier = Modifier.testTag("voice-call-dialog"),
    title = { Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(if (voiceCall.mode == "natural")
        R.string.assistant_action_voice_natural else R.string.assistant_action_voice_assistant))
      TextButton(onClick = { voiceExpanded = false }, modifier = Modifier.testTag("voice-minimize")) {
        Text(stringResource(R.string.voice_minimize))
      }
    } },
    text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(when (voiceCall.phase) {
        "connecting" -> stringResource(R.string.voice_connecting)
        "recovering" -> stringResource(R.string.voice_reconnecting)
        "connected" -> stringResource(if (voiceCall.speaking) R.string.voice_speaking
          else if (voiceCall.activity.isNotBlank() || voiceCall.taskId.isNotBlank()) R.string.voice_working
          else R.string.voice_listening)
        else -> stringResource(R.string.voice_paused)
      }, style = MaterialTheme.typography.titleMedium)
      if (voiceCall.userText.isNotBlank()) Text(voiceCall.userText,
        modifier = Modifier.testTag("voice-user-transcript"))
      if (voiceCall.assistantText.isNotBlank()) MarkdownContent(voiceCall.assistantText,
        modifier = Modifier.testTag("voice-assistant-transcript"))
      voiceCall.clarification?.let { pending ->
        ClarificationCard(pending, voiceCall.clarificationBusy, voiceCall.error.ifBlank { null },
          onCommand = { command -> voiceScope.launch { voiceCall.answerClarification(command) } }, modifier = Modifier.fillMaxWidth())
      }
      voiceCall.approval?.let { approval ->
        Text(stringResource(R.string.voice_approval_needed),
          style = MaterialTheme.typography.titleSmall)
        Text(approval.actionId)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = { voiceScope.launch { voiceCall.answerApproval(false) } },
            enabled = !voiceCall.approvalBusy,
            modifier = Modifier.testTag("voice-approval-deny")) {
            Text(stringResource(R.string.voice_approval_deny))
          }
          Button(onClick = { voiceScope.launch { voiceCall.answerApproval(true) } },
            enabled = !voiceCall.approvalBusy,
            modifier = Modifier.testTag("voice-approval-allow")) {
            Text(stringResource(R.string.voice_approval_allow))
          }
        }
      }
      if (voiceCall.error.isNotBlank()) Text(stringResource(when (voiceCall.error) {
        "NETWORK", "route_lost", "OMNI_CONNECTION_CLOSED", "OMNI_CONNECTION_FAILED" ->
          R.string.voice_error_network
        "CAPTURE_FAILED", "CAPTURE_INTERRUPTED" -> R.string.voice_error_microphone
        "PLAYBACK_FAILED", "PLAYBACK_STALLED", "AUDIO_QUEUE_FULL" -> R.string.voice_error_playback
        "NO_RESPONSE_AUDIO" -> R.string.voice_reply_text_only
        "RESPONSE_FAILED" -> R.string.voice_reply_interrupted
        "INPUT_BACKPRESSURE", "EMPTY_UTTERANCE" -> R.string.voice_repeat_input
        "INPUT_DROPPED" -> if (voiceCall.phase == "connected") R.string.voice_repeat_input else R.string.voice_error_input_dropped
        "ROUTE_CHANGE_FAILED" -> R.string.voice_error_route
        "TIME_LIMIT" -> R.string.voice_error_time_limit
        "background" -> R.string.voice_error_background
        else -> R.string.voice_error_generic
      }),
        color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("voice-call-error"))
      if (voiceCall.phase == "paused" && activeVoiceConversationId != null)
        TextButton(onClick = { voiceScope.launch {
          voiceCall.start(requireNotNull(activeVoiceConversationId), voiceCall.mode)
        } }, modifier = Modifier.testTag("voice-retry")) {
          Text(stringResource(R.string.voice_retry))
        }
      if (voicePermissionDenied) Text(stringResource(R.string.voice_permission_denied),
        color = MaterialTheme.colorScheme.error)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        VoiceCallToggle(R.string.voice_mute, R.drawable.action_microphone, voiceCall.requestedMute, voiceCall.phase == "connected", "voice-mute") {
          voiceCall.changeMuted(!voiceCall.requestedMute)
        }
        VoiceCallToggle(R.string.voice_speaker, R.drawable.action_speaker, voiceCall.speaker, voiceCall.phase == "connected", "voice-speaker") {
          voiceCall.changeSpeaker(!voiceCall.speaker)
        }
        TextButton(onClick = voiceCall::stopReply,
          enabled = voiceCall.phase == "connected" &&
            (if (voiceCall.taskId.isNotBlank()) !voiceCall.taskCancelling else voiceCall.hasReply),
          modifier = Modifier.testTag("voice-stop-reply")) {
          Text(stringResource(if (voiceCall.taskId.isNotBlank()) R.string.voice_cancel_task
            else R.string.voice_stop_reply))
        }
      }
    } },
    confirmButton = { TextButton(onClick = { voiceScope.launch { voiceCall.stop() } },
      modifier = Modifier.testTag("voice-end")) { Text(stringResource(R.string.voice_end)) } })
  if (voiceCall.phase != "idle" && !voiceExpanded) Popup(
    alignment = Alignment.BottomCenter,
    offset = IntOffset(voiceMiniX.roundToInt(), voiceMiniY.roundToInt() - 110),
    properties = PopupProperties(focusable = false)) {
    Card(onClick = { voiceExpanded = true },
      modifier = Modifier.fillMaxWidth(0.9f).navigationBarsPadding()
        .pointerInput(voiceCall) { detectDragGestures { change, drag ->
          change.consume()
          voiceMiniX = (voiceMiniX + drag.x).coerceIn(-voiceMiniMaxX, voiceMiniMaxX)
          voiceMiniY = (voiceMiniY + drag.y).coerceIn(-voiceMiniMaxY, 0f)
        } }.testTag("voice-call-mini")) {
      Row(modifier = Modifier.fillMaxWidth().padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text("◉", color = MaterialTheme.colorScheme.primary)
        Column(modifier = Modifier.weight(1f)) {
          Text(stringResource(if (voiceCall.mode == "natural")
            R.string.assistant_action_voice_natural else R.string.assistant_action_voice_assistant),
            maxLines = 1)
          Text(stringResource(when (voiceCall.phase) {
            "connecting" -> R.string.voice_connecting
            "recovering" -> R.string.voice_reconnecting
            "paused" -> R.string.voice_paused
            else -> if (voiceCall.speaking) R.string.voice_speaking else R.string.voice_listening
          }), style = MaterialTheme.typography.bodySmall)
        }
        TextButton(onClick = { voiceScope.launch { voiceCall.stop() } },
          modifier = Modifier.testTag("voice-mini-end")) { Text(stringResource(R.string.voice_end)) }
      }
    }
  }
}

private fun ConnectionUiState.matchesComposer(gatewayId: String?, conversationId: String?): Boolean =
  profile?.gatewayId == gatewayId && selectedConversationId == conversationId

@Composable
private fun MainBottomSurface(tag: String, expanded: Boolean,
  content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
  Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).testTag(tag)
    .background(if (expanded) MaterialTheme.colorScheme.surface else Color.Transparent, themedCorners(28)),
    content = content)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DraftAttachmentStrip(items: List<ChatAttachment>, scopeKey: String?, tagPrefix: String,
  canRemove: Boolean, onRemove: (String) -> Unit,
  onPreviewImage: suspend (ChatAttachment) -> Bitmap?,
  onPreviewFile: suspend (ChatAttachment) -> ByteArray?) {
  var previewId by remember(scopeKey) { mutableStateOf<String?>(null) }
  val previewItem = items.firstOrNull { it.id == previewId && it.type == "image" }
  val previewFile = items.firstOrNull { it.id == previewId && it.type == "document" }
  val previewLabel = stringResource(R.string.assistant_attachment_preview)
  val removeLabel = stringResource(R.string.assistant_attachment_remove)
  if (items.isNotEmpty()) {
    Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
      .padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically) {
      items.forEach { item ->
        if (item.type == "image") {
          val loaded by produceState<Pair<Boolean, Bitmap?>>(false to null,
            scopeKey, item.id, item.size) {
            value = true to runCatching { onPreviewImage(item) }.getOrNull()
          }
          Box(modifier = Modifier.size(96.dp).clip(themedCorners(12))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable { previewId = item.id }
            .semantics { contentDescription = "$previewLabel: ${item.name}" }
            .testTag("$tagPrefix-attachment-${item.id}")) {
            if (loaded.second != null) Image(loaded.second!!.asImageBitmap(),
              contentDescription = null, modifier = Modifier.fillMaxSize()
                .testTag("$tagPrefix-attachment-thumbnail-${item.id}"),
              contentScale = ContentScale.Crop)
            else Box(Modifier.fillMaxSize().padding(8.dp), contentAlignment = Alignment.Center) {
              if (!loaded.first) BrandLoadingIndicator(Modifier.size(24.dp))
              else Text(item.name, style = MaterialTheme.typography.labelSmall, maxLines = 3,
                overflow = TextOverflow.Ellipsis)
            }
            TextButton(onClick = { onRemove(item.id) }, enabled = canRemove,
              modifier = Modifier.align(Alignment.TopEnd).size(34.dp)
                .background(Color.Black.copy(alpha = 0.7f), CircleShape)
                .semantics { contentDescription = "$removeLabel: ${item.name}" }
                .testTag("$tagPrefix-attachment-remove-${item.id}"),
              contentPadding = PaddingValues(0.dp)) {
              Text("×", color = Color.White, style = MaterialTheme.typography.titleMedium)
            }
          }
        } else {
          Row(modifier = Modifier.clip(themedCorners(12))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable { previewId = item.id }.padding(start = 12.dp)
            .testTag("$tagPrefix-attachment-${item.id}"),
            verticalAlignment = Alignment.CenterVertically) {
            Text(item.name, modifier = Modifier.size(width = 130.dp, height = 48.dp)
              .padding(top = 14.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            TextButton(onClick = { onRemove(item.id) }, enabled = canRemove,
              modifier = Modifier.testTag("$tagPrefix-attachment-remove-${item.id}")) {
              Text(stringResource(R.string.assistant_attachment_remove))
            }
          }
        }
      }
    }
  }
  if (previewItem != null) {
    ModalBottomSheet(onDismissRequest = { previewId = null },
      modifier = Modifier.testTag("$tagPrefix-attachment-preview")) {
      val loaded by produceState<Pair<Boolean, Bitmap?>>(false to null,
        scopeKey, previewItem.id, previewItem.size) {
        value = true to runCatching { onPreviewImage(previewItem) }.getOrNull()
      }
      Text(previewItem.name, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
        style = MaterialTheme.typography.titleMedium, maxLines = 2,
        overflow = TextOverflow.Ellipsis)
      Box(modifier = Modifier.fillMaxWidth()
        .height((LocalConfiguration.current.screenHeightDp * 0.6f).dp)
        .padding(16.dp), contentAlignment = Alignment.Center) {
        if (loaded.second != null) Image(loaded.second!!.asImageBitmap(),
          contentDescription = previewItem.name, modifier = Modifier.fillMaxSize()
            .testTag("$tagPrefix-attachment-preview-image"), contentScale = ContentScale.Fit)
        else if (!loaded.first) BrandLoadingIndicator(modifier = Modifier.fillMaxWidth())
        else Text(stringResource(R.string.assistant_attachment_preview_unavailable),
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
  if (previewFile != null) {
    ModalBottomSheet(onDismissRequest = { previewId = null },
      modifier = Modifier.testTag("$tagPrefix-file-preview")) {
      val loaded by produceState<Pair<Boolean, ByteArray?>>(false to null, scopeKey, previewFile.id) {
        value = true to runCatching { onPreviewFile(previewFile) }.getOrNull()
      }
      Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(previewFile.name, style = MaterialTheme.typography.titleMedium)
        if (!loaded.first) BrandLoadingIndicator()
        else if (loaded.second != null) FilePreviewContent(previewFile.name, previewFile.mimeType, loaded.second!!,
          modifier = Modifier.fillMaxWidth().heightIn(max = 480.dp))
        else Text(stringResource(R.string.message_preview_unavailable))
      }
    }
  }
}

@Composable
private fun AssistantComposer(connection: ConnectionUiState, composerValue: TextFieldValue,
  onComposerValueChange: (TextFieldValue) -> Unit, composerFocus: FocusRequester,
  actionsOpen: Boolean, onActionsOpenChange: (Boolean) -> Unit,
  onRemoveDraftRef: (String, String) -> Unit, onRemoveDraftAttachment: (String) -> Unit,
  onPreviewImage: suspend (String, ChatAttachment) -> Bitmap?,
  onPreviewFile: suspend (String, ChatAttachment) -> ByteArray?,
  onSendMessage: () -> Unit, onStopRun: () -> Unit,
  voiceMode: Boolean, voiceHeld: Boolean, voiceBusy: Boolean, voicePhase: String,
  voiceError: String, voiceDestination: String, voiceSeconds: Int,
  onVoiceToggle: () -> Unit, onVoiceStart: () -> Boolean,
  onVoiceMove: (Float, Float) -> Unit, onVoiceFinish: (String) -> Unit,
  onVoiceCancel: () -> Unit, onVoiceRetry: () -> Unit,
  onDismissVoiceError: () -> Unit, onDismissError: () -> Unit) {
  val focusManager = LocalFocusManager.current
  val keyboardController = LocalSoftwareKeyboardController.current
  val expandedComposer = composerValue.text.isNotEmpty() || connection.draftRefs.isNotEmpty() ||
    connection.draftAttachments.isNotEmpty()
  val showVoicePad = voiceMode || voicePhase != "idle"
  val toggleActions: () -> Unit = {
    if (!actionsOpen) {
      focusManager.clearFocus(force = true)
      keyboardController?.hide()
    }
    onActionsOpenChange(!actionsOpen)
  }
  Column(modifier = Modifier.fillMaxWidth()) {
    val feedback = when {
      connection.sendError -> when {
        connection.sendErrorDetail != null -> stringResource(R.string.assistant_send_rejected_detail, connection.sendErrorDetail)
        connection.sendRejected -> stringResource(R.string.assistant_send_rejected)
        else -> stringResource(R.string.assistant_send_error)
      }
      connection.attachmentError -> stringResource(R.string.assistant_attachment_error)
      else -> ""
    }
    ComposerFeedback(feedback, onDismissError, Modifier.testTag("assistant-attachment-error"),
      scopeKey = connection.profile?.gatewayId to connection.selectedConversationId)
    if (connection.attachmentLoading) BrandLoadingIndicator(modifier = Modifier.fillMaxWidth()
      .testTag("assistant-attachment-loading"))
    ComposerFeedback(voiceError, onDismissVoiceError, Modifier.testTag("assistant-voice-error"), autoDismiss = false)
    if (connection.pendingDeleteId == connection.selectedConversationId) {
      Text(stringResource(R.string.conversations_pending_delete), color = MaterialTheme.colorScheme.error)
    }
    Column(modifier = Modifier.fillMaxWidth().heightIn(max = 152.dp)
      .verticalScroll(rememberScrollState())) {
    connection.draftRefs.forEach { ref ->
      Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        val kindLabel = when (ref.kind) {
          "note" -> stringResource(R.string.assistant_action_reference_note)
          "task" -> stringResource(R.string.assistant_action_reference_task)
          else -> stringResource(R.string.assistant_assertion_ref)
        }
        Text(kindLabel + " · " + ref.title.ifBlank { ref.sourceId },
          modifier = Modifier.weight(1f).testTag("assistant-ref-${ref.kind}-${ref.sourceId}"),
          style = MaterialTheme.typography.bodySmall, maxLines = 1,
          overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = { onRemoveDraftRef(ref.kind, ref.sourceId) },
          enabled = !connection.sending && connection.pendingInput == null,
          modifier = Modifier.testTag("assistant-remove-ref-${ref.kind}-${ref.sourceId}")) {
          Text(stringResource(R.string.assistant_remove_ref))
        }
      }
    }
    DraftAttachmentStrip(connection.draftAttachments,
      "${connection.profile?.gatewayId}:${connection.selectedConversationId}", "assistant",
      !connection.attachmentLoading && !connection.sending && connection.pendingInput == null,
      onRemoveDraftAttachment,
      { item -> connection.selectedConversationId?.let { onPreviewImage(it, item) } },
      { item -> connection.selectedConversationId?.let { onPreviewFile(it, item) } })
    }
    val personalAgent = connection.personal.agent?.takeIf { it.conversationId == connection.selectedConversationId }
    Column(modifier = Modifier.fillMaxWidth()
      .background(if (actionsOpen) Color.Transparent else MaterialTheme.colorScheme.surfaceContainer,
        themedCorners(28)).testTag("assistant-composer-shell")) {
      Row(modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.Bottom) {
        if (!expandedComposer) {
          VoiceInputToggle(voiceMode, voiceBusy || voicePhase != "idle" || connection.sending, onVoiceToggle)
        }
        if (showVoicePad) {
          VoiceInputPad(Modifier.weight(1f), voiceHeld, voiceBusy, voicePhase,
            voiceDestination, voiceSeconds, onVoiceStart, onVoiceMove, onVoiceFinish,
            onVoiceCancel, onVoiceRetry)
        } else BasicTextField(value = composerValue, onValueChange = onComposerValueChange,
          modifier = Modifier.weight(1f).heightIn(min = 48.dp).focusRequester(composerFocus)
            .onFocusChanged { if (it.isFocused) onActionsOpenChange(false) }
            .padding(horizontal = 12.dp, vertical = 10.dp).testTag("assistant-input"),
          textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
          maxLines = 5, enabled = !connection.historyLoading &&
            connection.pendingDeleteId != connection.selectedConversationId,
          decorationBox = { innerTextField ->
            Box {
              if (composerValue.text.isEmpty()) Text(if (personalAgent == null) stringResource(R.string.assistant_input_hint)
                else stringResource(R.string.chat_ask_personal, personalAgent.displayName),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
              innerTextField()
            }
          })
        if (!expandedComposer) {
          AssistantAddAction(connection, actionsOpen, toggleActions, voiceBusy || voiceHeld)
          AssistantComposerButtons(connection, onSendMessage, onStopRun, voiceBusy || voiceHeld)
        }
      }
      if (expandedComposer) {
        Row(modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp),
          horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
          VoiceInputToggle(voiceMode, voiceBusy || voicePhase != "idle" || connection.sending, onVoiceToggle)
          Spacer(Modifier.weight(1f))
          AssistantAddAction(connection, actionsOpen, toggleActions, voiceBusy || voiceHeld)
          AssistantComposerButtons(connection, onSendMessage, onStopRun, voiceBusy || voiceHeld)
        }
      }
    }
  }
}

@Composable
private fun VoiceInputPad(modifier: Modifier, voiceHeld: Boolean, voiceBusy: Boolean,
  voicePhase: String, voiceDestination: String, voiceSeconds: Int,
  onVoiceStart: () -> Boolean, onVoiceMove: (Float, Float) -> Unit,
  onVoiceFinish: (String) -> Unit, onVoiceCancel: () -> Unit, onVoiceRetry: () -> Unit) {
  val holdLabel = stringResource(R.string.voice_input_hold)
  val density = LocalDensity.current
  val currentVoiceStart by rememberUpdatedState(onVoiceStart)
  val currentVoiceMove by rememberUpdatedState(onVoiceMove)
  val currentVoiceFinish by rememberUpdatedState(onVoiceFinish)
  val currentVoiceCancel by rememberUpdatedState(onVoiceCancel)
  Column(modifier) {
    if (voiceHeld) Row(modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 16.dp),
      horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
      Text("✕", color = if (voiceDestination == "cancel") MaterialTheme.colorScheme.error
        else MaterialTheme.colorScheme.onSurfaceVariant)
      Text("◖))  %02d:%02d".format(voiceSeconds / 60, voiceSeconds % 60),
        color = MaterialTheme.colorScheme.primary)
      Text("☷", color = if (voiceDestination == "text") MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (voicePhase == "ready" && !voiceBusy) Row(modifier = Modifier.fillMaxWidth().height(48.dp),
      verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = onVoiceCancel, modifier = Modifier.weight(1f)
        .testTag("assistant-voice-cancel")) { Text(stringResource(R.string.progress_cancel)) }
      TextButton(onClick = onVoiceRetry, modifier = Modifier.weight(1f)
        .testTag("assistant-voice-retry")) { Text(stringResource(R.string.voice_input_retry)) }
    } else Box(modifier = Modifier.fillMaxWidth().height(48.dp)
      .pointerInput(voiceBusy) {
        awaitEachGesture {
          val down = awaitFirstDown(requireUnconsumed = false)
          if (!currentVoiceStart()) return@awaitEachGesture
          var destination = "send"
          var released = false
          do {
            val event = awaitPointerEvent()
            val change = event.changes.firstOrNull { it.id == down.id }
            if (change == null) break
            val dx = (change.position.x - down.position.x) / density.density
            val dy = (change.position.y - down.position.y) / density.density
            destination = voiceRecordingDestination(dx, dy, destination)
            currentVoiceMove(dx, dy)
            released = !change.pressed
          } while (!released)
          if (released) currentVoiceFinish(destination) else currentVoiceCancel()
        }
      }.semantics { contentDescription = holdLabel }
      .testTag("assistant-voice-record"), contentAlignment = Alignment.Center) {
      Text(when {
        voiceBusy -> stringResource(R.string.voice_input_working)
        voiceDestination == "cancel" -> stringResource(R.string.voice_input_release_cancel)
        voiceDestination == "text" -> stringResource(R.string.voice_input_release_text)
        voiceHeld -> stringResource(R.string.voice_input_release_send)
        else -> stringResource(R.string.voice_input_hold)
      }, color = if (voiceDestination == "cancel") MaterialTheme.colorScheme.error
        else MaterialTheme.colorScheme.onSurface)
    }
  }
}

private fun voiceRecordingDestination(dx: Float, dy: Float, current: String): String {
  if (current == "cancel" && dy < -52 && dx < -24) return "cancel"
  if (current == "text" && dy < -52 && dx > 24) return "text"
  return when {
    dy < -72 && dx < -40 -> "cancel"
    dy < -72 && dx > 40 -> "text"
    else -> "send"
  }
}

@Composable
internal fun VoiceCallToggle(label: Int, icon: Int, active: Boolean, enabled: Boolean, tag: String, onClick: () -> Unit) {
  val colors = MaterialTheme.colorScheme
  TextButton(onClick = onClick, enabled = enabled, contentPadding = PaddingValues(4.dp),
    modifier = Modifier.testTag(tag).semantics { selected = active }) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Box(Modifier.size(44.dp).background(
        if (active) colors.primary else colors.surfaceContainerHigh, CircleShape),
        contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(22.dp),
          tint = if (active) colors.onPrimary else colors.onSurface)
      }
      Text(stringResource(label), fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal)
    }
  }
}

@Composable
private fun VoiceInputToggle(active: Boolean, disabled: Boolean, onClick: () -> Unit,
  tag: String = "assistant-voice-toggle") {
  val label = stringResource(if (active) R.string.voice_input_keyboard else R.string.assistant_action_voice)
  IconButton(onClick = onClick, enabled = !disabled,
    modifier = Modifier.size(48.dp).semantics {
      contentDescription = label
    }.testTag(tag)) {
    if (active) Text("⌨", color = MaterialTheme.colorScheme.primary,
      style = MaterialTheme.typography.titleLarge)
    else Icon(painterResource(R.drawable.action_microphone), contentDescription = null,
      tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
  }
}

@Composable
private fun AssistantActionPanel(canRecord: Boolean, canReference: Boolean, onOpenReference: (String) -> Unit,
  canPick: Boolean, onPick: (String) -> Unit, onVoiceAction: () -> Unit,
  canSwitchAgent: Boolean, onOpenAgentPicker: () -> Unit) {
  val actions = listOfNotNull(
    Triple(R.string.assistant_action_photos, R.drawable.action_photo, "photos"),
    Triple(R.string.assistant_action_camera, R.drawable.action_camera, "camera"),
    Triple(R.string.assistant_action_local_files, R.drawable.action_folder, "local-files"),
    Triple(R.string.assistant_action_voice, R.drawable.action_microphone, "voice"),
    Triple(R.string.assistant_action_reference_note, R.drawable.tab_notes, "reference-note"),
    Triple(R.string.assistant_action_reference_task, R.drawable.tab_progress, "reference-task"),
    Triple(R.string.assistant_action_reference_file, R.drawable.action_folder, "reference-file"),
    Triple(R.string.assistant_action_switch_agent, R.drawable.tab_assistant, "switch-agent").takeIf { canSwitchAgent },
  )
  Column(Modifier.fillMaxWidth().padding(horizontal = 6.dp).padding(top = 2.dp, bottom = 10.dp)
    .testTag("assistant-action-panel"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    actions.chunked(4).forEach { row ->
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        row.forEach { (label, icon, id) ->
          val enabled = when (id) {
            "voice" -> canRecord
            "switch-agent" -> canSwitchAgent
            "reference-note", "reference-task" -> canReference
            else -> canPick
          }
          TextButton(onClick = {
            when {
              id == "voice" -> onVoiceAction()
              id == "switch-agent" -> onOpenAgentPicker()
              id.startsWith("reference-") -> onOpenReference(id.removePrefix("reference-"))
              else -> onPick(id)
            }
          }, enabled = enabled, modifier = Modifier.weight(1f).height(84.dp).testTag("assistant-action-$id"),
            shape = themedCorners(14), contentPadding = PaddingValues(0.dp)) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
              Box(Modifier.size(48.dp).background(MaterialTheme.colorScheme.surfaceContainerHighest, themedCorners(14)),
                contentAlignment = Alignment.Center) {
                Icon(painterResource(icon), null, Modifier.size(24.dp),
                  tint = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else .5f))
              }
              Text(stringResource(label), style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
          }
        }
        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
      }
    }
  }
}

@Composable
private fun AssistantAddAction(connection: ConnectionUiState, open: Boolean, onClick: () -> Unit, voiceBusy: Boolean) {
  val label = stringResource(if (open) R.string.composer_close_actions else R.string.composer_add_actions)
  IconButton(onClick, enabled = !voiceBusy && !connection.sending && !connection.attachmentLoading &&
    connection.pendingDeleteId != connection.selectedConversationId,
    modifier = Modifier.size(44.dp).testTag("assistant-actions-toggle")) {
    Icon(painterResource(if (open) R.drawable.action_close else R.drawable.action_add), label,
      Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurface)
  }
}

@Composable
private fun AssistantComposerButtons(connection: ConnectionUiState,
  onSendMessage: () -> Unit, onStopRun: () -> Unit, voiceBusy: Boolean) {
  val hasPayload = connection.draftText.isNotBlank() || connection.draftRefs.isNotEmpty() ||
    connection.draftAttachments.isNotEmpty()
  if (hasPayload) {
    val sendLabel = stringResource(R.string.assistant_send)
    IconButton(onClick = onSendMessage, modifier = Modifier.size(48.dp)
      .semantics { contentDescription = sendLabel }.testTag("assistant-send")
      .background(if (connection.sending) MaterialTheme.colorScheme.surfaceContainerHigh
        else LocalChatColors.current.action, CircleShape),
      enabled = !voiceBusy && !connection.sending && !connection.taskScopeLoading &&
        !connection.attachmentLoading &&
        connection.draftModelReady && connection.realtimeStatus == "connected" &&
        connection.pendingInput == null && connection.pendingDeleteId != connection.selectedConversationId) {
      if (connection.sending) BrandLoadingIndicator(extent = 24.dp)
      else Text("↑", style = MaterialTheme.typography.titleLarge,
        color = LocalChatColors.current.onAction)
    }
  }
  if (connection.activeRunId != null) {
    val stopLabel = stringResource(if (connection.stoppingRun) R.string.assistant_stopping
      else R.string.assistant_stop)
    if (connection.stoppingRun) Text(stopLabel, style = MaterialTheme.typography.labelSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant)
    IconButton(onClick = onStopRun, modifier = Modifier.size(48.dp)
      .semantics { contentDescription = stopLabel }.testTag("assistant-stop")
      .background(MaterialTheme.colorScheme.onSurface, CircleShape),
      enabled = !connection.stoppingRun) {
      Text("■", color = MaterialTheme.colorScheme.surface)
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AssistantScreen(connection: ConnectionUiState, readingPosition: ChatReadingPosition, insets: PaddingValues,
  bottomChromeInsets: PaddingValues,
  onRetryConversation: (String) -> Unit, onCreateConversation: () -> Unit,
  onLoadOlderHistory: () -> Unit,
  onLoadReferences: (String, String) -> Unit,
  onAddDraftRef: (ReferencePickerItem) -> Boolean,
  onSessionFileContent: suspend (String) -> ByteArray,
  onRetryPendingInput: () -> Unit,
  onReloadModels: () -> Unit, onSelectModel: (String) -> Unit,
  onSelectThinking: (String) -> Unit,
  onLoadQueuedInputs: () -> Unit,
  onUpdateQueuedInput: (String, String?, Int?) -> Unit,
  onCancelQueuedInput: (String) -> Unit,
  onReloadAgents: () -> Unit, onSwitchAgent: (String, Boolean) -> Unit,
  onReloadContext: () -> Unit,
  onLoadContextPanel: (String, String, String) -> Unit,
  onSetContextDirectory: () -> Unit,
  onAddContextFile: (ManagedFile) -> Unit,
  onCreateContextConversation: (String?, String?) -> Unit,
  onRefreshClarification: () -> Unit,
  onRespondToClarification: (ClarificationCommand) -> Unit,
  onRefreshConnectionWait: () -> Unit,
  onConnectionWaitAction: suspend (ai.xopc.mobile.gateway.ConnectionWaitSnapshot, String, String?, String?) -> String?,
  onOpenExecution: (String) -> Unit,
  onRetryExecution: () -> Unit, onCloseExecution: () -> Unit,
  onCopyMessageText: (String) -> Unit,
  onSaveMessageAsNote: (String) -> Unit,
  onReuseMessage: (String) -> Boolean,
  onRegenerateMessage: (String) -> Boolean,
  onLoadMessageMedia: suspend (String, ConversationMedia) -> ByteArray,
  reader: ReadAloudController,
  onOpenMessageTarget: (ConversationTarget) -> Unit,
  onComposerValueChange: (TextFieldValue) -> Unit,
  onFocusDraft: () -> Unit,
  referenceKind: String?, onReferenceKindChange: (String?) -> Unit,
  referenceQuery: String, onReferenceQueryChange: (String) -> Unit,
  agentPickerOpen: Boolean, onAgentPickerOpenChange: (Boolean) -> Unit,
  onActionsOpenChange: (Boolean) -> Unit,
  onLoadAgentVoices: () -> Unit = {},
  onUpdateAgentProfile: (String, String, String?, Boolean, String) -> Unit = { _, _, _, _, _ -> },
  onLoadProactivity: suspend () -> ai.xopc.mobile.gateway.PersonalProactivitySettings = { error("UNAVAILABLE") },
  onSaveProactivity: suspend (ai.xopc.mobile.gateway.PersonalProactivitySettings) -> ai.xopc.mobile.gateway.PersonalProactivitySettings = { error("UNAVAILABLE") },
  onUploadAvatar: suspend (ByteArray) -> Unit = {},
  onLoadPersonalModel: LoadPersonalModel? = null, onSavePersonalModel: SavePersonalModel? = null,
  phoneAvailable: Boolean = false, phoneNeedsUser: Boolean = false, onOpenPhone: () -> Unit = {},
  onShareConversation: (String) -> Unit,
  messageSearchOpen: Boolean,
  onMessageSearchOpenChange: (Boolean) -> Unit,
  canStartVoiceCall: Boolean,
  onStartVoiceCall: () -> Unit,
  onOpenSidebar: () -> Unit,
  onRetryHomeChat: () -> Unit,
  onCloseAutomationConfiguration: () -> Unit = {},
  projectChatTitle: String? = null,
  onCloseProjectChat: () -> Unit = {},
  onOpenPersonalOverview: () -> Unit = {},
  sidebarGesture: Modifier,
  generatedMediaAccess: GeneratedMediaAccess? = null,
  activeMusic: MusicTrack? = null,
  onInlineMusic: (String?) -> Unit = {},
  onExpandMusic: () -> Unit = {},
  taskChrome: @Composable (() -> Unit, () -> Unit) -> Unit = { _, _ -> }) {
  val focusManager = LocalFocusManager.current
  val keyboardController = LocalSoftwareKeyboardController.current
  val personalOverviewLabel = stringResource(R.string.personal_overview_open)
  val bottomChromeHeight = bottomChromeInsets.calculateBottomPadding()
  val uriHandler = LocalUriHandler.current
  val context = LocalContext.current
  val speechChat = connection.selectedConversationId?.let { ChatSpeechScope(it, connection.historyTranscriptId) }
  val speechLanguage = LocalConfiguration.current.locales[0].toLanguageTag()
  DisposableEffect(reader, speechChat) {
    onDispose { speechChat?.let(reader::leaveConversation) }
  }
  LaunchedEffect(reader, speechChat, connection.historyLoading, connection.messages, connection.activeRunId, speechLanguage) {
    if (speechChat != null && !connection.historyLoading) {
      val replies = connection.messages.mapNotNull { message ->
        if (message.role != "assistant" || !message.answerConfirmed || message.text.isBlank() ||
          (connection.activeRunId != null && message.turnId == connection.activeRunId) ||
          message.media.any { it.mimeType.startsWith("audio/") }) null
        else ChatSpeechReply(message.id, message.text)
      }
      reader.showConversation(speechChat, replies, speechLanguage)
    }
  }
  LaunchedEffect(connection.selectedConversationId, connection.historyLoading) {
    if (connection.selectedConversationId != null && !connection.historyLoading && !connection.chatError &&
      connection.messages.isEmpty() && connection.context == null && !connection.contextError) onReloadContext()
  }
  val selected = connection.conversationSummary(connection.selectedConversationId)
  var personalSettingsOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var modelPickerOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var thinkingPickerOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var pendingModelChoice by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  var pendingThinkingChoice by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  LaunchedEffect(connection.modelSaving, connection.modelError, connection.selectedModelId, connection.thinkingLevel,
    pendingModelChoice, pendingThinkingChoice) {
    if (!connection.modelSaving) {
      if (pendingModelChoice == connection.selectedModelId) {
        modelPickerOpen = false
        pendingModelChoice = null
      }
      if (pendingThinkingChoice == connection.thinkingLevel) {
        thinkingPickerOpen = false
        pendingThinkingChoice = null
      }
      if (connection.modelError) { pendingModelChoice = null; pendingThinkingChoice = null }
    }
  }
  var queueOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var editingQueuedId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  var editingQueuedContent by remember(connection.selectedConversationId) { mutableStateOf("") }
  var modelQuery by remember(connection.selectedConversationId) { mutableStateOf("") }
  var agentQuery by remember(connection.selectedConversationId) { mutableStateOf("") }
  LaunchedEffect(agentPickerOpen) {
    if (agentPickerOpen) {
      agentQuery = ""
      onReloadAgents()
    }
  }
  var pendingAgentId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  var contextOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var sessionFilesOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var contextInitialMode by remember(connection.selectedConversationId) { mutableStateOf("context") }
  var contextInitialKind by remember(connection.selectedConversationId) { mutableStateOf("note") }
  var optionsOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }

  val optionsLabel = stringResource(R.string.assistant_options)
  val optimisticUser = connection.chatSendMessageId?.takeIf { id ->
    connection.optimisticText.isNotBlank() && !connection.chatSendQueued && connection.messages.none { it.renderId == id }
  }?.let { ConversationMessage(it, "user", connection.optimisticText) }
  val displayMessages = remember(connection.messages, connection.liveMessages, optimisticUser) {
    chatPresentationMessages(connection.messages + listOfNotNull(optimisticUser), connection.liveMessages)
  }
  val isPersonalChat = connection.personal.agent?.let {
    it.state == "ready" && it.conversationId == connection.selectedConversationId
  } == true
  val showStagedProgress = !isPersonalChat && (connection.sending || connection.activeRunId != null ||
    connection.runProgress.terminalStatus != null)
  val answerStarted = displayMessages.any { it.role == "assistant" && it.turnId == connection.runProgress.runId &&
    it.answerConfirmed && it.text.isNotBlank() }
  val latestConnection by rememberUpdatedState(connection)
  val selectedMessageConversationId = connection.selectedConversationId
  val mediaScope = connection.profile?.let { profile ->
    selectedMessageConversationId?.let { id ->
      connection.historyTranscriptId?.let { transcript -> GeneratedMediaScope(profile.gatewayId, profile.deviceId, id, transcript) }
    }
  }
  val generatedMedia = remember(generatedMediaAccess, mediaScope) {
    GeneratedMediaChatState(mediaScope?.let { generatedMediaAccess?.snapshot(it) }.orEmpty())
  }
  val mediaCoroutine = rememberCoroutineScope()
  val mediaLifecycle = LocalLifecycleOwner.current.lifecycle
  val mediaRunActive = connection.activeRunId != null || connection.sending
  LaunchedEffect(generatedMedia, generatedMediaAccess, mediaRunActive, mediaLifecycle, connection.musicJobsRevision) {
    val access = generatedMediaAccess ?: return@LaunchedEffect
    val scope = mediaScope ?: return@LaunchedEffect
    mediaLifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
      generatedMedia.observe(access, scope, mediaRunActive)
    }
  }
  val generatedCards = remember(generatedMedia.items, displayMessages) {
    generatedMediaByReply(generatedMedia.items, displayMessages)
  }
  SideEffect {
    onInlineMusic(activeMusic?.takeIf { track -> track.conversationId == selectedMessageConversationId &&
      generatedMedia.items.any { it.id == track.id && it.kind == GeneratedMediaKind.Music } }?.key)
  }
  val musicPlayback = MusicPlayback.state.collectAsStateWithLifecycle()
  val musicPlaying by remember { derivedStateOf { musicPlayback.value?.phase == MusicPhase.Playing } }
  LaunchedEffect(musicPlaying) {
    if (musicPlaying) { generatedMedia.presentedVideo = null; reader.stop() }
  }
  var previewMusic by remember(mediaScope) { mutableStateOf<MusicTrack?>(null) }
  fun musicTrack(item: GeneratedMediaItem, scope: GeneratedMediaScope) = MusicTrack(scope.gatewayId,
    scope.conversationId, item.id, item.title.orEmpty().ifBlank { context.getString(R.string.music_notification_channel) },
    connection.personal.agent?.displayName?.takeIf { isPersonalChat }
      ?: connection.conversationSummary(selectedMessageConversationId)?.title.orEmpty(),
    item.lyrics, (item.duration ?: 0).coerceIn(0, Int.MAX_VALUE / 1000) * 1000)
  val playGeneratedMedia: (GeneratedMediaItem) -> Unit = { item ->
    reader.stop()
    if (item.kind == GeneratedMediaKind.Music && mediaScope != null) {
      generatedMedia.presentedVideo = null
      playGeneratedMusic(context, generatedMediaAccess, musicTrack(item, mediaScope))
    } else if (item.kind == GeneratedMediaKind.Video && mediaScope != null && generatedMediaAccess != null) {
      focusManager.clearFocus(force = true)
      keyboardController?.hide()
      MusicPlayback.pause()
      generatedMedia.presentedVideo = item
    }
  }
  val openGeneratedMedia: (GeneratedMediaItem) -> Unit = { item ->
    if (item.kind == GeneratedMediaKind.Video) {
      playGeneratedMedia(item)
    } else {
      focusManager.clearFocus(force = true)
      keyboardController?.hide()
      previewMusic = mediaScope?.let { musicTrack(item, it) }
    }
  }
  var musicCardBounds by remember(activeMusic?.key, selectedMessageConversationId) { mutableStateOf<Rect?>(null) }
  var chatContentBounds by remember { mutableStateOf<Rect?>(null) }
  val confirmGeneratedMedia: (GeneratedMediaItem) -> Unit = { card ->
    if (!mediaRunActive && mediaScope != null && generatedMediaAccess != null) {
      mediaCoroutine.launch { generatedMedia.confirm(generatedMediaAccess, mediaScope, card) }
    }
  }
  DisposableEffect(generatedMedia, generatedMediaAccess, mediaLifecycle) {
    val observer = LifecycleEventObserver { _, event ->
      if (event == Lifecycle.Event.ON_STOP) generatedMedia.presentedVideo = null
    }
    mediaLifecycle.addObserver(observer)
    onDispose {
      mediaLifecycle.removeObserver(observer)
      generatedMedia.presentedVideo = null
    }
  }
  val externalLinkFailure = stringResource(R.string.message_open_link_failed)
  var messageActionsId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  var selectingMessageId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  BackHandler(selectingMessageId != null) { selectingMessageId = null }
  var messageDetailId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  val messageDetailScroll = remember(connection.selectedConversationId, messageDetailId) { ScrollState(0) }
  var previewRequest by remember(connection.selectedConversationId) { mutableStateOf<MessagePreviewRequest?>(null) }
  var externalUrl by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  val openLink: (String) -> Unit = { link ->
    val target = messageLinkTarget(link)
    if (target != null && target.kind in setOf("file", "workspace_file")) {
      selectedMessageConversationId?.let { conversationId ->
        val file = ConversationMedia(target.id, target.title, "file", "application/octet-stream", 0,
          if (target.kind == "file") "xopc-file:${target.id}" else "",
          workspaceRelativePath = target.id.takeIf { target.kind == "workspace_file" })
        previewRequest = MessagePreviewRequest(conversationId, file)
      }
    } else if (target != null) onOpenMessageTarget(target)
    else if (externalMessageLink(link)) externalUrl = link
  }
  val showConnectionWait = connection.connectionWait.gatewayId == connection.profile?.gatewayId &&
    connection.connectionWait.conversationId == connection.selectedConversationId &&
    connection.connectionWait.snapshot?.wait?.phase?.let { it != "ready" } == true
  val messageListState = readingPosition.listState
  var positionedAtLatest by readingPosition.positionedAtLatest
  var followBottom by readingPosition.followBottom
  var waitingForUserScrollEnd by remember(readingPosition) { mutableStateOf(false) }
  var userScrolledTowardLatest by remember(readingPosition) { mutableStateOf(false) }
  var olderAnchor by remember(readingPosition) { mutableStateOf<Pair<String, Int>?>(null) }
  val messageDragged by messageListState.interactionSource.collectIsDraggedAsState()
  val density = LocalDensity.current
  val bottomGap = if (showConnectionWait || connection.clarification != null) 104.dp else 12.dp
  val bottomChromePx = with(density) { (bottomChromeHeight + bottomGap).roundToPx() }
  val latestLabelGapPx = with(density) { 24.dp.roundToPx() }
  val latestMarkerPx = with(density) { 1.dp.roundToPx() }
  val showPersonalWaiting = isPersonalChat && (connection.sending || connection.activeRunId != null) && !connection.runError &&
    connection.clarification == null && !connection.liveMessages.any { it.answerConfirmed && it.text.isNotBlank() }
  val hasUnanchoredMedia = generatedCards.containsKey("")
  val leadingRows = if (connection.historyBefore != null) 1 else 0
  val latestRowIndex = leadingRows + displayMessages.size + (if (hasUnanchoredMedia) 1 else 0) +
    (if (showStagedProgress || showPersonalWaiting) 1 else 0)
  var lastTranscript by readingPosition.transcriptId
  LaunchedEffect(connection.historyTranscriptId) {
    val transcript = connection.historyTranscriptId ?: return@LaunchedEffect
    if (lastTranscript != null && lastTranscript != transcript) {
      positionedAtLatest = false
      followBottom = true
    }
    lastTranscript = transcript
  }
  var observedSendSequence by remember(readingPosition) { mutableStateOf(connection.chatSendSequence) }
  LaunchedEffect(connection.chatSendSequence) {
    if (connection.chatSendSequence != observedSendSequence && !connection.chatSendQueued &&
      connection.chatSendMessageId != null) {
      olderAnchor = null
      followBottom = true
    }
    observedSendSequence = connection.chatSendSequence
  }
  fun latestIsVisible(gap: Int): Boolean {
    val layout = messageListState.layoutInfo
    val marker = layout.visibleItemsInfo.lastOrNull { it.key == "assistant-latest" } ?: return false
    return marker.offset + marker.size <= layout.viewportEndOffset - bottomChromePx + gap
  }
  val latestVisible by remember(messageListState, bottomChromePx, latestLabelGapPx) {
    derivedStateOf { latestIsVisible(latestLabelGapPx) }
  }
  val showJumpBottom = positionedAtLatest && !followBottom && !latestVisible
  val jumpScope = rememberCoroutineScope()
  var jumpJob by remember(messageListState) { mutableStateOf<Job?>(null) }
  DisposableEffect(messageListState) {
    onDispose { jumpJob?.cancel() }
  }
  val messageScrollDirection = remember(readingPosition) {
    object : NestedScrollConnection {
      override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        if (source == NestedScrollSource.UserInput && available.y != 0f) {
          jumpJob?.cancel()
          olderAnchor = null
          followBottom = false
          positionedAtLatest = true
          waitingForUserScrollEnd = true
          userScrolledTowardLatest = available.y < 0f
        }
        return Offset.Zero
      }
    }
  }
  LaunchedEffect(readingPosition, bottomChromePx) {
    snapshotFlow { messageListState.isScrollInProgress || messageDragged }.collect { scrolling ->
      if (!scrolling && waitingForUserScrollEnd) {
        waitingForUserScrollEnd = false
        if (userScrolledTowardLatest && latestIsVisible(latestLabelGapPx)) {
          followBottom = true
        }
      }
    }
  }
  LaunchedEffect(connection.historyLoadingOlder, displayMessages.firstOrNull()?.renderId) {
    val saved = olderAnchor ?: return@LaunchedEffect
    if (connection.historyLoadingOlder) return@LaunchedEffect
    val index = displayMessages.indexOfFirst { it.renderId == saved.first }
    if (index >= 0) messageListState.requestScrollToItem(leadingRows + index, -saved.second)
    olderAnchor = null
  }
  fun scrollMessagesToBottom(force: Boolean = false) {
    if (jumpJob != null || waitingForUserScrollEnd || olderAnchor != null ||
      (positionedAtLatest && !followBottom && !force)) return
    val layout = messageListState.layoutInfo
    if (latestRowIndex >= layout.totalItemsCount) return
    if (!latestIsVisible(1) || force) {
      val bottomOffset = (layout.viewportEndOffset - bottomChromePx - latestMarkerPx).coerceAtLeast(0)
      messageListState.requestScrollToItem(latestRowIndex, -bottomOffset)
    }
    positionedAtLatest = true
    followBottom = true
  }
  LaunchedEffect(readingPosition, generatedMedia, latestRowIndex, bottomChromePx) {
    snapshotFlow {
      val latest = latestConnection
      val layout = messageListState.layoutInfo
      listOf(latest.messages.lastOrNull(), latest.liveMessages.lastOrNull(), latest.activeRunId,
        latest.historyLoading, latest.historyLoadingOlder, latest.optimisticText, generatedMedia.items.isNotEmpty(),
        layout.totalItemsCount, layout.viewportSize.height, layout.beforeContentPadding,
        layout.visibleItemsInfo.lastOrNull { it.key == "assistant-latest" }?.offset, followBottom, waitingForUserScrollEnd)
    }.conflate().collect {
      val latest = latestConnection
      if (!latest.historyLoading && !latest.historyLoadingOlder &&
        (latest.messages.isNotEmpty() || latest.liveMessages.isNotEmpty() || latest.optimisticText.isNotBlank() ||
          generatedMedia.items.isNotEmpty())) scrollMessagesToBottom()
    }
  }
  val statusIssue = when {
    connection.chatError -> R.string.chat_load_error
    connection.contextError && connection.taskScopeLoading -> R.string.assistant_task_scope_error
    connection.runError -> R.string.assistant_run_error
    connection.stopError -> R.string.assistant_stop_error
    connection.agentError -> R.string.assistant_agent_error
    connection.modelError -> R.string.assistant_model_error
    else -> null
  }
  val retryStatus: () -> Unit = when (statusIssue) {
    R.string.assistant_task_scope_error -> onReloadContext
    R.string.assistant_agent_error -> onReloadAgents
    R.string.assistant_model_error -> onReloadModels
    else -> { { connection.selectedConversationId?.let(onRetryConversation) } }
  }
  val chatTopInset = WindowInsets.safeDrawing.asPaddingValues().calculateTopPadding()
  val scopedHeader = connection.automationConfigurationChat || projectChatTitle != null
  val taskHeader = isTaskChat(connection)
  var headerHeightPx by remember(scopedHeader, taskHeader, isPersonalChat) { mutableIntStateOf(0) }
  val headerClearance = if (headerHeightPx > 0) with(LocalDensity.current) { headerHeightPx.toDp() }
    else chatTopInset + if (isPersonalChat) 110.dp else 72.dp
  val topClearancePx = with(LocalDensity.current) { headerClearance.toPx() }
  val bottomClearancePx = with(LocalDensity.current) { bottomChromeHeight.toPx() }
  val showStickyMusic = musicPlaying && activeMusic?.conversationId == selectedMessageConversationId &&
    generatedMedia.items.any { it.kind == GeneratedMediaKind.Music && it.id == activeMusic?.id } &&
    chatContentBounds?.let { viewport ->
      musicCardBounds?.let { card ->
        card.height <= 0 || card.bottom <= viewport.top + topClearancePx || card.top >= viewport.bottom - bottomClearancePx
      } ?: true
    } == true
  var stickyMusicHeightPx by remember { mutableIntStateOf(0) }
  val timelineHeaderClearance = headerClearance + if (showStickyMusic) with(density) { stickyMusicHeightPx.toDp() } + 4.dp else 0.dp
  Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(insets)
    .onGloballyPositioned { chatContentBounds = it.boundsInWindow() }
    .pointerInput(focusManager, keyboardController) {
      awaitPointerEventScope {
        while (true) {
          val event = awaitPointerEvent(PointerEventPass.Final)
          if (event.changes.any { !it.pressed && it.previousPressed }) {
            focusManager.clearFocus(force = true)
            keyboardController?.hide()
          }
        }
      }
    }.testTag("assistant-content-area")) {
  Column(modifier = Modifier.fillMaxSize().then(sidebarGesture)
    .padding(start = 12.dp, end = 12.dp, bottom = 16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (connection.selectedConversationId == null) {
      Spacer(Modifier.height(headerClearance))
      if (connection.personal.agentCreating || connection.restoringHomeChat) BrandLoadingPanel()
      else if (connection.personal.agentError) {
        Text(stringResource(R.string.personal_agent_error), color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = onRetryHomeChat) { Text(stringResource(R.string.progress_refresh)) }
      }
      else Text(stringResource(R.string.assistant_choose_conversation), style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
      if (statusIssue != null) Row(modifier = Modifier.fillMaxWidth().padding(top = headerClearance),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(statusIssue), modifier = Modifier.weight(1f),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3)
        TextButton(onClick = retryStatus, modifier = Modifier.testTag("assistant-status-retry")) {
          Text(stringResource(R.string.progress_refresh))
        }
      }
      if (reader.state.phase == "error") ComposerFeedback(
        stringResource(R.string.assistant_speech_error), reader::stop,
        Modifier.padding(top = if (statusIssue == null) headerClearance else 0.dp)
          .testTag("assistant-read-aloud-error"), scopeKey = reader)
      else if (reader.state.phase != "idle") Row(modifier = Modifier.fillMaxWidth()
        .padding(top = if (statusIssue == null) headerClearance else 0.dp)
        .background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(16))
        .padding(horizontal = 8.dp).testTag("assistant-read-aloud-controls"),
        verticalAlignment = Alignment.CenterVertically) {
        if (reader.state.phase == "loading") BrandLoadingIndicator(extent = 20.dp)
        Text(when (reader.state.phase) {
          "loading" -> stringResource(R.string.assistant_speech_loading)
          "waiting" -> stringResource(R.string.assistant_speech_waiting)
          "error" -> stringResource(R.string.assistant_speech_error)
          else -> "${reader.state.segment}/${reader.state.segmentCount}"
        }, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        if (reader.state.phase == "playing" || reader.state.phase == "paused") TextButton(
          onClick = reader::toggle, modifier = Modifier.testTag("assistant-read-aloud-toggle")) {
          Text(stringResource(if (reader.state.phase == "playing") R.string.assistant_pause
            else R.string.assistant_resume))
        }
        TextButton(onClick = reader::stop, modifier = Modifier.testTag("assistant-read-aloud-stop")) {
          Text(stringResource(R.string.assistant_stop))
        }
      }
      if (connection.historyLoading && displayMessages.isEmpty()) {
        Box(modifier = Modifier.weight(1f).padding(top = headerClearance)) { AssistantHistorySkeleton() }
      } else if (!connection.historyLoading && displayMessages.isEmpty() && generatedCards.isEmpty() &&
        connection.historyBefore == null && connection.activeRunId == null &&
        connection.liveText.isBlank() && connection.optimisticText.isBlank() && !showStagedProgress) {
        BoxWithConstraints(modifier = Modifier.weight(1f).fillMaxWidth()
          .padding(top = headerClearance, bottom = bottomChromeHeight).testTag("assistant-welcome-viewport")) {
          if (connection.automationConfigurationChat) AutomationConfigurationWelcome()
          else AssistantWelcome(maxHeight, if (connection.contextLoading || isPersonalChat) null else
            taskRecommendation(connection.taskWelcome) ?: projectRecommendation(connection.projectWelcome),
            personalName = connection.personal.agent?.displayName.takeIf { isPersonalChat },
            standaloneDraft = selected?.isLocalDraft == true && !isPersonalChat &&
              !isTaskChat(connection) && connection.projectWelcome == null) { prompt ->
            onActionsOpenChange(false)
            onComposerValueChange(TextFieldValue(prompt, selection = TextRange(prompt.length)))
            onFocusDraft()
          }
        }
      } else LazyColumn(modifier = Modifier.weight(1f).testTag("assistant-message-list")
        .nestedScroll(messageScrollDirection),
        state = messageListState,
        contentPadding = ChatMessagePadding(bottomChromeInsets, timelineHeaderClearance, bottomGap),
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.Top)) {
        if (connection.historyBefore != null) item(key = "assistant-older") {
          Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (connection.historyLoadingOlder) BrandLoadingIndicator(extent = 20.dp)
            else TextButton(onClick = {
              val visible = messageListState.layoutInfo.visibleItemsInfo.firstOrNull { item ->
                displayMessages.any { it.renderId == item.key }
              }
              olderAnchor = (visible?.key as? String)?.let { it to visible.offset }
              followBottom = false
              onLoadOlderHistory()
            }, modifier = Modifier.testTag("assistant-load-older")) {
              Text(stringResource(if (connection.historyOlderError) R.string.assistant_older_retry
                else R.string.assistant_older_messages))
            }
          }
        }
        val latestMessageId = displayMessages.lastOrNull {
          it.role == "user" || it.role == "assistant"
        }?.id
        items(displayMessages, key = { it.renderId }) { message ->
          Column(Modifier.then(if (connection.liveMessages.any { it.id in message.sourceIds })
            Modifier.testTag("assistant-live-output") else Modifier)) {
          ChatMessageCard(message, onReading = { followBottom = false }, streaming = followBottom && !messageListState.isScrollInProgress && connection.activeRunId != null && connection.liveMessages.any { it.id in message.sourceIds }, actionsEnabled = connection.messages.any { it.id == message.id },
            onMore = {
              selectingMessageId = null
              messageActionsId = message.id
            },
            selectingText = selectingMessageId == message.id,
            onEndSelection = { if (selectingMessageId == message.id) selectingMessageId = null },
            onDismissMenu = { messageActionsId = null },
            menuContent = connection.messages.firstOrNull { it.id == messageActionsId && it.id == message.id }?.let { actionsMessage ->
              {
                val hasText = actionsMessage.text.isNotBlank()
                val codeText = remember(actionsMessage.text) { extractMarkdownCodeBlocks(actionsMessage.text) }
                if (hasText) {
                  MessageMenuItem(R.string.assistant_copy, R.drawable.message_copy, "copy") {
                    messageActionsId = null
                    onCopyMessageText(actionsMessage.text)
                  }
                  MessageMenuItem(R.string.assistant_select_text, R.drawable.message_select_text, "select-text") {
                    messageActionsId = null
                    selectingMessageId = actionsMessage.id
                  }
                }
                if (actionsMessage.role == "assistant") {
                  val assistantIndex = connection.messages.indexOfFirst { it.id == actionsMessage.id }
                  val source = connection.messages.take(assistantIndex.coerceAtLeast(0)).lastOrNull { it.role == "user" }
                  if (source != null && source.text.isNotBlank() && !source.hasNonTextContent) {
                    MessageMenuItem(R.string.assistant_regenerate, R.drawable.action_refresh, "regenerate",
                      enabled = connection.activeRunId == null && !connection.sending && connection.pendingInput == null &&
                        connection.realtimeStatus == "connected") {
                      if (onRegenerateMessage(actionsMessage.id)) messageActionsId = null
                    }
                  }
                  if (hasText && actionsMessage.media.none { it.mimeType.startsWith("audio/") }) {
                    val phase = if (reader.state.sourceId == actionsMessage.id) reader.state.phase else "idle"
                    val label = when (phase) {
                      "playing" -> R.string.assistant_pause
                      "paused" -> R.string.assistant_resume
                      else -> R.string.assistant_read_aloud
                    }
                    MessageMenuItem(label, if (phase == "playing") R.drawable.message_pause else R.drawable.action_speaker,
                      "read-aloud", enabled = phase != "loading") {
                      messageActionsId = null
                      if (phase == "playing" || phase == "paused") reader.toggle()
                      else speechChat?.let { reader.speak(it, ChatSpeechReply(actionsMessage.id, actionsMessage.text)) }
                    }
                  }
                  if (hasText) {
                    MessageMenuItem(R.string.conversations_share, R.drawable.message_share, "share") {
                      messageActionsId = null
                      shareMessageText(context, actionsMessage.text)
                    }
                    MessageMenuItem(R.string.assistant_save_note, R.drawable.message_bookmark, "save-note",
                      enabled = connection.savingMessageNoteId == null) {
                      messageActionsId = null
                      onSaveMessageAsNote(actionsMessage.id)
                    }
                  }
                  MessageMenuItem(R.string.assistant_message_detail, R.drawable.tab_notes, "detail") {
                    messageActionsId = null
                    messageDetailId = actionsMessage.id
                  }
                  MessageMenuItem(R.string.assistant_execution, R.drawable.action_task_list, "execution") {
                    messageActionsId = null
                    onOpenExecution(actionsMessage.id)
                  }
                  if (codeText.isNotEmpty()) MessageMenuItem(R.string.assistant_copy_code, R.drawable.message_copy, "copy-code") {
                    messageActionsId = null
                    onCopyMessageText(codeText)
                  }
                }
                if (actionsMessage.role == "user" && hasText && actionsMessage.text.length <= 32_000 &&
                  !actionsMessage.hasNonTextContent) {
                  MessageMenuItem(R.string.assistant_reuse, android.R.drawable.ic_menu_edit, "reuse",
                    enabled = !connection.sending && connection.pendingInput == null &&
                      !connection.attachmentLoading && connection.draftAttachments.isEmpty() && connection.draftRefs.isEmpty()) {
                    if (onReuseMessage(actionsMessage.id)) {
                      messageActionsId = null
                      onActionsOpenChange(false)
                      onFocusDraft()
                    }
                  }
                }
              }
            },
            onOpenTarget = onOpenMessageTarget,
            onOpenPreview = { media, gallery ->
              previewRequest = MessagePreviewRequest(connection.selectedConversationId, media, gallery)
            }, onOpenLink = openLink, onCopy = onCopyMessageText,
            previewEligible = message.id != latestMessageId && connection.messages.any { it.id == message.id },
            onViewMore = { messageDetailId = message.id },
            revealAnswer = connection.liveMessages.any { it.answerConfirmed && it.id in message.sourceIds },
            loadMedia = { media -> onLoadMessageMedia(selectedMessageConversationId, media) })
            generatedCards[message.renderId]?.let { cards ->
              GeneratedMediaRows(cards, generatedMedia.submitting || mediaRunActive, generatedMedia.failedDraftId,
                playGeneratedMedia, confirmGeneratedMedia, selectedMessageConversationId, activeMusic, openGeneratedMedia) { musicCardBounds = it }
            }
          }
        }
        generatedCards[""]?.let { cards ->
          item(key = "generated-media-unanchored") {
            GeneratedMediaRows(cards, generatedMedia.submitting || mediaRunActive, generatedMedia.failedDraftId,
              playGeneratedMedia, confirmGeneratedMedia, selectedMessageConversationId, activeMusic, openGeneratedMedia) { musicCardBounds = it }
          }
        }
        if (showStagedProgress) {
          item(key = "assistant-waiting") {
            AssistantStagesView(progress = connection.runProgress, answerStarted = answerStarted,
              connected = connection.realtimeStatus == "connected", paused = connection.clarification != null)
          }
        } else if (showPersonalWaiting) {
          item(key = "assistant-waiting") {
            AssistantWaitingBubble(connected = connection.realtimeStatus == "connected")
          }
        }
        item(key = "assistant-latest") { Spacer(Modifier.height(1.dp)) }
      }
      connection.pendingInput?.let { pending ->
        Card(modifier = Modifier.fillMaxWidth().padding(bottom = bottomChromeHeight).testTag("assistant-pending")) {
          Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.assistant_pending_input), style = MaterialTheme.typography.labelMedium)
            if (pending.content.isNotBlank()) Text(pending.content, style = MaterialTheme.typography.bodyMedium)
            pending.attachments.forEach { item ->
              Text(item.name, style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("assistant-pending-attachment-${item.id}"))
            }
            OutlinedButton(onClick = onRetryPendingInput, modifier = Modifier.testTag("assistant-retry"),
              enabled = !connection.sending && !connection.taskScopeLoading &&
                connection.realtimeStatus == "connected" && connection.draftModelReady) {
              Text(stringResource(R.string.assistant_retry))
            }
          }
        }
      }
    }
  }
    if (showStickyMusic && activeMusic != null) {
      MusicMiniPlayer(activeMusic, onExpandMusic,
        Modifier.align(Alignment.TopCenter).padding(top = headerClearance + 4.dp, start = 12.dp, end = 12.dp)
          .onSizeChanged { stickyMusicHeightPx = it.height }, sticky = true)
    }
    val canvas = MaterialTheme.colorScheme.background
    Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(chatTopInset)
      .background(canvas)
      .testTag("chat-status-bar-background"))
    if (scopedHeader) {
      val headerFill = LocalChatColors.current.card
      Row(Modifier.align(Alignment.TopCenter).fillMaxWidth()
        .onSizeChanged { headerHeightPx = it.height }
        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
        .padding(horizontal = 12.dp, vertical = 8.dp).testTag("chat-floating-header"),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        IconButton(onClick = if (connection.automationConfigurationChat) onCloseAutomationConfiguration else onCloseProjectChat,
          modifier = Modifier.background(headerFill, CircleShape)
            .testTag(if (connection.automationConfigurationChat) "automation-configuration-close" else "project-chat-close")) {
          Icon(painterResource(R.drawable.action_chevron_left), stringResource(R.string.progress_back))
        }
        Text(if (connection.automationConfigurationChat) stringResource(R.string.automation_setup_title) else projectChatTitle.orEmpty(),
          modifier = Modifier.weight(1f, fill = false).background(headerFill, themedCorners(16))
            .padding(horizontal = 12.dp, vertical = 8.dp),
          style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    } else if (!taskHeader) {
      val personalAgent = connection.personal.agent?.takeIf { it.state == "ready" &&
        it.conversationId == connection.selectedConversationId }
      Column(Modifier.align(Alignment.TopCenter).fillMaxWidth()
        .onSizeChanged { headerHeightPx = it.height }
        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
        .padding(horizontal = 12.dp, vertical = 8.dp).testTag("chat-floating-header"),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.fillMaxWidth().height(if (personalAgent != null) 64.dp else 48.dp)) {
          IconButton(onClick = onOpenSidebar, modifier = Modifier.align(Alignment.TopStart)
            .background(LocalChatColors.current.card, CircleShape).testTag("chat-header-sidebar")) {
            Icon(painterResource(R.drawable.action_menu), stringResource(R.string.chat_open_drawer), Modifier.size(22.dp))
          }
          if (personalAgent != null) IconButton(onClick = onOpenPersonalOverview,
            modifier = Modifier.align(Alignment.TopCenter).size(62.dp).background(LocalChatColors.current.card, CircleShape).semantics {
              contentDescription = personalOverviewLabel
            }.testTag("chat-personal-overview")) {
            PersonalAgentAvatar(connection.personal.agentAvatar, personalAgent.appearance, 62.dp,
              active = !personalSettingsOpen && !messageSearchOpen)
          }
          Row(Modifier.align(Alignment.TopEnd), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            if (phoneAvailable) IconButton(onClick = onOpenPhone,
              modifier = Modifier.background(LocalChatColors.current.card, CircleShape).testTag("chat-header-phone")) {
              Box {
                Icon(painterResource(R.drawable.action_phone), stringResource(R.string.phone_open), Modifier.size(22.dp))
                if (phoneNeedsUser) Box(Modifier.align(Alignment.TopEnd).size(6.dp)
                  .background(MaterialTheme.colorScheme.primary, CircleShape))
              }
            }
            IconButton(onClick = {
              focusManager.clearFocus()
              keyboardController?.hide()
              onStartVoiceCall()
            }, enabled = canStartVoiceCall,
              modifier = Modifier.background(LocalChatColors.current.card, CircleShape).testTag("chat-header-voice-call")) {
              Icon(painterResource(R.drawable.action_call),
                stringResource(R.string.assistant_action_voice_natural), Modifier.size(22.dp))
            }
            if (personalAgent != null || selected?.isLocalDraft != true) {
              IconButton(onClick = {
                if (personalAgent != null) personalSettingsOpen = true else optionsOpen = true
              }, modifier = Modifier.background(LocalChatColors.current.card, CircleShape).testTag("assistant-options")) {
                Icon(painterResource(if (personalAgent != null) R.drawable.settings_gear else R.drawable.action_more_horizontal),
                  optionsLabel, Modifier.size(22.dp))
              }
            }
          }
        }
        if (personalAgent != null) {
          val attention = connection.progress.needsUser.size
          val attentionColors = LocalAttentionColors.current
          Column(horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.clip(themedCorners(14))
              .background(if (attention > 0) attentionColors.fill else LocalChatColors.current.card)
              .then(if (attention > 0) Modifier.clickable {
                onOpenMessageTarget(ConversationTarget("progress", "", ""))
              } else Modifier)
              .padding(horizontal = 12.dp, vertical = 2.dp)) {
            Text(personalAgent.displayName, Modifier.testTag("chat-personal-name"),
              style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
              maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (attention > 0) Text(stringResource(R.string.progress_attention_count, attention),
              style = MaterialTheme.typography.labelSmall, color = attentionColors.foreground)
          }
        }
      }
    }
  if (isTaskChat(connection)) taskChrome({ onMessageSearchOpenChange(true) }, { optionsOpen = true })
  connection.clarification?.let { prompt ->
    Box(Modifier.align(Alignment.BottomCenter).padding(start = 16.dp, end = 16.dp, bottom = bottomChromeHeight + 8.dp)) {
      ClarificationCard(prompt, connection.clarificationBusy, connection.clarificationError, onRespondToClarification, Modifier.fillMaxWidth())
    }
  }
  if (showConnectionWait && connection.clarification == null) Box(modifier = Modifier.align(Alignment.BottomCenter)
    .padding(start = 16.dp, end = 16.dp, bottom = bottomChromeHeight + 8.dp)) {
    ConnectionWaitCard(connection.connectionWait, onRefreshConnectionWait, onConnectionWaitAction)
  }
  if (showJumpBottom) {
    val jumpLabel = stringResource(R.string.assistant_jump_bottom)
    IconButton(onClick = {
      if (jumpJob == null && !waitingForUserScrollEnd) {
        val job = jumpScope.launch(start = CoroutineStart.LAZY) {
          try {
            val layout = messageListState.layoutInfo
            val bottomOffset = (layout.viewportEndOffset - bottomChromePx - latestMarkerPx).coerceAtLeast(0)
            messageListState.animateScrollToItem(latestRowIndex, -bottomOffset)
            followBottom = true
          } finally {
            jumpJob = null
          }
          scrollMessagesToBottom(force = true)
        }
        jumpJob = job
        job.start()
      }
    }, modifier = Modifier.align(Alignment.BottomCenter)
      .padding(bottom = bottomChromeHeight + if (showConnectionWait) 108.dp else 4.dp)
      .size(44.dp)
      .semantics { contentDescription = jumpLabel }.testTag("assistant-jump-bottom")) {
      Box(modifier = Modifier.size(36.dp)
        .background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape),
        contentAlignment = Alignment.Center) {
        if (connection.activeRunId != null || connection.sending)
          BrandLoadingIndicator(extent = 20.dp, compact = true,
            modifier = Modifier.testTag("assistant-jump-working"))
        else ActionIcon(R.drawable.action_arrow_down,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.testTag("assistant-jump-arrow"))
      }
    }
  }
  }
  val referenceFileSaving by rememberUpdatedState(referenceKind == "file" && connection.contextPanel.saving)
  val presentedVideo = generatedMedia.presentedVideo
  if (presentedVideo != null && mediaScope != null && generatedMediaAccess != null) {
    GeneratedVideoSheet(presentedVideo, mediaScope.conversationId, generatedMediaAccess) { generatedMedia.presentedVideo = null }
  }
  if (referenceKind != null) ModalBottomSheet(onDismissRequest = { if (!referenceFileSaving) onReferenceKindChange(null) },
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true,
      confirmValueChange = { it != androidx.compose.material3.SheetValue.Hidden || !referenceFileSaving })) {
    var filePath by remember(connection.selectedConversationId) { mutableStateOf("") }
    var fileAttachmentCount by remember { mutableIntStateOf(-1) }
    val panel = connection.contextPanel
    LaunchedEffect(referenceKind, referenceQuery, filePath) {
      if (referenceKind == "file") {
        if (referenceQuery.isNotEmpty()) delay(250)
        onLoadContextPanel("files", filePath, referenceQuery)
      }
    }
    LaunchedEffect(connection.draftAttachments.size, panel.saving) {
      if (fileAttachmentCount >= 0 && !panel.saving &&
        connection.draftAttachments.size > fileAttachmentCount) onReferenceKindChange(null)
    }
    Column(modifier = Modifier.fillMaxWidth().fillMaxHeight(0.85f).padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.assistant_reference_title), style = MaterialTheme.typography.titleMedium,
          modifier = Modifier.weight(1f))
        TextButton(onClick = { onReferenceKindChange(null) }, enabled = !panel.saving) { Text(stringResource(R.string.assistant_close)) }
      }
      SegmentedTabs(
        listOf("note" to R.string.assistant_action_reference_note,
          "task" to R.string.assistant_action_reference_task, "file" to R.string.assistant_action_reference_file)
          .map { (kind, label) -> SegmentOption(kind, stringResource(label), "assistant-reference-tab-$kind") },
        referenceKind, { kind -> filePath = ""; onReferenceQueryChange(""); onReferenceKindChange(kind) },
        enabled = !panel.saving,
      )
      OutlinedTextField(value = referenceQuery, onValueChange = { if (it.length <= 4096) onReferenceQueryChange(it) },
        label = { Text(stringResource(R.string.assistant_reference_search)) },
        modifier = Modifier.fillMaxWidth().testTag("assistant-reference-search"), singleLine = true, enabled = !panel.saving)
      if (referenceKind != "file" && connection.draftRefs.size >= 5) Text(stringResource(R.string.assistant_reference_limit),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (referenceKind == "file") {
        if (filePath.isNotBlank()) TextButton(onClick = {
          filePath = filePath.substringBeforeLast('/', "")
          onReferenceQueryChange("")
        }, enabled = !panel.saving, modifier = Modifier.testTag("assistant-reference-file-parent")) {
          Text("‹ $filePath", maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        val matchingFiles = panel.gatewayId == connection.profile?.gatewayId &&
          panel.conversationId == connection.selectedConversationId && panel.mode == "files" &&
          panel.filePath == filePath && panel.fileQuery == referenceQuery
        if (!matchingFiles || panel.loading) BrandLoadingPanel(minHeight = 120.dp)
        else {
          if (panel.error) {
            Text(stringResource(R.string.assistant_reference_error), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { onLoadContextPanel("files", filePath, referenceQuery) }, enabled = !panel.saving,
              modifier = Modifier.testTag("assistant-reference-retry")) {
              Text(stringResource(R.string.assistant_context_retry))
            }
          }
          if (!panel.error && panel.files.isEmpty()) Text(stringResource(R.string.assistant_reference_empty),
            color = MaterialTheme.colorScheme.onSurfaceVariant)
          if (panel.saving) BrandLoadingPanel(minHeight = 48.dp)
          LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            items(panel.files, key = { it.id }) { file ->
              val directory = file.kind == "directory"
              val added = connection.draftAttachments.any { it.workspaceRelativePath == file.relativePath }
              ContextRow(file.name, file.relativePath, "assistant-reference-file-${file.id}",
                iconRes = if (directory) R.drawable.action_folder else R.drawable.tab_notes,
                enabled = !panel.saving && !connection.sending && !connection.attachmentLoading &&
                  connection.pendingInput == null && (directory || (!added && connection.draftAttachments.size < 10))) {
                if (directory) { filePath = file.relativePath; onReferenceQueryChange("") }
                else { fileAttachmentCount = connection.draftAttachments.size; onAddContextFile(file) }
              }
            }
          }
        }
      } else {
        val picker = connection.referencePicker
        val matching = picker.gatewayId == connection.profile?.gatewayId &&
          picker.conversationId == connection.selectedConversationId &&
          picker.kind == referenceKind && picker.query == referenceQuery.trim()
        if (!matching || picker.loading) BrandLoadingPanel(minHeight = 120.dp)
        else if (picker.error) {
          Text(stringResource(R.string.assistant_reference_error), color = MaterialTheme.colorScheme.error)
          TextButton(onClick = { onLoadReferences(referenceKind, referenceQuery) },
            modifier = Modifier.testTag("assistant-reference-retry")) {
            Text(stringResource(R.string.assistant_context_retry))
          }
        } else if (picker.items.isEmpty()) {
          Text(stringResource(R.string.assistant_reference_empty),
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
          items(picker.items, key = { it.kind + ":" + it.id }) { item ->
            val alreadyAdded = connection.draftRefs.any { it.kind == item.kind && it.sourceId == item.id }
            TextButton(onClick = { if (onAddDraftRef(item)) onReferenceKindChange(null) },
              enabled = !alreadyAdded && connection.draftRefs.size < 5 && !connection.sending &&
                connection.pendingInput == null,
              modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
                .testTag("assistant-reference-${item.kind}-${item.id}")) {
              Column(modifier = Modifier.fillMaxWidth()) {
                Text(item.title.ifBlank { stringResource(R.string.notes_untitled) }, maxLines = 1,
                  overflow = TextOverflow.Ellipsis)
                if (item.description.isNotBlank()) Text(item.description,
                  style = MaterialTheme.typography.bodySmall, maxLines = 2,
                  overflow = TextOverflow.Ellipsis,
                  color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
          }
        }
      }
    }
  }

  val closeOptions: () -> Unit = {
    optionsOpen = false; contextOpen = false; modelPickerOpen = false
    thinkingPickerOpen = false; onAgentPickerOpenChange(false)
    pendingModelChoice = null; pendingThinkingChoice = null
  }
  if (personalSettingsOpen) PersonalAgentProfileSheet(connection.personal, { personalSettingsOpen = false },
    onLoadAgentVoices, onUpdateAgentProfile, onUploadAvatar, onLoadPersonalModel, onSavePersonalModel,
    modelBusy = connection.sending || connection.activeRunId != null || connection.pendingInput != null,
    onShare = connection.selectedConversationId?.takeIf {
      connection.messages.any { message -> message.role == "user" || message.role == "assistant" }
    }?.let { id -> { onShareConversation(id) } })
  if (messageSearchOpen) ChatMessageSearch(connection.messages, connection.historyBefore != null,
    connection.historyLoadingOlder, onLoadOlderHistory, onClose = { onMessageSearchOpenChange(false) },
    onSelect = { id -> onMessageSearchOpenChange(false); messageDetailId = id })
  if (optionsOpen || contextOpen || modelPickerOpen || thinkingPickerOpen || agentPickerOpen)
    ModalBottomSheet(onDismissRequest = closeOptions,
      sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
    if (modelPickerOpen) {
      ChatOptionsPanel(stringResource(R.string.assistant_model), 620.dp, closeOptions) {
        OutlinedTextField(modelQuery, { modelQuery = it }, modifier = Modifier.fillMaxWidth(),
          label = { Text(stringResource(R.string.assistant_model_search)) }, singleLine = true)
        if (connection.modelsLoading) ChatOptionsSkeleton()
        if (connection.modelError) Text(stringResource(R.string.assistant_model_error),
          color = MaterialTheme.colorScheme.error)
        if (connection.modelError) TextButton(onClick = onReloadModels) {
          Text(stringResource(R.string.assistant_model_retry))
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          if (!connection.modelsLoading) items(connection.models.filter {
            modelQuery.isBlank() || it.name.contains(modelQuery, true) || it.id.contains(modelQuery, true)
          }, key = { it.id }) { model ->
            ContextRow("${if (model.id == connection.selectedModelId) "✓ " else ""}${model.name}",
              model.id, "model-${model.id}",
              enabled = !connection.modelSaving && !connection.sending && connection.activeRunId == null &&
                connection.pendingInput == null,
              flat = true, showChevron = false) {
              if (model.id == connection.selectedModelId) closeOptions()
              else { pendingModelChoice = model.id; onSelectModel(model.id) }
            }
          }
        }
      }
    } else if (thinkingPickerOpen) {
      val model = connection.models.firstOrNull { it.id == connection.selectedModelId }
      ChatOptionsPanel(stringResource(R.string.assistant_thinking),
        (136 + model?.thinkingOptions.orEmpty().size * 60).coerceIn(280, 620).dp, closeOptions) {
        if (connection.modelError) Text(stringResource(R.string.assistant_model_error),
          color = MaterialTheme.colorScheme.error)
        if (connection.modelError) TextButton(onClick = onReloadModels) {
          Text(stringResource(R.string.assistant_model_retry))
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          if (model?.thinkingMode in setOf("levels", "toggle")) items(model?.thinkingOptions.orEmpty()) { level ->
            ContextRow(thinkingLevelLabel(level), if (level == connection.thinkingLevel) "✓" else "",
              "thinking-$level", flat = true,
              enabled = !connection.modelsLoading && !connection.modelSaving && !connection.sending &&
                connection.activeRunId == null && connection.pendingInput == null && connection.queuedInputs.isEmpty()) {
              if (level == connection.thinkingLevel) closeOptions()
              else { pendingThinkingChoice = level; onSelectThinking(level) }
            }
          } else item { Text(stringResource(if (model?.thinkingMode == "fixed")
            R.string.assistant_thinking_fixed else R.string.assistant_thinking_unsupported),
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(12.dp)) }
        }
      }
    } else if (agentPickerOpen) {
      ChatOptionsPanel(stringResource(R.string.assistant_agent), 620.dp, closeOptions) {
        OutlinedTextField(agentQuery, { agentQuery = it }, modifier = Modifier.fillMaxWidth(),
          label = { Text(stringResource(R.string.assistant_agent_search)) }, singleLine = true)
        if (connection.agentsLoading) ChatOptionsSkeleton()
        if (connection.agentError) Text(stringResource(R.string.assistant_agent_error),
          color = MaterialTheme.colorScheme.error)
        if (connection.agentError) TextButton(onClick = onReloadAgents) {
          Text(stringResource(R.string.assistant_agent_retry))
        }
        val agentRows = if (connection.agentsLoading) emptyList() else connection.agents.map {
          Triple(it, agentDisplayName(it), agentDisplayDescription(it))
        }.filter { (agent, name, description) ->
          listOf(name, description, agent.id, agent.name).any { it.contains(agentQuery.trim(), ignoreCase = true) }
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          items(agentRows, key = { it.first.id }) { (agent, name, description) ->
            val personal = connection.personal.agent?.takeIf { it.agentId == agent.id }
            val selectedHere = agent.id == connection.selectedAgentId
            Surface(onClick = {
              when {
                selectedHere -> closeOptions()
                personal != null -> { closeOptions(); onRetryHomeChat() }
                connection.draftText.isNotBlank() || connection.draftAttachments.isNotEmpty() || connection.draftRefs.isNotEmpty() ->
                  pendingAgentId = agent.id
                else -> { closeOptions(); onSwitchAgent(agent.id, false) }
              }
            }, enabled = !connection.creatingConversation, modifier = Modifier.fillMaxWidth().testTag("agent-${agent.id}"),
              shape = themedCorners(14), color = LocalChatColors.current.card) {
              Row(Modifier.heightIn(min = 60.dp).padding(10.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (personal != null) PersonalAgentAvatar(connection.personal.agentAvatar, personal.appearance, 40.dp, false)
                else AgentAvatar(connection.agentAvatars[agent.id], agent.avatar, agent.id, 40.dp, false, fallbackName = name)
                Column(Modifier.weight(1f)) {
                  Text(name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                  if (description.isNotBlank()) Text(description, style = MaterialTheme.typography.bodySmall, maxLines = 2,
                    overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (selectedHere) Text("✓", color = MaterialTheme.colorScheme.primary)
              }
            }
          }
        }
      }
    } else
    if (contextOpen) {
      ContextDetails(connection, onReloadContext, onLoadContextPanel, onSetContextDirectory,
        onAddContextFile, onCreateContextConversation, onLoadReferences, onAddDraftRef,
        initialMode = contextInitialMode, initialKind = contextInitialKind,
        onBackToOptions = { contextOpen = false; optionsOpen = true },
        onClose = { contextOpen = false; optionsOpen = false })
    } else {
    val contextSummary = listOfNotNull(connection.context?.project?.title?.takeIf(String::isNotBlank),
      connection.context?.environment?.let { if (it.kind == "managed_worktree") "Worktree" else "Local" })
      .joinToString(" · ")
    ChatOptionsPanel(stringResource(R.string.assistant_options), onClose = closeOptions) {
      Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (connection.selectedConversationId != null) {
          val shareId = connection.selectedConversationId
          if (connection.messages.any { it.role == "user" || it.role == "assistant" }) {
            ContextRow(stringResource(R.string.conversations_share), "", "assistant-share",
              compact = true, flat = true) {
              closeOptions()
              onShareConversation(shareId)
            }
          }
          ContextRow(stringResource(R.string.chat_personal_search), "", "assistant-search",
            iconRes = R.drawable.action_search, compact = true, flat = true) {
            closeOptions(); onMessageSearchOpenChange(true)
          }
          ContextRow(stringResource(R.string.assistant_context), contextSummary, "assistant-context",
            iconRes = R.drawable.action_folder, compact = true, flat = true) {
            optionsOpen = false; contextInitialMode = "context"; contextInitialKind = "note"
            contextOpen = true; onReloadContext()
          }
          val personalAgent = connection.personal.agent
          val isPersonalConversation = personalAgent?.state == "ready" &&
            personalAgent.conversationId == connection.selectedConversationId
          if (!isPersonalConversation) {
            ContextRow(stringResource(R.string.assistant_agent),
              connection.agents.firstOrNull { it.id == connection.selectedAgentId }?.name
                ?: connection.selectedAgentId, "assistant-agent", iconRes = R.drawable.tab_assistant,
              compact = true, flat = true, enabled = !connection.creatingConversation) {
              optionsOpen = false; onAgentPickerOpenChange(true)
            }
          }
          ContextRow(stringResource(R.string.assistant_model),
            connection.models.firstOrNull { it.id == connection.selectedModelId }?.name
              ?: connection.selectedModelId, "assistant-model", iconRes = R.drawable.action_waveform,
            compact = true, flat = true, enabled = !connection.modelSaving) {
            optionsOpen = false; modelQuery = ""; modelPickerOpen = true; onReloadModels()
          }
          val selectedModel = connection.models.firstOrNull { it.id == connection.selectedModelId }
          ContextRow(stringResource(R.string.assistant_thinking),
            when (selectedModel?.thinkingMode) {
              "levels", "toggle" -> thinkingLevelLabel(connection.thinkingLevel)
              "fixed" -> stringResource(R.string.assistant_thinking_fixed)
              else -> stringResource(R.string.assistant_thinking_unsupported)
            }, "assistant-thinking", iconRes = R.drawable.action_waveform, compact = true, flat = true) {
            optionsOpen = false; thinkingPickerOpen = true
          }
          if (connection.queuedInputs.isNotEmpty()) ContextRow(stringResource(R.string.assistant_queue), "", "assistant-queue",
            iconRes = R.drawable.action_new_chat, compact = true, flat = true) {
            optionsOpen = false; queueOpen = true; onLoadQueuedInputs()
          }
        }
        ContextRow(stringResource(R.string.assistant_action_new_chat), "", "assistant-new",
          iconRes = R.drawable.action_new_chat, compact = true, flat = true,
          enabled = !connection.creatingConversation) {
          optionsOpen = false; onCreateConversation()
        }
        if (connection.selectedConversationId != null) {
          ContextRow(stringResource(R.string.assistant_session_files), "", "assistant-session-files",
            iconRes = R.drawable.action_folder, compact = true, flat = true) {
            optionsOpen = false; sessionFilesOpen = true
            onLoadContextPanel("files", "", "")
          }
        }
      }
    }
    }
  }
  val detailMessage = connection.messages.firstOrNull { it.id == messageDetailId }
  if (detailMessage != null) ModalBottomSheet(onDismissRequest = { messageDetailId = null },
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
    Column(modifier = Modifier.fillMaxWidth().fillMaxHeight(0.85f)
      .padding(start = 12.dp, end = 12.dp, bottom = 16.dp).testTag("message-detail-panel")) {
      Column(modifier = Modifier.fillMaxWidth().weight(1f).verticalScroll(messageDetailScroll)
        .testTag("message-detail-scroll")) {
        ChatMessageCard(detailMessage, onMore = {}, onOpenTarget = onOpenMessageTarget,
          onOpenPreview = { media, gallery -> connection.selectedConversationId?.let {
            previewRequest = MessagePreviewRequest(it, media, gallery)
          } }, onOpenLink = openLink, onCopy = onCopyMessageText, actionsEnabled = false, textSelectable = true,
          previewEligible = false,
          loadMedia = { media -> onLoadMessageMedia(requireNotNull(connection.selectedConversationId), media) })
      }
    }
  }
  if (connection.executionMessageId != null) ModalBottomSheet(onDismissRequest = onCloseExecution,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), dragHandle = null) {
    Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f).testTag("execution-sheet")) {
      Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = onCloseExecution, modifier = Modifier.testTag("execution-back")) {
          Text(stringResource(R.string.assistant_close))
        }
        Text(stringResource(R.string.assistant_execution), style = MaterialTheme.typography.titleLarge)
      }
      HorizontalDivider()
      ExecutionDetails(connection.executionDetail, connection.executionLoading, connection.executionError,
        connection.activeRunId != null, onRetryExecution, openLink, Modifier.weight(1f))
    }
  }
  val downloadPreviewMusic = rememberMusicDownload(generatedMediaAccess)
  previewMusic?.let { track ->
    MusicPlayerSheet(track, { previewMusic = null }, onSource = null,
      onDownload = { downloadPreviewMusic(track) }, onPlay = {
        reader.stop()
        playGeneratedMusic(context, generatedMediaAccess, track)
      })
  }
  previewRequest?.let { request ->
    MobilePreviewSheet(onClose = { previewRequest = null }, heightFraction = 0.95f) {
      MessageMediaPreview(request, onLoadMessageMedia) { previewRequest = null }
    }
  }
  externalUrl?.let { url ->
    AlertDialog(onDismissRequest = { externalUrl = null },
      title = { Text(stringResource(R.string.message_open_external_title)) },
      text = { Text(url, maxLines = 4, overflow = TextOverflow.Ellipsis) },
      confirmButton = { TextButton(onClick = {
        externalUrl = null
        runCatching { uriHandler.openUri(url) }.onFailure {
          android.widget.Toast.makeText(context, externalLinkFailure, android.widget.Toast.LENGTH_SHORT).show()
        }
      }) { Text(stringResource(R.string.message_open_external)) } },
      dismissButton = { TextButton(onClick = { externalUrl = null }) {
        Text(stringResource(R.string.progress_cancel))
      } })
  }
  if (sessionFilesOpen) ModalBottomSheet(onDismissRequest = { sessionFilesOpen = false }) {
    SessionFilesDetails(connection.contextPanel, onLoadContextPanel, onSessionFileContent) {
      sessionFilesOpen = false
    }
  }
  if (queueOpen) ModalBottomSheet(onDismissRequest = { queueOpen = false }) {
    ChatOptionsPanel(stringResource(R.string.assistant_queue),
      (156 + connection.queuedInputs.size * 92).coerceIn(240, 620).dp,
      onClose = { queueOpen = false }) {
      Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = onLoadQueuedInputs, enabled = !connection.queueBusy) {
          Text(stringResource(R.string.personal_retry))
        }
        if (connection.queueLoading) ChatOptionsSkeleton()
        else if (connection.queueBusy) BrandLoadingIndicator()
        if (connection.queueError) Text(stringResource(R.string.assistant_queue_error),
          color = MaterialTheme.colorScheme.error)
        if (!connection.queueLoading && connection.queuedInputs.isEmpty()) {
          Text(stringResource(R.string.assistant_queue_empty),
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        connection.queuedInputs.forEachIndexed { index, input ->
          Card(modifier = Modifier.fillMaxWidth().testTag("queued-${input.id}")) {
            Column(Modifier.fillMaxWidth().padding(12.dp)) {
              Text(input.content.ifBlank { stringResource(R.string.assistant_queue_attachment) },
                maxLines = 3, overflow = TextOverflow.Ellipsis)
              val earlierLabel = stringResource(R.string.assistant_queue_earlier)
              val laterLabel = stringResource(R.string.assistant_queue_later)
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = {
                  editingQueuedId = input.id; editingQueuedContent = input.content
                }, enabled = !connection.queueBusy) { Text(stringResource(R.string.progress_edit_task)) }
                TextButton(onClick = { onUpdateQueuedInput(input.id, null, index - 1) },
                  enabled = !connection.queueBusy && index > 0,
                  modifier = Modifier.semantics { contentDescription = earlierLabel }) { Text("↑") }
                TextButton(onClick = { onUpdateQueuedInput(input.id, null, index + 1) },
                  enabled = !connection.queueBusy && index < connection.queuedInputs.lastIndex,
                  modifier = Modifier.semantics { contentDescription = laterLabel }) { Text("↓") }
                TextButton(onClick = { onCancelQueuedInput(input.id) },
                  enabled = !connection.queueBusy) { Text(stringResource(R.string.assistant_queue_remove)) }
              }
            }
          }
        }
        Spacer(Modifier.height(16.dp))
      }
    }
  }
  editingQueuedId?.let { inputId ->
    val input = connection.queuedInputs.firstOrNull { it.id == inputId }
    AlertDialog(onDismissRequest = { editingQueuedId = null },
      title = { Text(stringResource(R.string.assistant_queue_edit)) },
      text = { OutlinedTextField(editingQueuedContent, { editingQueuedContent = it },
        modifier = Modifier.fillMaxWidth(), maxLines = 5) },
      confirmButton = { TextButton(onClick = {
        onUpdateQueuedInput(inputId, editingQueuedContent, null)
        editingQueuedId = null
      }, enabled = !connection.queueBusy &&
        (editingQueuedContent.isNotBlank() || (input?.attachmentCount ?: 0) > 0 ||
          (input?.referenceCount ?: 0) > 0)) { Text(stringResource(R.string.progress_save)) } },
      dismissButton = { TextButton(onClick = { editingQueuedId = null }) {
        Text(stringResource(R.string.progress_cancel))
      } })
  }
  pendingAgentId?.let { agentId ->
    AlertDialog(onDismissRequest = { pendingAgentId = null },
      title = { Text(stringResource(R.string.assistant_discard_draft_title)) },
      text = { Text(stringResource(R.string.assistant_discard_draft_message)) },
      confirmButton = { TextButton(onClick = { pendingAgentId = null; closeOptions(); onSwitchAgent(agentId, true) },
        modifier = Modifier.testTag("agent-discard-confirm")) { Text(stringResource(R.string.assistant_discard_draft_confirm)) } },
      dismissButton = { TextButton(onClick = { pendingAgentId = null }) { Text(stringResource(R.string.assistant_discard_draft_cancel)) } })
  }
}

@Composable
private fun ExecutionDetails(detail: ExecutionDetail?, loading: Boolean, error: Boolean, live: Boolean,
  onRetry: () -> Unit, onOpenLink: (String) -> Unit, modifier: Modifier = Modifier) {
  var expandedGroupId by remember(detail?.turnId) { mutableStateOf<String?>(null) }
  val groups = remember(detail, live) { ExecutionGroups.group(detail?.steps.orEmpty(), live) }
  LazyColumn(modifier = modifier.fillMaxWidth().testTag("execution-scroll"),
    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (loading && detail == null) item(key = "loading") {
      BrandLoadingPanel(modifier = Modifier.testTag("execution-loading"))
    }
    if (error) item(key = "error") {
      Column {
        Text(stringResource(R.string.assistant_execution_error), color = MaterialTheme.colorScheme.error)
        TextButton(onClick = onRetry, modifier = Modifier.testTag("execution-retry")) {
          Text(stringResource(R.string.assistant_execution_retry))
        }
      }
    }
    if (!loading && !error && groups.isEmpty()) item(key = "empty") {
      Text(stringResource(R.string.assistant_execution_empty))
    }
    items(groups, key = { "group-${it.id}" }) { group ->
      if (group.kind == "progress") {
        SelectionContainer { Text(group.steps.first().text, style = MaterialTheme.typography.bodyMedium) }
      } else {
        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
          verticalArrangement = Arrangement.spacedBy(4.dp)) {
          val canExpand = group.steps.any { it.preview.isNotBlank() || it.failure.isNotBlank() }
          TextButton(onClick = { if (canExpand) expandedGroupId = if (expandedGroupId == group.id) null else group.id },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("execution-group-${group.id}")) {
            Text(executionCategoryLabel(group.category) + if (group.steps.size > 1) " · ${group.steps.size}" else "",
              modifier = Modifier.weight(1f))
            Text(executionStatusLabel(group.status), color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          if (expandedGroupId == group.id && canExpand) {
            group.steps.forEachIndexed { index, step ->
              Column(modifier = Modifier.padding(start = 12.dp)
                .testTag("execution-detail-${step.id}")) {
                if (group.steps.size > 1) Text("${index + 1}. ${executionCategoryLabel(group.category)}",
                  style = MaterialTheme.typography.labelMedium)
                if (step.preview.isNotBlank()) ExecutionPreview(step.preview, step.id, false, onOpenLink)
                if (step.failure.isNotBlank()) SelectionContainer {
                  Text(step.failure, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error)
                }
              }
            }
          } else if (canExpand) {
            group.steps.firstOrNull { it.preview.isNotBlank() }?.let { step ->
              ExecutionPreview(step.preview, step.id, true, onOpenLink)
            }
            group.steps.firstOrNull { it.failure.isNotBlank() }?.let { step ->
              Text(step.failure, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error, maxLines = 2,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 12.dp))
            }
          }
        }
        HorizontalDivider()
      }
    }
  }
}

private fun executionPreviewUrl(preview: String): String? {
  val value = preview.trim()
  if (value.any(Char::isWhitespace) || value.any { it.code < 0x20 }) return null
  return runCatching { URI(value) }.getOrNull()?.takeIf {
    value.startsWith("https://") && !it.host.isNullOrBlank() && it.rawUserInfo == null
  }?.toString()
}

@Composable
private fun ExecutionPreview(preview: String, stepId: String, compact: Boolean,
  onOpenLink: (String) -> Unit) {
  val url = remember(preview) { executionPreviewUrl(preview) }
  if (url != null) TextButton(onClick = { onOpenLink(url) },
    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("execution-preview-$stepId")) {
    Text(url, modifier = Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall,
      maxLines = if (compact) 2 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
  } else SelectionContainer {
    Text(preview, style = MaterialTheme.typography.bodySmall,
      color = if (compact) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
      maxLines = if (compact) 2 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis,
      modifier = Modifier.testTag("execution-preview-$stepId"))
  }
}

@Composable
private fun executionCategoryLabel(category: String): String = stringResource(when (category) {
  "search" -> R.string.assistant_step_search
  "read" -> R.string.assistant_step_read
  "command" -> R.string.assistant_step_command
  "write", "edit" -> R.string.assistant_step_edit
  "fetch" -> R.string.assistant_step_fetch
  "share" -> R.string.assistant_step_share
  "speech" -> R.string.assistant_step_speech
  "plan" -> R.string.assistant_step_plan
  else -> R.string.assistant_step_other
})

@Composable
private fun executionStatusLabel(status: String): String = stringResource(when (status) {
  "running" -> R.string.assistant_step_running
  "error" -> R.string.assistant_step_error
  "stopped" -> R.string.assistant_step_stopped
  else -> R.string.assistant_step_done
})

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationsScreen(
  connection: ConnectionUiState,
  insets: PaddingValues,
  onSearchChange: (String) -> Unit,
  onRefresh: () -> Unit,
  onLoadMore: () -> Unit,
  onCreateConversation: () -> Unit,
  onSelectConversation: (String) -> Unit,
  onSelectTaskChild: (String, String) -> Unit,
  onBeginRename: (String) -> Unit,
  onRenameDraftChange: (String) -> Unit,
  onSaveRename: () -> Unit,
  onCancelRename: () -> Unit,
  onTogglePin: (String) -> Unit,
  onToggleArchive: (String) -> Unit,
  onBatchConversations: (List<String>, String) -> Unit,
  onBeginShare: (String) -> Unit,
  onScheduleDelete: (String) -> Unit,
  onUndoDelete: () -> Unit,
  onExit: () -> Unit,
  startSearching: Boolean,
  onScope: (ConversationHistoryScope?) -> Unit,
  onLoadProjects: () -> Unit,
  onFetchExperts: suspend () -> List<ConversationAgent>,
) {
  val navigation = rememberNavigationPreferences()
  var mode by rememberSaveable(connection.profile?.gatewayId) {
    mutableStateOf(navigation.selection("conversation-history", listOf("recent", "projects", "experts"), "recent"))
  }
  var groupId by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf("") }
  var groupName by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf("") }
  var groupQuery by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf("") }
  var experts by remember(connection.profile?.gatewayId) { mutableStateOf(emptyList<ConversationAgent>()) }
  var expertsLoading by remember { mutableStateOf(false) }
  var expertsFailed by remember { mutableStateOf(false) }
  var expertReload by remember { mutableIntStateOf(0) }
  val browsingGroups = mode != "recent" && groupId.isEmpty()
  val scope = when {
    mode == "projects" && groupId == "unassigned" -> ConversationHistoryScope.Unassigned
    mode == "projects" && groupId.isNotEmpty() -> ConversationHistoryScope.Project(groupId)
    mode == "experts" && groupId.isNotEmpty() -> ConversationHistoryScope.Expert(groupId)
    else -> ConversationHistoryScope.Recent
  }
  val currentScopeSetter by rememberUpdatedState(onScope)
  DisposableEffect(connection.profile?.gatewayId) {
    onDispose { currentScopeSetter(null) }
  }
  LaunchedEffect(connection.profile?.gatewayId, browsingGroups, scope) {
    if (!browsingGroups) onScope(scope)
  }
  LaunchedEffect(mode, connection.profile?.gatewayId, expertReload) {
    if (mode == "projects") onLoadProjects()
    if (mode == "experts") {
      expertsLoading = true
      expertsFailed = false
      try {
        experts = onFetchExperts().filter {
          it.id != "main" && it.id != "task-router" && it.purpose != "task_dispatcher" &&
            !it.id.matches(Regex("personal-[a-f0-9]{12}", RegexOption.IGNORE_CASE))
        }
      } catch (error: kotlinx.coroutines.CancellationException) { throw error }
      catch (_: Exception) { expertsFailed = true }
      finally { expertsLoading = false }
    }
  }
  var menuConversationId by rememberSaveable { mutableStateOf<String?>(null) }
  var searchOpen by remember(startSearching) { mutableStateOf(startSearching) }
  var expandedTaskParents by rememberSaveable { mutableStateOf(emptyList<String>()) }
  var collapsedTaskParents by rememberSaveable { mutableStateOf(emptyList<String>()) }
  var selecting by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf(false) }
  var selectedIds by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf(emptyList<String>()) }
  var confirmBatchDelete by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf(false) }
  LaunchedEffect(connection.batchConversationRevision) {
    if (connection.batchConversationRevision > 0) {
      selectedIds = connection.batchConversationFailedIds
      selecting = selectedIds.isNotEmpty()
    }
  }
  val listState = rememberLazyListState()
  val currentLoadMore by rememberUpdatedState(onLoadMore)
  LaunchedEffect(connection.profile?.gatewayId, scope, connection.conversationSearch) {
    listState.scrollToItem(0)
    expandedTaskParents = emptyList()
    collapsedTaskParents = emptyList()
  }
  LaunchedEffect(connection.profile?.gatewayId, connection.conversationSearch,
    connection.conversationsHasMore, connection.conversationsLoading,
    connection.conversationsLoadingMore, connection.conversationsMoreError, browsingGroups) {
    if (browsingGroups || !connection.conversationsHasMore || connection.conversationsLoading ||
      connection.conversationsLoadingMore || connection.conversationsMoreError) return@LaunchedEffect
    if (ConversationGroups.visibleHistory(connection.conversations).isEmpty()) {
      currentLoadMore()
      return@LaunchedEffect
    }
    snapshotFlow {
      val layout = listState.layoutInfo
      layout.totalItemsCount > 0 &&
        (layout.visibleItemsInfo.lastOrNull()?.index ?: -1) >= layout.totalItemsCount - 2
    }.collect { nearEnd -> if (nearEnd) currentLoadMore() }
  }
  val focusManager = LocalFocusManager.current
  val keyboardController = LocalSoftwareKeyboardController.current
  val menuConversation = connection.conversations.firstOrNull { it.id == menuConversationId && !it.isLocalDraft }
  if (menuConversation != null) ModalBottomSheet(onDismissRequest = { menuConversationId = null }) {
    val managementEnabled = !connection.renamingConversation && connection.pinningConversationId == null &&
      connection.archivingConversationId == null && !connection.conversationShareBusy
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
      verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(menuConversation.title, style = MaterialTheme.typography.titleMedium, maxLines = 2,
        overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
      TextButton(onClick = { menuConversationId = null; onBeginShare(menuConversation.id) },
        enabled = managementEnabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("share-conversation-${menuConversation.id}")) {
        Text(stringResource(R.string.conversations_share), modifier = Modifier.fillMaxWidth())
      }
      TextButton(onClick = { menuConversationId = null; onBeginRename(menuConversation.id) },
        enabled = managementEnabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("rename-conversation-${menuConversation.id}")) {
        Text(stringResource(R.string.conversations_rename), modifier = Modifier.fillMaxWidth())
      }
      TextButton(onClick = { menuConversationId = null; onTogglePin(menuConversation.id) },
        enabled = managementEnabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("pin-conversation-${menuConversation.id}")) {
        Text(stringResource(if (menuConversation.status == "pinned") R.string.conversations_unpin
          else R.string.conversations_pin), modifier = Modifier.fillMaxWidth())
      }
      TextButton(onClick = { menuConversationId = null; onToggleArchive(menuConversation.id) },
        enabled = managementEnabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("archive-conversation-${menuConversation.id}")) {
        Text(stringResource(if (menuConversation.status == "archived") R.string.conversations_unarchive
          else R.string.conversations_archive), modifier = Modifier.fillMaxWidth())
      }
      TextButton(onClick = {
        menuConversationId = null
        selectedIds = listOf(menuConversation.id)
        selecting = true
      }, enabled = managementEnabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("select-conversation-${menuConversation.id}")) {
        Text(stringResource(R.string.conversations_select), modifier = Modifier.fillMaxWidth())
      }
      HorizontalDivider()
      TextButton(onClick = { menuConversationId = null; onScheduleDelete(menuConversation.id) },
        enabled = managementEnabled && connection.pendingDeleteId == null && !connection.sending &&
          (menuConversation.id != connection.selectedConversationId ||
            (connection.activeRunId == null && connection.pendingInput == null)),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("delete-conversation-${menuConversation.id}")) {
        Text(stringResource(R.string.conversations_delete), color = MaterialTheme.colorScheme.error,
          modifier = Modifier.fillMaxWidth())
      }
      TextButton(onClick = { menuConversationId = null }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(stringResource(R.string.conversations_cancel))
      }
    }
  }
  if (connection.renameDraftId != null) AlertDialog(
    onDismissRequest = onCancelRename,
    title = { Text(stringResource(R.string.conversations_rename)) },
    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedTextField(value = connection.renameDraftText, onValueChange = onRenameDraftChange,
        modifier = Modifier.fillMaxWidth().testTag("conversations-rename-input"), singleLine = true,
        label = { Text(stringResource(R.string.conversations_name)) },
        enabled = !connection.renamingConversation)
      if (connection.renameError) Text(stringResource(R.string.conversations_rename_error),
        color = MaterialTheme.colorScheme.error)
    } },
    confirmButton = { TextButton(onClick = onSaveRename,
      enabled = connection.renameDraftText.isNotBlank() && !connection.renamingConversation,
      modifier = Modifier.testTag("conversations-rename-save")) {
      Text(stringResource(R.string.conversations_save))
    } },
    dismissButton = { TextButton(onClick = onCancelRename, enabled = !connection.renamingConversation) {
      Text(stringResource(R.string.conversations_cancel))
    } },
  )
  if (confirmBatchDelete) AlertDialog(onDismissRequest = { confirmBatchDelete = false },
    title = { Text(stringResource(R.string.conversations_delete)) },
    text = { Text(stringResource(R.string.conversations_batch_delete_confirm, selectedIds.size)) },
    confirmButton = { TextButton(onClick = {
      confirmBatchDelete = false
      onBatchConversations(selectedIds, "delete")
    }, modifier = Modifier.testTag("conversations-batch-delete-confirm")) {
      Text(stringResource(R.string.conversations_delete), color = MaterialTheme.colorScheme.error)
    } },
    dismissButton = { TextButton(onClick = { confirmBatchDelete = false }) {
      Text(stringResource(R.string.conversations_cancel))
    } })
  fun closeSearch() {
    if (connection.conversationSearch.isNotEmpty()) onSearchChange("")
    groupQuery = ""
    searchOpen = false
    focusManager.clearFocus(force = true)
    keyboardController?.hide()
  }
  fun clearGroup() {
    closeSearch()
    groupId = ""
    groupName = ""
  }
  BackHandler(enabled = !selecting && (searchOpen || groupId.isNotEmpty())) {
    if (searchOpen) closeSearch() else clearGroup()
  }
  val clearLabel = stringResource(R.string.conversations_clear)
  val newConversationLabel = stringResource(R.string.assistant_new_action)
  val searchLabel = stringResource(when {
    browsingGroups && mode == "projects" -> R.string.conversations_search_projects
    browsingGroups -> R.string.conversations_search_experts
    else -> R.string.conversations_search
  })
  Column(modifier = Modifier.fillMaxSize().padding(insets).padding(horizontal = 20.dp, vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically) {
        if (!selecting) PageBackButton("conversations-back", { if (groupId.isNotEmpty()) clearGroup() else onExit() })
        if (selecting) Text(stringResource(R.string.conversations_selected, selectedIds.size),
          style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f),
          maxLines = 1, overflow = TextOverflow.Ellipsis)
        else Spacer(Modifier.weight(1f))
        if (selecting) TextButton(onClick = { selecting = false; selectedIds = emptyList() },
          enabled = !connection.batchConversationBusy,
          modifier = Modifier.testTag("conversations-selection-cancel")) {
          Text(stringResource(R.string.conversations_cancel))
        }
        if (!selecting && !searchOpen) IconButton(onClick = { searchOpen = true },
          modifier = Modifier.size(48.dp).semantics { contentDescription = searchLabel }
            .testTag("conversations-open-search")) {
          Icon(painterResource(R.drawable.action_search), contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.size(24.dp).testTag("conversations-search-icon"))
        }
        if (!selecting && mode == "recent") IconButton(onClick = onCreateConversation, enabled = !connection.creatingConversation,
          modifier = Modifier.size(48.dp).semantics {
            contentDescription = newConversationLabel
          }.testTag("chats-new")) {
          Icon(painterResource(R.drawable.action_add), contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.size(24.dp).testTag("conversations-new-icon"))
        }
      }
      if (!selecting) PageTitleMenu(listOf(
        SegmentOption("recent", stringResource(R.string.conversations_recent), "sessions-mode-recent"),
        SegmentOption("projects", stringResource(R.string.progress_projects), "sessions-mode-projects"),
        SegmentOption("experts", stringResource(R.string.conversations_experts), "sessions-mode-experts"),
      ), mode, "sessions-mode-menu", Modifier.fillMaxWidth(0.45f)) { selected ->
        if (mode != selected) {
          clearGroup()
          mode = selected
          navigation.rememberSelection("conversation-history", selected)
        }
      }
    }
    if (groupId.isNotEmpty()) TextButton(onClick = ::clearGroup, modifier = Modifier.testTag("sessions-clear-group")) {
      Text("$groupName ×", maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (searchOpen && !selecting) Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      BasicTextField(value = if (browsingGroups) groupQuery else connection.conversationSearch,
        onValueChange = { if (browsingGroups) groupQuery = it else onSearchChange(it) },
        modifier = Modifier.weight(1f).heightIn(min = 44.dp)
          .background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(24))
          .padding(horizontal = 16.dp, vertical = 10.dp).then(searchInputFocus()).testTag("conversations-search"),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        singleLine = true,
        decorationBox = { innerTextField ->
          Box {
            if ((if (browsingGroups) groupQuery else connection.conversationSearch).isEmpty()) Text(
              searchLabel,
              style = MaterialTheme.typography.bodyLarge,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
            innerTextField()
          }
        })
      IconButton(onClick = ::closeSearch,
        modifier = Modifier.size(48.dp).semantics { contentDescription = clearLabel }
        .testTag("conversations-clear")) {
        Text("×", style = MaterialTheme.typography.headlineMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    if (browsingGroups) {
      val projects = mode == "projects"
      val loading = if (projects) connection.progress.projectsLoading else expertsLoading
      val failed = if (projects) connection.progress.projectsError else expertsFailed
      val groups = if (projects) {
        listOf("unassigned" to stringResource(R.string.conversations_unassigned)) +
          connection.progress.projects.filter { it.status != "archived" }.map { it.id to it.name }
      } else experts.map { it.id to it.name }
      val matches = groups.filter { (_, name) -> name.contains(groupQuery.trim(), ignoreCase = true) }
      when {
        loading -> BrandLoadingPanel()
        failed -> TextButton(onClick = { if (projects) onLoadProjects() else expertReload++ }) {
          Text(stringResource(R.string.progress_refresh))
        }
        matches.isEmpty() -> Text(stringResource(R.string.progress_no_matches))
        else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          items(matches, key = { it.first }) { (id, name) ->
            Card(onClick = { closeSearch(); groupId = id; groupName = name },
              modifier = Modifier.fillMaxWidth().testTag("sessions-group-$id"), shape = themedCorners(16)) {
              Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(name, modifier = Modifier.weight(1f))
                ActionIcon(R.drawable.action_chevron_right, size = 16.dp)
              }
            }
          }
        }
      }
      return@Column
    }
    if (connection.conversationsLoading && connection.conversations.isEmpty()) BrandLoadingPanel()
    if (connection.conversationsError) Row(verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(R.string.chat_load_error), color = MaterialTheme.colorScheme.error,
        modifier = Modifier.weight(1f))
      TextButton(onClick = onRefresh, enabled = !connection.conversationsLoading,
        modifier = Modifier.testTag("conversations-retry")) {
        Text(stringResource(R.string.progress_refresh))
      }
    }
    if (connection.pinActionError) Text(stringResource(R.string.conversations_pin_error),
      color = MaterialTheme.colorScheme.error)
    if (connection.archiveActionError) Text(stringResource(R.string.conversations_archive_error),
      color = MaterialTheme.colorScheme.error)
    if (connection.deleteActionError) Text(stringResource(R.string.conversations_delete_error),
      color = MaterialTheme.colorScheme.error)
    if (connection.batchConversationFailedIds.isNotEmpty()) Text(
      stringResource(R.string.conversations_batch_failed, connection.batchConversationFailedIds.size),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("conversations-batch-error"))
    if (connection.discardDraftError) Text(stringResource(R.string.conversations_discard_error),
      color = MaterialTheme.colorScheme.error)
    if (connection.pendingDeleteId != null) Row(modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(R.string.conversations_pending_delete))
      TextButton(onClick = onUndoDelete, enabled = !connection.deleteCommitting,
        modifier = Modifier.testTag("conversations-undo-delete")) {
        Text(stringResource(R.string.conversations_undo))
      }
    }
    if (selecting) Row(modifier = Modifier.fillMaxWidth().testTag("conversations-batch-bar"),
      horizontalArrangement = Arrangement.SpaceEvenly) {
      TextButton(onClick = { onBatchConversations(selectedIds, "archive") },
        enabled = selectedIds.isNotEmpty() && !connection.batchConversationBusy,
        modifier = Modifier.testTag("conversations-batch-archive")) {
        Text(stringResource(R.string.conversations_archive))
      }
      TextButton(onClick = { onBatchConversations(selectedIds, "pin") },
        enabled = selectedIds.isNotEmpty() && !connection.batchConversationBusy,
        modifier = Modifier.testTag("conversations-batch-pin")) {
        Text(stringResource(R.string.conversations_pin))
      }
      TextButton(onClick = {
        selectedIds.singleOrNull()?.let(onBeginRename)
      }, enabled = selectedIds.size == 1 && !connection.batchConversationBusy,
        modifier = Modifier.testTag("conversations-batch-rename")) {
        Text(stringResource(R.string.conversations_rename))
      }
      TextButton(onClick = { confirmBatchDelete = true },
        enabled = selectedIds.isNotEmpty() && !connection.batchConversationBusy,
        modifier = Modifier.testTag("conversations-batch-delete")) {
        Text(stringResource(R.string.conversations_delete), color = MaterialTheme.colorScheme.error)
      }
    }
    PullToRefreshBox(isRefreshing = connection.conversationsLoading && connection.conversations.isNotEmpty(),
      onRefresh = { if (!connection.conversationsLoading && !connection.conversationsLoadingMore) onRefresh() },
      modifier = Modifier.fillMaxSize().testTag("conversations-refresh-gesture"),
      indicator = {
        if (connection.conversationsLoading && connection.conversations.isNotEmpty()) BrandLoadingIndicator(
          modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp), extent = 32.dp)
      }) {
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize().testTag("conversations-list"),
      contentPadding = PaddingValues(bottom = 20.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      ConversationGroups.group(ConversationGroups.visibleHistory(connection.conversations)
        .filterNot { it.id == connection.pendingDeleteId || it.id == connection.personal.agent?.conversationId }).forEach { group ->
        item(key = "section-${group.id}") {
          Text(conversationGroupLabel(group.id), style = MaterialTheme.typography.labelSmall, fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 22.dp, bottom = 8.dp))
        }
        group.items.forEach { conversation ->
          val taskGroup = connection.conversationTaskGroups[conversation.id]
            ?.takeIf { it.total > 0 && connection.conversationSearch.isBlank() }
          val taskExpanded = taskGroup != null && conversation.id !in collapsedTaskParents &&
            (conversation.id in expandedTaskParents || taskGroup.items.any {
              it.activeConversationId == connection.selectedConversationId
            })
          item(key = conversation.id) {
            ConversationCard(conversation, showTime = true,
              taskGroup = taskGroup, taskExpanded = taskExpanded,
              onToggleTasks = if (taskGroup == null) null else ({
                if (taskExpanded) {
                  expandedTaskParents = expandedTaskParents - conversation.id
                  collapsedTaskParents = collapsedTaskParents + conversation.id
                } else {
                  collapsedTaskParents = collapsedTaskParents - conversation.id
                  expandedTaskParents = expandedTaskParents + conversation.id
                }
              }),
              onMenu = if (selecting) null else ({ menuConversationId = conversation.id }),
              selected = conversation.id == connection.selectedConversationId,
              selectionMode = selecting,
              selectionSelected = conversation.id in selectedIds,
              discardEnabled = connection.discardingDraftId == null && !connection.creatingConversation && !connection.sending,
              onClick = {
                if (selecting) selectedIds = if (conversation.id in selectedIds)
                  selectedIds - conversation.id else selectedIds + conversation.id
                else onSelectConversation(conversation.id)
              })
          }
          if (taskGroup != null && taskExpanded && !selecting && connection.conversationSearch.isBlank()) {
            items(taskGroup.items, key = { "task-${conversation.id}-${it.taskId}" }) { child ->
              ConversationTaskRow(child, onOpen = { id -> onSelectTaskChild(child.taskId, id) })
            }
          }
        }
      }
      if (connection.conversationsHasMore) item {
        OutlinedButton(onClick = onLoadMore,
          enabled = !connection.conversationsLoading && !connection.conversationsLoadingMore,
          modifier = Modifier.fillMaxWidth().testTag("conversations-load-more")) {
          if (connection.conversationsLoadingMore) BrandLoadingIndicator(extent = 20.dp)
          Text(stringResource(if (connection.conversationsLoadingMore) R.string.conversations_loading_more
            else R.string.conversations_load_more))
        }
      }
      if (connection.conversationsMoreError) item {
        Text(stringResource(R.string.conversations_more_error), color = MaterialTheme.colorScheme.error)
      }
    }
    }
  }
}

@Composable
private fun ConversationCard(conversation: ConversationSummary, showTime: Boolean = false,
  onDiscard: (() -> Unit)? = null, onMenu: (() -> Unit)? = null, selected: Boolean = false,
  selectionMode: Boolean = false, selectionSelected: Boolean = false,
  taskGroup: ConversationTaskGroup? = null, taskExpanded: Boolean = false,
  onToggleTasks: (() -> Unit)? = null,
  discardEnabled: Boolean = true, onClick: () -> Unit, modifier: Modifier = Modifier) {
  val haptics = LocalHapticFeedback.current
  val contextMenuLabel = stringResource(R.string.conversations_more_actions)
  val taskExpandLabel = stringResource(R.string.conversations_expand_tasks)
  val taskCollapseLabel = stringResource(R.string.conversations_collapse_tasks)
  val shape = themedCorners(16)
  Card(modifier = modifier.fillMaxWidth().heightIn(min = 64.dp).clip(shape).testTag("conversation-row-${conversation.id}")
    .semantics {
      if (selectionMode) this.selected = selectionSelected
      if (onMenu != null) customActions = listOf(CustomAccessibilityAction(contextMenuLabel) {
        onMenu(); true
      })
    }.combinedClickable(onClick = onClick,
    onLongClick = onMenu?.let { action -> { haptics.performHapticFeedback(HapticFeedbackType.LongPress); action() } },
    onLongClickLabel = if (onMenu != null) stringResource(R.string.conversations_more_actions) else null),
    shape = shape,
    colors = CardDefaults.cardColors(containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer
      else MaterialTheme.colorScheme.surfaceContainer)) {
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (selectionMode) Text(if (selectionSelected) "☑" else "□",
          style = MaterialTheme.typography.titleMedium,
          color = MaterialTheme.colorScheme.primary)
        if (taskGroup != null && onToggleTasks != null && !selectionMode) {
          Box(modifier = Modifier.width(32.dp).height(40.dp), contentAlignment = Alignment.Center) {
            CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
              IconButton(onClick = onToggleTasks,
                modifier = Modifier.fillMaxSize().testTag("conversation-tasks-${conversation.id}").semantics {
                  contentDescription = if (taskExpanded) taskCollapseLabel else taskExpandLabel
                }) {
                Icon(painterResource(if (taskExpanded) R.drawable.action_chevron_down else R.drawable.action_chevron_right),
                  contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant,
                  modifier = Modifier.size(16.dp).testTag("conversation-task-chevron-${conversation.id}"))
              }
            }
          }
        }
        Text(if (conversation.isLocalDraft) stringResource(R.string.assistant_new_conversation) else conversation.title,
          style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
          modifier = Modifier.weight(1f))
        if (showTime) Text(conversationAgeLabel(conversation.updatedAt), style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
      }
      if (!showTime) Text(stringResource(R.string.conversations_message_count, conversation.messageCount),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (conversation.status == "pinned") Text(stringResource(R.string.conversations_pinned),
        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
      if (conversation.status == "archived") Text(stringResource(R.string.conversations_archived),
        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (onDiscard != null) TextButton(onClick = onDiscard, enabled = discardEnabled,
        modifier = Modifier.testTag("discard-draft-${conversation.id}")) {
        Text(stringResource(R.string.conversations_discard))
      }
    }
  }
}

@Composable
private fun ConversationTaskRow(child: ConversationTaskChild, onOpen: (String) -> Unit) {
  val status = child.runStatus ?: child.phase
  val label = when (status) {
    "running", "active", "verifying" -> stringResource(R.string.conversations_task_running)
    "completed", "succeeded", "closed" -> stringResource(R.string.conversations_task_completed)
    "failed" -> stringResource(R.string.conversations_task_failed)
    "backlog", "ready", "queued", "waiting" -> stringResource(R.string.conversations_task_waiting)
    else -> status
  }
  Row(modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
    .clip(themedCorners(12)).background(MaterialTheme.colorScheme.surfaceContainerLow)
    .clickable(enabled = child.activeConversationId != null) {
      child.activeConversationId?.let(onOpen)
    }.testTag("conversation-task-${child.taskId}")
    .padding(start = 24.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
    Box(modifier = Modifier.size(10.dp).border(1.dp, MaterialTheme.colorScheme.primary, CircleShape))
    Text(child.title, modifier = Modifier.weight(1f).testTag("conversation-task-title-${child.taskId}"), maxLines = 1, overflow = TextOverflow.Ellipsis,
      style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(label, maxLines = 1, style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun conversationGroupLabel(id: String): String {
  val locale = LocalConfiguration.current.locales[0]
  return when (id) {
  "today" -> stringResource(R.string.conversations_today)
  "yesterday" -> stringResource(R.string.conversations_yesterday)
  "this_week" -> stringResource(R.string.conversations_this_week)
  "last_week" -> stringResource(R.string.conversations_last_week)
  "this_month" -> stringResource(R.string.conversations_this_month)
  "earlier" -> stringResource(R.string.conversations_earlier)
  else -> runCatching {
    YearMonth.parse(id).format(DateTimeFormatter.ofPattern("LLLL yyyy", locale))
  }.getOrDefault(id)
  }
}

@Composable
private fun conversationAgeLabel(updatedAt: String): String {
  val age = ConversationGroups.age(updatedAt)
  val locale = LocalConfiguration.current.locales[0]
  return when (age.unit) {
    "now" -> stringResource(R.string.conversations_now)
    "minute" -> stringResource(R.string.conversations_minutes_ago, age.count)
    "hour" -> stringResource(R.string.conversations_hours_ago, age.count)
    "day" -> stringResource(R.string.conversations_days_ago, age.count)
    "week" -> stringResource(R.string.conversations_weeks_ago, age.count)
    "date" -> age.date?.format(DateTimeFormatter.ofPattern("MMM d", locale)).orEmpty()
    else -> ""
  }
}

@Composable
private fun ContextDetails(connection: ConnectionUiState, onRetry: () -> Unit,
  onLoadPanel: (String, String, String) -> Unit, onSetDirectory: () -> Unit,
  onAddFile: (ManagedFile) -> Unit, onCreateScope: (String?, String?) -> Unit,
  onLoadReferences: (String, String) -> Unit, onAddReference: (ReferencePickerItem) -> Boolean,
  initialMode: String = "context", initialKind: String = "note",
  onBackToOptions: () -> Unit, onClose: () -> Unit) {
  var mode by remember(connection.selectedConversationId, initialMode) { mutableStateOf(initialMode) }
  var kind by remember(connection.selectedConversationId, initialKind) { mutableStateOf(initialKind) }
  var query by remember(connection.selectedConversationId) { mutableStateOf("") }
  var filePath by remember(connection.selectedConversationId) { mutableStateOf("") }
  var fileAttachmentCount by remember(connection.selectedConversationId) { mutableIntStateOf(-1) }
  val panel = connection.contextPanel
  val summary = connection.context
  val sheetRows = when (mode) {
    "project" -> panel.projects.size + 1
    "environment" -> 2 + if (panel.environment?.worktreeUnavailableReason != null) 1 else 0
    "directory" -> (panel.directories?.entries?.count { it.isDirectory } ?: 0) + 3
    "references" -> 7
    else -> 2 + summary?.sources.orEmpty().size.coerceAtMost(5) +
      (if (summary?.environment != null) 1 else 0) +
      (if (summary?.project == null && summary?.task == null &&
        summary?.workingDirectoryLocked != true) 1 else 0)
  }
  val desiredHeight = when (mode) {
    "environment" -> if (panel.environment?.worktreeUnavailableReason != null) 336.dp else 272.dp
    "project" -> (132 + sheetRows * 68).dp.coerceIn(240.dp, 620.dp)
    "directory" -> (140 + sheetRows * 56).dp.coerceIn(300.dp, 620.dp)
    "references" -> 620.dp
    else -> if (connection.contextLoading || summary == null) 300.dp
      else (132 + sheetRows * 64).dp.coerceIn(280.dp, 620.dp)
  }
  val sheetHeight = minOf(desiredHeight, LocalConfiguration.current.screenHeightDp.dp * 0.84f)
  fun choose(next: String) {
    mode = next
    if (next == "project" || next == "environment") onLoadPanel(next, "", "")
    if (next == "directory") onLoadPanel(next, summary?.effectiveWorkspacePath.orEmpty(), "")
    if (next == "references") { kind = "note"; query = ""; onLoadReferences("note", "") }
  }
  LaunchedEffect(mode, kind, query, filePath) {
    if (mode == "references") {
      delay(250)
      if (kind == "file") onLoadPanel("files", filePath, query)
      else onLoadReferences(kind, query)
    }
  }
  LaunchedEffect(panel.mode, panel.saving) {
    if (mode == "directory" && panel.mode.isBlank() && !panel.saving) mode = "context"
  }
  LaunchedEffect(connection.draftAttachments.size, panel.saving) {
    if (fileAttachmentCount >= 0 && !panel.saving &&
      connection.draftAttachments.size > fileAttachmentCount) onClose()
  }
  BackHandler {
    if (mode != "context") mode = "context" else onBackToOptions()
  }
  Column(modifier = Modifier.fillMaxWidth().height(sheetHeight)
    .padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 24.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(R.string.assistant_context), modifier = Modifier.weight(1f),
        style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
      TextButton(onClick = onClose, modifier = Modifier.testTag("context-close")) {
        Text("×", style = MaterialTheme.typography.headlineMedium)
      }
    }
    if (mode == "references") {
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf("note" to R.string.tab_notes, "task" to R.string.progress_tasks,
          "file" to R.string.notes_files).forEach { (value, label) ->
          TextButton(onClick = { kind = value; query = ""; filePath = "" },
            modifier = Modifier.weight(1f).testTag("context-reference-kind-$value")) {
            Text(stringResource(label), color = if (kind == value) MaterialTheme.colorScheme.primary
              else MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
      OutlinedTextField(query, onValueChange = { if (it.length <= 4096) query = it },
        label = { Text(stringResource(R.string.assistant_reference_search)) },
        singleLine = true, modifier = Modifier.fillMaxWidth().testTag("context-reference-search"))
      if (kind == "file" && filePath.isNotBlank()) TextButton(onClick = {
        filePath = filePath.substringBeforeLast('/', "")
      }) { Text("‹ $filePath", maxLines = 1, overflow = TextOverflow.Ellipsis) }
      if (kind != "file" && connection.draftRefs.size >= 5) Text(
        stringResource(R.string.assistant_reference_limit), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    val busy = if (mode == "context") connection.contextLoading else if (mode == "references" && kind != "file")
      connection.referencePicker.loading else panel.loading || panel.saving
    val failed = if (mode == "context") connection.contextError else if (mode == "references" && kind != "file")
      connection.referencePicker.error else panel.error
    if (busy) BrandLoadingPanel(modifier = Modifier.testTag("context-loading"))
    if (failed) {
      Text(stringResource(R.string.assistant_context_error), color = MaterialTheme.colorScheme.error)
      TextButton(onClick = {
        when (mode) {
          "context" -> onRetry()
          "references" -> if (kind == "file") onLoadPanel("files", filePath, query)
            else onLoadReferences(kind, query)
          "directory" -> onLoadPanel("directory", panel.directories?.currentPath.orEmpty(), "")
          else -> onLoadPanel(mode, "", "")
        }
      }, modifier = Modifier.testTag("context-retry")) { Text(stringResource(R.string.assistant_context_retry)) }
    }
    LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth(),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      when (mode) {
        "context" -> if (summary != null) {
          item { Text(stringResource(R.string.assistant_context_hint),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
          item { ContextRow(summary.project?.title ?: stringResource(R.string.assistant_context_none),
            summary.task?.title.orEmpty(), "context-project", iconRes = R.drawable.action_folder) {
            choose("project")
          } }
          summary.environment?.let { environment -> item {
            ContextRow(if (environment.kind == "managed_worktree") "Worktree" else "Local",
              listOf(environment.rootPath, environment.branch.orEmpty()).filter(String::isNotBlank)
                .joinToString("\n"), "context-environment", iconRes = R.drawable.settings_gear) {
              choose(if (summary.project != null) "environment" else "directory")
            }
          } }
          if (summary.project == null && summary.task == null && !summary.workingDirectoryLocked) item {
            ContextRow(stringResource(R.string.assistant_context_change_directory), "", "context-directory") {
              choose("directory")
            }
          }
          items(summary.sources, key = { it.id }) { source ->
            ContextRow(source.title.ifBlank { source.id }, if (source.unavailable)
              stringResource(R.string.assistant_context_unavailable) else "", "context-source-${source.id}",
              enabled = false, navigable = false, iconRes = R.drawable.tab_notes) {}
          }
          if (summary.sourcesHasMore) item { Text(stringResource(R.string.assistant_context_more_sources)) }
          item { ContextRow(stringResource(R.string.assistant_reference_title), "", "context-add-reference") {
            choose("references")
          } }
        }
        "project" -> {
          item { ContextRow(stringResource(R.string.assistant_context_none), "", "context-project-none") {
            if (summary?.project == null) onClose() else { onCreateScope(null, null); onClose() }
          } }
          items(panel.projects, key = { it.id }) { project ->
            ContextRow((if (summary?.project?.id == project.id) "✓ " else "") + project.name,
              project.description, "context-project-${project.id}") {
              if (summary?.project?.id == project.id) onClose()
              else { onCreateScope(project.id, null); onClose() }
            }
          }
        }
        "environment" -> {
          item { ContextRow("Local", "", "context-local", iconRes = R.drawable.action_folder,
            enabled = panel.environment?.localAvailable == true) {
            onCreateScope(summary?.project?.id, "local_checkout"); onClose()
          } }
          item { ContextRow("Worktree", panel.environment?.worktreeUnavailableReason.orEmpty(),
            "context-worktree", iconRes = R.drawable.action_folder,
            enabled = panel.environment != null &&
              panel.environment.worktreeUnavailableReason == null) {
            onCreateScope(summary?.project?.id, "managed_worktree"); onClose()
          } }
        }
        "directory" -> {
          panel.directories?.let { page ->
            item { Text(page.currentPath, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            page.parentPath?.let { parent -> item { ContextRow("↑", parent, "context-directory-parent") {
              onLoadPanel("directory", parent, "")
            } } }
            items(page.entries.filter { it.isDirectory }, key = { it.absolutePath }) { entry ->
              ContextRow(entry.name, entry.absolutePath, "context-directory-${entry.name}") {
                onLoadPanel("directory", entry.absolutePath, "")
              }
            }
          }
        }
        "references" -> if (kind == "file") {
          items(panel.files, key = { it.id }) { file ->
            ContextRow(file.name, file.relativePath, "context-file-${file.id}",
              enabled = !panel.saving && connection.draftAttachments.none {
                it.workspaceRelativePath == file.relativePath
              }) {
              if (file.kind == "directory") filePath = file.relativePath
              else { fileAttachmentCount = connection.draftAttachments.size; onAddFile(file) }
            }
          }
        } else {
          items(connection.referencePicker.items, key = { it.kind + it.id }) { ref ->
            ContextRow(ref.title, ref.description, "context-reference-${ref.kind}-${ref.id}",
              enabled = connection.draftRefs.size < 5 &&
                connection.draftRefs.none { it.kind == ref.kind && it.sourceId == ref.id }) {
              if (onAddReference(ref)) onClose()
            }
          }
        }
      }
    }
    if (mode == "directory" && panel.directories?.currentPath?.isNotBlank() == true &&
      summary?.workingDirectoryLocked != true) Button(onClick = onSetDirectory,
      enabled = !panel.loading && !panel.saving,
      modifier = Modifier.fillMaxWidth().testTag("context-use-directory")) {
      Text(stringResource(R.string.assistant_context_use_directory))
    }
  }
}

@Composable
private fun SessionFilesDetails(panel: ContextPanelUiState,
  onLoadPanel: (String, String, String) -> Unit,
  onLoadContent: suspend (String) -> ByteArray, onClose: () -> Unit) {
  var path by remember { mutableStateOf("") }
  var query by remember { mutableStateOf("") }
  var selected by remember { mutableStateOf<ManagedFile?>(null) }
  val content by produceState<ByteArray?>(initialValue = null, selected?.id) {
    value = null
    val file = selected ?: return@produceState
    value = try { onLoadContent(file.id) }
      catch (error: CancellationException) { throw error }
      catch (_: Exception) { byteArrayOf() }
  }
  BackHandler(enabled = selected != null || path.isNotBlank()) {
    if (selected != null) selected = null
    else {
      path = path.substringBeforeLast('/', "")
      onLoadPanel("files", path, query)
    }
  }
  Column(modifier = Modifier.fillMaxWidth().fillMaxHeight(0.9f)
    .padding(horizontal = 20.dp, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(R.string.assistant_session_files),
        style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
        modifier = Modifier.weight(1f))
      TextButton(onClick = onClose) { Text("×") }
    }
    if (selected == null) {
      OutlinedTextField(query, onValueChange = { query = it.take(4096) },
        modifier = Modifier.fillMaxWidth().testTag("session-files-search"),
        label = { Text(stringResource(R.string.assistant_reference_search)) },
        singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onLoadPanel("files", path, query) }))
      Text(if (path.isBlank()) stringResource(R.string.assistant_session_files) else path,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (panel.loading) BrandLoadingPanel(modifier = Modifier.testTag("session-files-loading"))
      if (panel.error) {
        Text(stringResource(R.string.assistant_context_error), color = MaterialTheme.colorScheme.error)
        TextButton(onClick = { onLoadPanel("files", path, query) }, enabled = !panel.loading,
          modifier = Modifier.testTag("session-files-retry")) {
          Text(stringResource(R.string.assistant_context_retry))
        }
      }
      LazyColumn(modifier = Modifier.weight(1f),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!panel.loading && !panel.error && panel.files.isEmpty()) item {
          Text(stringResource(R.string.notes_files_empty),
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(panel.files, key = { it.id }) { file ->
          ContextRow(file.name, file.relativePath, "session-file-${file.id}",
            iconRes = if (file.kind == "directory") R.drawable.action_folder else R.drawable.tab_notes) {
            if (file.kind == "directory") {
              path = file.relativePath
              onLoadPanel("files", path, query)
            } else selected = file
          }
        }
      }
    } else {
      val file = selected!!
      Text(file.name, style = MaterialTheme.typography.titleMedium)
      Text(file.relativePath, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (content == null) BrandLoadingPanel(modifier = Modifier.testTag("session-file-loading"))
      else if (content!!.isEmpty()) Text(stringResource(R.string.notes_file_preview_unavailable))
      else if (isBitmapPreview(file.name, file.mimeType)) {
        val bitmap = remember(content) {
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeByteArray(content!!, 0, content!!.size, bounds)
          var sample = 1
          while (bounds.outWidth / sample > 2048 || bounds.outHeight / sample > 2048) sample *= 2
          BitmapFactory.decodeByteArray(content!!, 0, content!!.size,
            BitmapFactory.Options().apply { inSampleSize = sample })
        }
        if (bitmap != null) Image(bitmap.asImageBitmap(), file.name,
          modifier = Modifier.fillMaxWidth().weight(1f).testTag("session-file-image"),
          contentScale = ContentScale.Fit)
        else Text(stringResource(R.string.notes_file_preview_unavailable))
      } else FilePreviewContent(file.name, file.mimeType, content!!,
        modifier = Modifier.fillMaxWidth().weight(1f).testTag("session-file-preview"))
    }
  }
}

@Composable
internal fun ContextRow(title: String, subtitle: String, tag: String, enabled: Boolean = true,
  iconRes: Int? = null, compact: Boolean = false, navigable: Boolean = true,
  flat: Boolean = false, showChevron: Boolean = true,
  onClick: () -> Unit) {
  TextButton(onClick = onClick, enabled = enabled,
    modifier = Modifier.fillMaxWidth().heightIn(min = if (compact) 52.dp else 64.dp)
      .background(if (flat) Color.Transparent else MaterialTheme.colorScheme.surface,
        RoundedCornerShape(if (compact) 12.dp else 14.dp))
      .testTag(tag), contentPadding = PaddingValues(horizontal = if (compact) 12.dp else 16.dp,
      vertical = if (compact) 6.dp else 12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(if (compact) 10.dp else 12.dp)) {
      if (iconRes != null) Icon(painterResource(iconRes), contentDescription = null,
        modifier = Modifier.size(if (compact) 20.dp else 23.dp),
        tint = MaterialTheme.colorScheme.onSurfaceVariant)
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, color = MaterialTheme.colorScheme.onSurface,
          style = if (compact && flat) MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 21.sp)
            else if (compact) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge,
          fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (subtitle.isNotBlank()) Text(subtitle, style = if (flat)
          MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp, lineHeight = 18.sp)
          else MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2,
          overflow = TextOverflow.Ellipsis)
      }
      if (navigable && showChevron) ActionIcon(R.drawable.action_chevron_right, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 16.dp)
    }
  }
}

@Composable
private fun PairingScreen(
  title: String,
  connection: ConnectionUiState,
  onPair: (String) -> Unit,
  onCancelPairing: () -> Unit,
  onScanPairing: () -> Unit,
  scanning: Boolean,
  scanError: Boolean,
  insets: PaddingValues,
  onBack: (() -> Unit)? = null,
  onSettings: (() -> Unit)? = null,
) {
  // The invitation carries a secret. Keep the draft in memory, not saved instance state.
  var invitation by remember { mutableStateOf("") }
  var manualEntry by rememberSaveable { mutableStateOf(false) }
  var showHelp by rememberSaveable { mutableStateOf(false) }
  var dismissedError by remember { mutableStateOf<String?>(null) }
  val busy = connection.pairing || connection.restoring || scanning
  val secondary = manualEntry || showHelp || onBack != null
  val closeSecondary = {
    if (manualEntry || showHelp) {
      manualEntry = false; showHelp = false; dismissedError = connection.error
    }
    else onBack?.invoke()
    Unit
  }
  BackHandler(enabled = secondary && !busy, onBack = closeSecondary)
  Column(modifier = Modifier.fillMaxSize().padding(insets)) {
    Row(modifier = Modifier.fillMaxWidth().height(56.dp)
      .padding(start = 16.dp, end = 12.dp),
      verticalAlignment = Alignment.CenterVertically) {
      if (!secondary) {
        Image(painterResource(R.drawable.brand_mark), contentDescription = "xopc",
          modifier = Modifier.size(32.dp))
        Text("xopc", style = MaterialTheme.typography.titleLarge,
          fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
      }
      Spacer(modifier = Modifier.weight(1f))
      if (onSettings != null) IconButton(onClick = onSettings, enabled = !busy,
        modifier = Modifier.size(44.dp).testTag("pairing-settings")) {
        Icon(painterResource(R.drawable.settings_gear),
          contentDescription = stringResource(R.string.settings_title),
          tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    Column(modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
      .padding(horizontal = 24.dp)) {
      Text(when {
        connection.pairing || connection.restoring -> stringResource(
          if (connection.confirmationCode != null) R.string.pairing_waiting
          else R.string.pairing_connecting)
        showHelp -> stringResource(R.string.pairing_help_title)
        manualEntry -> stringResource(R.string.pairing_manual_title)
        onBack != null -> title
        else -> stringResource(R.string.pairing_title)
      }, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold,
        modifier = Modifier.fillMaxWidth().padding(top = 40.dp).testTag("pairing-title"))
      Text(when {
        connection.pairing || connection.restoring -> stringResource(
          if (connection.confirmationCode != null) R.string.pairing_approve_hint
          else R.string.pairing_connecting_hint)
        showHelp -> stringResource(R.string.pairing_help_steps)
        manualEntry -> stringResource(R.string.pairing_manual_hint)
        else -> stringResource(R.string.pairing_hint)
      }, style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp))
      connection.confirmationCode?.let { code ->
        Column(modifier = Modifier.fillMaxWidth().padding(top = 32.dp)
          .background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(20))
          .padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
          verticalArrangement = Arrangement.spacedBy(12.dp)) {
          Text(code, style = MaterialTheme.typography.headlineLarge,
            letterSpacing = 6.sp, modifier = Modifier.testTag("pairing-confirmation-code"))
          Text(stringResource(R.string.pairing_compare),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      if (manualEntry && !connection.pairing && !connection.restoring) {
        BasicTextField(invitation, { invitation = it }, enabled = !scanning,
          modifier = Modifier.fillMaxWidth().height(112.dp).padding(top = 24.dp)
            .background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(16))
            .padding(16.dp).testTag("pairing-link"),
          textStyle = MaterialTheme.typography.bodyMedium.copy(
            color = MaterialTheme.colorScheme.onSurface), maxLines = 5,
          decorationBox = { inner -> Box {
            if (invitation.isEmpty()) Text(stringResource(R.string.pairing_link_label),
              color = MaterialTheme.colorScheme.onSurfaceVariant)
            inner()
          } })
      }
      if ((connection.error != null && connection.error != dismissedError) ||
        (scanError && !manualEntry && !showHelp)) Text(stringResource(when {
        scanError && !manualEntry && !showHelp -> R.string.pairing_scan_error
        connection.error == "PAIRING_EXPIRED" -> R.string.pairing_error_expired
        connection.error == "PAIRING_REJECTED" -> R.string.pairing_error_rejected
        connection.error == "GATEWAY_IDENTITY_MISMATCH" -> R.string.pairing_error_identity
        connection.error == "INVALID_INVITATION" ||
          connection.error == "INVALID_SECURE_ORIGIN" -> R.string.pairing_error_link
        else -> R.string.pairing_error
      }), color = MaterialTheme.colorScheme.error,
        modifier = Modifier.fillMaxWidth().padding(top = 24.dp).testTag("pairing-error"))
    }
    Column(modifier = Modifier.fillMaxWidth()
      .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
      horizontalAlignment = Alignment.CenterHorizontally) {
      when {
        connection.pairing -> TextButton(onClick = onCancelPairing,
          modifier = Modifier.fillMaxWidth().height(48.dp).testTag("pairing-cancel")) {
          Text(stringResource(R.string.progress_cancel))
        }
        connection.restoring -> BrandLoadingIndicator(
          modifier = Modifier.testTag("pairing-progress"))
        showHelp -> Button(onClick = closeSecondary,
          modifier = Modifier.fillMaxWidth().height(52.dp).testTag("pairing-ready")) {
          Text(stringResource(R.string.pairing_ready))
        }
        manualEntry -> Button(onClick = { dismissedError = null; onPair(invitation.trim()) },
          enabled = invitation.isNotBlank() && !scanning,
          modifier = Modifier.fillMaxWidth().height(52.dp).testTag("pairing-submit")) {
          Text(stringResource(R.string.pairing_connect))
        }
        else -> {
          Button(onClick = { dismissedError = connection.error; onScanPairing() }, enabled = !scanning,
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("pairing-scan")) {
            Text(if (scanning) stringResource(R.string.pairing_scanning)
              else stringResource(R.string.pairing_scan))
          }
          TextButton(onClick = { manualEntry = true; dismissedError = connection.error }, enabled = !scanning,
            modifier = Modifier.fillMaxWidth().height(48.dp).testTag("pairing-manual")) {
            Text(stringResource(R.string.pairing_manual))
          }
          TextButton(onClick = { showHelp = true; dismissedError = connection.error }, enabled = !scanning,
            modifier = Modifier.fillMaxWidth().height(44.dp).testTag("pairing-help")) {
            Text(stringResource(R.string.pairing_help))
          }
        }
      }
      Text(stringResource(R.string.pairing_requirement),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 20.dp))
    }
  }
}
