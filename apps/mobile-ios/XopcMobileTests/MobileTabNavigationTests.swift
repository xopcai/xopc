import Foundation
import Testing
@testable import XopcMobile

@MainActor
struct MobileTabNavigationTests {
    private func makeAppState() -> AppState {
        AppState()
    }

    private func makePersonalRecord(conversationID: String = "ada-conv-1", displayName: String = "Ada") throws -> PersonalAgentRecord {
        let json = """
        {"agentId":"personal-1","conversationId":"\(conversationID)","state":"ready","displayName":"\(displayName)","appearance":"loopi","errorMessage":null}
        """
        return try JSONDecoder().decode(PersonalAgentRecord.self, from: Data(json.utf8))
    }

    @Test func coldStartDefaultsToAdaRootWithFiveCoreTabsOrdered() {
        let state = makeAppState()
        #expect(state.selectedTab == .ada)
        #expect(state.tabPaths.isEmpty)
        #expect(state.isShowingAdaRoot)
        #expect(MobileTab.coreTabs == [.ada, .conversations, .workbench, .notes, .library])
        #expect(MobileTab.ada.accessibilityID == "bottom-tab-ada")
        #expect(MobileTab.conversations.accessibilityID == "bottom-tab-conversations")
        #expect(MobileTab.workbench.accessibilityID == "bottom-tab-workbench")
        #expect(MobileTab.notes.accessibilityID == "bottom-tab-notes")
        #expect(MobileTab.library.accessibilityID == "bottom-tab-library")
        #expect(MobileTab.pinnedSpace("space-1").accessibilityID == "bottom-tab-space-space-1")
    }

    @Test func switchingTabsPreservesIndependentStacksAndActiveRetapBehavior() {
        let state = makeAppState()
        state.switchTab(.conversations)
        state.openTaskChat(taskID: "task-child-1", in: .conversations)
        #expect(state.selectedTab == .conversations)
        #expect(state.path(for: .conversations) == [.taskChat("task-child-1")])

        state.switchTab(.workbench)
        state.push(.projectDetail("proj-1"), in: .workbench)
        #expect(state.selectedTab == .workbench)
        #expect(state.path(for: .workbench) == [.projectDetail("proj-1")])
        #expect(state.path(for: .conversations) == [.taskChat("task-child-1")])

        state.switchTab(.notes)
        state.push(.noteDetail("note-1"), in: .notes)
        #expect(state.path(for: .workbench) == [.projectDetail("proj-1")])
        #expect(state.path(for: .notes) == [.noteDetail("note-1")])

        state.switchTab(.conversations)
        #expect(state.path(for: .conversations) == [.taskChat("task-child-1")])
        #expect(state.retapRevision(for: .conversations) == 0)

        // Active tab re-tap when non-empty pops to root.
        state.switchTab(.conversations)
        #expect(state.path(for: .conversations).isEmpty)
        #expect(state.retapRevision(for: .conversations) == 0)

        // Active tab re-tap at root bumps retap revision for scroll-to-top / section reset.
        state.switchTab(.conversations)
        #expect(state.retapRevision(for: .conversations) == 1)
        #expect(state.retapRevision(for: .workbench) == 0)
        #expect(state.retapRevision(for: .notes) == 0)
    }

