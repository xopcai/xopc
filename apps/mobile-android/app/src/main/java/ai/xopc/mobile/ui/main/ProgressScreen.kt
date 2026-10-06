package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ProgressItem
import ai.xopc.mobile.gateway.ProgressHomeAction
import ai.xopc.mobile.gateway.ProgressTask
import ai.xopc.mobile.gateway.ProgressProject
import ai.xopc.mobile.gateway.ProgressProjectSession
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import java.text.DateFormat
import java.util.Date
import java.util.UUID

/** Only known internal destinations may be opened from a Gateway-supplied home item. */
internal fun progressDestination(href: String): Pair<String, String>? {
  val match = Regex("^/(chat|tasks)/([A-Za-z0-9_-]{1,128})$").matchEntire(href) ?: return null
  return match.groupValues[1] to match.groupValues[2]
}

@Composable
internal fun ProgressScreen(state: ProgressUiState, insets: PaddingValues,
  onRefreshHome: () -> Unit, onRefreshTasks: () -> Unit, onLoadMore: () -> Unit,
  onOpenTask: (String) -> Unit, onSearchChange: (String) -> Unit, onSubmitSearch: () -> Unit,
  onTaskCommand: (String) -> Unit,
  onStartTask: (String) -> Unit,
  onCreateTaskWithChat: () -> Unit,
  onLoadProjects: () -> Unit,
  onOpenProject: (String) -> Unit,
  onCreateTask: (String, String, String) -> Unit,
  onOpenTaskChat: (String) -> Unit,
  onSaveTask: (String, Int, String, String, String) -> Unit,
  onOpenChat: (String) -> Unit,
  onCreateProjectChat: (String) -> Unit = {},
  onHomeAction: (ProgressHomeAction) -> Unit = {},
  onLoadAutomations: () -> Unit = {},
  onOpenAutomation: (String) -> Unit = {},
  onOpenAutomationRun: (String) -> Unit = {},
  onAutomationAction: (String, String) -> Unit = { _, _ -> },
  onCreateAutomation: (String, String, String, String) -> Unit = { _, _, _, _ -> },
  onUpdateAutomation: (String, String, String, String, String) -> Unit = { _, _, _, _, _ -> },
  onDeleteAutomation: (String, String) -> Unit = { _, _ -> },
  onAutomationRunAction: (String, String) -> Unit = { _, _ -> },
  onTopLevelChange: (Boolean) -> Unit = {},
  chatBusy: Boolean = false,
  bottomChromeHeight: Dp = 0.dp) {
  var pendingHomeAction by remember(state.gatewayId) { mutableStateOf<ProgressHomeAction?>(null) }
  var page by rememberSaveable(state.gatewayId) { mutableStateOf("overview") }
  LaunchedEffect(page) { onTopLevelChange(page == "overview") }
  var selectedTaskId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var detailReturnPage by rememberSaveable(state.gatewayId) { mutableStateOf("overview") }
  var taskFilter by rememberSaveable(state.gatewayId) { mutableStateOf("all") }
  var editTitle by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editBody by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editProject by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editVersion by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf(0) }
  var editOriginalTitle by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editOriginalBody by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editOriginalProject by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editStartedRevision by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf(0) }
  var discardEditOpen by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf(false) }
  var selectedProjectId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var selectedAutomationId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var selectedRunId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var automationName by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var automationInstruction by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var automationCron by rememberSaveable(state.gatewayId) { mutableStateOf("0 9 * * *") }
  var automationCreateKey by rememberSaveable(state.gatewayId) { mutableStateOf(UUID.randomUUID().toString()) }
  var automationCreateStartedId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var automationEditName by rememberSaveable(state.gatewayId, selectedAutomationId) { mutableStateOf("") }
  var automationEditInstruction by rememberSaveable(state.gatewayId, selectedAutomationId) { mutableStateOf("") }
  var automationEditCron by rememberSaveable(state.gatewayId, selectedAutomationId) { mutableStateOf("") }
  var automationOriginalName by rememberSaveable(state.gatewayId, selectedAutomationId) { mutableStateOf("") }
  var automationOriginalInstruction by rememberSaveable(state.gatewayId, selectedAutomationId) { mutableStateOf("") }
  var automationOriginalCron by rememberSaveable(state.gatewayId, selectedAutomationId) { mutableStateOf("") }
  var automationEditKey by rememberSaveable(state.gatewayId, selectedAutomationId) {
    mutableStateOf(UUID.randomUUID().toString())
  }
  var automationEditStartedRevision by rememberSaveable(state.gatewayId, selectedAutomationId) { mutableStateOf(0) }
  var discardAutomationEditOpen by rememberSaveable(state.gatewayId, selectedAutomationId) { mutableStateOf(false) }
  var discardAutomationOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var createTitle by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var createBody by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var createProjectId by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var createStartedRevision by rememberSaveable(state.gatewayId) { mutableStateOf(0) }
  var discardCreateOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var requestedTaskId by remember(state.gatewayId) { mutableStateOf<String?>(null) }
  val editDirty = editTitle != editOriginalTitle || editBody != editOriginalBody ||
    editProject != editOriginalProject
  val automationEditDirty = automationEditName != automationOriginalName ||
    automationEditInstruction != automationOriginalInstruction || automationEditCron != automationOriginalCron
  fun goBack() {
    if (state.commandBusy || state.editBusy || state.createBusy || state.automations.createBusy ||
      state.automations.editBusy || state.automations.deleteBusy) return
    when (page) {
      "edit" -> if (editDirty) discardEditOpen = true else page = "detail"
      "create" -> if (createTitle.isNotBlank() || createBody.isNotBlank() ||
        createProjectId != selectedProjectId) discardCreateOpen = true else page = "project"
      "detail" -> page = detailReturnPage
      "project" -> page = "projects"
      "automation-run" -> page = "automation"
      "automation" -> page = "automations"
      "automation-edit" -> if (automationEditDirty) discardAutomationEditOpen = true else page = "automation"
      "automation-create" -> if (automationName.isNotBlank() || automationInstruction.isNotBlank() ||
        automationCron != "0 9 * * *") discardAutomationOpen = true else page = "automations"
      else -> page = "overview"
    }
  }
  BackHandler(enabled = page != "overview") {
    goBack()
  }
  LaunchedEffect(page, selectedTaskId, state.detailTaskId) {
    val id = selectedTaskId
    if ((page == "detail" || page == "edit") && id != null &&
      state.detailTaskId != id && requestedTaskId != id) {
      requestedTaskId = id
      onOpenTask(id)
    }
  }
  LaunchedEffect(page, selectedAutomationId, selectedRunId,
    state.automations.selectedId, state.automations.selectedRunId) {
    if ((page == "automation" || page == "automation-edit") && selectedAutomationId != null &&
      state.automations.selectedId != selectedAutomationId) onOpenAutomation(selectedAutomationId!!)
    if (page == "automation-run" && selectedRunId != null &&
      state.automations.selectedRunId != selectedRunId) onOpenAutomationRun(selectedRunId!!)
  }
  LaunchedEffect(page, selectedRunId, state.automations.selectedRunId,
    state.automations.run?.status, state.automations.runLoading, state.automations.runActionBusy) {
    val run = state.automations.run
    if (page == "automation-run" && selectedRunId == state.automations.selectedRunId &&
      run?.id == selectedRunId && run?.status in setOf("queued", "running", "cancelling") &&
      !state.automations.runLoading && !state.automations.runActionBusy) {
      kotlinx.coroutines.delay(4000)
      selectedRunId?.let(onOpenAutomationRun)
    }
  }
  LaunchedEffect(state.editSavedRevision) {
    if (page == "edit" && state.editSavedRevision > editStartedRevision) page = "detail"
  }
  LaunchedEffect(state.createSavedRevision) {
    if (page == "create" && state.createSavedRevision > createStartedRevision) {
      selectedProjectId = createProjectId.trim()
      page = "project"
    }
  }
  LaunchedEffect(page, state.automations.createdId) {
    if (page == "automation-create") state.automations.createdId?.takeIf {
      it != automationCreateStartedId
    }?.let { openId ->
      selectedAutomationId = openId
      page = "automation"
      onOpenAutomation(openId)
    }
  }
  LaunchedEffect(page, state.automations.editedRevision) {
    if (page == "automation-edit" &&
      state.automations.editedRevision > automationEditStartedRevision) {
      page = "automation"
      selectedAutomationId?.let(onOpenAutomation)
    }
  }
  LaunchedEffect(page, state.automations.deletedId) {
    if (page == "automation" && state.automations.deletedId == selectedAutomationId) {
      page = "automations"
    }
  }
  val selectedTask = state.detailTask.takeIf { state.detailTaskId == selectedTaskId }
  fun openTask(id: String) {
    detailReturnPage = page
    selectedTaskId = id
    page = "detail"
    requestedTaskId = id
    onOpenTask(id)
  }
  fun openProject(id: String) {
    selectedProjectId = id
    page = "project"
    onOpenProject(id)
  }
  fun openAutomation(id: String) {
    selectedAutomationId = id
    page = "automation"
    onOpenAutomation(id)
  }
  fun openRun(id: String) {
    selectedRunId = id
    page = "automation-run"
    onOpenAutomationRun(id)
  }
  LaunchedEffect(page, state.automations.rerunNavigationId) {
    if (page == "automation-run") state.automations.rerunNavigationId?.let(::openRun)
  }
  Column(modifier = Modifier.fillMaxSize().padding(insets).padding(horizontal = 20.dp, vertical = 12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text(when (page) {
        "tasks" -> stringResource(R.string.progress_tasks)
        "detail" -> stringResource(R.string.progress_task_detail)
        "edit" -> stringResource(R.string.progress_edit_task)
        "projects" -> stringResource(R.string.progress_projects)
        "project" -> state.project?.name ?: stringResource(R.string.progress_projects)
        "create" -> stringResource(R.string.progress_new_task)
        "automations" -> stringResource(R.string.progress_automations)
        "automation-create" -> stringResource(R.string.automation_new)
        "automation-edit" -> stringResource(R.string.automation_edit)
        "automation" -> state.automations.detail?.name ?: stringResource(R.string.progress_automations)
        "automation-run" -> state.automations.run?.automationName ?: stringResource(R.string.automation_run)
        else -> stringResource(R.string.tab_progress)
      }, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
      if (page == "overview") TextButton(onClick = { page = "tasks" },
        modifier = Modifier.testTag("progress-all-work")) { Text(stringResource(R.string.progress_all_work)) }
      else Row {
        if (page == "tasks") TextButton(onClick = onCreateTaskWithChat,
          enabled = !state.creatingTaskChat,
          modifier = Modifier.testTag("progress-create-task-chat")) {
          Text(stringResource(R.string.progress_new_task))
        }
        TextButton(onClick = ::goBack,
          enabled = !state.commandBusy && !state.editBusy && !state.createBusy &&
            !state.automations.createBusy && !state.automations.editBusy &&
            !state.automations.deleteBusy && !state.creatingTaskChat,
          modifier = Modifier.testTag("progress-back")) { Text(stringResource(R.string.progress_back)) }
      }
    }
    if (state.createTaskChatError && page == "tasks") Text(
      stringResource(R.string.progress_create_chat_error), color = MaterialTheme.colorScheme.error,
      modifier = Modifier.testTag("progress-create-task-error"))
    when (page) {
      "create" -> ProgressTaskCreate(createTitle, { createTitle = it }, createBody, { createBody = it },
        createProjectId, { createProjectId = it }, state.createBusy, state.createError) {
        onCreateTask(createTitle, createBody, createProjectId)
      }
      "projects" -> ProgressProjects(state, onLoadProjects, ::openProject)
      "project" -> when {
        state.projectId != selectedProjectId || state.projectLoading -> CircularProgressIndicator(
          modifier = Modifier.testTag("progress-project-loading"))
        state.projectError -> OutlinedButton(onClick = { selectedProjectId?.let(onOpenProject) },
          modifier = Modifier.testTag("progress-project-retry")) {
          Text(stringResource(R.string.progress_load_failed))
        }
        state.project != null -> ProgressProjectDetail(state.project, state.projectTasks,
          state.projectSessions, state.projectSessionsLoading, state.projectSessionsError,
          onCreate = {
            createTitle = ""
            createBody = ""
            createProjectId = selectedProjectId.orEmpty()
            createStartedRevision = state.createSavedRevision
            page = "create"
          }, onOpenTask = ::openTask, onOpenChat = onOpenChat,
          onCreateChat = { onCreateProjectChat(state.project.id) }, chatBusy = chatBusy,
          onRetrySessions = { selectedProjectId?.let(onOpenProject) })
      }
      "edit" -> ProgressTaskEditor(editTitle, { editTitle = it }, editBody, { editBody = it },
        editProject, { editProject = it }, editDirty, state.editBusy, state.editError) {
        selectedTaskId?.let { id -> onSaveTask(id, editVersion, editTitle, editBody, editProject) }
      }
      "detail" -> when {
        state.detailTaskId != selectedTaskId || state.detailLoading -> CircularProgressIndicator(
          modifier = Modifier.testTag("progress-detail-loading"))
        state.detailError -> OutlinedButton(onClick = { selectedTaskId?.let(onOpenTask) },
          modifier = Modifier.testTag("progress-detail-retry")) {
          Text(stringResource(R.string.progress_task_missing))
        }
        selectedTask != null -> ProgressTaskDetail(selectedTask, state.commandBusy,
          state.commandError, state.taskChatBusy, state.taskChatError,
          onTaskCommand, onStartTask, onOpenTaskChat) {
          editTitle = selectedTask.title
          editBody = selectedTask.body
          editProject = selectedTask.projectId ?: ""
          editVersion = selectedTask.version
          editOriginalTitle = selectedTask.title
          editOriginalBody = selectedTask.body
          editOriginalProject = selectedTask.projectId ?: ""
          editStartedRevision = state.editSavedRevision
          page = "edit"
        }
      }
      "tasks" -> ProgressTaskList(state, taskFilter, { taskFilter = it }, onRefreshTasks,
        onLoadMore, onSearchChange, onSubmitSearch) { task -> openTask(task.id) }
      "automations" -> AutomationListContent(state.automations, state.gatewayId, onLoadAutomations,
        ::openAutomation) {
        automationName = ""
        automationInstruction = ""
        automationCron = "0 9 * * *"
        automationCreateKey = UUID.randomUUID().toString()
        automationCreateStartedId = state.automations.createdId
        page = "automation-create"
      }
      "automation-create" -> AutomationCreateContent(automationName,
        { automationName = it; automationCreateKey = UUID.randomUUID().toString() },
        automationInstruction,
        { automationInstruction = it; automationCreateKey = UUID.randomUUID().toString() },
        automationCron, { automationCron = it; automationCreateKey = UUID.randomUUID().toString() },
        state.automations.createBusy, state.automations.createError) {
        onCreateAutomation(automationName, automationInstruction, automationCron, automationCreateKey)
      }
      "automation" -> AutomationDetailContent(state.automations,
        { selectedAutomationId?.let(onOpenAutomation) }, ::openRun,
        { action -> selectedAutomationId?.let { onAutomationAction(it, action) } },
        onEdit = {
          state.automations.detail?.takeIf { it.id == selectedAutomationId && it.canEditSchedule }?.let { item ->
            automationEditName = item.name
            automationEditInstruction = item.instruction
            automationEditCron = item.schedule
            automationOriginalName = item.name
            automationOriginalInstruction = item.instruction
            automationOriginalCron = item.schedule
            automationEditKey = UUID.randomUUID().toString()
            automationEditStartedRevision = state.automations.editedRevision
            page = "automation-edit"
          }
        }, onDelete = { key -> selectedAutomationId?.let { onDeleteAutomation(it, key) } })
      "automation-edit" -> state.automations.detail?.takeIf {
        it.id == selectedAutomationId && it.canEditSchedule
      }?.let { item ->
        AutomationEditContent(item, automationEditName,
          { automationEditName = it; automationEditKey = UUID.randomUUID().toString() },
          automationEditInstruction,
          { automationEditInstruction = it; automationEditKey = UUID.randomUUID().toString() },
          automationEditCron,
          { automationEditCron = it; automationEditKey = UUID.randomUUID().toString() },
          state.automations.editBusy, state.automations.editError) {
          onUpdateAutomation(item.id, automationEditName, automationEditInstruction,
            automationEditCron, automationEditKey)
        }
      }
      "automation-run" -> AutomationRunContent(state.automations,
        { selectedRunId?.let(onOpenAutomationRun) }, onOpenChat, ::openAutomation,
        { action -> selectedRunId?.let { onAutomationRunAction(it, action) } })
      else -> ProgressOverview(state, onRefreshHome, onOpenChat, { page = "tasks" },
        { page = "projects"; onLoadProjects() },
        { page = "automations"; onLoadAutomations() }, ::openAutomation, ::openTask,
        { pendingHomeAction = it }, bottomChromeHeight)
    }
  }
  if (discardAutomationOpen) AlertDialog(onDismissRequest = { discardAutomationOpen = false },
    title = { Text(stringResource(R.string.progress_discard_title)) },
    text = { Text(stringResource(R.string.automation_discard_message)) },
    confirmButton = { TextButton(onClick = {
      discardAutomationOpen = false
      page = "automations"
    }, modifier = Modifier.testTag("automation-discard-confirm")) {
      Text(stringResource(R.string.progress_discard))
    } }, dismissButton = { TextButton(onClick = { discardAutomationOpen = false }) {
      Text(stringResource(R.string.progress_cancel))
    } })
  if (discardAutomationEditOpen) AlertDialog(onDismissRequest = { discardAutomationEditOpen = false },
    title = { Text(stringResource(R.string.progress_discard_title)) },
    text = { Text(stringResource(R.string.automation_discard_edit_message)) },
    confirmButton = { TextButton(onClick = {
      discardAutomationEditOpen = false
      page = "automation"
      selectedAutomationId?.let(onOpenAutomation)
    }, modifier = Modifier.testTag("automation-edit-discard-confirm")) {
      Text(stringResource(R.string.progress_discard))
    } }, dismissButton = { TextButton(onClick = { discardAutomationEditOpen = false }) {
      Text(stringResource(R.string.progress_cancel))
    } })
  if (discardEditOpen) AlertDialog(onDismissRequest = { discardEditOpen = false },
    title = { Text(stringResource(R.string.progress_discard_title)) },
    text = { Text(stringResource(R.string.progress_discard_message)) },
    confirmButton = {
      TextButton(onClick = {
        discardEditOpen = false
        page = "detail"
        selectedTaskId?.let(onOpenTask)
      },
        modifier = Modifier.testTag("progress-discard-confirm")) {
        Text(stringResource(R.string.progress_discard))
      }
    }, dismissButton = {
      TextButton(onClick = { discardEditOpen = false }) { Text(stringResource(R.string.progress_cancel)) }
    })
  if (discardCreateOpen) AlertDialog(onDismissRequest = { discardCreateOpen = false },
    title = { Text(stringResource(R.string.progress_discard_title)) },
    text = { Text(stringResource(R.string.progress_discard_message)) },
    confirmButton = {
      TextButton(onClick = { discardCreateOpen = false; page = "project" },
        modifier = Modifier.testTag("progress-create-discard-confirm")) {
        Text(stringResource(R.string.progress_discard))
      }
    }, dismissButton = {
      TextButton(onClick = { discardCreateOpen = false }) { Text(stringResource(R.string.progress_cancel)) }
    })
  pendingHomeAction?.let { action ->
    AlertDialog(onDismissRequest = { pendingHomeAction = null },
      title = { Text(action.label) },
      text = { Text(stringResource(R.string.progress_home_action_confirm)) },
      confirmButton = {
        TextButton(onClick = { pendingHomeAction = null; onHomeAction(action) },
          modifier = Modifier.testTag("progress-home-action-confirm")) {
          Text(stringResource(R.string.progress_confirm))
        }
      }, dismissButton = {
        TextButton(onClick = { pendingHomeAction = null }) { Text(stringResource(R.string.progress_cancel)) }
      })
  }
}

