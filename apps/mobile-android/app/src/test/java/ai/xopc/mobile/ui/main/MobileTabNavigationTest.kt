package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ConversationMessage
import ai.xopc.mobile.gateway.PersonalAgentRecord
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileTabNavigationTest {

  @Test
  fun coldStartDefaultsToAdaRootWithVisibleTabBarAndSwipe() {
    val nav = MobileNavSnapshot()
    assertEquals(MobileTab.Ada, nav.selectedTab)
    assertTrue(nav.isAtRoot)
    assertFalse(nav.sidebarOpen)
    assertTrue(nav.showBottomTabBar(imeVisible = false, fullScreenOverlayActive = false))
    assertTrue(nav.allowSidebarEdgeSwipe(fullScreenOverlayActive = false))
    assertTrue(nav.shouldMarkPersonalRead(appInForeground = true, fullScreenOverlayActive = false))
  }

  @Test
  fun bottomTabBarAndSidebarSwipeFollowIronRules() {
    val root = MobileNavSnapshot(selectedTab = MobileTab.Ada)
    // IME hides bottom tab bar immediately
    assertFalse(root.showBottomTabBar(imeVisible = true, fullScreenOverlayActive = false))
    // Full-screen overlay hides both bottom bar and edge swipe
    assertFalse(root.showBottomTabBar(imeVisible = false, fullScreenOverlayActive = true))
    assertFalse(root.allowSidebarEdgeSwipe(fullScreenOverlayActive = true))

    // Entering any L1 screen forces bottom tab bar hidden and disables sidebar edge swipe
    val pushed = root.openOrdinaryChat(conversationId = "chat-1")
    assertFalse(pushed.isAtRoot)
    assertFalse(pushed.showBottomTabBar(imeVisible = false, fullScreenOverlayActive = false))
    assertFalse(pushed.allowSidebarEdgeSwipe(fullScreenOverlayActive = false))
  }

  @Test
  fun tabSwitchingPreservesIndependentStacksAcrossAllCoreTabs() {
    var nav = MobileNavSnapshot()
    nav = nav.selectTab(MobileTab.Workbench)
      .push(MobileRoute.ProjectDetail("proj-1"))
      .push(MobileRoute.ProjectChat("proj-1", "conv-p1"))

    nav = nav.selectTab(MobileTab.Notes)
      .push(MobileRoute.NoteDetail("note-1"))

    nav = nav.selectTab(MobileTab.Ada)
    assertTrue(nav.activeStack.isEmpty())
    assertTrue(nav.showBottomTabBar(imeVisible = false, fullScreenOverlayActive = false))

    // Returning to Workbench restores its deep stack intact
    nav = nav.selectTab(MobileTab.Workbench)
    assertEquals(
      listOf(MobileRoute.ProjectDetail("proj-1"), MobileRoute.ProjectChat("proj-1", "conv-p1")),
      nav.activeStack,
    )
    assertFalse(nav.showBottomTabBar(imeVisible = false, fullScreenOverlayActive = false))

    // Notes stack also remains intact
    assertEquals(listOf(MobileRoute.NoteDetail("note-1")), nav.stackFor(MobileTab.Notes))
  }

  @Test
  fun activeRetapPopsToRootOrTriggersScrollToTopAtRoot() {
    var nav = MobileNavSnapshot()
      .selectTab(MobileTab.Workbench)
      .push(MobileRoute.TaskDetail("task-1"))
      .push(MobileRoute.TaskChat("task-1"))
    assertEquals(2, nav.activeStack.size)
    assertEquals(0, nav.scrollToTopRevision(MobileTab.Workbench))

    // Active re-tap with non-empty stack pops to root
    nav = nav.selectTab(MobileTab.Workbench)
    assertTrue(nav.activeStack.isEmpty())
    assertEquals(0, nav.scrollToTopRevision(MobileTab.Workbench))

    // Active re-tap already at root increments scroll-to-top signal
    nav = nav.selectTab(MobileTab.Workbench)
    assertTrue(nav.activeStack.isEmpty())
    assertEquals(1, nav.scrollToTopRevision(MobileTab.Workbench))
    assertEquals(0, nav.scrollToTopRevision(MobileTab.Ada))
  }

  @Test
  fun ordinaryChatSwitchesToAdaAndReplacesTopSessionChatWithoutStacking() {
    var nav = MobileNavSnapshot()
      .selectTab(MobileTab.Workbench)
      .push(MobileRoute.ProjectDetail("proj-1"))
      .setSidebarOpen(true)

    // Opening ordinary chat A from Workbench switches to Ada and protects Workbench stack
    nav = nav.openOrdinaryChat(conversationId = "chat-a", title = "Chat A")
    assertEquals(MobileTab.Ada, nav.selectedTab)
    assertFalse(nav.sidebarOpen)
    assertEquals(1, nav.activeStack.size)
    assertEquals("chat-a", (nav.topRoute as MobileRoute.SessionChat).conversationId)
    assertEquals(listOf(MobileRoute.ProjectDetail("proj-1")), nav.stackFor(MobileTab.Workbench))

    // Continuous switch A -> B -> C replaces top SessionChat (stack depth stays 1)
    nav = nav.openOrdinaryChat(conversationId = "chat-b", title = "Chat B")
    nav = nav.openOrdinaryChat(conversationId = "chat-c", title = "Chat C")
    assertEquals(1, nav.activeStack.size)
    assertEquals("chat-c", (nav.topRoute as MobileRoute.SessionChat).conversationId)

    // Single back returns directly to AdaRoot
    val back = nav.handleBack(hasTransientUi = false)
    assertTrue(back.action is BackAction.PoppedRoute)
    assertEquals(MobileTab.Ada, back.state.selectedTab)
    assertTrue(back.state.activeStack.isEmpty())
    assertTrue(back.state.showBottomTabBar(imeVisible = false, fullScreenOverlayActive = false))
  }

  @Test
  fun draftPromotionUpdatesTopSessionChatInPlacePreservingInstanceKey() {
    var nav = MobileNavSnapshot()
      .openOrdinaryChat(conversationId = null, draftId = "draft-123", agentId = "coder")
    val before = nav.topRoute as MobileRoute.SessionChat
    assertEquals("draft-123", before.effectiveConversationId)
    val originalKey = before.routeKey

    nav = nav.promoteSessionDraftInPlace("draft-123", "server-uuid-999", title = "Hello")
    val after = nav.topRoute as MobileRoute.SessionChat
    assertEquals(1, nav.activeStack.size)
    assertEquals("server-uuid-999", after.conversationId)
    assertNull(after.draftId)
    assertEquals("Hello", after.title)
    assertEquals("Instance routeKey must remain stable during draft promotion", originalKey, after.routeKey)
  }

  @Test
  fun openFromSearchPreservesSearchPredecessorAndJumpsToAdaForPersonal() {
    var nav = MobileNavSnapshot()
      .selectTab(MobileTab.Notes)
      .setSidebarOpen(true)
      .openSidebarTool(MobileRoute.ConversationSearch())

    assertEquals(MobileTab.Notes, nav.selectedTab)
    assertEquals(listOf(MobileRoute.ConversationSearch()), nav.activeStack)

    // Selecting ordinary chat from search pushes on top of ConversationSearch
    nav = nav.openFromSearch(conversationId = "chat-hit", isPersonalAgent = false, title = "Hit")
    assertEquals(MobileTab.Notes, nav.selectedTab)
    assertEquals(2, nav.activeStack.size)
    assertTrue(nav.activeStack[0] is MobileRoute.ConversationSearch)
    assertEquals("chat-hit", (nav.activeStack[1] as MobileRoute.SessionChat).conversationId)

    // Back returns to ConversationSearch first
    val backToSearch = nav.handleBack(hasTransientUi = false).state
    assertEquals(listOf(MobileRoute.ConversationSearch()), backToSearch.activeStack)

    // Selecting Ada from search jumps to Ada root with empty adaStack
    val jumped = backToSearch.openFromSearch(conversationId = "ada-id", isPersonalAgent = true)
    assertEquals(MobileTab.Ada, jumped.selectedTab)
    assertTrue(jumped.activeStack.isEmpty())
  }

  @Test
  fun sidebarLowFrequencyToolsPushInPlaceOnActiveTabWithoutReturnToSidebar() {
    val nav = MobileNavSnapshot()
      .selectTab(MobileTab.Library)
      .setSidebarOpen(true)
      .openSidebarTool(MobileRoute.Capabilities())

    assertEquals(MobileTab.Library, nav.selectedTab)
    assertFalse(nav.sidebarOpen)
    assertEquals(listOf(MobileRoute.Capabilities()), nav.activeStack)

    val popped = nav.handleBack(hasTransientUi = false).state
    assertEquals(MobileTab.Library, popped.selectedTab)
    assertTrue(popped.activeStack.isEmpty())
    assertFalse(popped.sidebarOpen)
  }

  @Test
  fun taskChatPushesInPlaceAcrossTabsAndPreventsTaskDetailLoop() {
    // From Ada root
    val fromAda = MobileNavSnapshot().openTaskChat("t-1")
    assertEquals(MobileTab.Ada, fromAda.selectedTab)
    assertEquals(listOf(MobileRoute.TaskChat("t-1")), fromAda.activeStack)

    // From Workbench -> TaskDetail -> TaskChat
    val fromWorkbench = MobileNavSnapshot()
      .selectTab(MobileTab.Workbench)
      .openTaskDetail("t-2")
      .openTaskChat("t-2")
    assertEquals(listOf(MobileRoute.TaskDetail("t-2"), MobileRoute.TaskChat("t-2")), fromWorkbench.activeStack)

    // From Library
    val fromLibrary = MobileNavSnapshot()
      .selectTab(MobileTab.Library)
      .openTaskChat("t-3")
    assertEquals(MobileTab.Library, fromLibrary.selectedTab)
    assertEquals(listOf(MobileRoute.TaskChat("t-3")), fromLibrary.activeStack)

    // Loop prevention: TaskChat(t-1) -> TaskDetail(t-1) -> openTaskChat(t-1) pops TaskDetail instead of duplicating
    val withDetail = fromAda.openTaskDetail("t-1")
    assertEquals(listOf(MobileRoute.TaskChat("t-1"), MobileRoute.TaskDetail("t-1")), withDetail.activeStack)
    val resumed = withDetail.openTaskChat("t-1")
    assertEquals(listOf(MobileRoute.TaskChat("t-1")), resumed.activeStack)

    // Calling openTaskChat(t-1) while already on TaskChat(t-1) does not duplicate
    val deduped = resumed.openTaskChat("t-1", conversationId = "cid-t1")
    assertEquals(listOf(MobileRoute.TaskChat("t-1", conversationId = "cid-t1")), deduped.activeStack)
  }

  @Test
  fun pushNotificationTargetsConstructSyntheticParentStacks() {
    val taskChat = MobileNavSnapshot().openPushTarget(PushNavTarget.TaskChat("t-9"))
    assertEquals(MobileTab.Workbench, taskChat.selectedTab)
    assertEquals(
      listOf(MobileRoute.TaskDetail("t-9"), MobileRoute.TaskChat("t-9")),
      taskChat.activeStack,
    )
    // Back chain: TaskChat -> TaskDetail -> WorkbenchRoot -> AdaRoot
    val s1 = taskChat.handleBack(false).state
    assertEquals(listOf(MobileRoute.TaskDetail("t-9")), s1.activeStack)
    val s2 = s1.handleBack(false).state
    assertTrue(s2.activeStack.isEmpty())
    assertEquals(MobileTab.Workbench, s2.selectedTab)
    val s3 = s2.handleBack(false).state
    assertEquals(MobileTab.Ada, s3.selectedTab)

    val autoRun = MobileNavSnapshot().openPushTarget(PushNavTarget.AutomationRun("run-7"))
    assertEquals(MobileTab.Workbench, autoRun.selectedTab)
    assertEquals(listOf(MobileRoute.Automations, MobileRoute.AutomationRun("run-7")), autoRun.activeStack)

    val note = MobileNavSnapshot().openPushTarget(PushNavTarget.NoteDetail("note-5"))
    assertEquals(MobileTab.Notes, note.selectedTab)
    assertEquals(listOf(MobileRoute.NoteDetail("note-5")), note.activeStack)

    val chat = MobileNavSnapshot().openPushTarget(PushNavTarget.OrdinaryChat("cid-5"))
    assertEquals(MobileTab.Ada, chat.selectedTab)
    assertEquals("cid-5", (chat.topRoute as MobileRoute.SessionChat).conversationId)
  }

  @Test
  fun backHandlingFollowsStrictFiveLevelPriorityOrder() {
    var nav = MobileNavSnapshot()
      .selectTab(MobileTab.Notes)
      .push(MobileRoute.NoteDetail("n-1"))
      .setSidebarOpen(true)

    // 1. Transient UI wins over sidebar and stack
    val r1 = nav.handleBack(hasTransientUi = true)
    assertEquals(BackAction.DismissTransientUi, r1.action)
    assertTrue(r1.state.sidebarOpen)
    assertEquals(1, r1.state.activeStack.size)

    // 2. Sidebar closes next
    val r2 = r1.state.handleBack(hasTransientUi = false)
    assertEquals(BackAction.ClosedSidebar, r2.action)
    assertFalse(r2.state.sidebarOpen)
    assertEquals(1, r2.state.activeStack.size)

    // 3. Active stack pops next
    val r3 = r2.state.handleBack(hasTransientUi = false)
    assertTrue(r3.action is BackAction.PoppedRoute)
    assertTrue(r3.state.activeStack.isEmpty())
    assertEquals(MobileTab.Notes, r3.state.selectedTab)

    // 4. Non-Ada root switches to Ada
    val r4 = r3.state.handleBack(hasTransientUi = false)
    assertEquals(BackAction.SwitchedToAda, r4.action)
    assertEquals(MobileTab.Ada, r4.state.selectedTab)

    // 5. Ada root yields SystemBack
    val r5 = r4.state.handleBack(hasTransientUi = false)
    assertEquals(BackAction.SystemBack, r5.action)
  }

  @Test
  fun deletingOrMissingOrdinaryChatPopsBackToAdaRoot() {
    val nav = MobileNavSnapshot()
      .openOrdinaryChat(conversationId = "gone-chat")
    val cleaned = nav.onConversationDeletedOrMissing("gone-chat")
    assertEquals(MobileTab.Ada, cleaned.selectedTab)
    assertTrue(cleaned.activeStack.isEmpty())
  }

  @Test
  fun personalUnreadClearsStrictlyAtAdaRootInForeground() {
    val adaRoot = MobileNavSnapshot()
    assertTrue(adaRoot.shouldMarkPersonalRead(appInForeground = true, fullScreenOverlayActive = false))
    assertFalse(adaRoot.shouldMarkPersonalRead(appInForeground = false, fullScreenOverlayActive = false))
    assertFalse(adaRoot.shouldMarkPersonalRead(appInForeground = true, fullScreenOverlayActive = true))
    assertFalse(adaRoot.setSidebarOpen(true).shouldMarkPersonalRead(appInForeground = true, fullScreenOverlayActive = false))
    assertFalse(adaRoot.openOrdinaryChat("other-chat").shouldMarkPersonalRead(appInForeground = true, fullScreenOverlayActive = false))
    assertFalse(adaRoot.selectTab(MobileTab.Workbench).shouldMarkPersonalRead(appInForeground = true, fullScreenOverlayActive = false))
  }

  @Test
  fun gatewaySwitchAtomicallyClearsAllStacksAndResetsToAdaRoot() {
    val dirty = MobileNavSnapshot()
      .selectTab(MobileTab.Workbench)
      .push(MobileRoute.ProjectDetail("p1"))
      .openOrdinaryChat("c1")
      .setSidebarOpen(true)

    val clean = dirty.resetForGatewaySwitch()
    assertEquals(MobileTab.Ada, clean.selectedTab)
    assertFalse(clean.sidebarOpen)
    for (tab in MobileTab.coreTabs) {
      assertTrue("Stack for ${tab.key} must be empty after gateway switch", clean.stackFor(tab).isEmpty())
    }
  }

  @Test
  fun pinnedSpaceArbitrationRoutesToTabWhenPinnedElseLibraryStack() {
    val unpinned = MobileNavSnapshot().openSpace("space-alpha")
    assertEquals(MobileTab.Library, unpinned.selectedTab)
    assertEquals(listOf(MobileRoute.SpaceDetail("space-alpha")), unpinned.activeStack)
    assertFalse(unpinned.showBottomTabBar(imeVisible = false, fullScreenOverlayActive = false))

    val pinned = MobileNavSnapshot(pinnedSpaceIds = setOf("space-alpha")).openSpace("space-alpha")
    assertEquals(MobileTab.PinnedSpace("space-alpha"), pinned.selectedTab)
    assertTrue(pinned.activeStack.isEmpty())
    assertTrue(pinned.showBottomTabBar(imeVisible = false, fullScreenOverlayActive = false))
  }

  @Test
  fun adaRootStateIsolationPreservesAdaSnapshotWhileViewingOrdinaryChat() {
    val adaAgent = PersonalAgentRecord(
      agentId = "personal-1",
      conversationId = "ada-conv-id",
      state = "ready",
      displayName = "Ada",
      appearance = "loopi",
      errorMessage = null,
    )
    val adaMessages = listOf(ConversationMessage("m1", "assistant", "Ada message"))
    val adaSnapshot = ChatSessionSnapshot(
      conversationId = "ada-conv-id",
      messages = adaMessages,
      draftText = "Ada unsent draft",
      activeRunId = "ada-run-1",
    )
    val viewingOrdinary = ConnectionUiState(
      selectedConversationId = "ordinary-conv-id",
      messages = listOf(ConversationMessage("m2", "assistant", "Ordinary message")),
      draftText = "Ordinary draft",
      personal = PersonalUiState(agent = adaAgent),
      personalChatSnapshot = adaSnapshot,
    )

    val isolatedAda = viewingOrdinary.forAdaRoot()
    assertEquals("ada-conv-id", isolatedAda.selectedConversationId)
    assertEquals(adaMessages, isolatedAda.messages)
    assertEquals("Ada unsent draft", isolatedAda.draftText)
    assertEquals("ada-run-1", isolatedAda.activeRunId)
    assertNotNull(viewingOrdinary.snapshotCurrentChat())
    assertEquals("ordinary-conv-id", viewingOrdinary.snapshotCurrentChat()?.conversationId)
  }

  @Test
  fun legacyRoutingPatchesAndDuplicateSidebarShortcutsAreRemoved() {
    val uiMainDir = listOf(
      File("src/main/java/ai/xopc/mobile/ui/main"),
      File("app/src/main/java/ai/xopc/mobile/ui/main"),
    ).first { it.isDirectory }

    val mainScreen = File(uiMainDir, "MainScreen.kt").readText()
    assertFalse("returnToSidebar must be removed from MainScreen.kt", mainScreen.contains("returnToSidebar"))
    assertFalse("linkedDetails must be removed from MainScreen.kt", mainScreen.contains("linkedDetails"))

    val sidebar = File(uiMainDir, "ChatSidebar.kt").readText()
    for (removedTag in listOf("chat-sidebar-personal", "chat-sidebar-workbench", "chat-sidebar-notes", "chat-sidebar-library")) {
      assertFalse("Duplicate sidebar shortcut $removedTag must be removed", sidebar.contains(removedTag))
    }
    for (keptTag in listOf("chat-sidebar-search", "chat-sidebar-automations", "chat-sidebar-capabilities", "chat-sidebar-about", "chat-sidebar-new", "chat-sidebar-profile")) {
      assertTrue("Slimmed sidebar must contain $keptTag", sidebar.contains(keptTag))
    }
  }
}