    @Test func ordinarySessionChatLivesOnConversationsStackAndReplacesTop() throws {
        let state = makeAppState()
        let ada = try makePersonalRecord(conversationID: "ada-conv-1")
        state.syncPersonalAgent(ada)
        #expect(state.personalConversation?.id == "ada-conv-1")

        // Start in workbench with a deep route; opening an ordinary chat switches to Conversations tab without disturbing Ada or workbench.
        state.switchTab(.workbench)
        state.push(.projectDetail("proj-9"), in: .workbench)

        let chatA = ConversationSelection.existing(id: "chat-a", title: "Chat A", agentId: "main")
        state.openOrdinaryConversation(chatA)
        #expect(state.selectedTab == .conversations)
        #expect(state.path(for: .workbench) == [.projectDetail("proj-9")])
        #expect(state.path(for: .ada).isEmpty)
        #expect(state.path(for: .conversations).count == 1)
        #expect(state.activeSessionConversation?.id == "chat-a")
        #expect(state.personalConversation?.id == "ada-conv-1")
        #expect(!state.isShowingAdaRoot)

        // Switching to ordinary chat B replaces top in-place instead of growing the stack.
        let initialSlot = state.activeSessionRoute
        let chatB = ConversationSelection.existing(id: "chat-b", title: "Chat B", agentId: "coder")
        state.openOrdinaryConversation(chatB)
        #expect(state.selectedTab == .conversations)
        #expect(state.path(for: .conversations).count == 1)
        #expect(state.activeSessionRoute == initialSlot)
        #expect(state.activeSessionConversation?.id == "chat-b")
        #expect(state.personalConversation?.id == "ada-conv-1")

        // In-chat top-right switcher also replaces top .sessionChat on conversations stack.
        let chatC = ConversationSelection.existing(id: "chat-c", title: "Chat C", agentId: "main")
        state.replaceTopSessionChat(chatC, in: .conversations)
        #expect(state.path(for: .conversations).count == 1)
        #expect(state.activeSessionRoute == initialSlot)
        #expect(state.activeSessionConversation?.id == "chat-c")

        // Single pop returns straight to Conversations root with session slots pruned.
        state.pop(in: .conversations)
        #expect(state.selectedTab == .conversations)
        #expect(state.path(for: .conversations).isEmpty)
        #expect(state.activeSessionConversation == nil)
        #expect(state.personalConversation?.id == "ada-conv-1")
        #expect(state.sessionConversations.isEmpty)

        // Selecting Ada via openOrdinaryConversation routes directly to Ada root.
        let adaSelection = ConversationSelection.existing(id: "ada-conv-1", title: "Ada", agentId: "personal-1")
        state.openOrdinaryConversation(adaSelection)
        #expect(state.selectedTab == .ada)
        #expect(state.path(for: .ada).isEmpty)
        #expect(state.isShowingAdaRoot)
    }

