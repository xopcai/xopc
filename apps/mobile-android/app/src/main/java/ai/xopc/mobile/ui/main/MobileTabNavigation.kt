package ai.xopc.mobile.ui.main

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * Top-level mobile tabs (5 core fixed slots + reserved dynamic pinned-space slot).
 */
internal sealed interface MobileTab {
  val key: String

  data object Ada : MobileTab {
    override val key: String = "ada"
  }

  data object Conversations : MobileTab {
    override val key: String = "conversations"
  }

  data object Workbench : MobileTab {
    override val key: String = "workbench"
  }

  data object Notes : MobileTab {
    override val key: String = "notes"
  }

  data object Library : MobileTab {
    override val key: String = "library"
  }

  data class PinnedSpace(val spaceId: String) : MobileTab {
    override val key: String = "pinnedSpace:$spaceId"
  }

  companion object {
    val coreTabs: List<MobileTab> = listOf(Ada, Conversations, Workbench, Notes, Library)
  }
}

/**
 * Unified L1 stack destinations pushed on top of a tab root.
 * Entering any MobileRoute hides the bottom tab bar and shows `< Back`.
 */
internal sealed interface MobileRoute {
  val routeKey: String

  // Chat domain
  data class SessionChat(
    val conversationId: String? = null,
    val draftId: String? = null,
    val agentId: String = "main",
    val title: String? = null,
    val instanceId: String = conversationId ?: draftId ?: "draft",
  ) : MobileRoute {
    val effectiveConversationId: String? get() = conversationId ?: draftId
    override val routeKey: String get() = "sessionChat:$instanceId"
  }

  data class TaskChat(
    val taskId: String,
    val conversationId: String? = null,
    val projectId: String? = null,
    val title: String? = null,
  ) : MobileRoute {
    override val routeKey: String get() = "taskChat:$taskId"

    fun matchesConversation(selectedId: String?, selectedTaskId: String?): Boolean =
      conversationId != null && conversationId == selectedId && taskId == selectedTaskId
  }

  data class ProjectChat(
    val projectId: String,
    val conversationId: String? = null,
    val title: String? = null,
  ) : MobileRoute {
    override val routeKey: String get() = "projectChat:$projectId:${conversationId.orEmpty()}"
  }

  data class AutomationSetupChat(
    val projectId: String? = null,
    val prompt: String? = null,
    val personalSchedule: Boolean = false,
    val conversationId: String? = null,
  ) : MobileRoute {
    override val routeKey: String get() = "automationSetupChat:${projectId.orEmpty()}:${conversationId.orEmpty()}"
  }

  data class ConversationSearch(val autoFocusSearch: Boolean = true) : MobileRoute {
    override val routeKey: String get() = "conversationSearch"
  }

  data class PersonalOverview(val allowsConversationSharing: Boolean = true) : MobileRoute {
    override val routeKey: String get() = "personalOverview"
  }

  // Work domain
  data class TaskDetail(val taskId: String) : MobileRoute {
    override val routeKey: String get() = "taskDetail:$taskId"
  }

  data class TaskEditor(val taskId: String? = null, val projectId: String? = null) : MobileRoute {
    override val routeKey: String get() = "taskEditor:${taskId.orEmpty()}:${projectId.orEmpty()}"
  }

  data class ProjectDetail(val projectId: String, val initialSection: String? = null) : MobileRoute {
    override val routeKey: String get() = "projectDetail:$projectId"
  }

  data object Automations : MobileRoute {
    override val routeKey: String = "automations"
  }

  data class AutomationDetail(val automationId: String) : MobileRoute {
    override val routeKey: String get() = "automationDetail:$automationId"
  }

  data class AutomationRun(val runId: String) : MobileRoute {
    override val routeKey: String get() = "automationRun:$runId"
  }

  // Notes & Library domain
  data class NoteDetail(val noteId: String) : MobileRoute {
    override val routeKey: String get() = "noteDetail:$noteId"
  }

