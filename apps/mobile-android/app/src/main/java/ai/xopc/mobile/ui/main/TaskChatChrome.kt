package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ProgressTask
import ai.xopc.mobile.gateway.ProgressTaskEdit
import ai.xopc.mobile.theme.LocalChatColors
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Stable
internal class ChatReadingPosition {
  val listState = androidx.compose.foundation.lazy.LazyListState()
  val positionedAtLatest = mutableStateOf(false)
  val followBottom = mutableStateOf(true)
  val transcriptId = mutableStateOf<String?>(null)
}

@Composable
internal fun rememberChatReadingPosition(gatewayId: String?, deviceId: String?, conversationId: String?): ChatReadingPosition {
  val positions = remember(gatewayId, deviceId) { linkedMapOf<String, ChatReadingPosition>() }
  return remember(gatewayId, deviceId, conversationId) {
    val key = conversationId.orEmpty()
    val position = positions.remove(key) ?: ChatReadingPosition()
    positions[key] = position
    if (positions.size > 50) positions.remove(positions.keys.first())
    position
  }
}

internal fun isTaskChat(connection: ConnectionUiState): Boolean = connection.taskConversationTaskId != null

@Stable
internal class TaskChatNavigation {
  private data class Source(val tab: HomeTab, val conversationId: String?)

  private var sources by mutableStateOf(listOf<Source>())
  private var pendingSource by mutableStateOf<Source?>(null)
  val canReturn: Boolean get() = sources.isNotEmpty()
  val returnTab: HomeTab get() = sources.lastOrNull()?.tab ?: HomeTab.Conversations

  fun open(taskId: String, connection: ConnectionUiState,
    sourceTab: HomeTab = HomeTab.Assistant, waitsForResult: Boolean = true, onOpen: (String) -> Unit) {
    if (connection.progress.taskChatBusy || pendingSource != null ||
      taskId == connection.taskConversationTaskId && sourceTab == HomeTab.Assistant) return
    val source = Source(sourceTab, connection.selectedConversationId)
    sources = sources + source
    if (waitsForResult) pendingSource = source
    onOpen(taskId)
  }

  fun close(onConversation: (String) -> Unit, onTab: (HomeTab) -> Unit) {
    val source = sources.lastOrNull()
    sources = sources.dropLast(1)
    pendingSource = null
    source?.conversationId?.let(onConversation)
    val tab = source?.tab ?: HomeTab.Conversations
    if (tab != HomeTab.Assistant || source?.conversationId == null) onTab(tab)
  }

  fun settle(connection: ConnectionUiState): Boolean {
    val source = pendingSource ?: return false
    if (connection.progress.taskChatError) {
      if (sources.lastOrNull() == source) sources = sources.dropLast(1)
      pendingSource = null
      return true
    }
    if (connection.selectedConversationId != source.conversationId ||
      connection.chatNavigationId != null) pendingSource = null
    return false
  }
}

@Composable
internal fun rememberTaskChatNavigation(connection: ConnectionUiState): TaskChatNavigation {
  val navigation = remember(connection.profile?.gatewayId) { TaskChatNavigation() }
  val context = androidx.compose.ui.platform.LocalContext.current
  LaunchedEffect(connection.progress.taskChatError, connection.selectedConversationId, connection.chatNavigationId) {
    if (navigation.settle(connection)) android.widget.Toast.makeText(context,
      R.string.progress_task_chat_error, android.widget.Toast.LENGTH_SHORT).show()
  }
  return navigation
}