    @Test func draftPromotionUpdatesConversationsStackInPlaceWithoutChangingRouteSlot() throws {
        let state = makeAppState()
        state.switchTab(.library)
        state.startConversation(agentId: "main")
        let initialRoute = state.activeSessionRoute
        let initialConversation = state.activeSessionConversation
        #expect(state.selectedTab == .conversations)
        #expect(initialRoute != nil)
        #expect(initialConversation?.isDraft == true)
        #expect(state.path(for: .conversations).count == 1)
        #expect(state.path(for: .ada).isEmpty)

        let draftID = initialConversation?.id ?? ""
        let promoted = initialConversation?.materialized(transcriptId: "tr-100")
        let previousPromotionRevision = state.sessionPromotionRevision
        try state.promoteSessionDraftInPlace(draftID: draftID, to: #require(promoted))

        #expect(state.selectedTab == .conversations)
        #expect(state.activeSessionRoute == initialRoute)
        #expect(state.path(for: .conversations).count == 1)
        #expect(state.activeSessionConversation?.isDraft == false)
        #expect(state.activeSessionConversation?.transcriptId == "tr-100")
        #expect(state.sessionPromotionRevision == previousPromotionRevision + 1)
    }

    @Test func openFromSearchPreservesSearchPredecessorAndRoutesAdaToRoot() throws {
        let state = makeAppState()
        try state.syncPersonalAgent(makePersonalRecord(conversationID: "ada-conv-1"))
        state.switchTab(.notes)
        state.openSidebarDestination(.conversationSearch)
        #expect(state.path(for: .notes) == [.conversationSearch])

        // Opening an ordinary conversation pushes above .conversationSearch on the current tab.
        let ordinary = ConversationSelection.existing(id: "chat-search-1", title: "Search Hit", agentId: "main")
        state.openFromSearch(ordinary)
        #expect(state.selectedTab == .notes)
        #expect(state.path(for: .notes).count == 2)
        #expect(state.path(for: .notes).first == .conversationSearch)
        #expect(state.activeSessionConversation?.id == "chat-search-1")

        // Switching inside that search-opened SessionChat replaces top in-place above .conversationSearch.
        let switched = ConversationSelection.existing(id: "chat-search-2", title: "Switched Hit", agentId: "main")
        state.replaceTopSessionChat(switched, in: .notes)
        #expect(state.path(for: .notes).count == 2)
        #expect(state.path(for: .notes).first == .conversationSearch)
        #expect(state.activeSessionConversation?.id == "chat-search-2")

        // Back returns to ConversationSearch.
        state.pop(in: .notes)
        #expect(state.path(for: .notes) == [.conversationSearch])

        // Clicking Ada from search switches to Ada root with empty Ada stack.
        let adaSelection = ConversationSelection.existing(id: "ada-conv-1", title: "Ada", agentId: "personal-1")
        state.openFromSearch(adaSelection)
        #expect(state.selectedTab == .ada)
        #expect(state.path(for: .ada).isEmpty)
        #expect(state.isShowingAdaRoot)
    }

    @Test func flattenedSidebarDestinationsPushOntoActiveTabWithCategoryDeepLinks() {
        let state = makeAppState()
        state.switchTab(.library)

        // All 6 flattened capability categories route with exact initialCategory.
        for category in ["plugins", "skills", "connections", "devices", "agents", "channels"] {
            state.popToRoot(in: .library)
            state.openSidebarDestination(.capabilities(initialCategory: category))
            #expect(state.selectedTab == .library)
            #expect(state.path(for: .library) == [.capabilities(initialCategory: category)])
        }

        // Duplicate top capability destination is ignored.
        state.openSidebarDestination(.capabilities(initialCategory: "channels"))
        #expect(state.path(for: .library) == [.capabilities(initialCategory: "channels")])

        // Workspace & Me flattened entries push cleanly onto active tab.
        state.popToRoot(in: .library)
        state.openSidebarDestination(.automations)
        state.openSidebarDestination(.shareCenter)
        state.openSidebarDestination(.aboutYou)
        state.openSidebarDestination(.personalGoals)
        #expect(state.selectedTab == .library)
        #expect(state.path(for: .library) == [.automations, .shareCenter, .aboutYou, .personalGoals])

        // Core tab destinations switch to that core tab at root.
        state.openSidebarDestination(.conversations)
        #expect(state.selectedTab == .conversations)
        #expect(state.path(for: .conversations).isEmpty)
    }

    @Test func deletingOrUnavailableOrdinaryChatPopsBackToConversationsRootWithoutAffectingAda() throws {
        let state = makeAppState()
        try state.syncPersonalAgent(makePersonalRecord(conversationID: "ada-conv-1"))
        state.openConversation(id: "chat-delete-me", title: "Temp", agentId: "main")
        #expect(state.selectedTab == .conversations)
        #expect(state.path(for: .conversations).count == 1)

        state.conversationUnavailable("chat-delete-me")
        #expect(state.selectedTab == .conversations)
        #expect(state.path(for: .conversations).isEmpty)
        #expect(state.activeSessionConversation == nil)
        #expect(state.personalConversation?.id == "ada-conv-1")

        // Ada's personal conversation is never dropped by conversationUnavailable.
        state.conversationUnavailable("ada-conv-1")
        #expect(state.personalConversation?.id == "ada-conv-1")
    }

    @Test func conversationsChildTaskPushPopAndWorkbenchLoopPrevention() {
        let state = makeAppState()

        // Child task row in ConversationsView pushes onto .conversations stack and pops cleanly back to root.
        state.switchTab(.conversations)
        state.openTaskChat(taskID: "task-child-42", in: .conversations)
        #expect(state.selectedTab == .conversations)
        #expect(state.path(for: .conversations) == [.taskChat("task-child-42")])
        state.pop(in: .conversations)
        #expect(state.path(for: .conversations).isEmpty)

        state.switchTab(.workbench)
        state.openTaskChat(taskID: "task-42")
        state.openTaskDetail(taskID: "task-42")
        #expect(state.path(for: .workbench) == [.taskChat("task-42"), .taskDetail("task-42")])

        // Tapping "Continue Task" from TaskDetail pops back to existing TaskChat instead of duplicating.
        state.openTaskChat(taskID: "task-42")
        #expect(state.path(for: .workbench) == [.taskChat("task-42")])

        // Same loop prevention in reverse: TaskDetail -> TaskChat -> TaskDetail pops back to TaskDetail.
        state.popToRoot(in: .workbench)
        state.openTaskDetail(taskID: "task-99")
        state.openTaskChat(taskID: "task-99")
        state.openTaskDetail(taskID: "task-99")
        #expect(state.path(for: .workbench) == [.taskDetail("task-99")])
    }

    @Test func pushNotificationsSynthesizeExpectedTabStacks() throws {
        let state = makeAppState()
        let ada = try makePersonalRecord(conversationID: "ada-conv-1")
        state.syncPersonalAgent(ada)

        // Task cold start synthesizes [taskDetail, taskChat] on workbench.
        state.openPushTarget(MobilePushTarget(kind: "task", taskId: "task-7"), personalConversationID: ada.conversationId)
        #expect(state.selectedTab == .workbench)
        #expect(state.path(for: .workbench) == [.taskDetail("task-7"), .taskChat("task-7")])

        // Automation run synthesizes [automations, libraryAutomationRun] on workbench.
        state.openPushTarget(MobilePushTarget(kind: "automation_run", runId: "run-9"), personalConversationID: ada.conversationId)
        #expect(state.selectedTab == .workbench)
        #expect(state.path(for: .workbench) == [.automations, .libraryAutomationRun("run-9")])

        // Ordinary chat push synthesizes [sessionChat] on conversations tab.
        state.openPushTarget(MobilePushTarget(kind: "chat", conversationId: "chat-push-1"), personalConversationID: ada.conversationId)
        #expect(state.selectedTab == .conversations)
        #expect(state.path(for: .conversations).count == 1)
        #expect(state.path(for: .ada).isEmpty)
        #expect(state.activeSessionConversation?.id == "chat-push-1")

        // Personal agent push lands directly on Ada root with empty stack.
        state.openPushTarget(MobilePushTarget(kind: "chat", conversationId: "ada-conv-1"), personalConversationID: ada.conversationId)
        #expect(state.selectedTab == .ada)
        #expect(state.path(for: .ada).isEmpty)
        #expect(state.isShowingAdaRoot)
    }

    @Test func clearAllStacksForGatewaySwitchResetsAllFiveTabsAndSessionState() throws {
        let state = makeAppState()
        try state.syncPersonalAgent(makePersonalRecord(conversationID: "ada-conv-1"))
        state.openConversation(id: "chat-1", title: "One", agentId: "main")
        state.switchTab(.workbench)
        state.push(.projectDetail("proj-1"), in: .workbench)
        state.switchTab(.notes)
        state.push(.noteDetail("note-1"), in: .notes)
        state.switchTab(.library)
        state.push(.shareCenter, in: .library)

        state.clearAllStacksForGatewaySwitch()
        #expect(state.selectedTab == .ada)
        #expect(state.tabPaths.isEmpty)
        #expect(state.sessionConversations.isEmpty)
        #expect(state.personalConversation == nil)
        #expect(state.isShowingAdaRoot)
    }
}

extension MobileTabNavigationTests {
    @Test func appShellMountsFiveTabStacksAndFlattenedSidebar() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("XopcMobile/App", isDirectory: true)
        let appRoot = try String(contentsOf: root.appendingPathComponent("AppRootView.swift"), encoding: .utf8)
        let tabBar = try String(contentsOf: root.appendingPathComponent("FloatingTabBar.swift"), encoding: .utf8)
        let sidebar = try String(contentsOf: root.appendingPathComponent("ChatSidebarView.swift"), encoding: .utf8)
        #expect(!appRoot.contains("reopenSidebar"))
        #expect(appRoot.contains("FloatingTabBar("))
        #expect(appRoot.contains("tabStack(for: .conversations)"))
        #expect(appRoot.contains("ShareCenterView("))
        #expect(appRoot.contains("initialCategory: initialCategory"))
        #expect(tabBar.contains("accessibilityReduceTransparency"))
        #expect(tabBar.contains("accessibilityReduceMotion"))
        #expect(tabBar.contains("bubble.left.and.bubble.right"))
        #expect(sidebar.contains("CapabilityCategory.allCases"))
        #expect(sidebar.contains(".shareCenter"))
        #expect(sidebar.contains(".personalGoals"))
        #expect(sidebar.contains(".aboutYou"))
        #expect(!sidebar.contains("chat-sidebar-session-"))
    }
}