  data class NoteEditor(val noteId: String? = null, val projectId: String? = null) : MobileRoute {
    override val routeKey: String get() = "noteEditor:${noteId.orEmpty()}:${projectId.orEmpty()}"
  }

  data class DiscussionNote(val noteId: String) : MobileRoute {
    override val routeKey: String get() = "discussionNote:$noteId"
  }

  data class VoiceNoteCapture(val recoveryOnly: Boolean = false) : MobileRoute {
    override val routeKey: String get() = "voiceNoteCapture:$recoveryOnly"
  }

  data object NoteFiles : MobileRoute {
    override val routeKey: String = "noteFiles"
  }

  data class FileDetail(val fileId: String) : MobileRoute {
    override val routeKey: String get() = "fileDetail:$fileId"
  }

  data class SessionFiles(val conversationId: String) : MobileRoute {
    override val routeKey: String get() = "sessionFiles:$conversationId"
  }

  data class SpaceDetail(val spaceId: String) : MobileRoute {
    override val routeKey: String get() = "spaceDetail:$spaceId"
  }

  data object LibraryBrowse : MobileRoute {
    override val routeKey: String = "libraryBrowse"
  }

  // System & Personal domain
  data class Capabilities(val section: String? = null) : MobileRoute {
    override val routeKey: String get() = "capabilities:${section.orEmpty()}"
  }

  data class Settings(val section: String? = null) : MobileRoute {
    override val routeKey: String get() = "settings:${section.orEmpty()}"
  }

  data class AboutYou(val itemId: String? = null, val startSection: String = "overview") : MobileRoute {
    override val routeKey: String get() = "aboutYou:${itemId.orEmpty()}:$startSection"
  }

  data object PersonalGoals : MobileRoute {
    override val routeKey: String = "personalGoals"
  }

  data object ShareCenter : MobileRoute {
    override val routeKey: String = "shareCenter"
  }
}

/**
 * Push notification / deep-link / external share targets with synthetic parent stacks.
 */
internal sealed interface PushNavTarget {
  data object AdaHome : PushNavTarget
  data class OrdinaryChat(val conversationId: String, val agentId: String = "main", val title: String? = null) : PushNavTarget
  data class TaskDetail(val taskId: String) : PushNavTarget
  data class TaskChat(val taskId: String, val conversationId: String? = null) : PushNavTarget
  data class AutomationRun(val runId: String) : PushNavTarget
  data class NoteDetail(val noteId: String) : PushNavTarget
  data class Settings(val section: String? = null) : PushNavTarget
}

/**
 * Outcome of unified Back consumption following strict 5-level priority.
 */
internal sealed interface BackAction {
  data object DismissTransientUi : BackAction
  data object ClosedSidebar : BackAction
  data class PoppedRoute(val route: MobileRoute) : BackAction
  data object SwitchedToAda : BackAction
  data object SystemBack : BackAction
}

internal data class BackResult(
  val state: MobileNavSnapshot,
  val action: BackAction,
)

/**
 * Pure immutable navigation state for multi-stack bottom tab navigation.
 * All transitions are pure functions so JVM unit tests can exhaustively verify every rule.
 */
