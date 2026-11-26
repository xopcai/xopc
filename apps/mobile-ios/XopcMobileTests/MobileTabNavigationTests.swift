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

    @Test func coldStartDefaultsToAdaRootWithCoreTabsOrdered() {
        let state = makeAppState()
        #expect(state.selectedTab == .ada)
        #expect(state.tabPaths.isEmpty)
        #expect(state.isShowingAdaRoot)
        #expect(MobileTab.coreTabs == [.ada, .workbench, .notes, .library])
        #expect(MobileTab.pinnedSpace("space-1").accessibilityID == "bottom-tab-space-space-1")
    }

    @Test func switchingTabsPreservesIndependentStacksAndActiveRetapBehavior() {
        let state = makeAppState()
        state.switchTab(.workbench)
        state.push(.projectDetail("proj-1"), in: .workbench)
        #expect(state.selectedTab == .workbench)
        #expect(state.path(for: .workbench) == [.projectDetail("proj-1")])

        state.switchTab(.notes)
        state.push(.noteDetail("note-1"), in: .notes)
        #expect(state.path(for: .workbench) == [.projectDetail("proj-1")])
        #expect(state.path(for: .notes) == [.noteDetail("note-1")])

        state.switchTab(.workbench)
        #expect(state.path(for: .workbench) == [.projectDetail("proj-1")])
        #expect(state.retapRevision(for: .workbench) == 0)

        // Active tab re-tap when non-empty pops to root.
        state.switchTab(.workbench)
        #expect(state.path(for: .workbench).isEmpty)
        #expect(state.retapRevision(for: .workbench) == 0)

        // Active tab re-tap at root bumps retap revision for scroll-to-top / section reset.
        state.switchTab(.workbench)
        #expect(state.retapRevision(for: .workbench) == 1)
        #expect(state.retapRevision(for: .notes) == 0)
    }

    @Test func ordinarySessionChatIsIsolatedFromAdaAndReplacesTop() throws {
        let state = makeAppState()
        let ada = try makePersonalRecord(conversationID: "ada-conv-1")
        state.syncPersonalAgent(ada)
        #expect(state.personalConversation?.id == "ada-conv-1")

        // Start in workbench with a deep route; opening an ordinary chat switches to Ada tab without disturbing workbench.
        state.switchTab(.workbench)
        state.push(.projectDetail("proj-9"), in: .workbench)

        let chatA = ConversationSelection.existing(id: "chat-a", title: "Chat A", agentId: "main")
        state.openOrdinaryConversation(chatA)
        #expect(state.selectedTab == .ada)
        #expect(state.path(for: .workbench) == [.projectDetail("proj-9")])
        #expect(state.path(for: .ada).count == 1)
        #expect(state.activeSessionConversation?.id == "chat-a")
        #expect(state.personalConversation?.id == "ada-conv-1")
        #expect(!state.isShowingAdaRoot)

        // Switching to ordinary chat B replaces top in-place instead of growing the stack.
        let chatB = ConversationSelection.existing(id: "chat-b", title: "Chat B", agentId: "coder")
        state.openOrdinaryConversation(chatB)
        #expect(state.path(for: .ada).count == 1)
        #expect(state.activeSessionConversation?.id == "chat-b")
        #expect(state.personalConversation?.id == "ada-conv-1")

        // Single pop returns straight to Ada root with personalConversation untouched.
        state.pop(in: .ada)
        #expect(state.isShowingAdaRoot)
        #expect(state.activeSessionConversation == nil)
        #expect(state.personalConversation?.id == "ada-conv-1")
        #expect(state.sessionConversations.isEmpty)
    }

    @Test func draftPromotionUpdatesTopSessionChatInPlaceWithoutChangingRouteSlot() throws {
        let state = makeAppState()
        state.startConversation(agentId: "main")
        let initialRoute = state.activeSessionRoute
        let initialConversation = state.activeSessionConversation
        #expect(initialRoute != nil)
        #expect(initialConversation?.isDraft == true)
        #expect(state.path(for: .ada).count == 1)

        let draftID = initialConversation?.id ?? ""
        let promoted = initialConversation?.materialized(transcriptId: "tr-100")
        let previousPromotionRevision = state.sessionPromotionRevision
        try state.promoteSessionDraftInPlace(draftID: draftID, to: #require(promoted))

        #expect(state.activeSessionRoute == initialRoute)
        #expect(state.path(for: .ada).count == 1)
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

    @Test func openSidebarDestinationPushesOntoActiveTabAndAvoidsDuplicateTop() {
        let state = makeAppState()
        state.switchTab(.library)
        state.openSidebarDestination(.automations)
        state.openSidebarDestination(.automations)
        #expect(state.selectedTab == .library)
        #expect(state.path(for: .library) == [.automations])

        state.openSidebarDestination(.aboutYou)
        #expect(state.path(for: .library) == [.automations, .aboutYou])
    }

    @Test func deletingOrUnavailableOrdinaryChatPopsBackToAdaRootWithoutAffectingAda() throws {
        let state = makeAppState()
        try state.syncPersonalAgent(makePersonalRecord(conversationID: "ada-conv-1"))
        state.openConversation(id: "chat-delete-me", title: "Temp", agentId: "main")
        #expect(state.path(for: .ada).count == 1)

        state.conversationUnavailable("chat-delete-me")
        #expect(state.path(for: .ada).isEmpty)
        #expect(state.isShowingAdaRoot)
        #expect(state.personalConversation?.id == "ada-conv-1")

        // Ada's personal conversation is never dropped by conversationUnavailable.
        state.conversationUnavailable("ada-conv-1")
        #expect(state.personalConversation?.id == "ada-conv-1")
    }

    @Test func taskChatAndTaskDetailPreventNavigationLoops() {
        let state = makeAppState()
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

        // Ordinary chat push synthesizes [sessionChat] on ada.
        state.openPushTarget(MobilePushTarget(kind: "chat", conversationId: "chat-push-1"), personalConversationID: ada.conversationId)
        #expect(state.selectedTab == .ada)
        #expect(state.path(for: .ada).count == 1)
        #expect(state.activeSessionConversation?.id == "chat-push-1")

        // Personal agent push lands directly on Ada root with empty stack.
        state.openPushTarget(MobilePushTarget(kind: "chat", conversationId: "ada-conv-1"), personalConversationID: ada.conversationId)
        #expect(state.selectedTab == .ada)
        #expect(state.path(for: .ada).isEmpty)
        #expect(state.isShowingAdaRoot)
    }

    @Test func clearAllStacksForGatewaySwitchResetsAllTabsAndSessionState() throws {
        let state = makeAppState()
        try state.syncPersonalAgent(makePersonalRecord(conversationID: "ada-conv-1"))
        state.openConversation(id: "chat-1", title: "One", agentId: "main")
        state.switchTab(.workbench)
        state.push(.projectDetail("proj-1"), in: .workbench)
        state.switchTab(.notes)
        state.push(.noteDetail("note-1"), in: .notes)

        state.clearAllStacksForGatewaySwitch()
        #expect(state.selectedTab == .ada)
        #expect(state.tabPaths.isEmpty)
        #expect(state.sessionConversations.isEmpty)
        #expect(state.personalConversation == nil)
        #expect(state.isShowingAdaRoot)
    }

    @Test func appRootRemovesReopenSidebarAndMountsFloatingTabBar() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("XopcMobile/App", isDirectory: true)
        let appRoot = try String(contentsOf: root.appendingPathComponent("AppRootView.swift"), encoding: .utf8)
        let tabBar = try String(contentsOf: root.appendingPathComponent("FloatingTabBar.swift"), encoding: .utf8)
        #expect(!appRoot.contains("reopenSidebar"))
        #expect(appRoot.contains("FloatingTabBar("))
        #expect(tabBar.contains("accessibilityReduceTransparency"))
        #expect(tabBar.contains("accessibilityReduceMotion"))
    }
}