@Composable
internal fun TaskConversationChrome(connection: ConnectionUiState, navigation: TaskChatNavigation,
  onConversation: (String) -> Unit, onTab: (HomeTab) -> Unit,
  onReload: (String) -> Unit, onCommand: (String) -> Unit, onStart: (String) -> Unit,
  onSave: (String, Int, ProgressTaskEdit) -> Unit, onProjects: () -> Unit,
  onSearch: () -> Unit, onOptions: () -> Unit, detailsOpen: Boolean, onDismissDetails: () -> Unit) {
  val taskId = connection.taskConversationTaskId ?: return
  val title = connection.context?.task?.title ?: connection.taskWelcome?.taskTitle.orEmpty()
  TaskChatChrome(taskId, title, connection.progress, { navigation.close(onConversation, onTab) },
    { onReload(taskId) }, onCommand, onStart, onSave, onProjects, onSearch, onOptions, detailsOpen, onDismissDetails,
    returnTab = navigation.returnTab)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TaskChatChrome(taskId: String, title: String, state: ProgressUiState,
  onClose: () -> Unit, onReload: () -> Unit, onCommand: (String) -> Unit,
  onStart: (String) -> Unit, onSave: (String, Int, ProgressTaskEdit) -> Unit,
  onLoadProjects: () -> Unit, onSearch: () -> Unit, onOptions: () -> Unit,
  detailsOpen: Boolean, onDismissDetails: () -> Unit, modifier: Modifier = Modifier,
  returnTab: HomeTab = HomeTab.Conversations) {
  var menuOpen by remember(taskId) { mutableStateOf(false) }
  var editOpen by rememberSaveable(taskId) { mutableStateOf(false) }
  var statusOpen by rememberSaveable(taskId) { mutableStateOf(false) }
  var confirmsCancel by remember(taskId) { mutableStateOf(false) }
  val task = state.detailTask?.takeIf { it.id == taskId }
  val moreLabel = stringResource(R.string.assistant_message_more)
  val busy = state.commandBusy || state.editBusy
  val latestCanRefresh by rememberUpdatedState(!editOpen && !statusOpen && !busy && !state.detailLoading)
  LaunchedEffect(taskId) {
    onReload()
    while (true) { delay(8_000); if (latestCanRefresh) onReload() }
  }
  val headerFill = LocalChatColors.current.card
  Box(modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))) {
    Row(Modifier.fillMaxWidth().height(64.dp).background(MaterialTheme.colorScheme.background)
      .padding(horizontal = 12.dp).testTag("task-chat-header"),
      verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      IconButton(onClick = onClose, modifier = Modifier.background(headerFill, CircleShape).testTag("task-chat-close")) {
        Icon(painterResource(R.drawable.action_close), stringResource(when (returnTab) {
          HomeTab.Assistant -> R.string.task_chat_return_conversation
          HomeTab.Progress, HomeTab.Projects, HomeTab.Automations, HomeTab.Notes -> R.string.task_chat_return_task
          else -> R.string.task_chat_return_history
        }))
      }
      Text(task?.title ?: title.ifBlank { stringResource(R.string.progress_task_detail) },
        modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall,
        maxLines = 1, overflow = TextOverflow.Ellipsis)
      Box {
        IconButton(onClick = { menuOpen = true }, modifier = Modifier.background(headerFill, CircleShape)
          .semantics { contentDescription = moreLabel }.testTag("task-chat-menu")) {
          Icon(painterResource(R.drawable.settings_sliders), contentDescription = null, modifier = Modifier.size(22.dp))
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
          DropdownMenuItem(text = { Text(stringResource(R.string.progress_edit_task)) }, enabled = task != null && !busy,
            onClick = { menuOpen = false; editOpen = true; onLoadProjects() })
          DropdownMenuItem(text = { Text(stringResource(R.string.progress_adjust_status)) }, enabled = task != null && !busy,
            onClick = { menuOpen = false; statusOpen = true })
          if (task?.allowedCommands?.contains("close") == true) DropdownMenuItem(
            text = { Text(stringResource(R.string.progress_cancel_task), color = MaterialTheme.colorScheme.error) },
            enabled = !busy, onClick = { menuOpen = false; confirmsCancel = true })
          HorizontalDivider()
          DropdownMenuItem(text = { Text(stringResource(R.string.chat_personal_search)) }, onClick = { menuOpen = false; onSearch() })
          DropdownMenuItem(text = { Text(stringResource(R.string.assistant_options)) }, onClick = { menuOpen = false; onOptions() })
        }
      }
    }
  }
  if (detailsOpen) ModalBottomSheet(onDismissRequest = onDismissDetails) {
    val sheetHeight = androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp.dp
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp),
      verticalAlignment = Alignment.CenterVertically) {
      Text(task?.title ?: stringResource(R.string.progress_task_detail),
        modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
        maxLines = 2, overflow = TextOverflow.Ellipsis)
      IconButton(onClick = onDismissDetails, modifier = Modifier.testTag("task-chat-details-close")) {
        Icon(painterResource(R.drawable.action_close), stringResource(R.string.assistant_close))
      }
    }
    Column(Modifier.fillMaxWidth().heightIn(max = sheetHeight * 0.65f)
      .verticalScroll(rememberScrollState()).padding(20.dp).testTag("task-chat-overview"),
      verticalArrangement = Arrangement.spacedBy(16.dp)) {
      if (state.detailError || state.commandError) {
        TextButton(onClick = onReload) { Text(stringResource(R.string.progress_refresh)) }
      } else if (task == null) {
        BrandLoadingPanel()
      }
      if (task != null) TaskChatOverview(task)
    }
  }
  if (task != null && statusOpen) ProgressTaskDetail(task, busy || state.detailLoading, state.commandError,
    false, false, onCommand, onStart, {}, state.agents, state.agentsLoading, state.agentsError,
    onRefresh = onReload, statusOnly = true, onStatusDismiss = { statusOpen = false; onReload() }, onEdit = {})
  if (task != null && editOpen) TaskChatEditor(task, state, onLoadProjects, onSave) { editOpen = false }
  if (confirmsCancel) AlertDialog(onDismissRequest = { confirmsCancel = false },
    title = { Text(stringResource(R.string.progress_cancel_task)) },
    text = { Text(stringResource(R.string.progress_cancel_task_help)) },
    confirmButton = { TextButton(onClick = { confirmsCancel = false; onCommand("cancel_task") }) {
      Text(stringResource(R.string.progress_cancel_task))
    } }, dismissButton = { TextButton(onClick = { confirmsCancel = false }) { Text(stringResource(R.string.assistant_close)) } })
}