internal data class MobileNavSnapshot(
  val selectedTab: MobileTab = MobileTab.Ada,
  val stacks: Map<MobileTab, List<MobileRoute>> = defaultStacks(),
  val sidebarOpen: Boolean = false,
  val pinnedSpaceIds: Set<String> = emptySet(),
  val rootScrollToTopRevision: Map<MobileTab, Int> = emptyMap(),
) {
  fun stackFor(tab: MobileTab): List<MobileRoute> = stacks[tab].orEmpty()

  val activeStack: List<MobileRoute> get() = stackFor(selectedTab)

  val topRoute: MobileRoute? get() = activeStack.lastOrNull()

  val isAtRoot: Boolean get() = activeStack.isEmpty()

  /** Iron rule 1: Bottom pill is visible iff active stack is empty, IME hidden, and no full-screen overlay. */
  fun showBottomTabBar(imeVisible: Boolean, fullScreenOverlayActive: Boolean): Boolean =
    activeStack.isEmpty() && !imeVisible && !fullScreenOverlayActive

  /** Iron rule 2: Left-edge sidebar swipe is enabled iff active stack is empty and no full-screen overlay. */
  fun allowSidebarEdgeSwipe(fullScreenOverlayActive: Boolean): Boolean =
    activeStack.isEmpty() && !fullScreenOverlayActive

  /** Ada unread only clears when strictly viewing Ada root in foreground with no sidebar or overlay. */
  fun shouldMarkPersonalRead(appInForeground: Boolean, fullScreenOverlayActive: Boolean): Boolean =
    selectedTab == MobileTab.Ada &&
      stackFor(MobileTab.Ada).isEmpty() &&
      !sidebarOpen &&
      appInForeground &&
      !fullScreenOverlayActive

  fun scrollToTopRevision(tab: MobileTab): Int = rootScrollToTopRevision[tab] ?: 0

  fun setSidebarOpen(open: Boolean): MobileNavSnapshot =
    if (sidebarOpen == open) this else copy(sidebarOpen = open)

  fun selectTab(tab: MobileTab): MobileNavSnapshot {
    if (tab != selectedTab) {
      return copy(selectedTab = tab, sidebarOpen = false)
    }
    // Active re-tap: pop to root if stack non-empty, otherwise trigger root scroll-to-top signal.
    val currentStack = stackFor(tab)
    return if (currentStack.isNotEmpty()) {
      copy(stacks = stacks + (tab to emptyList()), sidebarOpen = false)
    } else {
      val nextRev = (rootScrollToTopRevision[tab] ?: 0) + 1
      copy(
        sidebarOpen = false,
        rootScrollToTopRevision = rootScrollToTopRevision + (tab to nextRev),
      )
    }
  }

  fun push(route: MobileRoute, tab: MobileTab = selectedTab): MobileNavSnapshot {
    val current = stackFor(tab)
    return copy(
      stacks = stacks + (tab to (current + route)),
      sidebarOpen = false,
    )
  }

  fun pop(tab: MobileTab = selectedTab): MobileNavSnapshot {
    val current = stackFor(tab)
    if (current.isEmpty()) return this
    return copy(stacks = stacks + (tab to current.dropLast(1)))
  }

  fun popToRoot(tab: MobileTab = selectedTab): MobileNavSnapshot {
    if (stackFor(tab).isEmpty()) return this
    return copy(stacks = stacks + (tab to emptyList()))
  }

  /**
   * Opens an ordinary conversation (or new draft) on the Conversations host stack.
   * Replaces the top SessionChat if one is already on top, never stacking ordinary chats indefinitely.
   */
  fun openOrdinaryChat(
    conversationId: String?,
    draftId: String? = null,
    agentId: String = "main",
    title: String? = null,
  ): MobileNavSnapshot {
    val route = MobileRoute.SessionChat(
      conversationId = conversationId,
      draftId = draftId,
      agentId = agentId,
      title = title,
    )
    val conversationsStack = stackFor(MobileTab.Conversations)
    val nextConversationsStack = if (conversationsStack.lastOrNull() is MobileRoute.SessionChat) {
      conversationsStack.dropLast(1) + route
    } else {
      conversationsStack + route
    }
    return copy(
      selectedTab = MobileTab.Conversations,
      stacks = stacks + (MobileTab.Conversations to nextConversationsStack),
      sidebarOpen = false,
    )
  }

  /**
   * Switches ordinary chat from inside an open SessionChat, replacing the top SessionChat on the
   * active stack (preserving e.g. ConversationSearch predecessor when opened from search) or
   * routing to the Conversations host stack otherwise.
   */
  fun switchOrdinaryChat(
    conversationId: String,
    agentId: String = "main",
    title: String? = null,
  ): MobileNavSnapshot {
    val current = stackFor(selectedTab)
    if (current.lastOrNull() is MobileRoute.SessionChat) {
      val route = MobileRoute.SessionChat(
        conversationId = conversationId,
        agentId = agentId,
        title = title,
      )
      return copy(
        stacks = stacks + (selectedTab to (current.dropLast(1) + route)),
        sidebarOpen = false,
      )
    }
    return openOrdinaryChat(conversationId = conversationId, agentId = agentId, title = title)
  }

  /**
   * Promotes a draft SessionChat to its persisted server conversationId in-place (no pop+push),
   * keeping instanceId stable so keyboard, focus, and streaming never reset.
   */
  fun promoteSessionDraftInPlace(
    draftId: String,
    realConversationId: String,
    title: String? = null,
  ): MobileNavSnapshot {
    var changed = false
    val updatedStacks = stacks.mapValues { (_, stack) ->
      val last = stack.lastOrNull()
      if (last is MobileRoute.SessionChat && (last.draftId == draftId || last.conversationId == draftId)) {
        changed = true
        stack.dropLast(1) + last.copy(
          conversationId = realConversationId,
          draftId = null,
          title = title ?: last.title,
        )
      } else {
        stack
      }
    }
    return if (changed) copy(stacks = updatedStacks) else this
  }

  /**
   * Opens a conversation selected from ConversationSearch.
   * - Personal agent (Ada): jumps to Ada root (clears adaStack).
   * - Ordinary chat: pushes SessionChat directly on top of ConversationSearch so Back returns to search.
   */
  fun openFromSearch(
    conversationId: String,
    isPersonalAgent: Boolean,
    agentId: String = "main",
    title: String? = null,
  ): MobileNavSnapshot {
    if (isPersonalAgent) {
      return copy(
        selectedTab = MobileTab.Ada,
        stacks = stacks + (MobileTab.Ada to emptyList()),
        sidebarOpen = false,
      )
    }
    val route = MobileRoute.SessionChat(
      conversationId = conversationId,
      agentId = agentId,
      title = title,
    )
    val current = stackFor(selectedTab)
    val nextStack = if (current.lastOrNull() is MobileRoute.SessionChat) {
      current.dropLast(1) + route
    } else {
      current + route
    }
    return copy(
      stacks = stacks + (selectedTab to nextStack),
      sidebarOpen = false,
    )
  }

  /**
   * Low-frequency sidebar destinations (Automations / Capabilities / Settings / Search / AboutYou)
   * close the sidebar and push in-place onto the currently active tab stack.
   */
  fun openSidebarTool(route: MobileRoute): MobileNavSnapshot {
    val current = stackFor(selectedTab)
    val nextStack = if (current.lastOrNull() == route) current else current + route
    return copy(
      stacks = stacks + (selectedTab to nextStack),
      sidebarOpen = false,
    )
  }

  /**
   * Opens a task chat in-place on the active tab stack with loop prevention:
   * - Already on TaskChat(taskId) -> no-op
   * - Stack ends with [..., TaskChat(taskId), TaskDetail(taskId)] -> pop() instead of pushing duplicate
   * - Otherwise push TaskChat onto active stack.
   */
  fun openTaskChat(
    taskId: String,
    conversationId: String? = null,
    projectId: String? = null,
    title: String? = null,
  ): MobileNavSnapshot {
    val current = stackFor(selectedTab)
    val top = current.lastOrNull()
    if (top is MobileRoute.TaskChat && top.taskId == taskId) {
      val updated = if (conversationId != null && top.conversationId != conversationId) {
        current.dropLast(1) + top.copy(conversationId = conversationId, title = title ?: top.title)
      } else {
        current
      }
      return copy(stacks = stacks + (selectedTab to updated), sidebarOpen = false)
    }
    val previous = current.getOrNull(current.lastIndex - 1)
    if (previous is MobileRoute.TaskChat && previous.taskId == taskId) {
      return copy(stacks = stacks + (selectedTab to current.dropLast(1)), sidebarOpen = false)
    }
    val route = MobileRoute.TaskChat(
      taskId = taskId,
      conversationId = conversationId,
      projectId = projectId,
      title = title,
    )
    return copy(
      stacks = stacks + (selectedTab to (current + route)),
      sidebarOpen = false,
    )
  }

  /**
   * Opens a task detail in-place on the active tab stack with loop prevention.
   */
  fun openTaskDetail(taskId: String): MobileNavSnapshot {
    val current = stackFor(selectedTab)
    val top = current.lastOrNull()
    if (top is MobileRoute.TaskDetail && top.taskId == taskId) {
      return copy(sidebarOpen = false)
    }
    val previous = current.getOrNull(current.lastIndex - 1)
    if (previous is MobileRoute.TaskDetail && previous.taskId == taskId) {
      return copy(stacks = stacks + (selectedTab to current.dropLast(1)), sidebarOpen = false)
    }
    return push(MobileRoute.TaskDetail(taskId))
  }

  /**
   * Opens a project chat in-place on the active tab stack.
   */
  fun openProjectChat(projectId: String, conversationId: String? = null, title: String? = null): MobileNavSnapshot {
    val current = stackFor(selectedTab)
    val top = current.lastOrNull()
    val route = MobileRoute.ProjectChat(projectId, conversationId, title)
    val next = if (top is MobileRoute.ProjectChat && top.projectId == projectId) {
      current.dropLast(1) + route
    } else {
      current + route
    }
    return copy(stacks = stacks + (selectedTab to next), sidebarOpen = false)
  }

  /**
   * Future dynamic pinned-space arbitration:
   * - If spaceId is pinned in the bottom bar -> switch to PinnedSpace(spaceId) tab (L0).
   * - Otherwise -> switch to Library tab and push SpaceDetail(spaceId) (L1).
   */
  fun openSpace(spaceId: String): MobileNavSnapshot {
    if (spaceId in pinnedSpaceIds) {
      val tab = MobileTab.PinnedSpace(spaceId)
      return copy(
        selectedTab = tab,
        stacks = if (tab in stacks) stacks else stacks + (tab to emptyList()),
        sidebarOpen = false,
      )
    }
    val libStack = stackFor(MobileTab.Library)
    val route = MobileRoute.SpaceDetail(spaceId)
    val nextLibStack = if (libStack.lastOrNull() == route) libStack else libStack + route
    return copy(
      selectedTab = MobileTab.Library,
      stacks = stacks + (MobileTab.Library to nextLibStack),
      sidebarOpen = false,
    )
  }

  /**
   * Handles push notification / deep-link / external share targets with deterministic synthetic parent stacks.
   */
  fun openPushTarget(target: PushNavTarget): MobileNavSnapshot = when (target) {
    PushNavTarget.AdaHome -> copy(
      selectedTab = MobileTab.Ada,
      stacks = stacks + (MobileTab.Ada to emptyList()),
      sidebarOpen = false,
    )
    is PushNavTarget.OrdinaryChat -> copy(
      selectedTab = MobileTab.Conversations,
      stacks = stacks + (MobileTab.Conversations to listOf(
        MobileRoute.SessionChat(conversationId = target.conversationId, agentId = target.agentId, title = target.title),
      )),
      sidebarOpen = false,
    )
    is PushNavTarget.TaskDetail -> copy(
      selectedTab = MobileTab.Workbench,
      stacks = stacks + (MobileTab.Workbench to listOf(MobileRoute.TaskDetail(target.taskId))),
      sidebarOpen = false,
    )
    is PushNavTarget.TaskChat -> copy(
      selectedTab = MobileTab.Workbench,
      stacks = stacks + (MobileTab.Workbench to listOf(
        MobileRoute.TaskDetail(target.taskId),
        MobileRoute.TaskChat(taskId = target.taskId, conversationId = target.conversationId),
      )),
      sidebarOpen = false,
    )
    is PushNavTarget.AutomationRun -> copy(
      selectedTab = MobileTab.Workbench,
      stacks = stacks + (MobileTab.Workbench to listOf(
        MobileRoute.Automations,
        MobileRoute.AutomationRun(target.runId),
      )),
      sidebarOpen = false,
    )
    is PushNavTarget.NoteDetail -> copy(
      selectedTab = MobileTab.Notes,
      stacks = stacks + (MobileTab.Notes to listOf(MobileRoute.NoteDetail(target.noteId))),
      sidebarOpen = false,
    )
    is PushNavTarget.Settings -> openSidebarTool(MobileRoute.Settings(target.section))
  }

  /**
   * Automatically removes/pops any SessionChat whose conversation was deleted or returned 404.
   */
  fun onConversationDeletedOrMissing(conversationId: String): MobileNavSnapshot {
    var changed = false
    val cleaned = stacks.mapValues { (_, stack) ->
      val filtered = stack.filterNot { route ->
        route is MobileRoute.SessionChat && route.effectiveConversationId == conversationId
      }
      if (filtered.size != stack.size) changed = true
      filtered
    }
    return if (changed) copy(stacks = cleaned) else this
  }

  /**
   * Strict 5-level Back consumption priority:
   * 1. Transient UI (IME / composer action panel / L2 sheet or dialog)
   * 2. Sidebar drawer
   * 3. Active tab stack non-empty -> pop()
   * 4. Active tab stack empty & selectedTab != Ada -> switch to Ada
   * 5. Ada root -> allow system back (background app)
   */
  fun handleBack(hasTransientUi: Boolean): BackResult {
    if (hasTransientUi) {
      return BackResult(this, BackAction.DismissTransientUi)
    }
    if (sidebarOpen) {
      return BackResult(copy(sidebarOpen = false), BackAction.ClosedSidebar)
    }
    val current = activeStack
    if (current.isNotEmpty()) {
      val popped = current.last()
      return BackResult(
        state = copy(stacks = stacks + (selectedTab to current.dropLast(1))),
        action = BackAction.PoppedRoute(popped),
      )
    }
    if (selectedTab != MobileTab.Ada) {
      return BackResult(
        state = copy(selectedTab = MobileTab.Ada),
        action = BackAction.SwitchedToAda,
      )
    }
    return BackResult(this, BackAction.SystemBack)
  }

  /**
   * Atomically clears all tab stacks, closes sidebar, and resets to Ada root on gateway switch/removal.
   */
  fun resetForGatewaySwitch(): MobileNavSnapshot = MobileNavSnapshot(
    selectedTab = MobileTab.Ada,
    stacks = defaultStacks(),
    sidebarOpen = false,
    pinnedSpaceIds = emptySet(),
    rootScrollToTopRevision = emptyMap(),
  )

  companion object {
    fun defaultStacks(): Map<MobileTab, List<MobileRoute>> = mapOf(
      MobileTab.Ada to emptyList(),
      MobileTab.Conversations to emptyList(),
      MobileTab.Workbench to emptyList(),
      MobileTab.Notes to emptyList(),
      MobileTab.Library to emptyList(),
    )
  }
}

