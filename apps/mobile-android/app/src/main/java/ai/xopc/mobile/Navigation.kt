package ai.xopc.mobile

import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import ai.xopc.mobile.ui.main.MainScreen
import ai.xopc.mobile.ui.main.GatewayViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect

@Composable
fun MainNavigation(appearanceMode: String, onAppearanceModeChange: (String) -> Unit,
  colorScheme: String, onColorSchemeChange: (String) -> Unit,
  language: String, onLanguageChange: (String) -> Unit) {
  val backStack = rememberNavBackStack(Main)

  NavDisplay(
    backStack = backStack,
    onBack = { backStack.removeLastOrNull() },
    entryProvider =
      entryProvider {
        entry<Main> {
          val gateway: GatewayViewModel = viewModel()
          val connection by gateway.state.collectAsStateWithLifecycle()
          LaunchedEffect(gateway) { gateway.restore() }
          MainScreen(connection = connection, onPair = gateway::pair,
            appearanceMode = appearanceMode, onAppearanceModeChange = onAppearanceModeChange,
            colorScheme = colorScheme, onColorSchemeChange = onColorSchemeChange,
            language = language, onLanguageChange = onLanguageChange,
            onConversationSearchChange = gateway::updateConversationSearch,
            onLoadMoreConversations = gateway::loadMoreConversations,
            onSelectConversation = gateway::selectConversation, onCreateConversation = gateway::createConversation,
            onCreateReferenceConversation = gateway::createConversationForReference,
            onReferenceRequestHandled = gateway::referenceRequestHandled,
            onDiscardDraft = gateway::discardLocalDraft,
            onBeginRename = gateway::beginRename, onRenameDraftChange = gateway::changeRenameDraft,
            onSaveRename = gateway::saveRename, onCancelRename = gateway::cancelRename,
            onTogglePin = gateway::togglePin,
            onToggleArchive = gateway::toggleArchive,
            onScheduleDelete = gateway::scheduleDelete, onUndoDelete = gateway::undoDelete,
            onQuickDraftChange = gateway::changeQuickDraft, onQuickSubmit = gateway::submitQuickDraft,
            onAddQuickAttachment = gateway::addQuickAttachment,
            onAddCapturedQuickAttachment = gateway::addCapturedQuickAttachment,
            onRemoveQuickAttachment = gateway::removeQuickAttachment,
            onQuickNavigationHandled = gateway::quickNavigationHandled,
            onDraftChange = gateway::changeDraft, onSendMessage = gateway::sendMessage,
            onAddDraftAttachment = gateway::addDraftAttachment,
            onAddCapturedDraftAttachment = gateway::addCapturedDraftAttachment,
            onRemoveDraftAttachment = gateway::removeDraftAttachment,
            onRemoveDraftRef = gateway::removeDraftRef,
            onLoadReferences = gateway::loadReferences, onAddDraftRef = gateway::addDraftRef,
            onRetryPendingInput = gateway::retryPendingInput, onStopRun = gateway::stopRun,
            onReloadModels = gateway::loadModels, onSelectModel = gateway::selectModel,
            onReloadAgents = gateway::loadAgents, onSwitchAgent = gateway::switchAgent,
            onReloadContext = gateway::loadContext,
            onRefreshProgress = gateway::refreshProgress,
            onRefreshProgressHome = gateway::refreshProgressHome,
            onProgressHomeAction = gateway::actOnProgressHome,
            onLoadAutomations = gateway::loadAutomations,
            onOpenAutomation = gateway::openAutomation,
            onOpenAutomationRun = gateway::openAutomationRun,
            onAutomationAction = gateway::actOnAutomation,
            onCreateAutomation = gateway::createAutomation,
            onUpdateAutomation = gateway::updateAutomation,
            onDeleteAutomation = gateway::deleteAutomation,
            onLoadNotes = gateway::loadNotes,
            onLoadMoreNotes = gateway::loadMoreNotes,
            onOpenNote = gateway::openNote,
            onNewNote = gateway::beginNoteDraft,
            onNoteDraftChange = gateway::changeNoteDraft,
            onSaveNoteDraft = gateway::saveNoteDraft,
            onCreatedNoteHandled = gateway::noteCreationNavigationHandled,
            onOpenNoteDraft = gateway::openNoteDraft,
            onEditNote = gateway::beginEditNote,
            onResolveNoteConflict = gateway::resolveNoteConflict,
            onNoteMetadataChange = gateway::updateNoteMetadata,
            onLoadNoteHistory = gateway::loadNoteHistory,
            onLoadNoteSnapshot = gateway::loadNoteSnapshot,
            onRestoreNoteSnapshot = gateway::restoreNoteSnapshotToDraft,
            onNoteRestorationHandled = gateway::noteSnapshotRestorationHandled,
            onDeleteNote = gateway::deleteNote,
            onNoteDeletionHandled = gateway::noteDeletionHandled,
            onShareNote = gateway::shareNote,
            onDismissNoteShare = gateway::dismissNoteShare,
            onLoadShares = gateway::loadShares,
            onCloseShares = gateway::closeShareCenter,
            onRevokeShare = gateway::revokeShare,
            onExtendShare = gateway::extendShare,
            onLoadPersonal = gateway::loadPersonal,
            onSavePersonalGoal = gateway::savePersonalGoal,
            onLoadPersonalAssertions = gateway::loadPersonalAssertions,
            onOpenPersonalAssertion = gateway::openPersonalAssertion,
            onClosePersonalAssertion = gateway::closePersonalAssertion,
            onSavePersonalProfile = gateway::savePersonalProfile,
            onSavePersonalStatement = gateway::savePersonalStatement,
            onDeletePersonalAssertion = gateway::deletePersonalAssertion,
            onStartUnderstandingChat = gateway::startUnderstandingChat,
            onOpenGatewayProfiles = gateway::openGatewayProfiles,
            onProbeGateway = gateway::probeGateway,
            onActivateGateway = gateway::activateGateway,
            onRenameGateway = gateway::renameGateway,
            onRemoveGateway = gateway::removeGateway,
            onAutomationRunAction = gateway::actOnAutomationRun,
            onRefreshProgressTasks = gateway::refreshProgressTasks,
            onLoadMoreProgressTasks = gateway::loadMoreProgressTasks,
            onOpenProgressTask = gateway::openProgressTask,
            onProgressTaskCommand = gateway::commandProgressTask,
            onStartProgressTask = gateway::startProgressTask,
            onCreateTaskWithChat = gateway::createTaskWithChat,
            onLoadProgressProjects = gateway::loadProgressProjects,
            onOpenProgressProject = gateway::openProgressProject,
            onCreateProgressTask = gateway::createProgressTask,
            onOpenTaskChat = gateway::openTaskConversation,
            onSaveProgressTask = gateway::saveProgressTask,
            onProgressTaskSearchChange = gateway::changeProgressTaskSearch,
            onSubmitProgressTaskSearch = gateway::submitProgressTaskSearch,
            onOpenExecution = gateway::openExecution, onRetryExecution = gateway::retryExecution,
            onCloseExecution = gateway::closeExecution,
            onSaveMessageAsNote = gateway::saveMessageAsNote,
            onReuseMessage = gateway::reuseMessage,
            onMessageNoteFeedbackHandled = gateway::messageNoteFeedbackHandled,
            modifier = Modifier.safeDrawingPadding())
        }
      },
  )
}
