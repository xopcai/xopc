package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.gateway.ProgressTaskEdit

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.AutomationSummary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.material3.ExperimentalMaterial3Api
import ai.xopc.mobile.gateway.ProjectMutation
import ai.xopc.mobile.gateway.ProgressItem
import ai.xopc.mobile.gateway.ProgressHomeAction
import ai.xopc.mobile.gateway.ProgressTask
import ai.xopc.mobile.gateway.ProgressProject
import ai.xopc.mobile.gateway.ProgressProjectSession
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerDefaults
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.layout.size
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import java.text.DateFormat
import java.util.Date
import java.util.UUID

private val PROGRESS_DESTINATION_REGEX = Regex("^/(chat|tasks|automations)/([A-Za-z0-9_-]{1,128})$")

/** Only known internal destinations may be opened from a Gateway-supplied home item. */
internal fun progressDestination(href: String): Pair<String, String>? {
  val match = PROGRESS_DESTINATION_REGEX.matchEntire(href) ?: return null
  return match.groupValues[1] to match.groupValues[2]
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProgressScreen(state: ProgressUiState, insets: PaddingValues,
  onRefreshHome: () -> Unit, onRefreshTasks: () -> Unit, onLoadMore: () -> Unit,
  onOpenTask: (String) -> Unit, onSearchChange: (String) -> Unit, onSubmitSearch: () -> Unit,
  onTaskCommand: (String) -> Unit,
  onStartTask: (String) -> Unit,
  onCreateTaskWithChat: () -> Unit,
  onLoadProjects: () -> Unit,
  onOpenProject: (String) -> Unit,
  onCreateTask: (ProgressTaskEdit) -> Unit,
  onOpenTaskChat: (String) -> Unit,
  onSaveTask: (String, Int, ProgressTaskEdit) -> Unit,
  onOpenChat: (String) -> Unit,
  onOpenProjectChat: (ProgressProjectSession) -> Unit = { onOpenChat(it.id) },
  onOpenNote: (String) -> Unit = {},
  onCreateProjectChat: (String) -> Unit = {},
  onHomeAction: (ProgressHomeAction) -> Unit = {},
  onLoadAutomations: () -> Unit = {},
  onOpenAutomation: (String) -> Unit = {},
  onOpenAutomationRun: (String) -> Unit = {},
  onAutomationAction: (String, String) -> Unit = { _, _ -> },
  onArrangeAutomation: (String?, String) -> Unit = { _, _ -> },
  onWriteProject: suspend (ProjectMutation) -> ProgressProject = { error("UNAVAILABLE") },
  onCreateProjectNote: (String) -> Unit = {},
  onUpdateAutomation: (String, String, String, String, String) -> Unit = { _, _, _, _, _ -> },
  onDeleteAutomation: (String, String) -> Unit = { _, _ -> },
  onAutomationRunAction: (String, String) -> Unit = { _, _ -> },
  initialPage: String = "overview",
  initialItemId: String? = null,
  onExit: (() -> Unit)? = null,
  chatBusy: Boolean = false,
  initialDeliveryKind: String? = null,
  initialDeliveryId: String? = null,
  onCloseDelivery: () -> Unit = {},
  onOpenLibrary: (() -> Unit)? = null,
  onOpenSidebar: (() -> Unit)? = null,
  bottomChromeInset: Dp = 0.dp,
  scrollToTopRevision: Int = 0,
  onNavigateRoute: ((MobileRoute) -> Unit)? = null,
  sidebarGesture: Modifier = Modifier,
  ) {
  var pendingHomeAction by remember(state.gatewayId) { mutableStateOf<ProgressHomeAction?>(null) }
  val navigation = rememberNavigationPreferences()
  var page by rememberSaveable(state.gatewayId, initialPage) {
    mutableStateOf(when (initialDeliveryKind) {
      "task" -> "detail"
      "automation" -> "automation-run"
      else -> initialPage
    })
  }
  var selectedTaskId by rememberSaveable(state.gatewayId) {
    mutableStateOf(initialDeliveryId.takeIf { initialDeliveryKind == "task" } ?: initialItemId.takeIf { initialPage == "detail" })
  }
  var detailReturnPage by rememberSaveable(state.gatewayId) {
    mutableStateOf(if (initialDeliveryKind == "task") "delivery" else "overview")
  }
  var taskSearchOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var projectSearchOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var automationSearchOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var automationFilter by rememberSaveable(state.gatewayId) {
    mutableStateOf(navigation.selection("automation-filter", listOf("all", "enabled", "paused", "attention"), "all"))
  }
  var pendingAutomationEditId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  val focusManager = LocalFocusManager.current
  val keyboardController = LocalSoftwareKeyboardController.current
  fun closeTaskSearch() {
    if (state.taskSearchText.isNotEmpty()) { onSearchChange(""); onSubmitSearch() }
    taskSearchOpen = false
    focusManager.clearFocus(force = true)
    keyboardController?.hide()
  }
  LaunchedEffect(page, state.taskSearchText, state.taskSearch) {
    if (page == "tasks" && state.taskSearchText.trim() != state.taskSearch) {
      kotlinx.coroutines.delay(250)
      onSubmitSearch()
    }
  }
  var taskFilter by rememberSaveable(state.gatewayId) { mutableStateOf("all") }
  var editTitle by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editBody by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editProject by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editPriority by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("normal") }
  var editDueAt by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf<Long?>(null) }
  var editOriginalPriority by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("normal") }
  var editOriginalDueAt by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf<Long?>(null) }
  var editVersion by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf(0) }
  var editOriginalTitle by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editOriginalBody by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editOriginalProject by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf("") }
  var editStartedRevision by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf(0) }
  var discardEditOpen by rememberSaveable(state.gatewayId, selectedTaskId) { mutableStateOf(false) }
  var selectedProjectId by rememberSaveable(state.gatewayId) { mutableStateOf(initialItemId.takeIf { initialPage == "project" }) }
  var projectMenuOpen by rememberSaveable(state.gatewayId, selectedProjectId) { mutableStateOf(false) }
  val projectKey = selectedProjectId?.let { "project.$it" }
  val projectSections = listOf(
    SegmentOption("overview", stringResource(R.string.progress_project_overview), "progress-project-tab-overview"),
    SegmentOption("sessions", stringResource(R.string.tab_conversations), "progress-project-tab-sessions"),
    SegmentOption("tasks", stringResource(R.string.progress_tasks), "progress-project-tab-tasks"),
    SegmentOption("notes", stringResource(R.string.tab_notes), "progress-project-tab-notes"),
    SegmentOption("automations", stringResource(R.string.progress_automations), "progress-project-tab-automations"),
  )
  var projectSection by rememberSaveable(state.gatewayId, selectedProjectId) {
    mutableStateOf(projectKey?.let { navigation.selection(it, projectSections.map { option -> option.value },
      "overview") } ?: "overview")
  }
  val projectPager = androidx.compose.runtime.key(state.gatewayId, selectedProjectId) {
    rememberPagerState(initialPage = projectSections.indexOfFirst { it.value == projectSection }.coerceAtLeast(0)) {
      projectSections.size
    }
  }
  val projectPagerScope = rememberCoroutineScope()
  LaunchedEffect(projectPager, projectKey) {
    snapshotFlow { projectPager.settledPage }.collect { index ->
      projectSection = projectSections[index].value
      if (projectKey != null) navigation.rememberSelection(projectKey, projectSection)
    }
  }
  var projectEditorMode by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var projectWriteBusy by remember(state.gatewayId) { mutableStateOf(false) }
  var projectWriteError by remember(state.gatewayId) { mutableStateOf(false) }
  val projectWriteScope = rememberCoroutineScope()
  var selectedAutomationId by rememberSaveable(state.gatewayId) { mutableStateOf(initialItemId.takeIf { initialPage == "automation" }) }
  var automationReturnPage by rememberSaveable(state.gatewayId) { mutableStateOf("automations") }
  var selectedRunId by rememberSaveable(state.gatewayId) {
    mutableStateOf(initialDeliveryId.takeIf { initialDeliveryKind == "automation" }
      ?: initialItemId.takeIf { initialPage == "automation-run" })
  }
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
  var createTitle by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var createBody by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var createProjectId by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var createPriority by rememberSaveable(state.gatewayId) { mutableStateOf("normal") }
  var createDueAt by rememberSaveable(state.gatewayId) { mutableStateOf<Long?>(null) }
  var createSourceProjectId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var createStartedRevision by rememberSaveable(state.gatewayId) { mutableStateOf(0) }
  var discardCreateOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var requestedTaskId by remember(state.gatewayId) { mutableStateOf<String?>(null) }
  val editDirty = editTitle != editOriginalTitle || editBody != editOriginalBody ||
    editProject != editOriginalProject || editPriority != editOriginalPriority || editDueAt != editOriginalDueAt
  val automationEditDirty = automationEditName != automationOriginalName ||
    automationEditInstruction != automationOriginalInstruction || automationEditCron != automationOriginalCron
  var runReturnPage by rememberSaveable(state.gatewayId) {
    mutableStateOf(if (initialDeliveryKind == "automation") "delivery" else "automation")
  }
  val workPages = listOf(
    SegmentOption("overview", stringResource(R.string.tab_progress), "work-page-progress"),
    SegmentOption("tasks", stringResource(R.string.progress_tasks), "work-page-tasks"),
    SegmentOption("projects", stringResource(R.string.progress_projects), "work-page-projects"),
  )
  val workPageIndex = workPages.indexOfFirst { it.value == page }
  val workPager = rememberPagerState(initialPage = workPageIndex.coerceAtLeast(0)) { workPages.size }
  val workPageStates = rememberSaveableStateHolder()
  val workScope = rememberCoroutineScope()
  fun returnToPage(target: String) {
    val index = workPages.indexOfFirst { it.value == target }
    if (index >= 0 && (index != workPager.settledPage || workPager.isScrollInProgress)) {
      workPager.requestScrollToPage(index)
    }
    page = target
  }
  val selectWorkPage by rememberUpdatedState<(Int) -> Unit>({ index ->
    val target = workPages[index].value
    if (index == workPager.settledPage && workPages.any { it.value == page } && page != target) {
      focusManager.clearFocus(force = true)
      keyboardController?.hide()
      page = target
      when (target) {
        "overview" -> onRefreshHome()
        "projects" -> onLoadProjects()
      }
    }
  })
  fun scrollToWorkPage(target: String) {
    val index = workPages.indexOfFirst { it.value == target }
    if (index < 0 || index == workPager.settledPage) return
    workScope.launch {
      if (kotlin.math.abs(index - workPager.currentPage) == 1) workPager.animateScrollToPage(index)
      else workPager.scrollToPage(index)
    }
  }
  LaunchedEffect(workPager) {
    snapshotFlow { workPager.settledPage }.collect { selectWorkPage(it) }
  }
  LaunchedEffect(scrollToTopRevision) {
    if (scrollToTopRevision > 0 && workPageIndex >= 0) {
      if (workPager.currentPage != 0) {
        workPager.animateScrollToPage(0)
      }
      page = "overview"
      onRefreshHome()
    }
  }
  LaunchedEffect(page, state.gatewayId) {
    if (page == "tasks") onRefreshTasks()
  }
  var automationListReturnPage by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  fun openAutomationsFromOverview() {
    if (onNavigateRoute != null && workPageIndex >= 0) {
      onLoadAutomations()
      onNavigateRoute(MobileRoute.Automations)
      return
    }
    automationListReturnPage = "overview"
    page = "automations"
    onLoadAutomations()
  }
  fun goBack() {
    if (projectWriteBusy || state.commandBusy || state.editBusy || state.createBusy ||
      state.automations.editBusy || state.automations.deleteBusy) return
    when (page) {
      "edit" -> if (editDirty) discardEditOpen = true else page = "detail"
      "create" -> if (createTitle.isNotBlank() || createBody.isNotBlank() ||
        createProjectId != createSourceProjectId.orEmpty() || createPriority != "normal" || createDueAt != null) discardCreateOpen = true
        else returnToPage(if (createSourceProjectId == null) "tasks" else "project")
      "detail" -> when {
        detailReturnPage == "delivery" -> onCloseDelivery()
        initialPage == "detail" && selectedTaskId == initialItemId -> onExit?.invoke()
        else -> returnToPage(detailReturnPage)
      }
      "project" -> if (initialPage == "project" && selectedProjectId == initialItemId) onExit?.invoke() else returnToPage("projects")
      "automations" -> {
        val parent = automationListReturnPage
        if (parent != null) {
          automationListReturnPage = null
          returnToPage(parent)
        } else if (onExit != null) onExit()
        else returnToPage("overview")
      }
      "overview", "tasks", "projects" -> {
        if (onExit != null) {
          onExit()
        } else returnToPage("overview")
      }
      "automation-run" -> when {
        runReturnPage == "delivery" -> onCloseDelivery()
        initialPage == "automation-run" && runReturnPage == "automation" -> onExit?.invoke()
        else -> page = runReturnPage
      }
      "automation" -> if (initialPage == "automation" && selectedAutomationId == initialItemId &&
        automationReturnPage == "automations") onExit?.invoke() else returnToPage(automationReturnPage)
      "automation-edit" -> if (automationEditDirty) discardAutomationEditOpen = true else page = "automation"
      else -> onExit?.invoke()
    }
  }
  val isWorkbenchRoot = onOpenSidebar != null && workPageIndex >= 0
  BackHandler(enabled = !isWorkbenchRoot && (page != "overview" || onExit != null)) {
    goBack()
  }
  BackHandler(enabled = page == "tasks" && taskSearchOpen) { closeTaskSearch() }
  BackHandler(enabled = page == "projects" && projectSearchOpen) { projectSearchOpen = false }
  BackHandler(enabled = page == "automations" && automationSearchOpen) { automationSearchOpen = false }
  LaunchedEffect(page, selectedTaskId, state.detailTaskId) {
    val id = selectedTaskId
    if ((page == "detail" || page == "edit") && id != null &&
      state.detailTaskId != id && requestedTaskId != id) {
      requestedTaskId = id
      onOpenTask(id)
    }
  }
  LaunchedEffect(page, selectedProjectId, state.projectId) {
    val id = selectedProjectId
    if (page == "project" && id != null && state.projectId != id) onOpenProject(id)
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
      if (createSourceProjectId != null) {
        selectedProjectId = createProjectId.trim()
        page = "project"
      } else {
        val createdId = state.createdTaskId
        if (createdId == null) returnToPage("tasks")
        else {
          selectedTaskId = createdId
          detailReturnPage = "tasks"
          page = "detail"
          onOpenTask(createdId)
        }
      }
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
      if (initialPage == "automation" && selectedAutomationId == initialItemId) onExit?.invoke()
      else page = "automations"
    }
  }
  val selectedTask = state.detailTask.takeIf { state.detailTaskId == selectedTaskId }
  fun openProject(id: String) {
    if (onNavigateRoute != null && workPageIndex >= 0) {
      onOpenProject(id)
      onNavigateRoute(MobileRoute.ProjectDetail(id))
      return
    }
    selectedProjectId = id
    page = "project"
    onOpenProject(id)
  }
  fun createTask(projectId: String?) {
    focusManager.clearFocus(force = true)
    keyboardController?.hide()
    if (onNavigateRoute != null && workPageIndex >= 0) {
      if (state.projects.isEmpty() && !state.projectsLoading) onLoadProjects()
      onNavigateRoute(MobileRoute.TaskEditor(projectId = projectId))
      return
    }
    createTitle = ""
    createBody = ""
    createSourceProjectId = projectId
    createProjectId = projectId.orEmpty()
    createPriority = "normal"
    createDueAt = null
    if (state.projects.isEmpty() && !state.projectsLoading) onLoadProjects()
    createStartedRevision = state.createSavedRevision
    page = "create"
  }
  fun openProjectEditor(mode: String) {
    projectWriteError = false
    projectEditorMode = mode
  }
  fun writeProject(mutation: ProjectMutation) {
    if (projectWriteBusy) return
    projectWriteBusy = true
    projectWriteError = false
    projectWriteScope.launch {
      try {
        val updated = onWriteProject(mutation)
        projectEditorMode = null
        openProject(updated.id)
      } catch (e: CancellationException) { throw e }
      catch (_: Exception) { projectWriteError = true }
      finally { projectWriteBusy = false }
    }
  }
  fun openAutomation(id: String) {
    if (onNavigateRoute != null && workPageIndex >= 0) {
      onOpenAutomation(id)
      onNavigateRoute(MobileRoute.AutomationDetail(id))
      return
    }
    pendingAutomationEditId = null
    automationReturnPage = page
    selectedAutomationId = id
    page = "automation"
    onOpenAutomation(id)
  }
  fun editAutomation(item: AutomationSummary) {
    if (item.id != selectedAutomationId || !item.canEditSchedule) return
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
  LaunchedEffect(page, state.automations.detail, pendingAutomationEditId) {
    val item = state.automations.detail
    if (page == "automation" && item != null && pendingAutomationEditId == item.id) {
      pendingAutomationEditId = null
      editAutomation(item)
    }
  }
  fun openRun(id: String) {
    if (onNavigateRoute != null && workPageIndex >= 0) {
      onOpenAutomationRun(id)
      onNavigateRoute(MobileRoute.AutomationRun(id))
      return
    }
    if (page != "automation-run") runReturnPage = page
    selectedRunId = id
    page = "automation-run"
    onOpenAutomationRun(id)
  }
  LaunchedEffect(page, state.automations.rerunNavigationId) {
    if (page == "automation-run") state.automations.rerunNavigationId?.let(::openRun)
  }
  @Composable
  fun WorkPageContent(target: String) {
    when (target) {
      "projects" -> ProgressProjects(state, onLoadProjects, ::openProject, projectSearchOpen, page == target)
      "tasks" -> ProgressTaskList(state, taskFilter, { taskFilter = it }, onRefreshTasks,
        onLoadMore, onSearchChange, onSubmitSearch, taskSearchOpen && page == target, ::closeTaskSearch,
        onCreateTaskWithChat) { task -> onOpenTaskChat(task.id) }
      "overview" -> ProgressOverview(state, onRefreshHome, onOpenChat, ::openAutomationsFromOverview,
        ::openAutomation, onOpenTaskChat,
        { action ->
          val taskId = action.reviewTaskId
          if (taskId != null) onOpenTaskChat(taskId) else pendingHomeAction = action
        }, ::openRun, onOpenLibrary)
    }
  }
  val motionAllowed = rememberMotionAllowed()
  Column(modifier = Modifier.fillMaxSize().then(if (isWorkbenchRoot) sidebarGesture else Modifier).padding(insets)) {
    val automationName = state.automations.detail?.takeIf { page == "automation" && it.id == selectedAutomationId }?.name
    XopcPageHeader(
      backTag = "progress-back",
      onBack = ::goBack,
      backEnabled = !state.commandBusy && !state.editBusy,
      showBack = !isWorkbenchRoot && (page != "overview" || onExit != null),
      leadingContent = if (isWorkbenchRoot) ({ PageSidebarButton("workbench-sidebar", onOpenSidebar!!) }) else null,
      title = if (page == "automations" || page == "automation") (automationName ?: stringResource(R.string.progress_automations)) else null,
      titleContent = when {
        workPageIndex >= 0 -> ({ PageTitleMenu(workPages, page, "work-page-menu", Modifier.fillMaxWidth(), ::scrollToWorkPage) })
        page == "project" && selectedProjectId != null -> ({
          PageTitleMenu(projectSections, projectSection, "progress-project-tabs", Modifier.fillMaxWidth()) { target ->
            val index = projectSections.indexOfFirst { it.value == target }
            projectPagerScope.launch {
              val distance = index - projectPager.currentPage
              if (xopcPagerAnimated(motionAllowed, distance)) projectPager.animateScrollToPage(index)
              else projectPager.scrollToPage(index)
            }
          }
        })
        else -> null
      },
      modifier = Modifier.padding(bottom = if (page == "overview") 4.dp else 0.dp).testTag("progress-header"),
    ) {
      if (page == "automations") {
        PageSearchButton(automationSearchOpen, R.string.progress_search, "automation-open-search") {
          automationSearchOpen = !automationSearchOpen
        }
        AutomationFilterButton(automationFilter) {
          automationFilter = it
          navigation.rememberSelection("automation-filter", it)
        }
      } else if (page == "projects") {
        PageSearchButton(projectSearchOpen, R.string.progress_search_projects, "projects-open-search") {
          projectSearchOpen = !projectSearchOpen
        }
        IconButton(onClick = { openProjectEditor("create") }, modifier = Modifier.testTag("project-create")) {
          Icon(painterResource(R.drawable.action_add), stringResource(R.string.project_new))
        }
      } else if (page == "project") IconButton(onClick = { projectMenuOpen = true },
        enabled = state.project?.id == selectedProjectId && selectedProjectId != null,
        modifier = Modifier.testTag("project-open-actions")) {
        Icon(painterResource(R.drawable.action_add), stringResource(R.string.project_add_item))
      } else if (page == "tasks") Row {
        if (!taskSearchOpen) IconButton(onClick = { taskSearchOpen = true },
          modifier = Modifier.size(48.dp).testTag("progress-open-search")) {
          Icon(painterResource(R.drawable.action_search), contentDescription = stringResource(R.string.progress_search),
            modifier = Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurface)
        }
        IconButton(onClick = { createTask(null) }, modifier = Modifier.size(48.dp).testTag("progress-create-task")) {
          Icon(painterResource(R.drawable.action_add), contentDescription = stringResource(R.string.progress_new_task),
            modifier = Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurface)
        }
      }
    }
    Column(modifier = Modifier.weight(1f).fillMaxWidth()
      .padding(start = XopcDesignTokens.PagePaddingX, end = XopcDesignTokens.PagePaddingX,
        bottom = if (isWorkbenchRoot) bottomChromeInset else 0.dp)) {
    if (state.createTaskChatError && page == "tasks") Text(
      stringResource(R.string.progress_create_chat_error), color = MaterialTheme.colorScheme.error,
      modifier = Modifier.testTag("progress-create-task-error"))
    when (page) {
      "create" -> ProgressTaskEditor(createTitle, { createTitle = it }, createBody, { createBody = it },
        createProjectId, { createProjectId = it }, createPriority, { createPriority = it }, createDueAt, { createDueAt = it },
        state.projects, state.projectsLoading, state.projectsError, onLoadProjects, true, state.createBusy, state.createError,
        creating = true, requiresProject = createSourceProjectId != null) {
        onCreateTask(ProgressTaskEdit(createTitle, createBody, createProjectId, createPriority, createDueAt))
      }
      "overview", "tasks", "projects" -> workPageStates.SaveableStateProvider("workbench") {
        HorizontalPager(workPager, modifier = Modifier.fillMaxSize().testTag("work-page-pager"),
          beyondViewportPageCount = 1, flingBehavior = PagerDefaults.flingBehavior(workPager, snapPositionalThreshold = 0.33f),
          key = { workPages[it].value }) { index ->
          val accessibility = if (index == workPager.settledPage) Modifier
            else Modifier.clearAndSetSemantics { hideFromAccessibility() }
          Box(accessibility.fillMaxSize()) { WorkPageContent(workPages[index].value) }
        }
      }
      "project" -> when {
        state.projectId != selectedProjectId || state.projectLoading -> BrandLoadingPanel(
          modifier = Modifier.testTag("progress-project-loading"))
        state.projectError -> OutlinedButton(onClick = { selectedProjectId?.let(onOpenProject) },
          modifier = Modifier.testTag("progress-project-retry")) {
          Text(stringResource(R.string.progress_load_failed))
        }
        state.project != null -> HorizontalPager(projectPager,
          modifier = Modifier.fillMaxSize().testTag("progress-project-pager"),
          key = { projectSections[it].value }, userScrollEnabled = !projectMenuOpen,
          flingBehavior = PagerDefaults.flingBehavior(projectPager, snapPositionalThreshold = 0.33f),
        ) { index ->
          val accessibility = if (index == projectPager.settledPage) Modifier
            else Modifier.clearAndSetSemantics { hideFromAccessibility() }
          Box(accessibility.fillMaxSize()) {
            ProgressProjectDetail(state.project, projectSections[index].value, state.projectTasks,
              state.projectTasksLoading, state.projectTasksError, state.projectSessions, state.projectSessionsLoading, state.projectSessionsError,
              state.projectNotes, state.projectNotesLoading, state.projectNotesError,
              state.projectAutomations, state.projectAutomationsLoading, state.projectAutomationsError,
              onCreate = { createTask(state.project.id) }, onOpenTask = onOpenTaskChat, onOpenChat = onOpenProjectChat,
              onOpenNote = onOpenNote, onOpenAutomation = ::openAutomation,
              onSchedule = { prompt -> onArrangeAutomation(state.project.id, prompt) },
              onCreateChat = { onCreateProjectChat(state.project.id) }, chatBusy = chatBusy,
              onRetryProject = { selectedProjectId?.let(onOpenProject) },
              deliveries = state.deliveries.filter { it.projectId == state.project.id },
              onOpenRun = ::openRun,
              needsUser = state.needsUser.filter { it.projectId == state.project.id },
              homeActionBusy = state.homeActionBusy,
              onOpenAttention = { item ->
                item.openAction?.href?.let(::progressDestination)?.let { (destPage, id) ->
                  when (destPage) {
                    "chat" -> onOpenChat(id)
                    "tasks" -> onOpenTaskChat(id)
                    "automations" -> openAutomation(id)
                  }
                }
              },
              onRequestAction = { action ->
                val taskId = action.reviewTaskId
                if (taskId != null) onOpenTaskChat(taskId) else pendingHomeAction = action
              })
          }
        }
      }
      "edit" -> ProgressTaskEditor(editTitle, { editTitle = it }, editBody, { editBody = it },
        editProject, { editProject = it }, editPriority, { editPriority = it }, editDueAt, { editDueAt = it },
        state.projects, state.projectsLoading, state.projectsError, onLoadProjects,
        editDirty, state.editBusy, state.editError) {
        selectedTaskId?.let { id -> onSaveTask(id, editVersion,
          ProgressTaskEdit(editTitle, editBody, editProject, editPriority, editDueAt)) }
      }
      "detail" -> when {
        state.detailTaskId != selectedTaskId || state.detailLoading && selectedTask == null -> BrandLoadingPanel(
          modifier = Modifier.testTag("progress-detail-loading"))
        state.detailError && selectedTask == null -> OutlinedButton(onClick = { selectedTaskId?.let(onOpenTask) },
          modifier = Modifier.testTag("progress-detail-retry")) {
          Text(stringResource(R.string.progress_task_missing))
        }
        selectedTask != null -> ProgressTaskDetail(selectedTask, state.commandBusy || state.detailLoading,
          state.commandError || state.detailError, state.taskChatBusy, state.taskChatError,
          onTaskCommand, onStartTask, onOpenTaskChat, state.agents, state.agentsLoading, state.agentsError,
          { selectedTaskId?.let(onOpenTask) }, projects = state.projects) {
          editTitle = selectedTask.title
          editBody = selectedTask.body
          editProject = selectedTask.projectId ?: ""
          editPriority = selectedTask.priority ?: "normal"
          editDueAt = selectedTask.dueAt
          editOriginalPriority = editPriority
          editOriginalDueAt = editDueAt
          onLoadProjects()
          editVersion = selectedTask.version
          editOriginalTitle = selectedTask.title
          editOriginalBody = selectedTask.body
          editOriginalProject = selectedTask.projectId ?: ""
          editStartedRevision = state.editSavedRevision
          page = "edit"
        }
      }
      "automations" -> AutomationListContent(state.automations, state.gatewayId, onLoadAutomations,
        ::openAutomation, automationSearchOpen, filter = automationFilter,
        onEdit = { id -> openAutomation(id); pendingAutomationEditId = id },
        onToggle = onAutomationAction, onDelete = onDeleteAutomation) { prompt -> onArrangeAutomation(null, prompt) }
      "automation" -> AutomationDetailContent(state.automations.takeIf { it.selectedId == selectedAutomationId }
        ?: AutomationUiState(detailLoading = true),
        { selectedAutomationId?.let(onOpenAutomation) }, ::openRun,
        { action -> selectedAutomationId?.let { onAutomationAction(it, action) } },
        onEdit = {
          state.automations.detail?.let(::editAutomation)
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

    }
    }
  }
  val activeProject = state.project?.takeIf { it.id == selectedProjectId }
  if (projectMenuOpen && activeProject != null) XopcBottomSheet(XopcSheetPreset.Compact, onDismissRequest = { projectMenuOpen = false }) {
    ProjectActions(activeProject.name, onChat = {
      projectMenuOpen = false
      onCreateProjectChat(activeProject.id)
    }, onTask = {
      projectMenuOpen = false
      createTask(activeProject.id)
    }, onNote = {
      projectMenuOpen = false
      onCreateProjectNote(activeProject.id)
    }, onAutomation = {
      projectMenuOpen = false
      onArrangeAutomation(activeProject.id, "")
    }, onManage = {
      projectMenuOpen = false
      openProjectEditor("edit")
    })
  }
  if (projectEditorMode == "create" || projectEditorMode == "edit" && activeProject != null)
    XopcBottomSheet(XopcSheetPreset.Large, onDismissRequest = { if (!projectWriteBusy) projectEditorMode = null }) {
      ProjectEditor(activeProject.takeIf { projectEditorMode == "edit" }, projectWriteBusy,
        projectWriteError, ::writeProject)
    }
  if (discardAutomationEditOpen) XopcConfirmDialog(
    onDismiss = { discardAutomationEditOpen = false },
    onConfirm = {
      discardAutomationEditOpen = false
      page = "automation"
      selectedAutomationId?.let(onOpenAutomation)
    },
    title = stringResource(R.string.progress_discard_title),
    message = stringResource(R.string.automation_discard_edit_message),
    confirmLabel = stringResource(R.string.progress_discard),
    destructive = true,
    confirmTag = "automation-edit-discard-confirm",
  )
  if (discardEditOpen) XopcConfirmDialog(
    onDismiss = { discardEditOpen = false },
    onConfirm = {
      discardEditOpen = false
      page = "detail"
      selectedTaskId?.let(onOpenTask)
    },
    title = stringResource(R.string.progress_discard_title),
    message = stringResource(R.string.progress_discard_message),
    confirmLabel = stringResource(R.string.progress_discard),
    destructive = true,
    confirmTag = "progress-discard-confirm",
  )
  if (discardCreateOpen) XopcConfirmDialog(
    onDismiss = { discardCreateOpen = false },
    onConfirm = {
      discardCreateOpen = false
      returnToPage(if (createSourceProjectId == null) "tasks" else "project")
    },
    title = stringResource(R.string.progress_discard_title),
    message = stringResource(R.string.progress_discard_message),
    confirmLabel = stringResource(R.string.progress_discard),
    destructive = true,
    confirmTag = "progress-create-discard-confirm",
  )
  pendingHomeAction?.let { action ->
    XopcConfirmDialog(
      onDismiss = { pendingHomeAction = null },
      onConfirm = { pendingHomeAction = null; onHomeAction(action) },
      title = action.label,
      message = stringResource(R.string.progress_home_action_confirm),
      confirmLabel = stringResource(R.string.progress_confirm),
      confirmTag = "progress-home-action-confirm",
    )
  }
}

@Composable
private fun ProgressProjects(state: ProgressUiState, onRefresh: () -> Unit,
  onOpenProject: (String) -> Unit, searchOpen: Boolean, active: Boolean) {
  var search by rememberSaveable(state.gatewayId, searchOpen) { mutableStateOf("") }
  var filter by rememberSaveable(state.gatewayId) { mutableStateOf("all") }
  val query = search.trim()
  val matching = remember(state.projects, query) {
    state.projects.sortedWith(
      compareByDescending<ProgressProject> { it.pinnedAt != null }
        .thenByDescending { it.pinnedAt ?: Long.MIN_VALUE }
    ).filter { project ->
      query.isEmpty() || project.name.contains(query, ignoreCase = true) ||
        project.brief.contains(query, ignoreCase = true) ||
        project.description.contains(query, ignoreCase = true)
    }
  }
  val shown = matching.filter { project -> when (filter) {
    "active" -> project.status != "archived"
    "archived" -> project.status == "archived"
    else -> true
  } }
  val motionAllowed = rememberMotionAllowed()
  Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    androidx.compose.animation.AnimatedVisibility(
      visible = searchOpen,
      enter = xopcExpandPanelEnter(motionAllowed, Alignment.Top),
      exit = xopcExpandPanelExit(motionAllowed, Alignment.Top),
    ) {
      XopcPageSearchField(
        query = search,
        onQueryChange = { search = it },
        placeholder = stringResource(R.string.progress_search_projects),
        tag = "progress-project-search",
        autoFocus = active,
      )
    }
    SegmentedTabs(
      listOf(
        SegmentOption("all", stringResource(R.string.progress_filter_all), "progress-project-filter-all", count = matching.size),
        SegmentOption("active", stringResource(R.string.progress_project_filter_active), "progress-project-filter-active", count = matching.count { it.status != "archived" }),
        SegmentOption("archived", stringResource(R.string.progress_project_filter_archived), "progress-project-filter-archived", count = matching.count { it.status == "archived" }),
      ), filter, { filter = it }, swipeToSelect = true,
    )
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
      if (state.projectsLoading && state.projects.isEmpty()) item {
        XopcListSkeleton(modifier = Modifier.testTag("progress-projects-loading"), rows = 4)
      }
      if (state.projectsError) item {
        XopcErrorState(
          message = stringResource(R.string.progress_load_failed),
          retryLabel = stringResource(R.string.progress_refresh),
          onRetry = onRefresh,
          retryEnabled = !state.projectsLoading,
          retryTag = "progress-project-retry",
        )
      }
      if (!state.projectsLoading && !state.projectsError && shown.isEmpty()) item {
        XopcEmptyState(message = stringResource(R.string.progress_no_projects))
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
private fun ProgressProjectDetail(project: ProgressProject, section: String, tasks: List<ProgressTask>,
  tasksLoading: Boolean, tasksError: Boolean, sessions: List<ProgressProjectSession>,
  sessionsLoading: Boolean, sessionsError: Boolean,
  notes: List<ai.xopc.mobile.gateway.NoteSummary>, notesLoading: Boolean, notesError: Boolean,
  automations: List<ai.xopc.mobile.gateway.AutomationSummary>,
  automationsLoading: Boolean, automationsError: Boolean,
  onCreate: () -> Unit, onOpenTask: (String) -> Unit, onOpenChat: (ProgressProjectSession) -> Unit,
  onOpenNote: (String) -> Unit, onOpenAutomation: (String) -> Unit,
  onSchedule: (String) -> Unit, onCreateChat: () -> Unit, chatBusy: Boolean,
  onRetryProject: () -> Unit,
  deliveries: List<ai.xopc.mobile.gateway.ProgressDelivery>, onOpenRun: (String) -> Unit,
  needsUser: List<ProgressItem> = emptyList(), homeActionBusy: Boolean = false,
  onOpenAttention: (ProgressItem) -> Unit = {},
  onRequestAction: (ProgressHomeAction) -> Unit = {}) {
  val overviewTasks = remember(tasks) { tasks.filter { it.phase != "closed" } }
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
    if (section == "overview" && needsUser.isNotEmpty()) {
      item { ProgressSectionTitle(R.string.progress_action_required) }
      items(needsUser, key = { "project-needs-${it.id}" }) { item ->
        ProgressAttentionRow(item, homeActionBusy, { onOpenAttention(item) }, onRequestAction)
      }
    }
    if ((section == "overview" || section == "notes") && deliveries.isNotEmpty()) {
      item { ProgressSectionTitle(R.string.library_recent_results) }
      items(if (section == "overview") deliveries.take(5) else deliveries, key = { "project-delivery-${it.id}" }) { delivery ->
        Card(onClick = { if (delivery.kind == "task") onOpenTask(delivery.subjectId) else onOpenRun(delivery.subjectId) },
          modifier = Modifier.fillMaxWidth().testTag("project-delivery-${delivery.id}")) {
          Column(Modifier.padding(12.dp)) {
            Text(delivery.title, style = MaterialTheme.typography.titleSmall)
            if (delivery.summary.isNotBlank()) Text(delivery.summary, maxLines = 2)
          }
        }
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
      if (sessionsLoading) item { BrandLoadingPanel(modifier = Modifier.testTag("progress-project-sessions-loading")) }
      else if (sessionsError) item {
        OutlinedButton(onClick = onRetryProject, modifier = Modifier.testTag("progress-project-sessions-retry")) {
          Text(stringResource(R.string.progress_project_sessions_error))
        }
      }
      else if (sessions.isEmpty()) item { Text(stringResource(R.string.progress_project_no_sessions)) }
      items(if (section == "overview") sessions.take(3) else sessions, key = { "session-${it.id}" }) { session ->
        Card(onClick = { onOpenChat(session) },
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
    if (tasksLoading) item { BrandLoadingPanel(modifier = Modifier.testTag("progress-project-tasks-loading")) }
    else if (tasksError) item {
      OutlinedButton(onClick = onRetryProject, modifier = Modifier.testTag("progress-project-tasks-retry")) {
        Text(stringResource(R.string.progress_load_failed))
      }
    }
    else if ((if (section == "overview") overviewTasks else tasks).isEmpty()) item {
      Text(stringResource(R.string.progress_project_no_tasks))
    }
    items(if (section == "overview") overviewTasks.take(3) else tasks, key = { "task-${it.id}" }) { task ->
      Card(onClick = { onOpenTask(task.id) },
        modifier = Modifier.fillMaxWidth().testTag("progress-project-task-${task.id}")) {
        Column(modifier = Modifier.padding(16.dp)) {
          Text(task.title, style = MaterialTheme.typography.titleMedium)
          Text(taskPresentationLabel(task.displayStatus), color = MaterialTheme.colorScheme.onSurfaceVariant)
          task.presentationReason?.let { Text(it, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
      }
    }
    }
    if (section == "overview" || section == "notes") {
      item { ProgressSectionTitle(R.string.tab_notes) }
      if (notesLoading) item { BrandLoadingPanel(modifier = Modifier.testTag("progress-project-notes-loading")) }
      else if (notesError) item {
        OutlinedButton(onClick = onRetryProject, modifier = Modifier.testTag("progress-project-notes-retry")) {
          Text(stringResource(R.string.progress_project_notes_error))
        }
      }
      else if (notes.isEmpty()) item { Text(stringResource(R.string.progress_project_no_notes)) }
      items(if (section == "overview") notes.take(3) else notes, key = { "note-${it.id}" }) { note ->
        Card(onClick = { onOpenNote(note.id) },
          modifier = Modifier.fillMaxWidth().testTag("progress-project-note-${note.id}")) {
          Column(modifier = Modifier.padding(16.dp)) {
            Text(note.title, style = MaterialTheme.typography.titleMedium)
            if (note.snippet.isNotBlank()) Text(note.snippet, maxLines = 2,
              overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
    if (section == "overview" || section == "automations") {
      item { ProgressSectionTitle(R.string.progress_automations) }
      if (automationsLoading) item {
        BrandLoadingPanel(modifier = Modifier.testTag("progress-project-automations-loading"))
      }
      else if (automationsError) item {
        OutlinedButton(onClick = onRetryProject,
          modifier = Modifier.testTag("progress-project-automations-retry")) {
          Text(stringResource(R.string.progress_project_automations_error))
        }
      }
      else if (section == "automations" && automations.isEmpty()) item { AutomationIdeas(projectScoped = true, onSelect = onSchedule) }
      items(if (section == "overview") automations.take(3) else automations,
        key = { "automation-${it.id}" }) { automation ->
        Card(onClick = { onOpenAutomation(automation.id) },
          modifier = Modifier.fillMaxWidth().testTag("progress-project-automation-${automation.id}")) {
          Column(modifier = Modifier.padding(16.dp)) {
            Text(automation.name, style = MaterialTheme.typography.titleMedium)
            Text(if (automation.enabled) stringResource(R.string.automation_enabled)
              else stringResource(R.string.automation_paused),
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
  }
}

@Composable
private fun ProgressTaskList(state: ProgressUiState, filter: String, onFilterChange: (String) -> Unit,
  onRefresh: () -> Unit,
  onLoadMore: () -> Unit, onSearchChange: (String) -> Unit, onSubmitSearch: () -> Unit,
  searchOpen: Boolean, onCloseSearch: () -> Unit, onCreateTaskWithChat: () -> Unit,
  onOpenTask: (ProgressTask) -> Unit) {
  val shown = remember(state.tasks, filter) { state.tasks.filter { task -> when (filter) {
    "open" -> task.phase != "closed"
    "attention" -> task.phase != "closed" && task.needsUserAttention
    "closed" -> task.phase == "closed"
    else -> true
  } } }
  Column(modifier = Modifier.fillMaxSize()) {
    TextButton(onClick = onCreateTaskWithChat, enabled = !state.creatingTaskChat,
      modifier = Modifier.align(Alignment.End).testTag("progress-create-task-chat")) {
      Text(stringResource(R.string.progress_create_task_in_chat))
    }
    if (searchOpen) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      BasicTextField(value = state.taskSearchText, onValueChange = onSearchChange,
        modifier = Modifier.weight(1f).heightIn(min = 44.dp)
          .background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(24))
          .padding(horizontal = 16.dp, vertical = 10.dp)
          .then(if (searchOpen) searchInputFocus() else Modifier)
          .testTag("progress-task-search"),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSubmitSearch() }),
        decorationBox = { innerTextField ->
          Box {
            if (state.taskSearchText.isEmpty()) Text(stringResource(R.string.progress_search),
              style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            innerTextField()
          }
        })
      val clearLabel = stringResource(R.string.conversations_clear)
      IconButton(onClick = onCloseSearch,
        modifier = Modifier.size(48.dp).semantics { contentDescription = clearLabel }
          .testTag("progress-search-clear")) {
        Text("×", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    SegmentedTabs(
      listOf(
        SegmentOption("all", stringResource(R.string.progress_filter_all), "progress-filter-all"),
        SegmentOption("open", stringResource(R.string.progress_filter_open), "progress-filter-open"),
        SegmentOption("attention", stringResource(R.string.personal_overview_attention), "progress-filter-attention"),
        SegmentOption("closed", stringResource(R.string.progress_filter_closed), "progress-filter-closed"),
      ), filter, onFilterChange, modifier = Modifier.testTag("progress-task-filter-strip"), swipeToSelect = true,
    )
    LazyColumn(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp),
    contentPadding = PaddingValues(bottom = 20.dp)) {
    item { Text(stringResource(R.string.progress_loaded_count, state.tasks.size),
      style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    if (state.tasksError) item {
      XopcErrorState(
        message = stringResource(R.string.progress_load_failed),
        retryLabel = stringResource(R.string.progress_refresh),
        onRetry = onRefresh,
      )
    }
    if (state.loading && state.tasks.isEmpty()) item { XopcListSkeleton(rows = 4) }
    if (!state.loading && !state.tasksError && shown.isEmpty()) item {
      XopcEmptyState(
        message = stringResource(if (state.tasks.isEmpty()) R.string.progress_no_tasks else R.string.progress_no_matches),
      )
    }
    items(shown, key = { it.id }) { task ->
      Card(onClick = { onOpenTask(task) }, modifier = Modifier.fillMaxWidth().testTag("progress-task-${task.id}")) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(task.title, style = MaterialTheme.typography.titleMedium, maxLines = 2,
            overflow = TextOverflow.Ellipsis)
          Text(taskPresentationLabel(task.displayStatus), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
          val preview = task.presentationReason?.takeIf { it.isNotBlank() } ?: task.body
          if (preview.isNotBlank()) MarkdownContent(preview, maxLines = 2)
        }
      }
    }
    if (state.tasks.size < state.taskTotal) item {
      OutlinedButton(onClick = onLoadMore, enabled = !state.loadingMore,
        modifier = Modifier.fillMaxWidth().testTag("progress-load-more")) {
        if (state.loadingMore) BrandLoadingIndicator(extent = 20.dp)
        Text(stringResource(if (state.loadingMore) R.string.progress_loading_more else R.string.progress_load_more))
      }
      if (state.moreError) Text(stringResource(R.string.progress_more_error), color = MaterialTheme.colorScheme.error)
    }
  }
  }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
internal fun ProgressTaskDetail(task: ProgressTask, busy: Boolean, commandError: Boolean,
  taskChatBusy: Boolean, taskChatError: Boolean,
  onCommand: (String) -> Unit, onStart: (String) -> Unit,
  onOpenTaskChat: (String) -> Unit, agents: List<ai.xopc.mobile.gateway.ConversationAgent>,
  agentsLoading: Boolean, agentsError: Boolean,
  onRefresh: () -> Unit, statusOnly: Boolean = false,
  onStatusDismiss: () -> Unit = {}, projects: List<ProgressProject> = emptyList(),
  onEdit: () -> Unit) {
  var confirmAction by rememberSaveable(task.id) { mutableStateOf<String?>(null) }
  var statusOpen by rememberSaveable(task.id) { mutableStateOf(statusOnly) }
  var agentId by rememberSaveable(task.id) { mutableStateOf("") }
  var confirmStart by rememberSaveable(task.id) { mutableStateOf(false) }
  if (!statusOnly) Column(Modifier.fillMaxSize().testTag("progress-task-detail")) {
  if (commandError || taskChatError) {
    Text(stringResource(if (commandError) R.string.progress_command_error else R.string.progress_task_chat_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag(if (commandError) "progress-command-error" else "progress-task-chat-error"))
    OutlinedButton(onClick = onRefresh, enabled = !busy) { Text(stringResource(R.string.progress_refresh)) }
  }
  Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
      Column(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(task.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        TextButton(onClick = { statusOpen = true }, enabled = !busy) {
          Text(if (task.phase == "closed" && task.resolution == "cancelled") taskResolutionLabel("cancelled") else progressPhaseLabel(task.phase))
        }
        task.projectId?.let { id ->
          val projectName = projects.firstOrNull { it.id == id }?.name ?: id
          Text(stringResource(R.string.progress_task_project, projectName))
        }
        task.presentationReason?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        task.signoffResultId?.let { resultId ->
          Button(onClick = { onCommand("signoff:$resultId") }, enabled = !busy,
            modifier = Modifier.testTag("progress-task-signoff")) {
            Text(stringResource(R.string.progress_task_signoff))
          }
        }
      }
    }
    if (task.latestResult.isNotBlank()) {
      ProgressSectionTitle(R.string.progress_latest_result)
      Card {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          MarkdownContent(task.latestResult)
          task.remainingWork.forEach { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
      }
    }
    if (task.phaseChanges.isNotEmpty()) {
      ProgressSectionTitle(R.string.progress_change_log)
      Card {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
          task.phaseChanges.asReversed().forEach { change ->
            Column {
              Text(progressPhaseLabel(change.fromPhase) + (change.fromResolution?.let { " · $it" } ?: "") +
                " → ${progressPhaseLabel(change.toPhase)}" +
                (change.resolution?.let { " · $it" } ?: ""))
              Text("${change.actor} · ${change.source} · ${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(change.createdAt))}",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
    }
    ProgressSectionTitle(R.string.progress_description)
    Card {
      if (task.body.isBlank()) Text(stringResource(R.string.progress_no_description),
        modifier = Modifier.fillMaxWidth().padding(16.dp), style = MaterialTheme.typography.bodyMedium)
      else MarkdownContent(task.body,
        modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("progress-task-body"))
    }
    ProgressSectionTitle(R.string.progress_acceptance_criteria)
    Card {
      Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (task.objective.isNotBlank()) Text(task.objective,
          style = MaterialTheme.typography.bodyMedium)
        if (task.criteria.isEmpty()) Text(stringResource(R.string.progress_no_acceptance_criteria),
          color = MaterialTheme.colorScheme.onSurfaceVariant)
        else {
          Text(stringResource(R.string.progress_criteria_passed,
            task.criteria.count { it.status == "passed" }, task.criteria.size),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
          task.criteria.forEachIndexed { index, criterion ->
            Row(Modifier.fillMaxWidth().testTag("task-criterion-$index"),
              horizontalArrangement = Arrangement.spacedBy(10.dp)) {
              Text(when (criterion.status) { "passed" -> "✓"; "failed" -> "!"; else -> "○" },
                color = when (criterion.status) {
                  "passed" -> MaterialTheme.colorScheme.primary
                  "failed" -> MaterialTheme.colorScheme.error
                  else -> MaterialTheme.colorScheme.onSurfaceVariant
                })
              Column {
                Text(criterion.text, style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(when (criterion.status) {
                  "passed" -> R.string.progress_criterion_passed
                  "failed" -> R.string.progress_criterion_failed
                  else -> R.string.progress_criterion_pending
                }), style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (criterion.humanReviewed) Text(stringResource(R.string.progress_criterion_human),
                  style = MaterialTheme.typography.labelSmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant)
                task.reviewAction(criterion)?.let { action ->
                  TextButton(onClick = { onCommand(action) }, enabled = !busy) {
                    Text(stringResource(if (criterion.status == "passed") R.string.progress_task_clear_review
                      else R.string.progress_task_mark_passed))
                  }
                }
              }
            }
          }
        }
      }
    }
    ProgressSectionTitle(R.string.progress_details)
    Card {
      Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.progress_execution_state, taskExecutionLabel(task.operationalState)))
        task.priority?.let { Text(stringResource(R.string.progress_task_priority, taskPriorityLabel(it))) }
        task.dueAt?.let { Text(stringResource(R.string.progress_due_date_value,
          DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it)))) }
        Text(stringResource(R.string.progress_task_updated,
          DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(task.updatedAt))))
        task.resolution?.let { Text(stringResource(R.string.progress_task_resolution, taskResolutionLabel(it))) }
      }
    }
  }
  Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    OutlinedButton(onClick = { statusOpen = true }, enabled = !busy,
      modifier = Modifier.weight(1f).testTag("progress-task-status")) {
      Text(stringResource(R.string.progress_adjust_status))
    }
    OutlinedButton(onClick = onEdit, enabled = !busy && task.version > 0,
      modifier = Modifier.weight(1f).testTag("progress-task-edit")) { Text(stringResource(R.string.progress_edit_task)) }
    Button(onClick = { onOpenTaskChat(task.id) }, enabled = !taskChatBusy && !busy,
      modifier = Modifier.weight(1f).testTag("progress-task-chat")) { Text(stringResource(R.string.progress_task_chat_short)) }
  }
  }
  if (statusOpen) XopcBottomSheet(XopcSheetPreset.Medium,
    onDismissRequest = { if (!busy) { statusOpen = false; onStatusDismiss() } }) {
    Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(20.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(stringResource(R.string.progress_adjust_status), style = MaterialTheme.typography.titleLarge)
      Text(stringResource(R.string.progress_phase_help), color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (statusOnly) {
        task.presentationReason?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        task.signoffResultId?.let { resultId ->
          Button(onClick = { onCommand("signoff:$resultId") }, enabled = !busy) {
            Text(stringResource(R.string.progress_task_signoff))
          }
        }
        task.criteria.forEach { criterion ->
          task.reviewAction(criterion)?.let { action ->
            TextButton(onClick = { onCommand(action) }, enabled = !busy) {
              Text(criterion.text + if (criterion.status == "passed") " ✓" else " ○")
            }
          }
        }
      }
      if (commandError) {
        Text(stringResource(R.string.progress_command_error), color = MaterialTheme.colorScheme.error)
        OutlinedButton(onClick = onRefresh, enabled = !busy) { Text(stringResource(R.string.progress_refresh)) }
      }
      listOf("backlog", "ready", "active", "review", "closed").forEach { phase ->
        OutlinedButton(onClick = { task.phaseAction(phase)?.let(onCommand) },
          enabled = !busy && task.phaseAction(phase) != null,
          modifier = Modifier.fillMaxWidth().testTag("progress-phase-$phase")) { Text(progressPhaseLabel(phase)) }
      }
      if (task.phase != "closed" && "move" !in task.allowedCommands) Text(stringResource(R.string.progress_phase_blocked),
        color = MaterialTheme.colorScheme.onSurfaceVariant)
      if ("start" in task.allowedCommands) {
        if (agentsLoading) BrandLoadingIndicator()
        if (agentsError || !agentsLoading && agents.isEmpty()) {
          Text(stringResource(R.string.progress_agents_unavailable), color = MaterialTheme.colorScheme.onSurfaceVariant)
          OutlinedButton(onClick = onRefresh, enabled = !busy && !agentsLoading) { Text(stringResource(R.string.progress_refresh)) }
        }
        TaskChoiceField(stringResource(R.string.progress_agent_id),
          agents.firstOrNull { it.id == agentId }?.name ?: stringResource(R.string.progress_choose_agent),
          agents.map { it.id to it.name }, !busy && !agentsLoading, "progress-start-agent") { agentId = it }
      }
      if ("start" in task.allowedCommands) {
        Button(onClick = { confirmStart = true }, enabled = !busy && agents.any { it.id == agentId },
          modifier = Modifier.fillMaxWidth().testTag("progress-command-start")) {
          Text(stringResource(R.string.progress_command_start))
        }
      }
      if (task.pausedWaitId != null && "resolve_wait" in task.allowedCommands) {
        OutlinedButton(onClick = { onCommand("resume_task") }, enabled = !busy,
          modifier = Modifier.fillMaxWidth().testTag("progress-command-resume")) {
          Text(stringResource(R.string.task_resume))
        }
      } else if (task.phase != "closed" && "add_wait" in task.allowedCommands) {
        OutlinedButton(onClick = { onCommand("pause_task") }, enabled = !busy,
          modifier = Modifier.fillMaxWidth().testTag("progress-command-pause")) {
          Text(stringResource(R.string.task_pause))
        }
      }
      if (task.activeRunId != null && task.activeRunVersion > 0) {
        OutlinedButton(onClick = { confirmAction = "stop_run" }, enabled = !busy,
          modifier = Modifier.fillMaxWidth().testTag("progress-command-stop-run")) {
          Text(stringResource(R.string.task_stop_run), color = MaterialTheme.colorScheme.error)
        }
      }
      if ("close" in task.allowedCommands) {
        if (task.runCount == 0) {
          OutlinedButton(onClick = { confirmAction = "close" }, enabled = !busy,
            modifier = Modifier.fillMaxWidth().testTag("progress-command-close")) {
            Text(stringResource(R.string.progress_command_close))
          }
        } else if (task.signoffResultId == null) {
          val blockRes = when (task.completionBlock) {
            "execution" -> R.string.task_block_execution
            "acceptance" -> R.string.task_block_acceptance
            else -> R.string.task_block_criteria
          }
          Text(stringResource(blockRes), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        TextButton(onClick = { confirmAction = "cancel_task" }, enabled = !busy,
          modifier = Modifier.fillMaxWidth().testTag("progress-command-cancel")) {
          Text(stringResource(R.string.progress_cancel_task), color = MaterialTheme.colorScheme.error)
        }
      }
    }
  }
  confirmAction?.let { action ->
    XopcConfirmDialog(
      onDismiss = { confirmAction = null },
      onConfirm = { confirmAction = null; onCommand(action) },
      title = stringResource(when (action) {
        "cancel_task" -> R.string.progress_cancel_task
        "stop_run" -> R.string.task_stop_run
        else -> R.string.progress_command_close
      }),
      message = stringResource(when (action) {
        "cancel_task" -> R.string.progress_cancel_task_help
        "stop_run" -> R.string.task_stop_run_help
        else -> R.string.progress_command_confirm
      }),
      confirmLabel = stringResource(R.string.progress_confirm),
      destructive = action == "cancel_task" || action == "stop_run",
      confirmTag = "progress-command-confirm",
    )
  }
  if (confirmStart && "start" in task.allowedCommands && !busy) XopcConfirmDialog(
    onDismiss = { confirmStart = false },
    onConfirm = {
      confirmStart = false
      val selected = agentId.trim()
      if (selected.isNotEmpty() && selected.length <= 128) onStart(selected)
    },
    title = stringResource(R.string.progress_command_start),
    message = stringResource(R.string.progress_start_confirm, agentId.trim()),
    confirmLabel = stringResource(R.string.progress_confirm),
    confirmTag = "progress-start-confirm",
  )
}

@Composable
internal fun ProgressTaskEditor(title: String, onTitleChange: (String) -> Unit,
  body: String, onBodyChange: (String) -> Unit,
  projectId: String, onProjectChange: (String) -> Unit,
  priority: String, onPriorityChange: (String) -> Unit, dueAt: Long?, onDueAtChange: (Long?) -> Unit,
  projects: List<ProgressProject>, projectsLoading: Boolean, projectsError: Boolean, onLoadProjects: () -> Unit,
  dirty: Boolean, busy: Boolean, error: Boolean, creating: Boolean = false, requiresProject: Boolean = false,
  onSave: () -> Unit) {
  val prefix = if (creating) "progress-create" else "progress-edit"
  val valid = title.trim().isNotEmpty() && title.trim().length <= 500 && body.length <= 50_000 &&
    projectId.trim().length <= 512 && (!requiresProject || projectId.isNotBlank())
  Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).testTag(if (creating) "progress-task-create" else "progress-task-editor"),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    OutlinedTextField(value = title, onValueChange = onTitleChange,
      modifier = Modifier.fillMaxWidth().testTag("$prefix-title"),
      label = { Text(stringResource(R.string.progress_task_name)) }, singleLine = true,
      enabled = !busy)
    OutlinedTextField(value = body, onValueChange = onBodyChange,
      modifier = Modifier.fillMaxWidth().testTag("$prefix-body"),
      label = { Text(stringResource(R.string.progress_description)) }, minLines = 6,
      enabled = !busy)
    TaskChoiceField(stringResource(R.string.progress_task_project_label),
      projects.firstOrNull { it.id == projectId }?.name ?: projectId.ifBlank { stringResource(R.string.progress_no_project) },
      (if (requiresProject) emptyList() else listOf("" to stringResource(R.string.progress_no_project))) +
        projects.map { it.id to it.name },
      !busy, "$prefix-project", onProjectChange)
    if (projectsLoading) BrandLoadingIndicator()
    if (projectsError) OutlinedButton(onClick = onLoadProjects, enabled = !busy) { Text(stringResource(R.string.progress_refresh)) }
    TaskChoiceField(stringResource(R.string.progress_priority_label), taskPriorityLabel(priority),
      listOf("low", "normal", "high", "critical").map { it to taskPriorityLabel(it) }, !busy,
      "$prefix-priority", onPriorityChange)
    val context = androidx.compose.ui.platform.LocalContext.current
    OutlinedButton(onClick = {
      val date = java.util.Calendar.getInstance().apply { timeInMillis = dueAt ?: System.currentTimeMillis() }
      android.app.DatePickerDialog(context, { _, year, month, day ->
        val chosen = java.util.Calendar.getInstance().apply {
          set(year, month, day, 23, 59, 59); set(java.util.Calendar.MILLISECOND, 999)
        }
        onDueAtChange(chosen.timeInMillis)
      }, date.get(java.util.Calendar.YEAR), date.get(java.util.Calendar.MONTH), date.get(java.util.Calendar.DAY_OF_MONTH)).show()
    }, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("$prefix-due-date")) {
      Text(dueAt?.let { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it)) }
        ?: stringResource(R.string.progress_no_due_date))
    }
    if (dueAt != null) TextButton(onClick = { onDueAtChange(null) }, enabled = !busy) {
      Text(stringResource(R.string.progress_clear_due_date))
    }
    if (error) Text(stringResource(if (creating) R.string.progress_create_error else R.string.progress_edit_error), color = MaterialTheme.colorScheme.error,
      modifier = Modifier.testTag("$prefix-error"))
    Button(onClick = onSave, enabled = valid && dirty && !busy,
      modifier = Modifier.fillMaxWidth().testTag("$prefix-save")) {
      Text(stringResource(R.string.progress_save))
    }
    if (busy) BrandLoadingIndicator(modifier = Modifier.fillMaxWidth().testTag("$prefix-busy"))
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
internal fun progressPhaseLabel(phase: String): String = stringResource(when (phase) {
  "backlog" -> R.string.progress_phase_backlog
  "ready" -> R.string.progress_phase_ready
  "active", "in_progress" -> R.string.progress_phase_active
  "review" -> R.string.progress_phase_review
  "closed" -> R.string.progress_phase_closed
  else -> R.string.execution_status_unknown
})

@Composable
private fun ProgressSectionTitle(label: Int) {
  Text(stringResource(label), style = MaterialTheme.typography.titleSmall,
    fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
}


@Composable
private fun TaskChoiceField(label: String, selected: String, options: List<Pair<String, String>>,
  enabled: Boolean, tag: String, onChoose: (String) -> Unit) {
  var expanded by remember { mutableStateOf(false) }
  Column {
    Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Box {
      OutlinedButton(onClick = { expanded = true }, enabled = enabled,
        modifier = Modifier.fillMaxWidth().testTag(tag)) { Text(selected) }
      androidx.compose.material3.DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
        options.forEach { (id, name) ->
          androidx.compose.material3.DropdownMenuItem(text = { Text(name) },
            onClick = { expanded = false; onChoose(id) })
        }
      }
    }
  }
}


@Composable
internal fun taskExecutionLabel(state: String): String = stringResource(when (state) {
  "queued" -> R.string.execution_status_queued
  "running" -> R.string.execution_status_running
  "failed" -> R.string.execution_status_failed
  "cancelled" -> R.string.execution_status_cancelled
  "waiting" -> R.string.progress_execution_waiting
  "verifying" -> R.string.progress_execution_verifying
  "blocked" -> R.string.progress_execution_blocked
  else -> R.string.progress_execution_idle
})