/**
 * Compose state holder wrapping MobileNavSnapshot for MainScreen.
 */
@Stable
internal class MobileTabNavState(initial: MobileNavSnapshot = MobileNavSnapshot()) {
  var snapshot by mutableStateOf(initial)
    private set

  val selectedTab: MobileTab get() = snapshot.selectedTab
  val stacks: Map<MobileTab, List<MobileRoute>> get() = snapshot.stacks
  val activeStack: List<MobileRoute> get() = snapshot.activeStack
  val topRoute: MobileRoute? get() = snapshot.topRoute
  val isAtRoot: Boolean get() = snapshot.isAtRoot
  val sidebarOpen: Boolean get() = snapshot.sidebarOpen

  fun stackFor(tab: MobileTab): List<MobileRoute> = snapshot.stackFor(tab)

  fun showBottomTabBar(imeVisible: Boolean, fullScreenOverlayActive: Boolean): Boolean =
    snapshot.showBottomTabBar(imeVisible, fullScreenOverlayActive)

  fun allowSidebarEdgeSwipe(fullScreenOverlayActive: Boolean): Boolean =
    snapshot.allowSidebarEdgeSwipe(fullScreenOverlayActive)

  fun shouldMarkPersonalRead(appInForeground: Boolean, fullScreenOverlayActive: Boolean): Boolean =
    snapshot.shouldMarkPersonalRead(appInForeground, fullScreenOverlayActive)