@Composable
internal fun TaskDetailsTip(onOpen: () -> Unit, modifier: Modifier = Modifier) {
  Box(modifier.height(44.dp).clickable(onClick = onOpen).testTag("task-chat-details-tip"),
    contentAlignment = Alignment.Center) {
    Row(Modifier.height(28.dp).background(LocalChatColors.current.card, CircleShape).padding(horizontal = 10.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      Text("ⓘ", color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.clearAndSetSemantics { })
      Text(stringResource(R.string.progress_task_detail), style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun TaskChatOverview(task: ProgressTask) {
  Text(stringResource(R.string.progress_execution_state, taskExecutionLabel(task.operationalState)),
    color = MaterialTheme.colorScheme.onSurfaceVariant)
  if (task.attention.isNotEmpty()) {
    Text(stringResource(R.string.task_chat_attention), style = MaterialTheme.typography.labelLarge)
    task.attention.forEach { Text(it) }
  }
  if (task.latestResult.isNotBlank()) {
    Text(stringResource(R.string.progress_latest_result), style = MaterialTheme.typography.labelLarge)
    MarkdownContent(task.latestResult)
  }
  task.remainingWork.forEach { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
  val objective = task.objective.ifBlank { task.body }
  if (objective.isNotBlank()) {
    Text(stringResource(R.string.progress_description), style = MaterialTheme.typography.labelLarge)
    MarkdownContent(objective)
  }
  if (task.criteria.isNotEmpty()) {
    Text(stringResource(R.string.progress_criteria_passed, task.criteria.count { it.status == "passed" }, task.criteria.size),
      style = MaterialTheme.typography.labelLarge)
    task.criteria.forEach { criterion -> Text((when (criterion.status) { "passed" -> "✓ "; "failed" -> "! "; else -> "○ " }) + criterion.text) }
  }
  if (task.expectedOutputs.isNotEmpty()) {
    Text(stringResource(R.string.task_chat_outputs), style = MaterialTheme.typography.labelLarge)
    task.expectedOutputs.forEach { Text(it) }
  }
  var properties by rememberSaveable(task.id) { mutableStateOf(false) }
  var history by rememberSaveable(task.id) { mutableStateOf(false) }
  HorizontalDivider()
  TextButton(onClick = { properties = !properties }) { Text(stringResource(R.string.progress_details)) }
  if (properties) {
    task.projectId?.let { Text(stringResource(R.string.progress_task_project, it)) }
    task.priority?.let { Text(it) }
    task.dueAt?.let { Text(java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it))) }
    if (task.body.isNotBlank() && task.body != objective) MarkdownContent(task.body)
  }
  TextButton(onClick = { history = !history }) { Text(stringResource(R.string.progress_change_log)) }
  if (history) task.phaseChanges.asReversed().forEach { change ->
    Text(progressPhaseLabel(change.fromPhase) + " → " + progressPhaseLabel(change.toPhase))
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskChatEditor(task: ProgressTask, state: ProgressUiState, onLoadProjects: () -> Unit,
  onSave: (String, Int, ProgressTaskEdit) -> Unit, onClose: () -> Unit) {
  var title by rememberSaveable(task.id) { mutableStateOf(task.title) }
  var body by rememberSaveable(task.id) { mutableStateOf(task.body) }
  var project by rememberSaveable(task.id) { mutableStateOf(task.projectId.orEmpty()) }
  var priority by rememberSaveable(task.id) { mutableStateOf(task.priority ?: "normal") }
  var due by rememberSaveable(task.id) { mutableStateOf(task.dueAt) }
  val version = remember(task.id) { task.version }
  val initialRevision = remember { state.editSavedRevision }
  var discard by remember { mutableStateOf(false) }
  val dirty = title != task.title || body != task.body || project != task.projectId.orEmpty() || priority != (task.priority ?: "normal") || due != task.dueAt
  LaunchedEffect(state.editSavedRevision) { if (state.editSavedRevision > initialRevision) onClose() }
  ModalBottomSheet(onDismissRequest = { if (!state.editBusy) { if (dirty) discard = true else onClose() } },
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
    Box(Modifier.fillMaxWidth().fillMaxHeight(0.9f).padding(20.dp)) {
      ProgressTaskEditor(title, { title = it }, body, { body = it }, project, { project = it },
        priority, { priority = it }, due, { due = it }, state.projects, state.projectsLoading,
        state.projectsError, onLoadProjects, dirty, state.editBusy, state.editError,
        { onSave(task.id, version, ProgressTaskEdit(title, body, project, priority, due)) })
    }
  }
  if (discard) AlertDialog(onDismissRequest = { discard = false },
    title = { Text(stringResource(R.string.progress_discard_title)) },
    text = { Text(stringResource(R.string.progress_discard_message)) },
    confirmButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.progress_discard)) } },
    dismissButton = { TextButton(onClick = { discard = false }) { Text(stringResource(R.string.progress_edit_task)) } })
}
