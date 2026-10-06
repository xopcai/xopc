package ai.xopc.mobile.ui.main

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
import ai.xopc.mobile.gateway.ConversationSummary
import ai.xopc.mobile.gateway.ConversationTaskChild
import ai.xopc.mobile.gateway.ConversationTaskGroup
import ai.xopc.mobile.gateway.ConversationMedia
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
import androidx.annotation.StringRes
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.Image
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.TextButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.produceState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException

/** The five top-level destinations mirror the current HarmonyOS home screen. */
enum class HomeTab(@field:StringRes val label: Int, val icon: Int) {
  Assistant(R.string.tab_assistant, R.drawable.tab_assistant),
  Conversations(R.string.tab_conversations, R.drawable.tab_conversations),
  Progress(R.string.tab_progress, R.drawable.tab_progress),
  Notes(R.string.tab_notes, R.drawable.tab_notes),
  Me(R.string.tab_me, R.drawable.tab_me),
}

@Composable
private fun XopcTabDock(selectedTab: HomeTab, onSelectTab: (HomeTab) -> Unit,
  grouped: Boolean = false, attentionCount: Int = 0) {
  Row(modifier = Modifier.fillMaxWidth().padding(horizontal = if (grouped) 0.dp else 8.dp)
    .height(52.dp)
    .padding(horizontal = 4.dp, vertical = 4.dp).testTag("main-tab-dock"),
    verticalAlignment = Alignment.CenterVertically) {
    HomeTab.entries.forEach { tab ->
      val selected = selectedTab == tab
      val label = stringResource(tab.label)
      val interactionSource = remember { MutableInteractionSource() }
      val attentionDescription = if (tab == HomeTab.Progress && attentionCount > 0)
        stringResource(R.string.progress_attention_count, attentionCount) else null
      Column(modifier = Modifier.weight(1f).height(44.dp)
        .clickable(interactionSource = interactionSource, indication = null,
          role = Role.Tab, onClickLabel = label) { onSelectTab(tab) }
        .semantics {
          this.selected = selected
          if (attentionDescription != null) stateDescription = attentionDescription
        }
        .testTag("tab-${tab.name}"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Box(modifier = Modifier.size(width = 42.dp, height = 28.dp)
          .clip(RoundedCornerShape(16.dp))
          .indication(interactionSource, ripple(bounded = true, radius = 21.dp))) {
          Box(modifier = Modifier.fillMaxSize()
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
              RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
            if (tab == HomeTab.Assistant) LoopiIcon(extent = 28.dp, compact = true,
              active = selected, modifier = Modifier.testTag("assistant-tab-loopi"))
            else Icon(painterResource(tab.icon), contentDescription = null,
              tint = if (selected) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant,
              modifier = Modifier.size(22.dp))
          }
          if (tab == HomeTab.Progress && attentionCount > 0) {
            Text(if (attentionCount > 99) "99+" else attentionCount.toString(),
              modifier = Modifier.align(Alignment.TopEnd).testTag("progress-attention-badge")
                .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(8.dp))
                .padding(horizontal = 3.dp),
              fontSize = 10.sp, lineHeight = 16.sp,
              color = MaterialTheme.colorScheme.primary)
          }
        }
        Text(label, fontSize = 11.sp, lineHeight = 12.sp, maxLines = 1,
          color = if (selected) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

private data class WelcomeRecommendation(val title: String, val reason: String, val prompt: String)

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
private fun AssistantWelcome(recommendation: WelcomeRecommendation?, onChoose: (String) -> Unit) {
  Column(modifier = Modifier.fillMaxWidth().testTag("assistant-welcome"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(16.dp)) {
    LoopiIcon(extent = 108.dp, active = true, interactive = true,
      modifier = Modifier.testTag("assistant-welcome-loopi"))
    Text(stringResource(R.string.assistant_welcome), style = MaterialTheme.typography.titleLarge,
      fontWeight = FontWeight.SemiBold)
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
        .height(64.dp).background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp)))
    }
  }
}

@Composable
fun MainScreen(
  modifier: Modifier = Modifier,
  connection: ConnectionUiState = ConnectionUiState(),
  onPair: (String) -> Unit = {},
  onCancelPairing: () -> Unit = {},
  onConversationSearchChange: (String) -> Unit = {},
  onRefreshConversations: () -> Unit = {},
  onLoadMoreConversations: () -> Unit = {},
  onSelectConversation: (String) -> Unit = {},
  onSelectTaskChildConversation: (String, String) -> Unit = { _, _ -> },
  onCreateConversation: () -> Unit = {},
  onCreateProjectConversation: (String) -> Unit = {},
  onCreateReferenceConversation: (String) -> Unit = {},
  onReferenceRequestHandled: (String, String) -> Unit = { _, _ -> },
  onDiscardDraft: (String) -> Unit = {},
  onBeginRename: (String) -> Unit = {},
  onRenameDraftChange: (String) -> Unit = {},
  onSaveRename: () -> Unit = {},
  onCancelRename: () -> Unit = {},
  onTogglePin: (String) -> Unit = {},
  onToggleArchive: (String) -> Unit = {},
  onBatchConversations: (List<String>, String) -> Unit = { _, _ -> },
  onBeginConversationShare: (String) -> Unit = {},
  onConfirmConversationShare: () -> Unit = {},
  onDismissConversationShare: () -> Unit = {},
  onScheduleDelete: (String) -> Unit = {},
  onUndoDelete: () -> Unit = {},
  onQuickDraftChange: (String) -> Unit = {},
  onQuickSubmit: () -> Unit = {},
  onAddQuickAttachment: (String, Uri) -> Unit = { _, _ -> },
  onAddCapturedQuickAttachment: (String, Uri) -> Unit = { _, _ -> },
  onRemoveQuickAttachment: (String) -> Unit = {},
  onPreviewQuickImage: suspend (ChatAttachment) -> Bitmap? = { null },
  onQuickNavigationHandled: (String) -> Unit = {},
  onDraftChange: (String) -> Unit = {},
  onAddDraftAttachment: (String, String, Uri) -> Unit = { _, _, _ -> },
  onAddCapturedDraftAttachment: (String, String, Uri) -> Unit = { _, _, _ -> },
  onRemoveDraftAttachment: (String) -> Unit = {},
  onPreviewDraftImage: suspend (String, ChatAttachment) -> Bitmap? = { _, _ -> null },
  onRemoveDraftRef: (String, String) -> Unit = { _, _ -> },
  onLoadReferences: (String, String) -> Unit = { _, _ -> },
  onAddDraftRef: (ReferencePickerItem) -> Boolean = { false },
  onSendMessage: () -> Unit = {},
  onRetryPendingInput: () -> Unit = {},
  onStopRun: () -> Unit = {},
  onReloadModels: () -> Unit = {},
  onSelectModel: (String) -> Unit = {},
  onReloadAgents: () -> Unit = {},
  onSwitchAgent: (String, Boolean) -> Unit = { _, _ -> },
  onReloadContext: () -> Unit = {},
  onLoadContextPanel: (String, String, String) -> Unit = { _, _, _ -> },
  onSetContextDirectory: () -> Unit = {},
  onAddContextFile: (ManagedFile) -> Unit = {},
  onCreateContextConversation: (String?, String?) -> Unit = { _, _ -> },
  onRefreshConnectionWait: () -> Unit = {},
  onRefreshProgress: () -> Unit = {},
  onRefreshProgressHome: () -> Unit = {},
  onProgressHomeAction: (ProgressHomeAction) -> Unit = {},
  onLoadAutomations: () -> Unit = {},
  onOpenAutomation: (String) -> Unit = {},
  onOpenAutomationRun: (String) -> Unit = {},
  onAutomationAction: (String, String) -> Unit = { _, _ -> },
  onCreateAutomation: (String, String, String, String) -> Unit = { _, _, _, _ -> },
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
  onCreateProgressTask: (String, String, String) -> Unit = { _, _, _ -> },
  onOpenTaskChat: (String) -> Unit = {},
  onSaveProgressTask: (String, Int, String, String, String) -> Unit = { _, _, _, _, _ -> },
  onProgressTaskSearchChange: (String) -> Unit = {},
  onSubmitProgressTaskSearch: () -> Unit = {},
  onOpenExecution: (String) -> Unit = {},
  onRetryExecution: () -> Unit = {},
  onCloseExecution: () -> Unit = {},
  onSaveMessageAsNote: (String) -> Unit = {},
  onReuseMessage: (String) -> Boolean = { false },
  onRegenerateMessage: (String) -> Boolean = { false },
  onLoadMessageMedia: suspend (String, ConversationMedia) -> ByteArray = { _, _ ->
    throw IllegalStateException("MEDIA_UNAVAILABLE")
  },
  onSpeechChunk: suspend (String, String) -> ByteArray = { _, _ ->
    throw IllegalStateException("SPEECH_UNAVAILABLE")
  },
  onTranscribeAudio: suspend (ByteArray, String) -> String = { _, _ ->
    throw IllegalStateException("TRANSCRIPTION_UNAVAILABLE")
  },
  onCreateVoiceCall: suspend (String, String) -> VoiceCallConnection = { _, _ ->
    throw IllegalStateException("VOICE_UNAVAILABLE")
  },
  onCancelVoiceCall: suspend (VoiceCallConnection) -> Unit = {},
  onVoiceClarification: suspend (String, Int, String, String) -> Unit = { _, _, _, _ -> },
  onPendingVoiceApproval: suspend (String) -> VoiceApproval? = { null },
  onRespondVoiceApproval: suspend (VoiceApproval, Boolean) -> Unit = { _, _ -> },
  onAddVoiceAttachment: suspend (ByteArray, Int) -> Unit = { _, _ ->
    throw IllegalStateException("VOICE_UNAVAILABLE")
  },
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
  val activity = context as? Activity
  val latestPair by rememberUpdatedState(onPair)
  var pairingScannerOpen by remember { mutableStateOf(false) }
  var pairingPermissionRequesting by remember { mutableStateOf(false) }
  var pairingPermissionRationale by remember { mutableStateOf(false) }
  var pairingPermissionPermanentlyDenied by remember { mutableStateOf(false) }
  var pairingScanError by remember { mutableStateOf(false) }
  val latestAddAttachment by rememberUpdatedState(onAddDraftAttachment)
  val latestAddQuickAttachment by rememberUpdatedState(onAddQuickAttachment)
  val latestAddCapturedAttachment by rememberUpdatedState(onAddCapturedDraftAttachment)
  val latestAddCapturedQuickAttachment by rememberUpdatedState(onAddCapturedQuickAttachment)
  var pickerGatewayId by rememberSaveable { mutableStateOf<String?>(null) }
  var pickerConversationId by rememberSaveable { mutableStateOf<String?>(null) }
  var pickerQuick by rememberSaveable { mutableStateOf(false) }
  val handlePickedUri: (Uri?) -> Unit = { uri ->
    val gatewayId = pickerGatewayId
    val conversationId = pickerConversationId
    val quick = pickerQuick
    pickerGatewayId = null
    pickerConversationId = null
    pickerQuick = false
    if (uri != null && gatewayId != null && connection.profile?.gatewayId == gatewayId) {
      if (quick) latestAddQuickAttachment(gatewayId, uri)
      else if (conversationId != null && connection.selectedConversationId == conversationId)
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
  var cameraQuick by rememberSaveable { mutableStateOf(false) }
  val cameraPicker = rememberLauncherForActivityResult(CameraTakePictureContract()) { saved ->
    val uri = cameraUri?.let(Uri::parse)
    val gatewayId = cameraGatewayId
    val conversationId = cameraConversationId
    val quick = cameraQuick
    cameraUri = null
    cameraGatewayId = null
    cameraConversationId = null
    cameraQuick = false
    if (uri != null) {
      if (saved && gatewayId != null && connection.profile?.gatewayId == gatewayId &&
        (quick || conversationId == connection.selectedConversationId)) {
        if (quick) latestAddCapturedQuickAttachment(gatewayId, uri)
        else if (conversationId != null) latestAddCapturedAttachment(gatewayId, conversationId, uri)
      } else CameraCaptureStore.discard(context, uri)
    }
  }
  val launchCamera: (String, String?, Boolean) -> Unit = { gatewayId, conversationId, quick ->
    var uri: Uri? = null
    try {
      uri = CameraCaptureStore.create(context)
      cameraUri = uri.toString()
      cameraGatewayId = gatewayId
      cameraConversationId = conversationId
      cameraQuick = quick
      cameraPicker.launch(uri)
    } catch (_: Exception) {
      uri?.let { CameraCaptureStore.discard(context, it) }
      cameraUri = null
      cameraGatewayId = null
      cameraConversationId = null
      cameraQuick = false
      Toast.makeText(context, R.string.camera_capture_error, Toast.LENGTH_SHORT).show()
    }
  }
  var selectedTab by rememberSaveable { mutableStateOf(HomeTab.Assistant) }
  var wasUnpaired by remember { mutableStateOf(connection.profile == null) }
  LaunchedEffect(connection.profile?.gatewayId) {
    if (connection.profile == null) wasUnpaired = true
    else if (wasUnpaired) {
      selectedTab = HomeTab.Assistant
      wasUnpaired = false
    }
  }
  LaunchedEffect(connection.quickOpenedConversationId, connection.selectedConversationId) {
    val id = connection.quickOpenedConversationId
    if (id != null && id == connection.selectedConversationId) {
      selectedTab = HomeTab.Assistant
      onQuickNavigationHandled(id)
    }
  }
  LaunchedEffect(connection.messageNoteFeedback) {
    val feedback = connection.messageNoteFeedback ?: return@LaunchedEffect
    Toast.makeText(context, if (feedback.saved) R.string.assistant_saved_note
      else R.string.assistant_save_note_error, Toast.LENGTH_SHORT).show()
    onMessageNoteFeedbackHandled(feedback)
  }
  MainContent(selectedTab = selectedTab, onSelectTab = { selectedTab = it }, connection = connection,
    onPair = onPair, onCancelPairing = onCancelPairing, onScanPairing = scanPairingCode,
    pairingScanning = pairingScannerOpen || pairingPermissionRequesting,
    pairingScanError = pairingScanError, onConversationSearchChange = onConversationSearchChange,
    onRefreshConversations = onRefreshConversations,
    onLoadMoreConversations = onLoadMoreConversations, onSelectConversation = onSelectConversation,
    onSelectTaskChildConversation = onSelectTaskChildConversation,
    onCreateConversation = onCreateConversation,
    onCreateProjectConversation = onCreateProjectConversation,
    onCreateReferenceConversation = onCreateReferenceConversation,
    onReferenceRequestHandled = onReferenceRequestHandled,
    onDiscardDraft = onDiscardDraft,
    onBeginRename = onBeginRename, onRenameDraftChange = onRenameDraftChange,
    onSaveRename = onSaveRename, onCancelRename = onCancelRename,
    onTogglePin = onTogglePin,
    onToggleArchive = onToggleArchive,
    onBatchConversations = onBatchConversations,
    onBeginConversationShare = onBeginConversationShare,
    onConfirmConversationShare = onConfirmConversationShare,
    onDismissConversationShare = onDismissConversationShare,
    onScheduleDelete = onScheduleDelete, onUndoDelete = onUndoDelete,
    onQuickDraftChange = onQuickDraftChange, onQuickSubmit = onQuickSubmit,
    onRemoveQuickAttachment = onRemoveQuickAttachment,
    onPreviewQuickImage = onPreviewQuickImage,
    onPickQuickAttachment = { kind ->
      val gatewayId = connection.profile?.gatewayId
      if (gatewayId != null) {
        if (kind == "camera") launchCamera(gatewayId, null, true)
        else {
          pickerGatewayId = gatewayId
          pickerConversationId = null
          pickerQuick = true
          if (kind == "photos") photoPicker.launch(PickVisualMediaRequest(
            ActivityResultContracts.PickVisualMedia.ImageOnly))
          else documentPicker.launch(arrayOf("*/*"))
        }
      }
    },
    onDraftChange = onDraftChange, onRemoveDraftRef = onRemoveDraftRef,
    onPickDraftAttachment = { kind ->
      val gatewayId = connection.profile?.gatewayId
      val conversationId = connection.selectedConversationId
      if (gatewayId != null && conversationId != null) {
        if (kind == "camera") launchCamera(gatewayId, conversationId, false)
        else {
          pickerGatewayId = gatewayId
          pickerConversationId = conversationId
          pickerQuick = false
          if (kind == "photos") photoPicker.launch(PickVisualMediaRequest(
            ActivityResultContracts.PickVisualMedia.ImageOnly))
          else documentPicker.launch(arrayOf("*/*"))
        }
      }
    },
    onRemoveDraftAttachment = onRemoveDraftAttachment,
    onPreviewDraftImage = onPreviewDraftImage,
    onLoadReferences = onLoadReferences, onAddDraftRef = onAddDraftRef,
    onSendMessage = onSendMessage,
    onRetryPendingInput = onRetryPendingInput, onStopRun = onStopRun,
    onReloadModels = onReloadModels, onSelectModel = onSelectModel,
    onReloadAgents = onReloadAgents, onSwitchAgent = onSwitchAgent,
    onReloadContext = onReloadContext, onLoadContextPanel = onLoadContextPanel,
    onSetContextDirectory = onSetContextDirectory, onAddContextFile = onAddContextFile,
    onCreateContextConversation = onCreateContextConversation,
    onRefreshConnectionWait = onRefreshConnectionWait,
    onRefreshProgress = onRefreshProgress, onLoadMoreProgressTasks = onLoadMoreProgressTasks,
    onRefreshProgressHome = onRefreshProgressHome, onRefreshProgressTasks = onRefreshProgressTasks,
    onProgressHomeAction = onProgressHomeAction,
    onLoadAutomations = onLoadAutomations, onOpenAutomation = onOpenAutomation,
    onOpenAutomationRun = onOpenAutomationRun,
    onAutomationAction = onAutomationAction,
    onCreateAutomation = onCreateAutomation,
    onUpdateAutomation = onUpdateAutomation,
    onDeleteAutomation = onDeleteAutomation,
    onAutomationRunAction = onAutomationRunAction,
    onOpenProgressTask = onOpenProgressTask, onProgressTaskSearchChange = onProgressTaskSearchChange,
    onProgressTaskCommand = onProgressTaskCommand,
    onStartProgressTask = onStartProgressTask,
    onCreateTaskWithChat = onCreateTaskWithChat,
    onLoadProgressProjects = onLoadProgressProjects,
    onOpenProgressProject = onOpenProgressProject,
    onCreateProgressTask = onCreateProgressTask,
    onOpenTaskChat = onOpenTaskChat,
    onSaveProgressTask = onSaveProgressTask,
    onSubmitProgressTaskSearch = onSubmitProgressTaskSearch,
    onOpenExecution = onOpenExecution, onRetryExecution = onRetryExecution,
    onCloseExecution = onCloseExecution,
    onSaveMessageAsNote = onSaveMessageAsNote, onReuseMessage = onReuseMessage,
    onRegenerateMessage = onRegenerateMessage,
    onLoadMessageMedia = onLoadMessageMedia,
    onSpeechChunk = onSpeechChunk,
    onTranscribeAudio = onTranscribeAudio,
    onCreateVoiceCall = onCreateVoiceCall, onCancelVoiceCall = onCancelVoiceCall,
    onVoiceClarification = onVoiceClarification,
    onPendingVoiceApproval = onPendingVoiceApproval,
    onRespondVoiceApproval = onRespondVoiceApproval,
    onAddVoiceAttachment = onAddVoiceAttachment,
    onSendVoiceRecording = onSendVoiceRecording,
    onCopyMessageText = { value ->
      (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
        .setPrimaryClip(ClipData.newPlainText(context.getString(R.string.assistant_copy), value))
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun MainContent(
  selectedTab: HomeTab,
  onSelectTab: (HomeTab) -> Unit,
  connection: ConnectionUiState = ConnectionUiState(),
  onPair: (String) -> Unit = {},
  onCancelPairing: () -> Unit = {},
  onScanPairing: () -> Unit = {},
  pairingScanning: Boolean = false,
  pairingScanError: Boolean = false,
  onConversationSearchChange: (String) -> Unit = {},
  onRefreshConversations: () -> Unit = {},
  onLoadMoreConversations: () -> Unit = {},
  onSelectConversation: (String) -> Unit = {},
  onSelectTaskChildConversation: (String, String) -> Unit = { _, _ -> },
  onCreateConversation: () -> Unit = {},
  onCreateProjectConversation: (String) -> Unit = {},
  onCreateReferenceConversation: (String) -> Unit = {},
  onReferenceRequestHandled: (String, String) -> Unit = { _, _ -> },
  onDiscardDraft: (String) -> Unit = {},
  onBeginRename: (String) -> Unit = {},
  onRenameDraftChange: (String) -> Unit = {},
  onSaveRename: () -> Unit = {},
  onCancelRename: () -> Unit = {},
  onTogglePin: (String) -> Unit = {},
  onToggleArchive: (String) -> Unit = {},
  onBatchConversations: (List<String>, String) -> Unit = { _, _ -> },
  onBeginConversationShare: (String) -> Unit = {},
  onConfirmConversationShare: () -> Unit = {},
  onDismissConversationShare: () -> Unit = {},
  onScheduleDelete: (String) -> Unit = {},
  onUndoDelete: () -> Unit = {},
  onQuickDraftChange: (String) -> Unit = {},
  onQuickSubmit: () -> Unit = {},
  onPickQuickAttachment: (String) -> Unit = {},
  onRemoveQuickAttachment: (String) -> Unit = {},
  onPreviewQuickImage: suspend (ChatAttachment) -> Bitmap? = { null },
  onDraftChange: (String) -> Unit = {},
  onPickDraftAttachment: (String) -> Unit = {},
  onRemoveDraftAttachment: (String) -> Unit = {},
  onPreviewDraftImage: suspend (String, ChatAttachment) -> Bitmap? = { _, _ -> null },
  onRemoveDraftRef: (String, String) -> Unit = { _, _ -> },
  onLoadReferences: (String, String) -> Unit = { _, _ -> },
  onAddDraftRef: (ReferencePickerItem) -> Boolean = { false },
  onSendMessage: () -> Unit = {},
  onRetryPendingInput: () -> Unit = {},
  onStopRun: () -> Unit = {},
  onReloadModels: () -> Unit = {},
  onSelectModel: (String) -> Unit = {},
  onReloadAgents: () -> Unit = {},
  onSwitchAgent: (String, Boolean) -> Unit = { _, _ -> },
  onReloadContext: () -> Unit = {},
  onLoadContextPanel: (String, String, String) -> Unit = { _, _, _ -> },
  onSetContextDirectory: () -> Unit = {},
  onAddContextFile: (ManagedFile) -> Unit = {},
  onCreateContextConversation: (String?, String?) -> Unit = { _, _ -> },
  onRefreshConnectionWait: () -> Unit = {},
  onRefreshProgress: () -> Unit = {},
  onRefreshProgressHome: () -> Unit = {},
  onProgressHomeAction: (ProgressHomeAction) -> Unit = {},
  onLoadAutomations: () -> Unit = {},
  onOpenAutomation: (String) -> Unit = {},
  onOpenAutomationRun: (String) -> Unit = {},
  onAutomationAction: (String, String) -> Unit = { _, _ -> },
  onCreateAutomation: (String, String, String, String) -> Unit = { _, _, _, _ -> },
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
  onCreateProgressTask: (String, String, String) -> Unit = { _, _, _ -> },
  onOpenTaskChat: (String) -> Unit = {},
  onSaveProgressTask: (String, Int, String, String, String) -> Unit = { _, _, _, _, _ -> },
  onProgressTaskSearchChange: (String) -> Unit = {},
  onSubmitProgressTaskSearch: () -> Unit = {},
  onOpenExecution: (String) -> Unit = {},
  onRetryExecution: () -> Unit = {},
  onCloseExecution: () -> Unit = {},
  onSaveMessageAsNote: (String) -> Unit = {},
  onReuseMessage: (String) -> Boolean = { false },
  onRegenerateMessage: (String) -> Boolean = { false },
  onLoadMessageMedia: suspend (String, ConversationMedia) -> ByteArray = { _, _ ->
    throw IllegalStateException("MEDIA_UNAVAILABLE")
  },
  onSpeechChunk: suspend (String, String) -> ByteArray = { _, _ ->
    throw IllegalStateException("SPEECH_UNAVAILABLE")
  },
  onTranscribeAudio: suspend (ByteArray, String) -> String = { _, _ ->
    throw IllegalStateException("TRANSCRIPTION_UNAVAILABLE")
  },
  onCreateVoiceCall: suspend (String, String) -> VoiceCallConnection = { _, _ ->
    throw IllegalStateException("VOICE_UNAVAILABLE")
  },
  onCancelVoiceCall: suspend (VoiceCallConnection) -> Unit = {},
  onVoiceClarification: suspend (String, Int, String, String) -> Unit = { _, _, _, _ -> },
  onPendingVoiceApproval: suspend (String) -> VoiceApproval? = { null },
  onRespondVoiceApproval: suspend (VoiceApproval, Boolean) -> Unit = { _, _ -> },
  onAddVoiceAttachment: suspend (ByteArray, Int) -> Unit = { _, _ ->
    throw IllegalStateException("VOICE_UNAVAILABLE")
  },
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
  val voiceContext = LocalContext.current
  val lifecycleOwner = LocalLifecycleOwner.current
  val voiceScope = rememberCoroutineScope()
  val currentVoiceCreate by rememberUpdatedState(onCreateVoiceCall)
  val currentVoiceCancel by rememberUpdatedState(onCancelVoiceCall)
  val currentVoiceClarification by rememberUpdatedState(onVoiceClarification)
  val currentPendingVoiceApproval by rememberUpdatedState(onPendingVoiceApproval)
  val currentRespondVoiceApproval by rememberUpdatedState(onRespondVoiceApproval)
  val voiceCall = remember(connection.profile?.gatewayId) {
    RealtimeVoiceController(voiceContext, voiceScope,
      { id, mode -> currentVoiceCreate(id, mode) }, { call -> currentVoiceCancel(call) },
      { id, version, action, answer -> currentVoiceClarification(id, version, action, answer) },
      { id -> currentPendingVoiceApproval(id) },
      { approval, allow -> currentRespondVoiceApproval(approval, allow) })
  }
  var voiceAnswer by remember(voiceCall) { mutableStateOf("") }
  DisposableEffect(voiceCall) { onDispose { voiceScope.launch { voiceCall.stop() } } }
  val voiceMemo = remember(connection.profile?.gatewayId, connection.selectedConversationId) {
    VoiceMemoRecorder(voiceContext)
  }
  DisposableEffect(voiceMemo) { onDispose { voiceMemo.cancel() } }
  val inputVoice = remember(connection.profile?.gatewayId, connection.selectedConversationId) {
    VoiceMemoRecorder(voiceContext)
  }
  var inputVoiceMode by remember(connection.profile?.gatewayId, connection.selectedConversationId) {
    mutableStateOf(false)
  }
  var inputVoiceHeld by remember(inputVoice) { mutableStateOf(false) }
  var inputVoiceBusy by remember(inputVoice) { mutableStateOf(false) }
  var inputVoiceError by remember(inputVoice) { mutableStateOf("") }
  var inputVoiceDestination by remember(inputVoice) { mutableStateOf("send") }
  var inputVoiceRetryDestination by remember(inputVoice) { mutableStateOf("send") }
  var inputVoiceElapsed by remember(inputVoice) { mutableIntStateOf(0) }
  DisposableEffect(inputVoice) { onDispose { inputVoice.cancel() } }
  LaunchedEffect(inputVoiceHeld) {
    while (inputVoiceHeld) {
      inputVoiceElapsed = inputVoice.elapsedSeconds
      delay(250)
    }
  }
  val inputVoicePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) inputVoiceMode = true
    else inputVoiceError = voiceContext.getString(R.string.voice_permission_denied)
  }
  val voiceFocusManager = LocalFocusManager.current
  DisposableEffect(lifecycleOwner, voiceCall, voiceMemo, inputVoice) {
    val observer = LifecycleEventObserver { _, event ->
      if (event == Lifecycle.Event.ON_STOP) {
        if (voiceMemo.phase == "recording" || voiceMemo.phase == "paused")
          voiceMemo.stopRecording()
        if (voiceCall.phase != "idle") voiceScope.launch { voiceCall.stop() }
        if (inputVoice.phase != "idle") {
          inputVoice.cancel(); inputVoiceHeld = false
        }
      }
    }
    lifecycleOwner.lifecycle.addObserver(observer)
    onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
  }
  var voiceMemoSending by remember(voiceMemo) { mutableStateOf(false) }
  var voiceMemoError by remember(voiceMemo) { mutableStateOf(false) }
  var voiceElapsed by remember(voiceMemo) { mutableIntStateOf(0) }
  LaunchedEffect(voiceMemo.phase) {
    while (voiceMemo.phase == "recording") {
      voiceElapsed = voiceMemo.elapsedSeconds
      delay(500)
    }
  }
  var pendingVoiceMode by remember(connection.profile?.gatewayId) { mutableStateOf<String?>(null) }
  var activeVoiceConversationId by remember(connection.profile?.gatewayId) { mutableStateOf<String?>(null) }
  var voicePermissionDenied by remember(connection.profile?.gatewayId) { mutableStateOf(false) }
  val voicePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) {
      pendingVoiceMode = pendingVoiceMode ?: "natural"
      if (connection.selectedConversationId == null) onCreateConversation()
    }
    else { pendingVoiceMode = null; voicePermissionDenied = true }
  }
  fun requestVoice(mode: String) {
    pendingVoiceMode = mode
    voicePermissionDenied = false
    if (ContextCompat.checkSelfPermission(voiceContext, Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED) voicePermission.launch(Manifest.permission.RECORD_AUDIO)
    else if (connection.selectedConversationId == null) onCreateConversation()
  }
  LaunchedEffect(pendingVoiceMode, connection.selectedConversationId) {
    val mode = pendingVoiceMode ?: return@LaunchedEffect
    val id = connection.selectedConversationId ?: return@LaunchedEffect
    if (ContextCompat.checkSelfPermission(voiceContext, Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED) return@LaunchedEffect
    pendingVoiceMode = null
    if (mode == "record") { voiceElapsed = 0; voiceMemo.start() } else {
      activeVoiceConversationId = id
      voiceCall.start(id, mode)
    }
  }
  var personalPage by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf("home") }
  var progressAtRoot by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf(true) }
  var notesAtRoot by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf(true) }
  var personalReturnPage by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf("home") }
  var personalStartSection by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf("overview") }
  var personalDetailId by rememberSaveable(connection.profile?.gatewayId) { mutableStateOf("") }
  var previousGatewayId by remember { mutableStateOf(connection.profile?.gatewayId) }
  LaunchedEffect(connection.profile?.gatewayId) {
    val currentId = connection.profile?.gatewayId
    if (previousGatewayId != null && currentId != null && previousGatewayId != currentId) {
      personalPage = "home"
      onSelectTab(HomeTab.Assistant)
    }
    previousGatewayId = currentId
  }
  fun leavePersonalPage() {
    if (personalPage == "detail") {
      personalPage = personalReturnPage
      onClosePersonalAssertion()
    } else if (personalPage == "settings-appearance" || personalPage == "settings-language" ||
      personalPage == "settings-gateways" || personalPage == "settings-sharing") {
      if (personalPage == "settings-sharing") onCloseShares()
      personalPage = "settings"
    } else if (personalPage == "settings-add") {
      personalPage = "settings-gateways"
    } else personalPage = "home"
  }
  LaunchedEffect(connection.personal.assertionDeletedRevision) {
    if (personalPage == "detail" && connection.personal.assertionDeletedRevision > 0 &&
      connection.personal.selectedAssertionId == null) personalPage = personalReturnPage
  }
  LaunchedEffect(connection.profile?.gatewayId) {
    if (connection.profile != null) {
      while (true) {
        onRefreshProgressHome()
        delay(30_000)
      }
    }
  }
  LaunchedEffect(connection.requestedReferenceConversationId,
    connection.requestedReferenceKind, connection.selectedConversationId) {
    if (connection.requestedReferenceKind != null &&
      connection.requestedReferenceConversationId == connection.selectedConversationId &&
      connection.selectedConversationId != null) onSelectTab(HomeTab.Assistant)
  }
  LaunchedEffect(selectedTab, connection.profile?.gatewayId) {
    if (selectedTab == HomeTab.Progress && connection.profile != null) onRefreshProgressTasks()
  }
  LaunchedEffect(selectedTab, connection.profile?.gatewayId) {
    if (selectedTab == HomeTab.Notes && connection.profile != null) {
      onLoadNotes(connection.notes.search, connection.notes.status)
    }
  }
  LaunchedEffect(selectedTab, connection.profile?.gatewayId) {
    if (selectedTab == HomeTab.Me && connection.profile != null) onLoadPersonal()
  }
  val latestConnectionWaitRefresh by rememberUpdatedState(onRefreshConnectionWait)
  LaunchedEffect(selectedTab, connection.profile?.gatewayId, connection.selectedConversationId) {
    if (selectedTab == HomeTab.Assistant && connection.profile != null &&
      connection.selectedConversationId != null) {
      while (true) {
        latestConnectionWaitRefresh()
        delay(5_000)
      }
    }
  }
  LaunchedEffect(personalPage, connection.profile?.gatewayId) {
    if (personalPage == "settings-gateways") onOpenGatewayProfiles()
    if (personalPage == "settings-sharing" && connection.profile != null) onLoadShares()
  }
  var assistantActionsOpen by remember(selectedTab, connection.selectedConversationId) { mutableStateOf(false) }
  var quickActionsOpen by remember(selectedTab, connection.profile?.gatewayId) { mutableStateOf(false) }
  var assistantComposerValue by remember(connection.selectedConversationId) {
    mutableStateOf(TextFieldValue(connection.draftText, selection = TextRange(connection.draftText.length)))
  }
  val assistantComposerFocus = remember(connection.selectedConversationId) { FocusRequester() }
  var assistantFocusRevision by remember(connection.selectedConversationId) { mutableIntStateOf(0) }
  var assistantReferenceKind by remember(connection.profile?.gatewayId, connection.selectedConversationId) {
    mutableStateOf<String?>(null)
  }
  var assistantReferenceQuery by remember(connection.profile?.gatewayId, connection.selectedConversationId) {
    mutableStateOf("")
  }
  val keyboardController = LocalSoftwareKeyboardController.current
  val currentComposerConnection by rememberUpdatedState(connection)
  LaunchedEffect(inputVoiceMode) {
    if (inputVoiceMode) {
      assistantActionsOpen = false
      voiceFocusManager.clearFocus(force = true)
      keyboardController?.hide()
    }
  }
  fun toggleInputVoice() {
    if (inputVoiceBusy || inputVoiceHeld || inputVoice.phase != "idle") return
    inputVoiceError = ""
    if (inputVoiceMode) {
      inputVoiceMode = false
      assistantComposerFocus.requestFocus()
      keyboardController?.show()
    } else if (ContextCompat.checkSelfPermission(voiceContext, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED) {
      assistantActionsOpen = false
      voiceFocusManager.clearFocus(force = true)
      keyboardController?.hide()
      inputVoiceMode = true
    } else inputVoicePermission.launch(Manifest.permission.RECORD_AUDIO)
  }
  fun deliverInputVoice(destination: String) {
    if (inputVoiceBusy || inputVoice.phase != "ready") return
    val targetGatewayId = connection.profile?.gatewayId
    val targetConversationId = connection.selectedConversationId
    inputVoiceRetryDestination = destination
    inputVoiceBusy = true
    voiceScope.launch {
      try {
        val (bytes, seconds) = withContext(Dispatchers.IO) { inputVoice.consume() }
        if (destination == "text") {
          val lang = when { language.startsWith("zh") -> "zh"; language.startsWith("en") -> "en"; else -> "" }
          val transcript = onTranscribeAudio(bytes, lang)
          if (inputVoice.phase != "ready" || currentComposerConnection.profile?.gatewayId != targetGatewayId ||
            currentComposerConnection.selectedConversationId != targetConversationId) return@launch
          val next = if (assistantComposerValue.text.isBlank()) transcript
            else assistantComposerValue.text + "\n" + transcript
          assistantComposerValue = TextFieldValue(next, selection = TextRange(next.length))
          onDraftChange(next)
          inputVoiceMode = false
          assistantComposerFocus.requestFocus()
          keyboardController?.show()
        } else {
          if (inputVoice.phase != "ready" || currentComposerConnection.profile?.gatewayId != targetGatewayId ||
            currentComposerConnection.selectedConversationId != targetConversationId) return@launch
          onSendVoiceRecording(bytes, seconds)
        }
        inputVoice.cancel()
        inputVoiceError = ""
      } catch (failure: Exception) {
        inputVoiceError = failure.message ?: voiceContext.getString(R.string.voice_record_error)
      } finally { inputVoiceBusy = false }
    }
  }
  fun finishInputVoice(destination: String) {
    if (!inputVoiceHeld) return
    inputVoiceHeld = false
    inputVoiceDestination = "send"
    if (destination == "cancel" || inputVoice.elapsedMilliseconds < 380) {
      inputVoice.cancel()
      return
    }
    inputVoice.stopRecording()
    if (inputVoice.phase != "ready") {
      inputVoiceError = inputVoice.error.ifBlank { voiceContext.getString(R.string.voice_record_error) }
      inputVoice.cancel()
      return
    }
    deliverInputVoice(destination)
  }
  LaunchedEffect(inputVoiceElapsed, inputVoiceHeld) {
    if (inputVoiceHeld && inputVoiceElapsed >= 120) finishInputVoice(inputVoiceDestination)
  }
  val focusManager = LocalFocusManager.current
  val showBottomChrome = connection.profile != null && when (selectedTab) {
    HomeTab.Progress -> progressAtRoot
    HomeTab.Notes -> notesAtRoot
    HomeTab.Me -> personalPage == "home"
    else -> true
  }
  LaunchedEffect(showBottomChrome) {
    if (!showBottomChrome) {
      assistantActionsOpen = false
      quickActionsOpen = false
      focusManager.clearFocus(force = true)
      keyboardController?.hide()
    }
  }
  LaunchedEffect(connection.selectedConversationId, connection.draftText) {
    if (assistantComposerValue.text != connection.draftText) assistantComposerValue =
      TextFieldValue(connection.draftText, selection = TextRange(connection.draftText.length))
  }
  LaunchedEffect(connection.selectedConversationId, assistantFocusRevision) {
    if (assistantFocusRevision > 0 && selectedTab == HomeTab.Assistant) {
      assistantComposerFocus.requestFocus()
      keyboardController?.show()
    }
  }
  LaunchedEffect(connection.requestedReferenceConversationId, connection.requestedReferenceKind,
    connection.selectedConversationId, connection.historyLoading) {
    val id = connection.requestedReferenceConversationId ?: return@LaunchedEffect
    val kind = connection.requestedReferenceKind ?: return@LaunchedEffect
    if (id == connection.selectedConversationId && !connection.historyLoading) {
      assistantReferenceQuery = ""
      assistantReferenceKind = kind
      onReferenceRequestHandled(id, kind)
    }
  }
  LaunchedEffect(assistantReferenceKind, assistantReferenceQuery, connection.profile?.gatewayId,
    connection.selectedConversationId) {
    val kind = assistantReferenceKind ?: return@LaunchedEffect
    if (assistantReferenceQuery.isNotEmpty()) delay(250)
    onLoadReferences(kind, assistantReferenceQuery)
  }
  val imeVisible = WindowInsets.isImeVisible
  val layoutDirection = LocalLayoutDirection.current
  var bottomChromeHeightPx by remember { mutableIntStateOf(0) }
  val bottomChromeHeight = with(LocalDensity.current) { bottomChromeHeightPx.toDp() }
  val tabStateHolder = rememberSaveableStateHolder()
  BackHandler(enabled = assistantActionsOpen) { assistantActionsOpen = false }
  BackHandler(enabled = quickActionsOpen) { quickActionsOpen = false }
  BackHandler(enabled = selectedTab == HomeTab.Me && personalPage != "home") { leavePersonalPage() }
  Scaffold(
    modifier = modifier.imePadding(),
    containerColor = MaterialTheme.colorScheme.background,
    bottomBar = {
      if (showBottomChrome) Column(modifier = Modifier.fillMaxWidth()
        .onSizeChanged { bottomChromeHeightPx = it.height }
        .padding(top = 8.dp)) {
        val attentionCount = connection.progress.needsUser.size.takeIf {
          connection.progress.gatewayId == connection.profile.gatewayId
        } ?: 0
        val showQuick = selectedTab != HomeTab.Assistant
        if (selectedTab == HomeTab.Assistant) {
          MainBottomSurface("assistant-bottom-surface") {
            AssistantComposer(connection, assistantComposerValue, { value ->
              assistantComposerValue = value
              onDraftChange(value.text)
            }, assistantComposerFocus, assistantActionsOpen, { assistantActionsOpen = it },
              onRemoveDraftRef, onRemoveDraftAttachment, onPreviewDraftImage, onSendMessage, onStopRun,
              inputVoiceMode, inputVoiceHeld, inputVoiceBusy, inputVoice.phase, inputVoiceError,
              inputVoiceDestination, inputVoiceElapsed,
              ::toggleInputVoice, onVoiceStart = {
                if (inputVoiceBusy || inputVoice.phase != "idle" || connection.sending) false
                else {
                  inputVoiceError = ""; inputVoiceDestination = "send"; inputVoiceElapsed = 0
                  inputVoice.start()
                  inputVoiceHeld = inputVoice.phase == "recording"
                  if (!inputVoiceHeld) {
                    inputVoiceError = inputVoice.error
                    inputVoice.cancel()
                  }
                  inputVoiceHeld
                }
              }, onVoiceMove = { dx, dy ->
                inputVoiceDestination = voiceRecordingDestination(dx, dy, inputVoiceDestination)
              }, onVoiceFinish = ::finishInputVoice, onVoiceCancel = {
                inputVoice.cancel(); inputVoiceError = ""; inputVoiceHeld = false
              }, onVoiceRetry = { deliverInputVoice(inputVoiceRetryDestination) })
            AnimatedVisibility(visible = assistantActionsOpen,
              enter = expandVertically(animationSpec = tween(220), expandFrom = Alignment.Bottom) +
                fadeIn(animationSpec = tween(220)),
              exit = shrinkVertically(animationSpec = tween(180), shrinkTowards = Alignment.Bottom) +
                fadeOut(animationSpec = tween(180)), label = "assistant-actions") {
              AssistantActionPanel(
                canCreate = !connection.creatingConversation && !connection.sending,
                canReference = !connection.sending && connection.pendingInput == null,
                canPick = !connection.sending && !connection.attachmentLoading &&
                  connection.pendingInput == null && connection.draftAttachments.size < 10,
                onPick = { kind ->
                  assistantActionsOpen = false
                  onPickDraftAttachment(kind)
                }, onVoiceAction = { mode ->
                  assistantActionsOpen = false
                  requestVoice(mode)
                }, onOpenReference = { kind ->
                  assistantActionsOpen = false
                  assistantReferenceQuery = ""
                  assistantReferenceKind = kind
                }, onCreateConversation = {
                  assistantActionsOpen = false
                  onCreateConversation()
                })
            }
            if (!assistantActionsOpen && !imeVisible) XopcTabDock(selectedTab, onSelectTab,
              grouped = true, attentionCount = attentionCount)
          }
        } else if (showQuick) {
          MainBottomSurface("secondary-bottom-surface") {
            QuickComposer(connection, selectedTab, onQuickDraftChange, onQuickSubmit,
              quickActionsOpen, { quickActionsOpen = it }, onRemoveQuickAttachment,
              onPreviewQuickImage, onOpenChat = {
                quickActionsOpen = false
                onCreateConversation()
                onSelectTab(HomeTab.Assistant)
              })
            AnimatedVisibility(visible = quickActionsOpen,
              enter = expandVertically(animationSpec = tween(220), expandFrom = Alignment.Bottom) +
                fadeIn(animationSpec = tween(220)),
              exit = shrinkVertically(animationSpec = tween(180), shrinkTowards = Alignment.Bottom) +
                fadeOut(animationSpec = tween(180)), label = "quick-actions") {
              AssistantActionPanel(canCreate = !connection.creatingConversation && !connection.quickSending,
                canReference = !connection.creatingConversation && !connection.quickSending,
                canPick = !connection.quickSending && !connection.quickAttachmentLoading &&
                  connection.quickAttachments.size < 10,
                onPick = { kind ->
                  quickActionsOpen = false
                  onPickQuickAttachment(kind)
                }, onVoiceAction = { mode ->
                  quickActionsOpen = false
                  onSelectTab(HomeTab.Assistant)
                  requestVoice(mode)
                },
                onOpenReference = { kind ->
                  quickActionsOpen = false
                  onCreateReferenceConversation(kind)
                },
                onCreateConversation = {
                  quickActionsOpen = false
                  onCreateConversation()
                  onSelectTab(HomeTab.Assistant)
                }, tagPrefix = "quick")
            }
            if (!quickActionsOpen && !imeVisible) XopcTabDock(selectedTab, onSelectTab,
              grouped = true, attentionCount = attentionCount)
          }
        } else if (!imeVisible) {
          MainBottomSurface("secondary-bottom-surface") {
            XopcTabDock(selectedTab, onSelectTab, grouped = true,
              attentionCount = attentionCount)
          }
        }
        Spacer(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background)
          .navigationBarsPadding().height(4.dp).testTag("bottom-content-mask"))
      }
    },
  ) { insets ->
    val rootInsets = if (showBottomChrome) PaddingValues(
      start = insets.calculateLeftPadding(layoutDirection),
      top = insets.calculateTopPadding(),
      end = insets.calculateRightPadding(layoutDirection)) else insets
    if (connection.profile == null && personalPage == "home") {
      PairingScreen(stringResource(R.string.pairing_title), connection, onPair, onCancelPairing,
        onScanPairing, pairingScanning, pairingScanError, insets,
        onSettings = {
          personalPage = "settings"
          onSelectTab(HomeTab.Me)
        })
    } else {
    tabStateHolder.SaveableStateProvider(selectedTab.name) {
    when (selectedTab) {
      HomeTab.Assistant, HomeTab.Conversations -> {
        val title = stringResource(selectedTab.label)
        if (connection.profile == null) PairingScreen(title, connection, onPair, onCancelPairing,
          onScanPairing,
          pairingScanning, pairingScanError, insets)
        else if (selectedTab == HomeTab.Assistant) AssistantScreen(connection,
          rootInsets, bottomChromeHeight, onSelectConversation,
          onCreateConversation, onLoadReferences, onAddDraftRef,
          onNoteFileContent,
          onRetryPendingInput,
          onReloadModels, onSelectModel, onReloadAgents, onSwitchAgent, onReloadContext,
          onLoadContextPanel, onSetContextDirectory, onAddContextFile, onCreateContextConversation,
          onRefreshConnectionWait,
          onOpenExecution, onRetryExecution, onCloseExecution,
          onCopyMessageText, onSaveMessageAsNote, onReuseMessage, onRegenerateMessage,
          onLoadMessageMedia, onSpeechChunk, onOpenMessageTarget = { target ->
            when (target.kind) {
              "note" -> { onOpenNote(target.id); onSelectTab(HomeTab.Notes) }
              "task" -> { onOpenProgressTask(target.id); onSelectTab(HomeTab.Progress) }
              "project" -> { onOpenProgressProject(target.id); onSelectTab(HomeTab.Progress) }
              "automation" -> { onOpenAutomation(target.id); onSelectTab(HomeTab.Progress) }
              "session" -> { onSelectConversation(target.id); onSelectTab(HomeTab.Assistant) }
              "user_assertion" -> {
                personalReturnPage = "home"; personalDetailId = target.id; personalPage = "detail"
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
          { assistantActionsOpen = it })
        else ConversationsScreen(connection, rootInsets, bottomChromeHeight,
          onConversationSearchChange,
          onRefreshConversations, onLoadMoreConversations, {
          onCreateConversation()
          onSelectTab(HomeTab.Assistant)
        }, { id ->
          onSelectConversation(id)
          onSelectTab(HomeTab.Assistant)
        }, { taskId, id ->
          onSelectTaskChildConversation(taskId, id)
          onSelectTab(HomeTab.Assistant)
        }, onDiscardDraft, onBeginRename, onRenameDraftChange, onSaveRename, onCancelRename,
          onTogglePin, onToggleArchive, onBatchConversations,
          onBeginConversationShare, onConfirmConversationShare,
          onDismissConversationShare, onScheduleDelete, onUndoDelete)
      }
      HomeTab.Progress -> if (connection.profile == null) PairingScreen(
        stringResource(R.string.tab_progress), connection, onPair, onCancelPairing, onScanPairing,
        pairingScanning, pairingScanError, insets)
      else ProgressScreen(connection.progress.takeIf { it.gatewayId == connection.profile.gatewayId }
        ?: ProgressUiState(gatewayId = connection.profile.gatewayId, loading = true),
        rootInsets, onRefreshProgressHome, onRefreshProgressTasks, onLoadMoreProgressTasks,
        onOpenProgressTask, onProgressTaskSearchChange, onSubmitProgressTaskSearch,
        onProgressTaskCommand, onStartProgressTask, onCreateTaskWithChat,
        onLoadProgressProjects, onOpenProgressProject, onCreateProgressTask,
        onOpenTaskChat, onSaveProgressTask, onHomeAction = onProgressHomeAction,
        onLoadAutomations = onLoadAutomations, onOpenAutomation = onOpenAutomation,
        onOpenAutomationRun = onOpenAutomationRun, onAutomationAction = onAutomationAction,
        onCreateAutomation = onCreateAutomation,
        onUpdateAutomation = onUpdateAutomation,
        onDeleteAutomation = onDeleteAutomation,
        onAutomationRunAction = onAutomationRunAction,
        onTopLevelChange = { progressAtRoot = it },
        onOpenChat = { id ->
        onSelectConversation(id)
        onSelectTab(HomeTab.Assistant)
      }, onCreateProjectChat = { projectId ->
        if (!connection.creatingConversation && connection.progress.project?.id == projectId) {
          onCreateProjectConversation(projectId)
          onSelectTab(HomeTab.Assistant)
        }
      }, chatBusy = connection.creatingConversation, bottomChromeHeight = bottomChromeHeight)
      HomeTab.Notes -> if (connection.profile == null) PairingScreen(
        stringResource(R.string.tab_notes), connection, onPair, onCancelPairing, onScanPairing,
        pairingScanning, pairingScanError, insets)
      else NotesScreen(connection.notes.takeIf { it.gatewayId == connection.profile.gatewayId }
        ?: NotesUiState(gatewayId = connection.profile.gatewayId), rootInsets,
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
        onTopLevelChange = { notesAtRoot = it }, bottomChromeHeight = bottomChromeHeight)
      HomeTab.Me -> {
        val profile = connection.profile
        val personal = if (profile == null) PersonalUiState(gatewayId = "")
          else connection.personal.takeIf { it.gatewayId == profile.gatewayId }
            ?: PersonalUiState(gatewayId = profile.gatewayId, loading = true)
        if (personalPage == "home" && profile == null) UnpairedPersonalScreen(insets,
          onOpenSettings = { personalPage = "settings" },
          onConnect = { personalPage = "pairing" })
        else if (personalPage == "home") PersonalScreen(personal, rootInsets,
          connection.realtimeStatus == "connected", onLoadPersonal, onSavePersonalGoal,
          onOpenSettings = { personalPage = "settings" },
          onOpenAbout = { personalStartSection = "overview"; personalPage = "about" },
          onOpenUnderstanding = { personalStartSection = "understanding"; personalPage = "about" },
          onOpenAssertion = { id ->
            personalReturnPage = "home"
            personalDetailId = id
            personalPage = "detail"
            onOpenPersonalAssertion(id)
          }, bottomChromeHeight = bottomChromeHeight)
        else if (personalPage == "settings-gateways") GatewayProfilesScreen(connection, insets,
          onBack = ::leavePersonalPage, onAdd = { personalPage = "settings-add" },
          onRefresh = onOpenGatewayProfiles, onProbe = onProbeGateway,
          onActivate = onActivateGateway, onRename = onRenameGateway,
          onRemove = onRemoveGateway)
        else if (personalPage == "settings-add" || personalPage == "pairing") PairingScreen(
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
            else -> "root"
          }, insets = insets,
          onBack = ::leavePersonalPage,
          onOpenGateways = { personalPage = "settings-gateways" },
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
          onOpenNotes = { personalPage = "home"; onSelectTab(HomeTab.Notes) },
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
  if (voiceCall.phase != "idle") AlertDialog(onDismissRequest = { voiceScope.launch { voiceCall.stop() } },
    modifier = Modifier.testTag("voice-call-dialog"),
    title = { Text(stringResource(if (voiceCall.mode == "natural")
      R.string.assistant_action_voice_natural else R.string.assistant_action_voice_assistant)) },
    text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(when (voiceCall.phase) {
        "connecting" -> stringResource(R.string.voice_connecting)
        "connected" -> stringResource(R.string.voice_listening)
        else -> stringResource(R.string.voice_paused)
      }, style = MaterialTheme.typography.titleMedium)
      if (voiceCall.userText.isNotBlank()) Text(voiceCall.userText,
        modifier = Modifier.testTag("voice-user-transcript"))
      if (voiceCall.assistantText.isNotBlank()) MarkdownContent(voiceCall.assistantText,
        modifier = Modifier.testTag("voice-assistant-transcript"))
      voiceCall.clarification?.let { pending ->
        Text(pending.question, style = MaterialTheme.typography.titleSmall)
        pending.choices.forEach { choice ->
          TextButton(onClick = { voiceScope.launch {
            voiceCall.answerClarification("answer", choice)
          } }, enabled = !voiceCall.clarificationBusy) { Text(choice) }
        }
        OutlinedTextField(voiceAnswer, { voiceAnswer = it },
          modifier = Modifier.fillMaxWidth().testTag("voice-answer"),
          placeholder = { Text(pending.suggestedAnswer.ifBlank {
            stringResource(R.string.voice_answer_hint)
          }) })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          TextButton(onClick = { voiceScope.launch {
            voiceCall.answerClarification("agent_decide")
          } }, enabled = !voiceCall.clarificationBusy) {
            Text(stringResource(R.string.voice_agent_decide))
          }
          Button(onClick = { voiceScope.launch {
            voiceCall.answerClarification("answer", voiceAnswer)
            voiceAnswer = ""
          } }, enabled = !voiceCall.clarificationBusy && voiceAnswer.isNotBlank(),
            modifier = Modifier.testTag("voice-answer-submit")) {
            Text(stringResource(R.string.voice_answer_send))
          }
        }
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
      if (voiceCall.error.isNotBlank()) Text(voiceCall.error,
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
        TextButton(onClick = { voiceCall.changeMuted(!voiceCall.muted) },
          enabled = voiceCall.phase == "connected", modifier = Modifier.testTag("voice-mute")) {
          Text(stringResource(if (voiceCall.muted) R.string.voice_unmute else R.string.voice_mute))
        }
        TextButton(onClick = { voiceCall.changeSpeaker(!voiceCall.speaker) },
          enabled = voiceCall.phase == "connected", modifier = Modifier.testTag("voice-speaker")) {
          Text(stringResource(if (voiceCall.speaker) R.string.voice_earpiece else R.string.voice_speaker))
        }
        TextButton(onClick = voiceCall::stopReply,
          enabled = voiceCall.phase == "connected", modifier = Modifier.testTag("voice-stop-reply")) {
          Text(stringResource(R.string.voice_stop_reply))
        }
      }
    } },
    confirmButton = { TextButton(onClick = { voiceScope.launch { voiceCall.stop() } },
      modifier = Modifier.testTag("voice-end")) { Text(stringResource(R.string.voice_end)) } })
  if (voiceMemo.phase != "idle") AlertDialog(onDismissRequest = voiceMemo::cancel,
    modifier = Modifier.testTag("voice-record-dialog"),
    title = { Text(stringResource(R.string.assistant_action_voice)) },
    text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text(when (voiceMemo.phase) {
        "recording" -> stringResource(R.string.voice_recording_seconds, voiceElapsed)
        "paused" -> stringResource(R.string.voice_recording_paused_seconds, voiceMemo.elapsedSeconds)
        "playing" -> stringResource(R.string.voice_playing)
        "ready" -> stringResource(R.string.voice_recorded_seconds, voiceMemo.durationSeconds)
        else -> stringResource(R.string.voice_record_error)
      })
      if (voiceMemo.error.isNotBlank() || voiceMemoError) Text(
        voiceMemo.error.ifBlank { stringResource(R.string.voice_record_error) },
        color = MaterialTheme.colorScheme.error)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (voiceMemo.phase == "recording" || voiceMemo.phase == "paused") {
          OutlinedButton(onClick = if (voiceMemo.phase == "recording")
            voiceMemo::pauseRecording else voiceMemo::resumeRecording,
            modifier = Modifier.testTag("voice-record-pause-resume")) {
            Text(stringResource(if (voiceMemo.phase == "recording") R.string.voice_record_pause
              else R.string.voice_record_resume))
          }
          Button(onClick = voiceMemo::stopRecording,
            modifier = Modifier.testTag("voice-record-stop")) {
            Text(stringResource(R.string.voice_record_stop))
          }
        }
        if (voiceMemo.phase == "ready") {
          OutlinedButton(onClick = voiceMemo::play,
            modifier = Modifier.testTag("voice-record-preview")) { Text(stringResource(R.string.voice_preview)) }
          Button(onClick = { voiceScope.launch {
            voiceMemoSending = true; voiceMemoError = false
            try {
              val (bytes, seconds) = withContext(Dispatchers.IO) { voiceMemo.consume() }
              onAddVoiceAttachment(bytes, seconds)
              voiceMemo.cancel()
            } catch (_: Exception) { voiceMemoError = true }
            voiceMemoSending = false
          } }, enabled = !voiceMemoSending, modifier = Modifier.testTag("voice-record-add")) {
            Text(stringResource(R.string.voice_add_attachment))
          }
        }
        if (voiceMemo.phase == "playing") OutlinedButton(onClick = voiceMemo::stopPlayback) {
          Text(stringResource(R.string.voice_record_stop))
        }
      }
    } }, confirmButton = { TextButton(onClick = voiceMemo::cancel,
      modifier = Modifier.testTag("voice-record-cancel")) {
      Text(stringResource(R.string.progress_cancel))
    } })
}

@Composable
private fun MainBottomSurface(tag: String, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
  Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)
    .shadow(8.dp, RoundedCornerShape(24.dp))
    .clip(RoundedCornerShape(24.dp))
    .background(MaterialTheme.colorScheme.surface)
    .testTag(tag), content = content)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DraftAttachmentStrip(items: List<ChatAttachment>, scopeKey: String?, tagPrefix: String,
  canRemove: Boolean, onRemove: (String) -> Unit,
  onPreviewImage: suspend (ChatAttachment) -> Bitmap?) {
  var previewId by remember(scopeKey) { mutableStateOf<String?>(null) }
  val previewItem = items.firstOrNull { it.id == previewId && it.type == "image" }
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
          Box(modifier = Modifier.size(96.dp).clip(RoundedCornerShape(12.dp))
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
          Row(modifier = Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh,
            RoundedCornerShape(12.dp)).padding(start = 12.dp)
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
}

@Composable
private fun QuickComposer(connection: ConnectionUiState, tab: HomeTab,
  onChange: (String) -> Unit, onSubmit: () -> Unit,
  actionsOpen: Boolean, onActionsOpenChange: (Boolean) -> Unit,
  onRemoveAttachment: (String) -> Unit,
  onPreviewImage: suspend (ChatAttachment) -> Bitmap?, onOpenChat: () -> Unit) {
  val context = LocalContext.current
  val focusManager = LocalFocusManager.current
  val keyboardController = LocalSoftwareKeyboardController.current
  val hasPayload = connection.quickDraftText.isNotBlank() || connection.quickAttachments.isNotEmpty()
  val canSend = hasPayload && !connection.quickSending && !connection.quickAttachmentLoading &&
    !connection.creatingConversation && !connection.sending && connection.realtimeStatus == "connected"
  val placeholder = when (tab) {
    HomeTab.Progress -> R.string.quick_progress_hint
    HomeTab.Notes -> R.string.quick_notes_hint
    HomeTab.Me -> R.string.quick_me_hint
    else -> R.string.quick_composer_hint
  }
  val assistantLabel = stringResource(R.string.tab_assistant)
  val sendLabel = stringResource(R.string.quick_send)
  Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
    if (connection.quickError) Text(stringResource(R.string.quick_send_error), color = MaterialTheme.colorScheme.error)
    if (connection.quickAttachmentError) Text(stringResource(R.string.assistant_attachment_error),
      color = MaterialTheme.colorScheme.error)
    DraftAttachmentStrip(connection.quickAttachments, connection.profile?.gatewayId,
      "quick", !connection.quickSending && !connection.quickAttachmentLoading,
      onRemoveAttachment, onPreviewImage)
    Row(modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
      .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(18.dp))
      .padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
      IconButton(onClick = onOpenChat, enabled = !connection.quickSending,
        modifier = Modifier.size(48.dp).semantics { contentDescription = assistantLabel }
          .testTag("quick-voice")) {
        Icon(painterResource(R.drawable.action_microphone), contentDescription = null,
          tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
      }
      BasicTextField(value = connection.quickDraftText, onValueChange = onChange,
        modifier = Modifier.weight(1f).heightIn(min = 48.dp)
          .onFocusChanged { if (it.isFocused) onActionsOpenChange(false) }
          .padding(horizontal = 4.dp, vertical = 12.dp).testTag("quick-composer"),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        singleLine = true, enabled = !connection.quickSending,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
        keyboardActions = KeyboardActions(onSend = { if (canSend) onSubmit() }),
        decorationBox = { innerTextField ->
          Box {
            if (connection.quickDraftText.isEmpty()) Text(stringResource(placeholder),
              style = MaterialTheme.typography.bodyLarge,
              color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
              overflow = TextOverflow.Ellipsis)
            innerTextField()
          }
        })
      IconButton(onClick = {
        if (!actionsOpen) {
          focusManager.clearFocus(force = true)
          keyboardController?.hide()
        }
        onActionsOpenChange(!actionsOpen)
      }, enabled = !connection.quickSending,
        modifier = Modifier.size(48.dp).semantics {
          contentDescription = if (actionsOpen) {
            context.getString(R.string.composer_close_actions)
          } else {
            context.getString(R.string.composer_add_actions)
          }
        }.testTag("quick-actions-toggle")) {
        Text(if (actionsOpen) "×" else "+", style = MaterialTheme.typography.headlineMedium,
          color = MaterialTheme.colorScheme.primary)
      }
      if (hasPayload) {
        IconButton(onClick = onSubmit, enabled = canSend,
          modifier = Modifier.size(48.dp).background(
            if (connection.quickSending) MaterialTheme.colorScheme.surfaceContainerHigh
            else MaterialTheme.colorScheme.onSurface, CircleShape)
            .semantics { contentDescription = sendLabel }.testTag("quick-send")) {
          if (connection.quickSending) BrandLoadingIndicator(extent = 24.dp)
          else Text("↑", style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.surface)
        }
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
  onSendMessage: () -> Unit, onStopRun: () -> Unit,
  voiceMode: Boolean, voiceHeld: Boolean, voiceBusy: Boolean, voicePhase: String,
  voiceError: String, voiceDestination: String, voiceSeconds: Int,
  onVoiceToggle: () -> Unit, onVoiceStart: () -> Boolean,
  onVoiceMove: (Float, Float) -> Unit, onVoiceFinish: (String) -> Unit,
  onVoiceCancel: () -> Unit, onVoiceRetry: () -> Unit) {
  val focusManager = LocalFocusManager.current
  val keyboardController = LocalSoftwareKeyboardController.current
  val expandedComposer = composerValue.text.isNotEmpty() || connection.draftRefs.isNotEmpty() ||
    connection.draftAttachments.isNotEmpty()
  val showVoicePad = voiceMode || voicePhase != "idle"
  val density = LocalDensity.current
  val currentVoiceStart by rememberUpdatedState(onVoiceStart)
  val currentVoiceMove by rememberUpdatedState(onVoiceMove)
  val currentVoiceFinish by rememberUpdatedState(onVoiceFinish)
  val currentVoiceCancel by rememberUpdatedState(onVoiceCancel)
  val toggleActions: () -> Unit = {
    if (!actionsOpen) {
      focusManager.clearFocus(force = true)
      keyboardController?.hide()
    }
    onActionsOpenChange(!actionsOpen)
  }
  Column(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
    if (connection.sendError) Text(
      when {
        connection.sendErrorDetail != null -> stringResource(R.string.assistant_send_rejected_detail,
          connection.sendErrorDetail)
        connection.sendRejected -> stringResource(R.string.assistant_send_rejected)
        else -> stringResource(R.string.assistant_send_error)
      }, color = MaterialTheme.colorScheme.error)
    if (connection.attachmentError) Text(stringResource(R.string.assistant_attachment_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("assistant-attachment-error"))
    if (connection.attachmentLoading) BrandLoadingIndicator(modifier = Modifier.fillMaxWidth()
      .testTag("assistant-attachment-loading"))
    if (voiceError.isNotBlank()) Text(voiceError, color = MaterialTheme.colorScheme.error,
      modifier = Modifier.testTag("assistant-voice-error"))
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
      onRemoveDraftAttachment) { item ->
      connection.selectedConversationId?.let { onPreviewImage(it, item) }
    }
    }
    Column(modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer,
      RoundedCornerShape(18.dp)).testTag("assistant-composer-shell")) {
      if (voiceHeld) Row(modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text("✕", color = if (voiceDestination == "cancel") MaterialTheme.colorScheme.error
          else MaterialTheme.colorScheme.onSurfaceVariant)
        Text("◖))  %02d:%02d".format(voiceSeconds / 60, voiceSeconds % 60),
          color = MaterialTheme.colorScheme.primary)
        Text("☷", color = if (voiceDestination == "text") MaterialTheme.colorScheme.primary
          else MaterialTheme.colorScheme.onSurfaceVariant)
      }
      Row(modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.Bottom) {
        if (showVoicePad) {
          if (voicePhase == "ready" && !voiceBusy) Row(modifier = Modifier.weight(1f).height(48.dp),
            verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onVoiceCancel, modifier = Modifier.weight(1f)
              .testTag("assistant-voice-cancel")) { Text(stringResource(R.string.progress_cancel)) }
            TextButton(onClick = onVoiceRetry, modifier = Modifier.weight(1f)
              .testTag("assistant-voice-retry")) { Text(stringResource(R.string.voice_input_retry)) }
          } else Box(modifier = Modifier.weight(1f).height(48.dp)
            .pointerInput(voiceBusy, connection.sending) {
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
            }.semantics { contentDescription = "Hold to speak" }
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
        } else BasicTextField(value = composerValue, onValueChange = onComposerValueChange,
          modifier = Modifier.weight(1f).heightIn(min = 48.dp).focusRequester(composerFocus)
            .onFocusChanged { if (it.isFocused) onActionsOpenChange(false) }
            .padding(horizontal = 12.dp, vertical = 10.dp).testTag("assistant-input"),
          textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
          maxLines = 5, enabled = connection.pendingDeleteId != connection.selectedConversationId,
          decorationBox = { innerTextField ->
            Box {
              if (composerValue.text.isEmpty()) Text(stringResource(R.string.assistant_input_hint),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
              innerTextField()
            }
          })
        if (!expandedComposer) {
          VoiceInputToggle(voiceMode, voiceBusy || voicePhase != "idle" || connection.sending, onVoiceToggle)
          AssistantComposerButtons(connection, actionsOpen,
            toggleActions, onSendMessage, onStopRun)
        }
      }
      if (expandedComposer) {
        Row(modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 4.dp),
          horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
          VoiceInputToggle(voiceMode, voiceBusy || voicePhase != "idle" || connection.sending, onVoiceToggle)
          AssistantComposerButtons(connection, actionsOpen,
            toggleActions, onSendMessage, onStopRun)
        }
      }
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
private fun VoiceInputToggle(active: Boolean, disabled: Boolean, onClick: () -> Unit) {
  IconButton(onClick = onClick, enabled = !disabled,
    modifier = Modifier.size(48.dp).semantics {
      contentDescription = if (active) "Switch to keyboard" else "Voice input"
    }.testTag("assistant-voice-toggle")) {
    if (active) Text("⌨", color = MaterialTheme.colorScheme.primary,
      style = MaterialTheme.typography.titleLarge)
    else Icon(painterResource(R.drawable.action_microphone), contentDescription = null,
      tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
  }
}

@Composable
private fun AssistantActionPanel(canCreate: Boolean, onCreateConversation: () -> Unit,
  canReference: Boolean = false, onOpenReference: (String) -> Unit = {},
  canPick: Boolean = false, onPick: (String) -> Unit = {},
  onVoiceAction: (String) -> Unit = {},
  tagPrefix: String = "assistant") {
  val firstPage = listOf(
    Triple(R.string.assistant_action_photos, R.drawable.action_photo, "photos"),
    Triple(R.string.assistant_action_camera, R.drawable.action_camera, "camera"),
    Triple(R.string.assistant_action_local_files, R.drawable.action_folder, "local-files"),
    Triple(R.string.assistant_action_voice, R.drawable.action_microphone, "voice"),
    Triple(R.string.assistant_action_reference_note, R.drawable.tab_notes, "reference-note"),
    Triple(R.string.assistant_action_reference_task, R.drawable.tab_progress, "reference-task"),
    Triple(R.string.assistant_action_reference_file, R.drawable.action_folder, "reference-file"),
    Triple(R.string.assistant_action_new_chat, R.drawable.action_new_chat, "new-chat"),
  )
  val secondPage = listOf(
    Triple(R.string.assistant_action_voice_natural, R.drawable.action_waveform, "voice-natural"),
    Triple(R.string.assistant_action_voice_assistant, R.drawable.action_speaker, "voice-assistant"),
  )
  val pages = listOf(firstPage, secondPage)
  val pagerState = rememberPagerState(pageCount = { pages.size })
  Column(modifier = Modifier.fillMaxWidth().testTag("$tagPrefix-action-panel")
    .background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(18.dp))
    .padding(top = 8.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    HorizontalPager(state = pagerState, modifier = Modifier.fillMaxWidth().height(178.dp)) { page ->
      Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        pages[page].chunked(4).forEach { row ->
          Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            row.forEach { (label, icon, id) ->
              val enabled = (id == "new-chat" && canCreate) ||
                (id in setOf("voice", "voice-natural", "voice-assistant") && canCreate) ||
                (id in setOf("reference-note", "reference-task") && canReference) ||
                (id in setOf("photos", "camera", "local-files") && canPick)
              TextButton(onClick = {
                if (id == "new-chat") onCreateConversation()
                else if (id in setOf("voice", "voice-natural", "voice-assistant"))
                  onVoiceAction(when (id) {
                    "voice-assistant" -> "assistant"
                    "voice" -> "record"
                    else -> "natural"
                  })
                else if (id in setOf("photos", "camera", "local-files")) onPick(id)
                else onOpenReference(if (id == "reference-note") "note" else "task")
              }, enabled = enabled,
                modifier = Modifier.weight(1f).height(84.dp).testTag("$tagPrefix-action-$id"),
                contentPadding = PaddingValues(0.dp)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally,
                  verticalArrangement = Arrangement.spacedBy(5.dp)) {
                  Box(modifier = Modifier.size(48.dp)
                    .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(14.dp)),
                    contentAlignment = Alignment.Center) {
                    Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(24.dp),
                      tint = if (enabled) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f))
                  }
                  Text(stringResource(label), style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(
                      alpha = if (enabled) 1f else 0.65f),
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
              }
            }
            repeat(4 - row.size) { androidx.compose.foundation.layout.Spacer(Modifier.weight(1f)) }
          }
        }
      }
    }
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center,
      verticalAlignment = Alignment.CenterVertically) {
      pages.indices.forEach { page ->
        Box(modifier = Modifier.padding(horizontal = 4.dp).size(6.dp)
          .background(if (pagerState.currentPage == page) MaterialTheme.colorScheme.onSurfaceVariant
            else MaterialTheme.colorScheme.outlineVariant, CircleShape))
      }
    }
  }
}

@Composable
private fun AssistantComposerButtons(connection: ConnectionUiState, actionsOpen: Boolean,
  onToggleActions: () -> Unit, onSendMessage: () -> Unit, onStopRun: () -> Unit) {
  val hasPayload = connection.draftText.isNotBlank() || connection.draftRefs.isNotEmpty() ||
    connection.draftAttachments.isNotEmpty()
  if (connection.activeRunId == null || !hasPayload) {
    val context = LocalContext.current
    IconButton(onClick = onToggleActions,
      enabled = !connection.sending && connection.pendingDeleteId != connection.selectedConversationId,
      modifier = Modifier.size(48.dp).semantics {
        contentDescription = if (actionsOpen) {
          context.getString(R.string.composer_close_actions)
        } else {
          context.getString(R.string.composer_add_actions)
        }
      }.testTag("assistant-actions-toggle")) {
      Text(if (actionsOpen) "×" else "+", style = MaterialTheme.typography.headlineMedium,
        color = MaterialTheme.colorScheme.primary)
    }
  }
  if (hasPayload) {
    val sendLabel = stringResource(R.string.assistant_send)
    IconButton(onClick = onSendMessage, modifier = Modifier.size(48.dp)
      .semantics { contentDescription = sendLabel }.testTag("assistant-send")
      .background(if (connection.sending) MaterialTheme.colorScheme.surfaceContainerHigh
        else MaterialTheme.colorScheme.onSurface, CircleShape),
      enabled = !connection.sending && !connection.taskScopeLoading &&
        !connection.attachmentLoading &&
        connection.draftModelReady && connection.realtimeStatus == "connected" &&
        connection.pendingInput == null && connection.pendingDeleteId != connection.selectedConversationId) {
      if (connection.sending) BrandLoadingIndicator(extent = 24.dp)
      else Text("↑", style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.surface)
    }
  }
  if (connection.activeRunId != null) {
    val stopLabel = stringResource(R.string.assistant_stop)
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
private fun AssistantScreen(connection: ConnectionUiState, insets: PaddingValues,
  bottomChromeHeight: androidx.compose.ui.unit.Dp,
  onSelectConversation: (String) -> Unit, onCreateConversation: () -> Unit,
  onLoadReferences: (String, String) -> Unit,
  onAddDraftRef: (ReferencePickerItem) -> Boolean,
  onSessionFileContent: suspend (String) -> ByteArray,
  onRetryPendingInput: () -> Unit,
  onReloadModels: () -> Unit, onSelectModel: (String) -> Unit,
  onReloadAgents: () -> Unit, onSwitchAgent: (String, Boolean) -> Unit,
  onReloadContext: () -> Unit,
  onLoadContextPanel: (String, String, String) -> Unit,
  onSetContextDirectory: () -> Unit,
  onAddContextFile: (ManagedFile) -> Unit,
  onCreateContextConversation: (String?, String?) -> Unit,
  onRefreshConnectionWait: () -> Unit,
  onOpenExecution: (String) -> Unit,
  onRetryExecution: () -> Unit, onCloseExecution: () -> Unit,
  onCopyMessageText: (String) -> Unit,
  onSaveMessageAsNote: (String) -> Unit,
  onReuseMessage: (String) -> Boolean,
  onRegenerateMessage: (String) -> Boolean,
  onLoadMessageMedia: suspend (String, ConversationMedia) -> ByteArray,
  onSpeechChunk: suspend (String, String) -> ByteArray,
  onOpenMessageTarget: (ConversationTarget) -> Unit,
  onComposerValueChange: (TextFieldValue) -> Unit,
  onFocusDraft: () -> Unit,
  referenceKind: String?, onReferenceKindChange: (String?) -> Unit,
  referenceQuery: String, onReferenceQueryChange: (String) -> Unit,
  onActionsOpenChange: (Boolean) -> Unit) {
  val focusManager = LocalFocusManager.current
  val keyboardController = LocalSoftwareKeyboardController.current
  val uriHandler = LocalUriHandler.current
  val context = LocalContext.current
  val speechScope = rememberCoroutineScope()
  val currentSpeechFetch by rememberUpdatedState(onSpeechChunk)
  val reader = remember(connection.profile?.gatewayId, connection.selectedConversationId) {
    ReadAloudController(context, speechScope) { text, language ->
      currentSpeechFetch(text, language)
    }
  }
  DisposableEffect(reader) { onDispose { reader.stop() } }
  LaunchedEffect(connection.selectedConversationId, connection.historyLoading) {
    if (connection.selectedConversationId != null && !connection.historyLoading && !connection.chatError &&
      connection.messages.isEmpty() && connection.context == null && !connection.contextError) onReloadContext()
  }
  val selected = connection.conversations.firstOrNull { it.id == connection.selectedConversationId }
  var modelPickerOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var modelQuery by remember(connection.selectedConversationId) { mutableStateOf("") }
  var agentPickerOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var agentQuery by remember(connection.selectedConversationId) { mutableStateOf("") }
  var pendingAgentId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  var contextOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var sessionFilesOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  var contextInitialMode by remember(connection.selectedConversationId) { mutableStateOf("context") }
  var contextInitialKind by remember(connection.selectedConversationId) { mutableStateOf("note") }
  var optionsOpen by remember(connection.selectedConversationId) { mutableStateOf(false) }
  val optionsLabel = stringResource(R.string.assistant_options)
  var messageActionsId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  var messageDetailId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  var executionReturnMessageId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  val messageDetailScroll = remember(connection.selectedConversationId) { ScrollState(0) }
  var messageDetailScrollOwnerId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  var messageDetailRestoreId by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  var messageDetailRestoreOffset by remember(connection.selectedConversationId) { mutableIntStateOf(0) }
  LaunchedEffect(messageDetailId) {
    if (messageDetailId != null) {
      if (messageDetailId == messageDetailRestoreId) {
        withFrameNanos { }
        messageDetailScroll.scrollTo(messageDetailRestoreOffset)
        messageDetailRestoreId = null
      } else if (messageDetailId != messageDetailScrollOwnerId) {
        messageDetailScroll.scrollTo(0)
      }
      messageDetailScrollOwnerId = messageDetailId
    }
  }
  var previewRequest by remember(connection.selectedConversationId) { mutableStateOf<MessagePreviewRequest?>(null) }
  var externalUrl by remember(connection.selectedConversationId) { mutableStateOf<String?>(null) }
  val openLink: (String) -> Unit = { link ->
    val target = messageLinkTarget(link)
    if (target != null) onOpenMessageTarget(target)
    else if (link.startsWith("https://")) externalUrl = link
  }
  val showConnectionWait = connection.connectionWait.gatewayId == connection.profile?.gatewayId &&
    connection.connectionWait.conversationId == connection.selectedConversationId &&
    connection.connectionWait.snapshot?.wait?.phase?.let { it != "ready" } == true
  val messageListState = remember(connection.selectedConversationId) { LazyListState() }
  var positionedAtLatest by remember(connection.selectedConversationId) { mutableStateOf(false) }
  LaunchedEffect(connection.selectedConversationId, connection.historyLoading,
    connection.messages.lastOrNull()?.id) {
    if (!positionedAtLatest && !connection.historyLoading && connection.messages.isNotEmpty()) {
      messageListState.scrollToItem(connection.messages.lastIndex)
      positionedAtLatest = true
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
    else -> { { connection.selectedConversationId?.let(onSelectConversation) } }
  }
  Box(modifier = Modifier.fillMaxSize().padding(insets)
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
  Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically) {
      Text(selected?.takeUnless { it.isLocalDraft }?.title
        ?: stringResource(R.string.assistant_new_conversation),
        style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Medium,
        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
      IconButton(onClick = { optionsOpen = true },
        modifier = Modifier.semantics { contentDescription = optionsLabel }.testTag("assistant-options")) {
        Text("···", style = MaterialTheme.typography.titleLarge)
      }
    }
    if (connection.selectedConversationId == null) {
      Text(stringResource(R.string.assistant_choose_conversation), style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (connection.conversationsLoading) BrandLoadingPanel()
      connection.conversations.take(3).forEach { conversation ->
        ConversationCard(conversation, onClick = { onSelectConversation(conversation.id) })
      }
    } else {
      if (statusIssue != null) Row(modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(statusIssue), modifier = Modifier.weight(1f),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3)
        TextButton(onClick = retryStatus, modifier = Modifier.testTag("assistant-status-retry")) {
          Text(stringResource(R.string.progress_refresh))
        }
      }
      if (reader.state.phase != "idle") Row(modifier = Modifier.fillMaxWidth()
        .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(16.dp))
        .padding(horizontal = 8.dp).testTag("assistant-read-aloud-controls"),
        verticalAlignment = Alignment.CenterVertically) {
        if (reader.state.phase == "loading") BrandLoadingIndicator(extent = 20.dp)
        Text(when (reader.state.phase) {
          "loading" -> stringResource(R.string.assistant_speech_loading)
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
      if (connection.historyLoading && connection.messages.isEmpty()) {
        Box(modifier = Modifier.weight(1f)) { AssistantHistorySkeleton() }
      } else if (!connection.historyLoading && connection.messages.isEmpty() &&
        connection.activeRunId == null && connection.liveText.isBlank()) {
        Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
          AssistantWelcome(if (connection.contextLoading) null else
            taskRecommendation(connection.taskWelcome) ?: projectRecommendation(connection.projectWelcome)) { prompt ->
            onActionsOpenChange(false)
            onComposerValueChange(TextFieldValue(prompt, selection = TextRange(prompt.length)))
            onFocusDraft()
          }
        }
      } else LazyColumn(modifier = Modifier.weight(1f).testTag("assistant-message-list"),
        state = messageListState,
        contentPadding = PaddingValues(bottom = bottomChromeHeight + if (showConnectionWait) 104.dp else 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val latestMessageId = connection.messages.lastOrNull {
          it.role == "user" || it.role == "assistant"
        }?.id
        items(connection.messages, key = { it.id }) { message ->
          ChatMessageCard(message, onMore = { messageActionsId = message.id },
            onOpenTarget = onOpenMessageTarget,
            onOpenPreview = { media, gallery ->
              previewRequest = MessagePreviewRequest(connection.selectedConversationId, media, gallery)
            }, onOpenLink = openLink, onCopy = onCopyMessageText,
            previewEligible = message.id != latestMessageId,
            onViewMore = { messageDetailId = message.id },
            onSaveNote = if (message.role == "assistant" && message.text.isNotBlank())
              ({ onSaveMessageAsNote(message.id) }) else null,
            onOpenExecution = if (message.role == "assistant" &&
              (message.turnId != null || message.hasNonTextContent)) {
              { executionReturnMessageId = null; onOpenExecution(message.id) }
            } else null,
            loadMedia = { media -> onLoadMessageMedia(connection.selectedConversationId, media) })
        }
        if (connection.liveText.isNotBlank() && connection.activeRunId != null) item(key = "live-output") {
          Card(modifier = Modifier.fillMaxWidth(0.9f).testTag("assistant-live-output")) {
            MarkdownContent(connection.liveText, modifier = Modifier.fillMaxWidth().padding(16.dp),
              onOpenLink = openLink, onCopyCode = onCopyMessageText)
          }
        }
      }
      connection.pendingInput?.let { pending ->
        Card(modifier = Modifier.fillMaxWidth().testTag("assistant-pending")) {
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
  if (showConnectionWait) Box(modifier = Modifier.align(Alignment.BottomCenter)
    .padding(start = 16.dp, end = 16.dp, bottom = bottomChromeHeight + 8.dp)) {
    ConnectionWaitCard(connection.connectionWait, onRefreshConnectionWait)
  }
  }
  if (referenceKind != null) ModalBottomSheet(onDismissRequest = { onReferenceKindChange(null) }) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(stringResource(R.string.assistant_reference_title), style = MaterialTheme.typography.titleMedium)
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("note" to R.string.assistant_action_reference_note,
          "task" to R.string.assistant_action_reference_task).forEach { (kind, label) ->
          TextButton(onClick = { onReferenceQueryChange(""); onReferenceKindChange(kind) },
            modifier = Modifier.weight(1f).testTag("assistant-reference-tab-$kind")) {
            Text(stringResource(label), color = if (referenceKind == kind) MaterialTheme.colorScheme.primary
              else MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
        TextButton(onClick = {}, enabled = false, modifier = Modifier.weight(1f)) {
          Text(stringResource(R.string.assistant_action_reference_file))
        }
      }
      OutlinedTextField(value = referenceQuery, onValueChange = { if (it.length <= 4096) onReferenceQueryChange(it) },
        label = { Text(stringResource(R.string.assistant_reference_search)) },
        modifier = Modifier.fillMaxWidth().testTag("assistant-reference-search"), singleLine = true)
      if (connection.draftRefs.size >= 5) Text(stringResource(R.string.assistant_reference_limit),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
      } else LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
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
  if (optionsOpen || contextOpen) ModalBottomSheet(onDismissRequest = {
    optionsOpen = false; contextOpen = false
  }) {
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
    Column(modifier = Modifier.fillMaxWidth().heightIn(max = 460.dp)
      .padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 16.dp),
      verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(stringResource(R.string.assistant_options), style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 8.dp))
      if (connection.selectedConversationId != null) {
        ContextRow(stringResource(R.string.assistant_context), contextSummary, "assistant-context",
          iconRes = R.drawable.action_folder, compact = true) {
          optionsOpen = false; contextInitialMode = "context"; contextInitialKind = "note"
          contextOpen = true; onReloadContext()
        }
        ContextRow(stringResource(R.string.assistant_agent),
          connection.agents.firstOrNull { it.id == connection.selectedAgentId }?.name
            ?: connection.selectedAgentId, "assistant-agent", iconRes = R.drawable.tab_assistant,
          compact = true, enabled = !connection.creatingConversation) {
          optionsOpen = false; agentPickerOpen = true; onReloadAgents()
        }
        ContextRow(stringResource(R.string.assistant_model),
          connection.models.firstOrNull { it.id == connection.selectedModelId }?.name
            ?: connection.selectedModelId, "assistant-model", iconRes = R.drawable.action_waveform,
          compact = true, enabled = !connection.modelSaving) {
          optionsOpen = false; modelPickerOpen = true; onReloadModels()
        }
      }
      ContextRow(stringResource(R.string.assistant_action_new_chat), "", "assistant-new",
        iconRes = R.drawable.action_new_chat, compact = true,
        enabled = !connection.creatingConversation) {
        optionsOpen = false; onCreateConversation()
      }
      if (connection.selectedConversationId != null) {
        ContextRow(stringResource(R.string.assistant_session_files), "", "assistant-session-files",
          iconRes = R.drawable.action_folder, compact = true) {
          optionsOpen = false; sessionFilesOpen = true
          onLoadContextPanel("files", "", "")
        }
      }
    }
    }
  }
  val actionsMessage = connection.messages.firstOrNull { it.id == messageActionsId }
  if (actionsMessage != null) ModalBottomSheet(onDismissRequest = { messageActionsId = null }) {
    val codeText = extractMarkdownCodeBlocks(actionsMessage.text)
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(stringResource(R.string.assistant_message_more), style = MaterialTheme.typography.titleMedium)
      if (actionsMessage.role == "assistant") TextButton(onClick = {
        messageActionsId = null
        messageDetailId = actionsMessage.id
      }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("message-detail-action")) {
        Text(stringResource(R.string.assistant_message_detail), modifier = Modifier.fillMaxWidth())
      }
      if (actionsMessage.role == "assistant" && actionsMessage.text.isNotBlank()) TextButton(onClick = {
        messageActionsId = null
        reader.speak(actionsMessage.text, actionsMessage.id, Locale.getDefault().toLanguageTag())
      }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
        .testTag("message-read-aloud-action")) {
        Text(stringResource(R.string.assistant_read_aloud), modifier = Modifier.fillMaxWidth())
      }
      if (actionsMessage.text.isNotBlank()) TextButton(onClick = {
        messageActionsId = null
        onCopyMessageText(actionsMessage.text)
      }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("message-copy-action")) {
        Text(stringResource(R.string.assistant_copy), modifier = Modifier.fillMaxWidth())
      }
      if (actionsMessage.role == "assistant" && actionsMessage.text.isNotBlank()) TextButton(onClick = {
        messageActionsId = null
        onSaveMessageAsNote(actionsMessage.id)
      }, enabled = connection.savingMessageNoteId == null,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("message-save-note-action")) {
        Text(stringResource(R.string.assistant_save_note), modifier = Modifier.fillMaxWidth())
      }
      if (actionsMessage.role == "assistant") {
        val assistantIndex = connection.messages.indexOfFirst { it.id == actionsMessage.id }
        val source = connection.messages.take(assistantIndex.coerceAtLeast(0)).lastOrNull { it.role == "user" }
        if (source != null && source.text.isNotBlank() && !source.hasNonTextContent) TextButton(onClick = {
          if (onRegenerateMessage(actionsMessage.id)) messageActionsId = null
        }, enabled = connection.activeRunId == null && !connection.sending && connection.pendingInput == null &&
          connection.realtimeStatus == "connected",
          modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("message-regenerate-action")) {
          Text(stringResource(R.string.assistant_regenerate), modifier = Modifier.fillMaxWidth())
        }
      }
      if (actionsMessage.role == "assistant" && codeText.isNotEmpty()) TextButton(onClick = {
        messageActionsId = null
        onCopyMessageText(codeText)
      }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("message-copy-code-action")) {
        Text(stringResource(R.string.assistant_copy_code), modifier = Modifier.fillMaxWidth())
      }
      if (actionsMessage.role == "user" && actionsMessage.text.isNotBlank() &&
        actionsMessage.text.length <= 32_000 &&
        !actionsMessage.hasNonTextContent) TextButton(onClick = {
        if (onReuseMessage(actionsMessage.id)) {
          messageActionsId = null
          onActionsOpenChange(false)
          onFocusDraft()
        }
      }, enabled = !connection.sending && connection.pendingInput == null &&
        !connection.attachmentLoading && connection.draftAttachments.isEmpty() && connection.draftRefs.isEmpty(),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("message-reuse-action")) {
        Text(stringResource(R.string.assistant_reuse), modifier = Modifier.fillMaxWidth())
      }
      TextButton(onClick = { messageActionsId = null }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(stringResource(R.string.assistant_close))
      }
    }
  }
  val detailMessage = connection.messages.firstOrNull { it.id == messageDetailId }
  if (detailMessage != null) ModalBottomSheet(onDismissRequest = { messageDetailId = null },
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(stringResource(R.string.assistant_message_detail), style = MaterialTheme.typography.titleLarge)
      Text(stringResource(if (detailMessage.role == "user") R.string.message_you else R.string.tab_assistant),
        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
      Column(modifier = Modifier.heightIn(max = 420.dp).verticalScroll(messageDetailScroll)
        .testTag("message-detail-scroll")) {
        ChatMessageCard(detailMessage, onMore = {}, onOpenTarget = onOpenMessageTarget,
          onOpenPreview = { media, gallery -> connection.selectedConversationId?.let {
            previewRequest = MessagePreviewRequest(it, media, gallery)
          } }, onOpenLink = openLink, onCopy = onCopyMessageText, showMore = false,
          previewEligible = false,
          loadMedia = { media -> onLoadMessageMedia(requireNotNull(connection.selectedConversationId), media) })
      }
      if (detailMessage.role == "assistant") {
        OutlinedButton(onClick = {
          messageDetailRestoreId = detailMessage.id
          messageDetailRestoreOffset = messageDetailScroll.value
          executionReturnMessageId = detailMessage.id
          messageDetailId = null
          onOpenExecution(detailMessage.id)
        }, modifier = Modifier.fillMaxWidth().testTag("message-execution")) {
          Text(stringResource(R.string.assistant_execution))
        }
      }
      TextButton(onClick = { messageDetailId = null }) { Text(stringResource(R.string.assistant_close)) }
    }
  }
  if (connection.executionMessageId != null) ModalBottomSheet(onDismissRequest = {
    onCloseExecution()
    messageDetailId = executionReturnMessageId
    executionReturnMessageId = null
  }) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(stringResource(R.string.assistant_execution), style = MaterialTheme.typography.titleLarge)
      ExecutionDetails(connection.executionDetail, connection.executionLoading, connection.executionError,
        connection.activeRunId != null, onRetryExecution, openLink)
      TextButton(onClick = {
        onCloseExecution()
        messageDetailId = executionReturnMessageId
        executionReturnMessageId = null
      }, modifier = Modifier.testTag("execution-back")) {
        Text(stringResource(if (executionReturnMessageId != null) R.string.assistant_back_to_message
          else R.string.assistant_close))
      }
    }
  }
  previewRequest?.let { request ->
    ModalBottomSheet(onDismissRequest = { previewRequest = null }) {
      MessageMediaPreview(request, onLoadMessageMedia) { previewRequest = null }
    }
  }
  externalUrl?.let { url ->
    AlertDialog(onDismissRequest = { externalUrl = null },
      title = { Text(stringResource(R.string.message_open_external_title)) },
      text = { Text(url, maxLines = 4, overflow = TextOverflow.Ellipsis) },
      confirmButton = { TextButton(onClick = {
        externalUrl = null
        runCatching { uriHandler.openUri(url) }
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
  if (modelPickerOpen) AlertDialog(
    onDismissRequest = { modelPickerOpen = false },
    title = { Text(stringResource(R.string.assistant_model)) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(value = modelQuery, onValueChange = { modelQuery = it },
          label = { Text(stringResource(R.string.assistant_model_search)) }, singleLine = true)
        if (connection.modelsLoading) BrandLoadingPanel(minHeight = 120.dp)
        if (connection.modelError) TextButton(onClick = onReloadModels) {
          Text(stringResource(R.string.assistant_model_retry))
        }
        LazyColumn(modifier = Modifier.heightIn(max = 360.dp)) {
          items(connection.models.filter { modelQuery.isBlank() ||
            it.name.contains(modelQuery, ignoreCase = true) || it.id.contains(modelQuery, ignoreCase = true) },
            key = { it.id }) { model ->
            TextButton(onClick = { onSelectModel(model.id); modelPickerOpen = false },
              enabled = !connection.modelSaving && !connection.sending && connection.activeRunId == null &&
                connection.pendingInput == null, modifier = Modifier.fillMaxWidth().testTag("model-${model.id}")) {
              Text("${if (model.id == connection.selectedModelId) "✓ " else ""}${model.name} · ${model.id}")
            }
          }
        }
      }
    },
    confirmButton = { TextButton(onClick = { modelPickerOpen = false }) { Text(stringResource(R.string.assistant_model_close)) } },
  )
  if (agentPickerOpen) AlertDialog(
    onDismissRequest = { agentPickerOpen = false },
    title = { Text(stringResource(R.string.assistant_agent)) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(value = agentQuery, onValueChange = { agentQuery = it },
          label = { Text(stringResource(R.string.assistant_agent_search)) }, singleLine = true)
        if (connection.agentsLoading) BrandLoadingPanel(minHeight = 120.dp)
        if (connection.agentError) TextButton(onClick = onReloadAgents) {
          Text(stringResource(R.string.assistant_agent_retry))
        }
        LazyColumn(modifier = Modifier.heightIn(max = 360.dp)) {
          items(connection.agents.filter { agentQuery.isBlank() ||
            it.name.contains(agentQuery, ignoreCase = true) || it.id.contains(agentQuery, ignoreCase = true) },
            key = { it.id }) { agent ->
            TextButton(onClick = {
              agentPickerOpen = false
              if (connection.draftText.isNotBlank()) pendingAgentId = agent.id
              else onSwitchAgent(agent.id, false)
            }, enabled = !connection.creatingConversation, modifier = Modifier.fillMaxWidth().testTag("agent-${agent.id}")) {
              Text("${if (agent.id == connection.selectedAgentId) "✓ " else ""}${agent.name} · ${agent.id}")
            }
          }
        }
      }
    },
    confirmButton = { TextButton(onClick = { agentPickerOpen = false }) { Text(stringResource(R.string.assistant_model_close)) } },
  )
  pendingAgentId?.let { agentId ->
    AlertDialog(onDismissRequest = { pendingAgentId = null },
      title = { Text(stringResource(R.string.assistant_discard_draft_title)) },
      text = { Text(stringResource(R.string.assistant_discard_draft_message)) },
      confirmButton = { TextButton(onClick = { pendingAgentId = null; onSwitchAgent(agentId, true) },
        modifier = Modifier.testTag("agent-discard-confirm")) { Text(stringResource(R.string.assistant_discard_draft_confirm)) } },
      dismissButton = { TextButton(onClick = { pendingAgentId = null }) { Text(stringResource(R.string.assistant_discard_draft_cancel)) } })
  }
}

@Composable
private fun ExecutionDetails(detail: ExecutionDetail?, loading: Boolean, error: Boolean, live: Boolean,
  onRetry: () -> Unit, onOpenLink: (String) -> Unit) {
  var expandedGroupId by remember(detail?.turnId) { mutableStateOf<String?>(null) }
  val groups = remember(detail, live) { ExecutionGroups.group(detail?.steps.orEmpty(), live) }
  if (loading && detail == null) BrandLoadingPanel(modifier = Modifier.testTag("execution-loading"))
  if (error) {
    Text(stringResource(R.string.assistant_execution_error), color = MaterialTheme.colorScheme.error)
    TextButton(onClick = onRetry, modifier = Modifier.testTag("execution-retry")) {
      Text(stringResource(R.string.assistant_execution_retry))
    }
  }
  if (!loading && !error && groups.isEmpty()) Text(stringResource(R.string.assistant_execution_empty))
  if (groups.isNotEmpty()) LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 500.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp)) {
    items(groups, key = { it.id }) { group ->
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
  bottomChromeHeight: androidx.compose.ui.unit.Dp,
  onSearchChange: (String) -> Unit,
  onRefresh: () -> Unit,
  onLoadMore: () -> Unit,
  onCreateConversation: () -> Unit,
  onSelectConversation: (String) -> Unit,
  onSelectTaskChild: (String, String) -> Unit,
  onDiscardDraft: (String) -> Unit,
  onBeginRename: (String) -> Unit,
  onRenameDraftChange: (String) -> Unit,
  onSaveRename: () -> Unit,
  onCancelRename: () -> Unit,
  onTogglePin: (String) -> Unit,
  onToggleArchive: (String) -> Unit,
  onBatchConversations: (List<String>, String) -> Unit,
  onBeginShare: (String) -> Unit,
  onConfirmShare: () -> Unit,
  onDismissShare: () -> Unit,
  onScheduleDelete: (String) -> Unit,
  onUndoDelete: () -> Unit,
) {
  var pendingDiscardId by rememberSaveable { mutableStateOf<String?>(null) }
  var menuConversationId by rememberSaveable { mutableStateOf<String?>(null) }
  var searchOpen by rememberSaveable { mutableStateOf(true) }
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
  LaunchedEffect(connection.profile?.gatewayId, connection.conversationSearch) {
    listState.scrollToItem(0)
    expandedTaskParents = emptyList()
    collapsedTaskParents = emptyList()
  }
  LaunchedEffect(connection.profile?.gatewayId, connection.conversationSearch,
    connection.conversationsHasMore, connection.conversationsLoading,
    connection.conversationsLoadingMore, connection.conversationsMoreError) {
    if (!connection.conversationsHasMore || connection.conversationsLoading ||
      connection.conversationsLoadingMore || connection.conversationsMoreError) return@LaunchedEffect
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
  if (connection.conversationShareBusy) AlertDialog(onDismissRequest = {},
    title = { Text(stringResource(R.string.conversations_share)) },
    text = { BrandLoadingPanel(modifier = Modifier.testTag("conversations-share-loading"), minHeight = 120.dp) },
    confirmButton = {})
  connection.conversationSharePreview?.let { preview -> AlertDialog(onDismissRequest = onDismissShare,
    title = { Text(stringResource(R.string.conversations_share)) },
    text = { Text(stringResource(R.string.conversations_share_confirm,
      preview.messageCount, preview.attachmentCount)) },
    confirmButton = { TextButton(onClick = onConfirmShare,
      modifier = Modifier.testTag("conversations-share-confirm")) {
      Text(stringResource(R.string.conversations_share))
    } },
    dismissButton = { TextButton(onClick = onDismissShare) {
      Text(stringResource(R.string.conversations_cancel))
    } }) }
  if (connection.conversationShareError) AlertDialog(onDismissRequest = onDismissShare,
    title = { Text(stringResource(R.string.conversations_share)) },
    text = { Text(stringResource(R.string.conversations_share_error)) },
    confirmButton = { TextButton(onClick = onDismissShare) {
      Text(stringResource(R.string.progress_back))
    } })
  val share = connection.conversationShareResult
  if (share != null) {
    val context = LocalContext.current
    ModalBottomSheet(onDismissRequest = onDismissShare,
      modifier = Modifier.testTag("conversations-share-sheet")) {
      Column(modifier = Modifier.fillMaxWidth().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(share.title, style = MaterialTheme.typography.titleLarge)
        Text(share.url, color = MaterialTheme.colorScheme.primary,
          modifier = Modifier.testTag("conversations-share-url"))
        Text(stringResource(when (share.reachability) {
          "public" -> R.string.notes_share_public
          "lan" -> R.string.notes_share_lan
          else -> R.string.notes_share_local
        }))
        if (share.hint.isNotBlank()) Text(share.hint)
        Text(stringResource(R.string.notes_share_expires, share.expiresAt))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = {
            (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
              .setPrimaryClip(ClipData.newPlainText(share.title, share.url))
          }, modifier = Modifier.testTag("conversations-share-copy")) {
            Text(stringResource(R.string.notes_share_copy))
          }
          Button(onClick = {
            val send = Intent(Intent.ACTION_SEND).apply {
              type = "text/plain"
              putExtra(Intent.EXTRA_TEXT, "${share.title}\n${share.url}")
            }
            context.startActivity(Intent.createChooser(send, null))
          }, modifier = Modifier.testTag("conversations-share-system")) {
            Text(stringResource(R.string.notes_share_system))
          }
        }
      }
    }
  }
  if (pendingDiscardId != null) AlertDialog(
    onDismissRequest = { pendingDiscardId = null },
    title = { Text(stringResource(R.string.conversations_discard_title)) },
    text = { Text(stringResource(R.string.conversations_discard_message)) },
    confirmButton = { TextButton(onClick = {
      pendingDiscardId?.let(onDiscardDraft)
      pendingDiscardId = null
    }, modifier = Modifier.testTag("conversations-confirm-discard")) {
      Text(stringResource(R.string.conversations_discard))
    } },
    dismissButton = { TextButton(onClick = { pendingDiscardId = null }) {
      Text(stringResource(R.string.conversations_cancel))
    } },
  )
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
  val clearLabel = stringResource(R.string.conversations_clear)
  val newConversationLabel = stringResource(R.string.assistant_new_action)
  val searchLabel = stringResource(R.string.conversations_search)
  Column(modifier = Modifier.fillMaxSize().padding(insets).padding(horizontal = 20.dp, vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically) {
      Text(if (selecting) stringResource(R.string.conversations_selected, selectedIds.size)
        else stringResource(R.string.tab_conversations), style = MaterialTheme.typography.headlineMedium,
        fontWeight = FontWeight.Bold, fontSize = 30.sp, modifier = Modifier.weight(1f))
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
      if (!selecting) IconButton(onClick = onCreateConversation, enabled = !connection.creatingConversation,
        modifier = Modifier.size(48.dp).semantics {
          contentDescription = newConversationLabel
        }.testTag("chats-new")) {
        Icon(painterResource(R.drawable.action_add), contentDescription = null,
          tint = MaterialTheme.colorScheme.onSurface,
          modifier = Modifier.size(24.dp).testTag("conversations-new-icon"))
      }
    }
    if (searchOpen) Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      BasicTextField(value = connection.conversationSearch, onValueChange = onSearchChange,
        modifier = Modifier.weight(1f).heightIn(min = 44.dp)
          .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(24.dp))
          .padding(horizontal = 16.dp, vertical = 10.dp).testTag("conversations-search"),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        singleLine = true,
        decorationBox = { innerTextField ->
          Box {
            if (connection.conversationSearch.isEmpty()) Text(
              stringResource(R.string.conversations_search),
              style = MaterialTheme.typography.bodyLarge,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
            innerTextField()
          }
        })
      IconButton(onClick = {
        if (connection.conversationSearch.isNotEmpty()) onSearchChange("")
        searchOpen = false
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
      }, modifier = Modifier.size(48.dp).semantics { contentDescription = clearLabel }
        .testTag("conversations-clear")) {
        Text("×", style = MaterialTheme.typography.headlineMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    if (connection.conversationsLoading && connection.conversations.isEmpty()) BrandLoadingPanel()
    if (connection.chatError) Row(verticalAlignment = Alignment.CenterVertically) {
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
      contentPadding = PaddingValues(bottom = bottomChromeHeight + 20.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      ConversationGroups.group(connection.conversations.filterNot { it.id == connection.pendingDeleteId }).forEach { group ->
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
              onDiscard = if (conversation.isLocalDraft) ({ pendingDiscardId = conversation.id }) else null,
              onMenu = if (conversation.isLocalDraft || selecting) null else ({ menuConversationId = conversation.id }),
              selected = conversation.id == connection.selectedConversationId,
              selectionMode = selecting && !conversation.isLocalDraft,
              selectionSelected = conversation.id in selectedIds,
              discardEnabled = connection.discardingDraftId == null && !connection.creatingConversation && !connection.sending,
              onClick = {
                if (selecting && !conversation.isLocalDraft) selectedIds = if (conversation.id in selectedIds)
                  selectedIds - conversation.id else selectedIds + conversation.id
                else onSelectConversation(conversation.id)
              })
          }
          if (taskGroup != null && taskExpanded && connection.conversationSearch.isBlank()) {
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
  Card(modifier = modifier.fillMaxWidth().heightIn(min = 64.dp).testTag("conversation-row-${conversation.id}")
    .semantics {
      if (selectionMode) this.selected = selectionSelected
      if (onMenu != null) customActions = listOf(CustomAccessibilityAction(contextMenuLabel) {
        onMenu(); true
      })
    }.combinedClickable(onClick = onClick,
    onLongClick = onMenu?.let { action -> { haptics.performHapticFeedback(HapticFeedbackType.LongPress); action() } },
    onLongClickLabel = if (onMenu != null) stringResource(R.string.conversations_more_actions) else null),
    shape = RoundedCornerShape(16.dp),
    colors = CardDefaults.cardColors(containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer
      else MaterialTheme.colorScheme.surfaceContainer)) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (selectionMode) Text(if (selectionSelected) "☑" else "□",
          style = MaterialTheme.typography.titleMedium,
          color = MaterialTheme.colorScheme.primary)
        if (taskGroup != null && onToggleTasks != null) IconButton(onClick = onToggleTasks,
          modifier = Modifier.size(48.dp).testTag("conversation-tasks-${conversation.id}").semantics {
            contentDescription = if (taskExpanded) taskCollapseLabel else taskExpandLabel
          }) {
          Text(if (taskExpanded) "⌄" else "›", style = MaterialTheme.typography.titleLarge)
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
    .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(12.dp))
    .clickable(enabled = child.activeConversationId != null) {
      child.activeConversationId?.let(onOpen)
    }.padding(start = 56.dp, end = 16.dp, top = 8.dp, bottom = 8.dp)
    .testTag("conversation-task-${child.taskId}"),
    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
    Text("•", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleSmall)
    Text(child.title, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
      style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(label, maxLines = 1, style = MaterialTheme.typography.labelSmall,
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
  Column(modifier = Modifier.fillMaxWidth().height(sheetHeight)
    .padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 24.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = { if (mode == "context") onBackToOptions() else mode = "context" },
        modifier = Modifier.testTag("context-back")) { Text("‹") }
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
  Column(modifier = Modifier.fillMaxWidth().fillMaxHeight(0.9f)
    .padding(horizontal = 20.dp, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = {
        if (selected != null) selected = null
        else if (path.isNotBlank()) {
          path = path.substringBeforeLast('/', "")
          onLoadPanel("files", path, query)
        } else onClose()
      }, modifier = Modifier.testTag("session-files-back")) { Text("‹") }
      Text(stringResource(R.string.assistant_session_files),
        style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
        modifier = Modifier.weight(1f))
      TextButton(onClick = onClose) { Text("×") }
    }
    if (selected == null) {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(query, onValueChange = { query = it.take(4096) },
          modifier = Modifier.weight(1f).testTag("session-files-search"),
          label = { Text(stringResource(R.string.assistant_reference_search)) },
          singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
          keyboardActions = KeyboardActions(onSearch = { onLoadPanel("files", path, query) }))
        TextButton(onClick = { onLoadPanel("files", path, query) },
          modifier = Modifier.testTag("session-files-refresh")) {
          Text(stringResource(R.string.assistant_context_retry))
        }
      }
      Text(if (path.isBlank()) stringResource(R.string.assistant_session_files) else path,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (panel.loading) BrandLoadingPanel(modifier = Modifier.testTag("session-files-loading"))
      if (panel.error) Text(stringResource(R.string.assistant_context_error),
        color = MaterialTheme.colorScheme.error)
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
private fun ContextRow(title: String, subtitle: String, tag: String, enabled: Boolean = true,
  iconRes: Int? = null, compact: Boolean = false, navigable: Boolean = true,
  onClick: () -> Unit) {
  TextButton(onClick = onClick, enabled = enabled,
    modifier = Modifier.fillMaxWidth().heightIn(min = if (compact) 52.dp else 64.dp)
      .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(if (compact) 12.dp else 14.dp))
      .testTag(tag), contentPadding = PaddingValues(horizontal = if (compact) 12.dp else 16.dp,
      vertical = if (compact) 6.dp else 12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(if (compact) 10.dp else 12.dp)) {
      if (iconRes != null) Icon(painterResource(iconRes), contentDescription = null,
        modifier = Modifier.size(if (compact) 20.dp else 23.dp),
        tint = MaterialTheme.colorScheme.onSurfaceVariant)
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, color = MaterialTheme.colorScheme.onSurface,
          style = if (compact) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge,
          fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2,
          overflow = TextOverflow.Ellipsis)
      }
      if (navigable) Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.titleMedium)
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
      if (secondary) IconButton(onClick = closeSecondary, enabled = !busy,
        modifier = Modifier.size(44.dp).testTag("pairing-back")) {
        Text("‹", style = MaterialTheme.typography.headlineMedium)
      } else {
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
          .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(20.dp))
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
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(16.dp))
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

@Composable
private fun UnpairedScreen(title: String, description: String, insets: PaddingValues) {
  Column(
    modifier = Modifier.fillMaxSize().padding(insets).padding(horizontal = 20.dp, vertical = 16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
    Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
      Text(description, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}