  fun scrollToTopRevision(tab: MobileTab): Int = snapshot.scrollToTopRevision(tab)

  fun setSidebarOpen(open: Boolean) {
    snapshot = snapshot.setSidebarOpen(open)
  }

  fun selectTab(tab: MobileTab) {
    snapshot = snapshot.selectTab(tab)
  }

  fun push(route: MobileRoute, tab: MobileTab = selectedTab) {
    snapshot = snapshot.push(route, tab)
  }

  fun pop(tab: MobileTab = selectedTab): MobileRoute? {
    val removed = snapshot.stackFor(tab).lastOrNull()
    snapshot = snapshot.pop(tab)
    return removed
  }

  fun popToRoot(tab: MobileTab = selectedTab) {
    snapshot = snapshot.popToRoot(tab)
  }

  fun openOrdinaryChat(
    conversationId: String?,
    draftId: String? = null,
    agentId: String = "main",
    title: String? = null,
  ) {
    snapshot = snapshot.openOrdinaryChat(conversationId, draftId, agentId, title)
  }

  fun switchOrdinaryChat(
    conversationId: String,
    agentId: String = "main",
    title: String? = null,
  ) {
    snapshot = snapshot.switchOrdinaryChat(conversationId, agentId, title)
  }

  fun promoteSessionDraftInPlace(draftId: String, realConversationId: String, title: String? = null) {
    snapshot = snapshot.promoteSessionDraftInPlace(draftId, realConversationId, title)
  }