@Composable
private fun ProgressOverview(state: ProgressUiState, onRefresh: () -> Unit,
  onOpenChat: (String) -> Unit, onOpenTaskList: () -> Unit, onOpenProjects: () -> Unit,
  onOpenAutomations: () -> Unit, onOpenAutomation: (String) -> Unit,
  onOpenTask: (String) -> Unit,
  onRequestAction: (ProgressHomeAction) -> Unit, bottomChromeHeight: Dp) {
  LazyColumn(modifier = Modifier.fillMaxSize().testTag("progress-overview-list"),
    verticalArrangement = Arrangement.spacedBy(12.dp),
    contentPadding = PaddingValues(bottom = bottomChromeHeight + 20.dp)) {
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(stringResource(R.string.progress_summary, state.needsUser.size, state.background.size),
            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
          Text(stringResource(R.string.progress_hint), style = MaterialTheme.typography.bodySmall)
        }
      }
    }
    item {
      Text(stringResource(R.string.progress_frequent_tools), style = MaterialTheme.typography.titleSmall)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ProgressShortcut(R.string.progress_tasks, onOpenTaskList, Modifier.weight(1f))
        ProgressShortcut(R.string.progress_projects, onOpenProjects,
          Modifier.weight(1f).testTag("progress-projects"))
      }
      ProgressShortcut(R.string.progress_automations, onOpenAutomations,
        Modifier.fillMaxWidth().padding(top = 8.dp).testTag("progress-automations"))
    }
    if (state.homeLoading && state.needsUser.isEmpty() && state.background.isEmpty()) item {
      CircularProgressIndicator(modifier = Modifier.testTag("progress-loading"))
    }
    if (state.homeError) item {
      OutlinedButton(onClick = onRefresh, modifier = Modifier.testTag("progress-retry")) {
        Text(stringResource(R.string.progress_load_failed))
      }
    }
    if (state.homeActionError) item {
      Text(stringResource(R.string.progress_home_action_error), color = MaterialTheme.colorScheme.error,
        modifier = Modifier.testTag("progress-home-action-error"))
    }
    if (state.needsUser.isNotEmpty()) {
      item { ProgressSectionTitle(R.string.progress_needs_you) }
      items(state.needsUser, key = { "needs-${it.id}" }) { item ->
        ProgressHomeRow(item, state.homeActionBusy, onOpenChat, onOpenTask, onRequestAction)
      }
    }
    if (state.background.isNotEmpty()) {
      item { ProgressSectionTitle(R.string.progress_ongoing) }
      items(state.background.take(5), key = { "ongoing-${it.id}" }) { item ->
        ProgressHomeRow(item, state.homeActionBusy, onOpenChat, onOpenTask, onRequestAction)
      }
    }
    state.automationMetrics?.nextRun?.let { next ->
      item { ProgressSectionTitle(R.string.progress_upcoming) }
      item {
        Card(onClick = { onOpenAutomation(next.automationId) },
          modifier = Modifier.fillMaxWidth().testTag("progress-upcoming-${next.automationId}")) {
          Column(modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(next.name, style = MaterialTheme.typography.titleMedium)
            Text(DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
              .format(Date(next.runAtMs)), style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
    val closed = state.recentClosedTasks
    if (closed.isNotEmpty()) {
      item { ProgressSectionTitle(R.string.progress_recent_closed) }
      items(closed, key = { "closed-${it.id}" }) { task ->
        Card(onClick = { onOpenTask(task.id) }, modifier = Modifier.fillMaxWidth().testTag("progress-closed-${task.id}")) {
          Column(modifier = Modifier.padding(16.dp)) {
            Text(task.title, style = MaterialTheme.typography.titleMedium)
            Text(task.resolution ?: task.phase, style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
    if (state.tasksError) item {
      Text(stringResource(R.string.progress_tasks_error), color = MaterialTheme.colorScheme.error)
    }
  }
}

@Composable
private fun ProgressShortcut(label: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
  Card(onClick = onClick, modifier = modifier.heightIn(min = 64.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp),
      horizontalArrangement = Arrangement.SpaceBetween) {
      Text(stringResource(label), style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Medium)
      Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun ProgressProjects(state: ProgressUiState, onRefresh: () -> Unit,
  onOpenProject: (String) -> Unit) {
  var search by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var filter by rememberSaveable(state.gatewayId) { mutableStateOf("all") }
  val matching = state.projects.filter { it.name.contains(search.trim(), ignoreCase = true) }
  val shown = matching.filter { project -> when (filter) {
    "active" -> project.status != "archived"
    "archived" -> project.status == "archived"
    else -> true
  } }
  Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedTextField(value = search, onValueChange = { search = it },
        modifier = Modifier.weight(1f).testTag("progress-project-search"),
        placeholder = { Text(stringResource(R.string.progress_search_projects)) }, singleLine = true)
      TextButton(onClick = onRefresh, enabled = !state.projectsLoading,
        modifier = Modifier.testTag("progress-project-refresh")) { Text(stringResource(R.string.progress_refresh)) }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      FilterChip(selected = filter == "all", onClick = { filter = "all" },
        modifier = Modifier.testTag("progress-project-filter-all"),
        label = { Text("${stringResource(R.string.progress_filter_all)} ${matching.size}") })
      FilterChip(selected = filter == "active", onClick = { filter = "active" },
        modifier = Modifier.testTag("progress-project-filter-active"),
        label = { Text("${stringResource(R.string.progress_project_filter_active)} ${matching.count { it.status != "archived" }}") })
      FilterChip(selected = filter == "archived", onClick = { filter = "archived" },
        modifier = Modifier.testTag("progress-project-filter-archived"),
        label = { Text("${stringResource(R.string.progress_project_filter_archived)} ${matching.count { it.status == "archived" }}") })
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
      if (state.projectsLoading && state.projects.isEmpty()) item {
        CircularProgressIndicator(modifier = Modifier.testTag("progress-projects-loading"))
      }
      if (state.projectsError) item {
        Text(stringResource(R.string.progress_load_failed), color = MaterialTheme.colorScheme.error)
      }
      if (!state.projectsLoading && !state.projectsError && shown.isEmpty()) item {
        Text(stringResource(R.string.progress_no_projects))
      }
      items(shown, key = { it.id }) { project ->
        Card(onClick = { onOpenProject(project.id) },
          modifier = Modifier.fillMaxWidth().testTag("progress-project-${project.id}")) {
          Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(project.name, style = MaterialTheme.typography.titleMedium)
            Text(projectStatusLabel(project.status), modifier = Modifier.testTag("progress-project-status-${project.id}"),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
            val summary = project.brief.ifBlank { project.description }
            if (summary.isNotBlank()) Text(summary, maxLines = 2, overflow = TextOverflow.Ellipsis)
          }
        }
      }
    }
  }
}

@Composable
private fun ProgressProjectDetail(project: ProgressProject, tasks: List<ProgressTask>,
  sessions: List<ProgressProjectSession>, sessionsLoading: Boolean, sessionsError: Boolean,
  onCreate: () -> Unit, onOpenTask: (String) -> Unit, onOpenChat: (String) -> Unit,
  onCreateChat: () -> Unit, chatBusy: Boolean,
  onRetrySessions: () -> Unit) {
  var section by rememberSaveable(project.id) { mutableStateOf("overview") }
  LazyColumn(modifier = Modifier.fillMaxSize().testTag("progress-project-detail"),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    item {
      Card {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(project.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
          Text(projectStatusLabel(project.status), modifier = Modifier.testTag("progress-project-detail-status"),
            color = MaterialTheme.colorScheme.onSurfaceVariant)
          Text(project.brief.ifBlank { project.description }.ifBlank {
            stringResource(R.string.progress_project_no_description)
          })
        }
      }
    }
    item {
      Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = section == "overview", onClick = { section = "overview" },
          modifier = Modifier.testTag("progress-project-tab-overview"),
          label = { Text(stringResource(R.string.progress_project_overview)) })
        FilterChip(selected = section == "sessions", onClick = { section = "sessions" },
          modifier = Modifier.testTag("progress-project-tab-sessions"),
          label = { Text("${stringResource(R.string.tab_conversations)} ${sessions.size}") })
        FilterChip(selected = section == "tasks", onClick = { section = "tasks" },
          modifier = Modifier.testTag("progress-project-tab-tasks"),
          label = { Text("${stringResource(R.string.progress_tasks)} ${tasks.size}") })
      }
    }
    if (section == "overview" || section == "sessions") {
      item {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          ProgressSectionTitle(R.string.tab_conversations)
          TextButton(onClick = onCreateChat, enabled = !chatBusy,
            modifier = Modifier.testTag("progress-project-new-chat")) {
            Text(stringResource(R.string.assistant_new_conversation))
          }
        }
      }
      if (sessionsLoading) item { CircularProgressIndicator(modifier = Modifier.testTag("progress-project-sessions-loading")) }
      else if (sessionsError) item {
        OutlinedButton(onClick = onRetrySessions, modifier = Modifier.testTag("progress-project-sessions-retry")) {
          Text(stringResource(R.string.progress_project_sessions_error))
        }
      }
      else if (sessions.isEmpty()) item { Text(stringResource(R.string.progress_project_no_sessions)) }
      items(if (section == "overview") sessions.take(3) else sessions, key = { "session-${it.id}" }) { session ->
        Card(onClick = { onOpenChat(session.id) },
          modifier = Modifier.fillMaxWidth().testTag("progress-project-session-${session.id}")) {
          Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(if (session.isLocalDraft) stringResource(R.string.assistant_new_conversation) else session.title,
              style = MaterialTheme.typography.titleMedium,
              maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(stringResource(R.string.progress_project_session_messages, session.messageCount),
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
    if (section == "overview" || section == "tasks") {
    item {
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        ProgressSectionTitle(R.string.progress_tasks)
        TextButton(onClick = onCreate, modifier = Modifier.testTag("progress-project-add-task")) {
          Text(stringResource(R.string.progress_new_task))
        }
      }
    }
    if (tasks.isEmpty()) item { Text(stringResource(R.string.progress_project_no_tasks)) }
    items(if (section == "overview") tasks.take(3) else tasks, key = { "task-${it.id}" }) { task ->
      Card(onClick = { onOpenTask(task.id) },
        modifier = Modifier.fillMaxWidth().testTag("progress-project-task-${task.id}")) {
        Column(modifier = Modifier.padding(16.dp)) {
          Text(task.title, style = MaterialTheme.typography.titleMedium)
          Text(progressPhaseLabel(task.phase), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
    }
  }
}

@Composable
private fun ProgressTaskCreate(title: String, onTitleChange: (String) -> Unit,
  body: String, onBodyChange: (String) -> Unit, projectId: String,
  onProjectChange: (String) -> Unit, busy: Boolean, error: Boolean, onSave: () -> Unit) {
  val valid = title.trim().isNotEmpty() && title.trim().length <= 500 && body.length <= 50_000 &&
    projectId.trim().matches(Regex("[A-Za-z0-9_-]{1,128}"))
  Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
    .testTag("progress-task-create"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    OutlinedTextField(value = title, onValueChange = onTitleChange,
      modifier = Modifier.fillMaxWidth().testTag("progress-create-title"),
      label = { Text(stringResource(R.string.progress_task_name)) }, singleLine = true, enabled = !busy)
    OutlinedTextField(value = body, onValueChange = onBodyChange,
      modifier = Modifier.fillMaxWidth().testTag("progress-create-body"),
      label = { Text(stringResource(R.string.progress_description)) }, minLines = 6, enabled = !busy)
    OutlinedTextField(value = projectId, onValueChange = onProjectChange,
      modifier = Modifier.fillMaxWidth().testTag("progress-create-project"),
      label = { Text(stringResource(R.string.progress_task_project_label)) }, singleLine = true, enabled = !busy)
    if (error) Text(stringResource(R.string.progress_create_error), color = MaterialTheme.colorScheme.error,
      modifier = Modifier.testTag("progress-create-error"))
    Button(onClick = onSave, enabled = valid && !busy,
      modifier = Modifier.fillMaxWidth().testTag("progress-create-save")) {
      Text(stringResource(R.string.progress_save))
    }
    if (busy) CircularProgressIndicator(modifier = Modifier.testTag("progress-create-busy"))
  }
}

@Composable
private fun ProgressHomeRow(item: ProgressItem,
  actionBusy: Boolean, onOpenChat: (String) -> Unit, onOpenTask: (String) -> Unit,
  onRequestAction: (ProgressHomeAction) -> Unit) {
  var reviewExpanded by rememberSaveable(item.id) { mutableStateOf(false) }
  val destination = item.openAction?.href?.let(::progressDestination)
  val canOpen = destination != null
  Card(onClick = {
    if (destination?.first == "chat") onOpenChat(destination.second)
    else if (destination?.first == "tasks") onOpenTask(destination.second)
  }, enabled = canOpen, modifier = Modifier.fillMaxWidth().testTag("progress-item-${item.id}")) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(item.title, style = MaterialTheme.typography.titleMedium)
      Text(listOfNotNull(item.statusLabel, item.summary).joinToString(" · "),
        style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
      item.recommendation?.let {
        Text(it, style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
      if (!item.reviewDetail.isNullOrBlank() && item.reviewDetail != item.summary) {
        TextButton(onClick = { reviewExpanded = !reviewExpanded },
          modifier = Modifier.testTag("progress-review-${item.id}")) {
          Text(stringResource(if (reviewExpanded) R.string.progress_hide_review else R.string.progress_show_review))
        }
        if (reviewExpanded) Text(item.reviewDetail, style = MaterialTheme.typography.bodyMedium,
          modifier = Modifier.testTag("progress-review-detail-${item.id}"))
      }
      item.primaryAction?.let { action ->
        Button(onClick = { onRequestAction(action) }, enabled = !actionBusy,
          modifier = Modifier.fillMaxWidth().testTag("progress-home-primary-${item.id}")) { Text(action.label) }
      }
      item.secondaryActions.forEachIndexed { index, action ->
        TextButton(onClick = { onRequestAction(action) }, enabled = !actionBusy,
          modifier = Modifier.fillMaxWidth().testTag("progress-home-secondary-${item.id}-$index")) {
          Text(action.label)
        }
      }
    }
  }
}

@Composable
private fun ProgressTaskList(state: ProgressUiState, filter: String, onFilterChange: (String) -> Unit,
  onRefresh: () -> Unit,
  onLoadMore: () -> Unit, onSearchChange: (String) -> Unit, onSubmitSearch: () -> Unit,
  onOpenTask: (ProgressTask) -> Unit) {
  val shown = state.tasks.filter { task -> when (filter) {
    "open" -> task.phase != "closed"
    "closed" -> task.phase == "closed"
    else -> true
  } }
  Column(modifier = Modifier.fillMaxSize()) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedTextField(value = state.taskSearchText, onValueChange = onSearchChange,
        modifier = Modifier.weight(1f).testTag("progress-task-search"),
        placeholder = { Text(stringResource(R.string.progress_search)) }, singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSubmitSearch() }))
      TextButton(onClick = onSubmitSearch, enabled = !state.loading,
        modifier = Modifier.testTag("progress-task-refresh")) { Text(stringResource(R.string.progress_refresh)) }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      FilterChip(selected = filter == "all", onClick = { onFilterChange("all") },
        modifier = Modifier.testTag("progress-filter-all"),
        label = { Text(stringResource(R.string.progress_filter_all)) })
      FilterChip(selected = filter == "open", onClick = { onFilterChange("open") },
        modifier = Modifier.testTag("progress-filter-open"),
        label = { Text(stringResource(R.string.progress_filter_open)) })
      FilterChip(selected = filter == "closed", onClick = { onFilterChange("closed") },
        modifier = Modifier.testTag("progress-filter-closed"),
        label = { Text(stringResource(R.string.progress_filter_closed)) })
    }
    LazyColumn(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp),
    contentPadding = PaddingValues(bottom = 20.dp)) {
    item { Text(stringResource(R.string.progress_loaded_count, state.tasks.size),
      style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    if (state.tasksError) item {
      OutlinedButton(onClick = onRefresh) { Text(stringResource(R.string.progress_load_failed)) }
    }
    if (state.loading && state.tasks.isEmpty()) item { CircularProgressIndicator() }
    if (!state.loading && !state.tasksError && shown.isEmpty()) item {
      Text(stringResource(if (state.tasks.isEmpty()) R.string.progress_no_tasks else R.string.progress_no_matches))
    }
    items(shown, key = { it.id }) { task ->
      Card(onClick = { onOpenTask(task) }, modifier = Modifier.fillMaxWidth().testTag("progress-task-${task.id}")) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(task.title, style = MaterialTheme.typography.titleMedium, maxLines = 2,
            overflow = TextOverflow.Ellipsis)
          Text(progressPhaseLabel(task.phase), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
          if (task.body.isNotBlank()) Text(task.body, style = MaterialTheme.typography.bodyMedium,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
      }
    }
    if (state.tasks.size < state.taskTotal) item {
      OutlinedButton(onClick = onLoadMore, enabled = !state.loadingMore,
        modifier = Modifier.fillMaxWidth().testTag("progress-load-more")) {
        Text(stringResource(if (state.loadingMore) R.string.progress_loading_more else R.string.progress_load_more))
      }
      if (state.moreError) Text(stringResource(R.string.progress_more_error), color = MaterialTheme.colorScheme.error)
    }
  }
  }
}

@Composable
private fun ProgressTaskDetail(task: ProgressTask, busy: Boolean, commandError: Boolean,
  taskChatBusy: Boolean, taskChatError: Boolean,
  onCommand: (String) -> Unit, onStart: (String) -> Unit,
  onOpenTaskChat: (String) -> Unit, onEdit: () -> Unit) {
  var confirmClose by rememberSaveable(task.id) { mutableStateOf(false) }
  var agentId by rememberSaveable(task.id) { mutableStateOf("") }
  var confirmStart by rememberSaveable(task.id) { mutableStateOf(false) }
  Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).testTag("progress-task-detail"),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
      Column(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(task.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(progressPhaseLabel(task.phase), color = MaterialTheme.colorScheme.onSurfaceVariant)
        task.projectId?.let { Text(stringResource(R.string.progress_task_project, it)) }
      }
    }
    ProgressSectionTitle(R.string.progress_description)
    Card {
      Text(task.body.ifBlank { stringResource(R.string.progress_no_description) },
        modifier = Modifier.fillMaxWidth().padding(16.dp), style = MaterialTheme.typography.bodyMedium)
    }
    ProgressSectionTitle(R.string.progress_details)
    Card {
      Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        task.priority?.let { Text(stringResource(R.string.progress_task_priority, it)) }
        Text(stringResource(R.string.progress_task_updated,
          DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(task.updatedAt))))
        task.resolution?.let { Text(stringResource(R.string.progress_task_resolution, it)) }
      }
    }
    if (task.version > 0) OutlinedButton(onClick = onEdit, enabled = !busy,
      modifier = Modifier.fillMaxWidth().testTag("progress-task-edit")) {
      Text(stringResource(R.string.progress_edit_task))
    }
    Button(onClick = { onOpenTaskChat(task.id) }, enabled = !taskChatBusy && !busy,
      modifier = Modifier.fillMaxWidth().testTag("progress-task-chat")) {
      Text(stringResource(R.string.progress_task_chat))
    }
    if (taskChatError) Text(stringResource(R.string.progress_task_chat_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("progress-task-chat-error"))
    if (commandError) Text(stringResource(R.string.progress_command_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("progress-command-error"))
    if (busy) CircularProgressIndicator(modifier = Modifier.testTag("progress-command-busy"))
    if ("start" in task.allowedCommands) OutlinedTextField(value = agentId,
      onValueChange = { agentId = it }, modifier = Modifier.fillMaxWidth().testTag("progress-start-agent"),
      label = { Text(stringResource(R.string.progress_agent_id)) }, singleLine = true, enabled = !busy)
    task.allowedCommands.filter { it in setOf("mark_ready", "request_review", "close", "reopen", "start") }
      .forEach { action ->
        Button(onClick = { when (action) {
          "close" -> confirmClose = true
          "start" -> confirmStart = true
          else -> onCommand(action)
        } }, enabled = !busy && (action != "start" || agentId.trim().isNotEmpty() && agentId.trim().length <= 128),
          modifier = Modifier.fillMaxWidth().testTag("progress-command-$action")) {
          Text(stringResource(when (action) {
            "mark_ready" -> R.string.progress_command_mark_ready
            "request_review" -> R.string.progress_command_request_review
            "close" -> R.string.progress_command_close
            "reopen" -> R.string.progress_command_reopen
            else -> R.string.progress_command_start
          }))
        }
      }
  }
  if (confirmClose) AlertDialog(onDismissRequest = { confirmClose = false },
    title = { Text(stringResource(R.string.progress_command_close)) },
    text = { Text(stringResource(R.string.progress_command_confirm)) },
    confirmButton = {
      TextButton(onClick = { confirmClose = false; onCommand("close") },
        modifier = Modifier.testTag("progress-command-confirm")) {
        Text(stringResource(R.string.progress_confirm))
      }
    }, dismissButton = {
      TextButton(onClick = { confirmClose = false }) { Text(stringResource(R.string.progress_cancel)) }
    })
  if (confirmStart && "start" in task.allowedCommands && !busy) AlertDialog(
    onDismissRequest = { confirmStart = false },
    title = { Text(stringResource(R.string.progress_command_start)) },
    text = { Text(stringResource(R.string.progress_start_confirm, agentId.trim())) },
    confirmButton = {
      TextButton(onClick = {
        confirmStart = false
        val selected = agentId.trim()
        if (selected.isNotEmpty() && selected.length <= 128) onStart(selected)
      }, modifier = Modifier.testTag("progress-start-confirm")) {
        Text(stringResource(R.string.progress_confirm))
      }
    }, dismissButton = {
      TextButton(onClick = { confirmStart = false }) { Text(stringResource(R.string.progress_cancel)) }
    })
}

@Composable
private fun ProgressTaskEditor(title: String, onTitleChange: (String) -> Unit,
  body: String, onBodyChange: (String) -> Unit,
  projectId: String, onProjectChange: (String) -> Unit,
  dirty: Boolean, busy: Boolean, error: Boolean, onSave: () -> Unit) {
  val valid = title.trim().isNotEmpty() && title.trim().length <= 500 && body.length <= 50_000 &&
    projectId.trim().length <= 512
  Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).testTag("progress-task-editor"),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    OutlinedTextField(value = title, onValueChange = onTitleChange,
      modifier = Modifier.fillMaxWidth().testTag("progress-edit-title"),
      label = { Text(stringResource(R.string.progress_task_name)) }, singleLine = true,
      enabled = !busy)
    OutlinedTextField(value = body, onValueChange = onBodyChange,
      modifier = Modifier.fillMaxWidth().testTag("progress-edit-body"),
      label = { Text(stringResource(R.string.progress_description)) }, minLines = 6,
      enabled = !busy)
    OutlinedTextField(value = projectId, onValueChange = onProjectChange,
      modifier = Modifier.fillMaxWidth().testTag("progress-edit-project"),
      label = { Text(stringResource(R.string.progress_task_project_label)) }, singleLine = true,
      enabled = !busy)
    if (error) Text(stringResource(R.string.progress_edit_error), color = MaterialTheme.colorScheme.error,
      modifier = Modifier.testTag("progress-edit-error"))
    Button(onClick = onSave, enabled = valid && dirty && !busy,
      modifier = Modifier.fillMaxWidth().testTag("progress-edit-save")) {
      Text(stringResource(R.string.progress_save))
    }
    if (busy) CircularProgressIndicator(modifier = Modifier.testTag("progress-edit-busy"))
  }
}

@Composable
private fun projectStatusLabel(status: String): String {
  val label = when (status) {
    "active" -> R.string.progress_project_status_active
    "planned" -> R.string.progress_project_status_planned
    "paused" -> R.string.progress_project_status_paused
    "completed" -> R.string.progress_project_status_completed
    "cancelled" -> R.string.progress_project_status_cancelled
    "archived" -> R.string.progress_project_status_archived
    else -> return status
  }
  return stringResource(label)
}

@Composable
private fun progressPhaseLabel(phase: String): String = stringResource(when (phase) {
  "backlog" -> R.string.progress_phase_backlog
  "ready" -> R.string.progress_phase_ready
  "active" -> R.string.progress_phase_active
  "review" -> R.string.progress_phase_review
  else -> R.string.progress_phase_closed
})

@Composable
private fun ProgressSectionTitle(label: Int) {
  Text(stringResource(label), style = MaterialTheme.typography.titleSmall,
    fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
}