  fun openFromSearch(
    conversationId: String,
    isPersonalAgent: Boolean,
    agentId: String = "main",
    title: String? = null,
  ) {
    snapshot = snapshot.openFromSearch(conversationId, isPersonalAgent, agentId, title)
  }

  fun openSidebarTool(route: MobileRoute) {
    snapshot = snapshot.openSidebarTool(route)
  }

  fun openTaskChat(taskId: String, conversationId: String? = null, projectId: String? = null, title: String? = null) {
    snapshot = snapshot.openTaskChat(taskId, conversationId, projectId, title)
  }

  fun openTaskDetail(taskId: String) {
    snapshot = snapshot.openTaskDetail(taskId)
  }

  fun openProjectChat(projectId: String, conversationId: String? = null, title: String? = null) {
    snapshot = snapshot.openProjectChat(projectId, conversationId, title)
  }

  fun openSpace(spaceId: String) {
    snapshot = snapshot.openSpace(spaceId)
  }

  fun openPushTarget(target: PushNavTarget) {
    snapshot = snapshot.openPushTarget(target)
  }

  fun onConversationDeletedOrMissing(conversationId: String) {
    snapshot = snapshot.onConversationDeletedOrMissing(conversationId)
  }

  fun handleBack(hasTransientUi: Boolean): BackAction {
    val result = snapshot.handleBack(hasTransientUi)
    snapshot = result.state
    return result.action
  }

  fun resetForGatewaySwitch() {
    snapshot = snapshot.resetForGatewaySwitch()
  }

  fun replaceTop(route: MobileRoute, tab: MobileTab = selectedTab) {
    val current = snapshot.stackFor(tab)
    val next = if (current.isEmpty()) listOf(route) else current.dropLast(1) + route
    snapshot = snapshot.copy(stacks = snapshot.stacks + (tab to next))
  }
}

@Composable
internal fun rememberMobileTabNavState(initial: MobileNavSnapshot = MobileNavSnapshot()): MobileTabNavState =
  remember { MobileTabNavState(initial) }
