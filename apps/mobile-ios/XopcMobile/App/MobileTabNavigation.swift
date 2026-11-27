import Foundation
import SwiftUI

enum MobileTab: Hashable, Sendable {
    case ada
    case conversations
    case workbench
    case notes
    case library
    case pinnedSpace(String)

    static let coreTabs: [MobileTab] = [.ada, .conversations, .workbench, .notes, .library]

    var accessibilityID: String {
        switch self {
        case .ada: "bottom-tab-ada"
        case .conversations: "bottom-tab-conversations"
        case .workbench: "bottom-tab-workbench"
        case .notes: "bottom-tab-notes"
        case .library: "bottom-tab-library"
        case let .pinnedSpace(spaceID): "bottom-tab-space-\(spaceID)"
        }
    }
}

struct SessionChatRoute: Hashable, Sendable {
    let slotID: UUID

    init(slotID: UUID = UUID()) {
        self.slotID = slotID
    }
}

enum HomeDestination: Hashable, Sendable {
    case sessionChat(SessionChatRoute)
    case conversations, conversationSearch
    case progress, projects, automations, notes, library, shareCenter, settings, files
    case capabilities(initialCategory: String? = nil)
    case aboutYou, personalGoals
    case settingsSection(MobileSettingsSection)
    case personalOverview(allowsConversationSharing: Bool)
    case taskDetail(String), taskChat(String)
    case projectDetail(String), automationDetail(String), noteDetail(String)
    case libraryTask(String), libraryAutomationRun(String), notificationTask(String)

    var sessionChatRoute: SessionChatRoute? {
        if case let .sessionChat(route) = self {
            return route
        }
        return nil
    }
}

extension AppState {
    var activeStack: [HomeDestination] {
        get { path(for: selectedTab) }
        set { setPath(newValue, for: selectedTab) }
    }

    var isShowingAdaRoot: Bool {
        selectedTab == .ada && path(for: .ada).isEmpty
    }

    var activeSessionRoute: SessionChatRoute? {
        activeStack.last?.sessionChatRoute
    }

    var activeSessionConversation: ConversationSelection? {
        activeSessionRoute.flatMap { sessionConversations[$0.slotID] }
    }

    var activeConversation: ConversationSelection? {
        if let activeSessionConversation {
            return activeSessionConversation
        }
        return personalConversation
    }

    func path(for tab: MobileTab) -> [HomeDestination] {
        tabPaths[tab] ?? []
    }

    func setPath(_ newPath: [HomeDestination], for tab: MobileTab) {
        if newPath.isEmpty {
            tabPaths.removeValue(forKey: tab)
        } else {
            tabPaths[tab] = newPath
        }
        pruneOrphanedSessionConversations()
    }

    func pathBinding(for tab: MobileTab) -> Binding<[HomeDestination]> {
        Binding(
            get: { self.path(for: tab) },
            set: { self.setPath($0, for: tab) }
        )
    }

    func sessionConversation(for route: SessionChatRoute) -> ConversationSelection? {
        sessionConversations[route.slotID]
    }

    func retapRevision(for tab: MobileTab) -> Int {
        tabRetapRevision[tab] ?? 0
    }

    func push(_ destination: HomeDestination, in tab: MobileTab? = nil) {
        let targetTab = tab ?? selectedTab
        var stack = path(for: targetTab)
        stack.append(destination)
        setPath(stack, for: targetTab)
    }

    @discardableResult
    func pop(in tab: MobileTab? = nil) -> HomeDestination? {
        let targetTab = tab ?? selectedTab
        var stack = path(for: targetTab)
        guard !stack.isEmpty else { return nil }
        let removed = stack.removeLast()
        setPath(stack, for: targetTab)
        return removed
    }

    func popToRoot(in tab: MobileTab? = nil) {
        let targetTab = tab ?? selectedTab
        setPath([], for: targetTab)
    }

    func switchTab(_ tab: MobileTab) {
        if selectedTab == tab {
            if !path(for: tab).isEmpty {
                popToRoot(in: tab)
            } else {
                tabRetapRevision[tab, default: 0] += 1
            }
        } else {
            selectedTab = tab
        }
    }

    func openPersonalAgent(_ record: PersonalAgentRecord? = nil) {
        if let record {
            syncPersonalAgent(record)
        }
        selectedTab = .ada
        popToRoot(in: .ada)
    }

    func openOrdinaryConversation(_ conversation: ConversationSelection) {
        if let personalID = personalConversation?.id, conversation.id == personalID {
            openPersonalAgent()
            return
        }
        selectedTab = .conversations
        let stack = path(for: .conversations)
        if stack.count == 1, let existingRoute = stack.first?.sessionChatRoute {
            sessionConversations[existingRoute.slotID] = conversation
        } else {
            let route = SessionChatRoute()
            sessionConversations[route.slotID] = conversation
            setPath([.sessionChat(route)], for: .conversations)
        }
    }

    func replaceTopSessionChat(_ conversation: ConversationSelection, in tab: MobileTab? = nil) {
        let targetTab = tab ?? selectedTab
        var stack = path(for: targetTab)
        if let existingRoute = stack.last?.sessionChatRoute {
            sessionConversations[existingRoute.slotID] = conversation
        } else {
            let route = SessionChatRoute()
            sessionConversations[route.slotID] = conversation
            stack.append(.sessionChat(route))
            setPath(stack, for: targetTab)
        }
    }

    func promoteSessionDraftInPlace(draftID: String, to updated: ConversationSelection) {
        for (slotID, existing) in sessionConversations where existing.id == draftID {
            sessionConversations[slotID] = updated
        }
        if personalConversation?.id == draftID {
            personalConversation = updated
        }
        if !updated.isDraft {
            sessionPromotionRevision += 1
        }
    }

    func updateSessionConversation(_ updated: ConversationSelection, for route: SessionChatRoute) {
        guard let existing = sessionConversations[route.slotID] else { return }
        let wasDraft = existing.isDraft
        sessionConversations[route.slotID] = updated
        if wasDraft, !updated.isDraft {
            sessionPromotionRevision += 1
        }
    }

    func updateSessionConversationTitle(id: String, title: String) {
        for (slotID, existing) in sessionConversations where existing.id == id {
            var copy = existing
            copy.title = title
            sessionConversations[slotID] = copy
        }
        if var personal = personalConversation, personal.id == id {
            personal.title = title
            personalConversation = personal
        }
    }

    func openFromSearch(_ conversation: ConversationSelection) {
        if let personalID = personalConversation?.id, conversation.id == personalID {
            openPersonalAgent()
            return
        }
        let targetTab = selectedTab
        var stack = path(for: targetTab)
        if let existingRoute = stack.last?.sessionChatRoute {
            sessionConversations[existingRoute.slotID] = conversation
        } else {
            let route = SessionChatRoute()
            sessionConversations[route.slotID] = conversation
            stack.append(.sessionChat(route))
            setPath(stack, for: targetTab)
        }
    }

    func openSidebarDestination(_ destination: HomeDestination) {
        switch destination {
        case .conversations:
            selectedTab = .conversations
            popToRoot(in: .conversations)
        case .progress:
            selectedTab = .workbench
            popToRoot(in: .workbench)
        case .notes:
            selectedTab = .notes
            popToRoot(in: .notes)
        case .library:
            selectedTab = .library
            popToRoot(in: .library)
        default:
            guard activeStack.last != destination else { return }
            push(destination, in: selectedTab)
        }
    }

    func openTaskChat(taskID: String, in tab: MobileTab? = nil) {
        let targetTab = tab ?? selectedTab
        let stack = path(for: targetTab)
        if stack.last == .taskChat(taskID) {
            return
        }
        if stack.count >= 2, stack[stack.count - 2] == .taskChat(taskID) {
            pop(in: targetTab)
            return
        }
        push(.taskChat(taskID), in: targetTab)
    }

    func openTaskDetail(taskID: String, in tab: MobileTab? = nil) {
        let targetTab = tab ?? selectedTab
        let stack = path(for: targetTab)
        if stack.last == .taskDetail(taskID) {
            return
        }
        if stack.count >= 2, stack[stack.count - 2] == .taskDetail(taskID) {
            pop(in: targetTab)
            return
        }
        push(.taskDetail(taskID), in: targetTab)
    }

    func openPushTarget(_ target: MobilePushTarget, personalConversationID: String?, defaultAgentID: String = "main") {
        switch target.kind {
        case "task", "task_chat":
            if let id = target.taskId, MobilePushClick.validID(id) {
                selectedTab = .workbench
                let opensChat = target.kind == "task_chat" || target.conversationId.map(MobilePushClick.validID) == true
                setPath(opensChat ? [.taskDetail(id), .taskChat(id)] : [.taskDetail(id)], for: .workbench)
            }
        case "automation_run":
            if let id = target.runId, MobilePushClick.validID(id) {
                selectedTab = .workbench
                setPath([.automations, .libraryAutomationRun(id)], for: .workbench)
            }
        case "chat", "work_discovery":
            if let id = target.conversationId, MobilePushClick.validID(id) {
                if id == personalConversationID || id == personalConversation?.id {
                    selectedTab = .ada
                    setPath([], for: .ada)
                } else {
                    selectedTab = .conversations
                    let route = SessionChatRoute()
                    sessionConversations[route.slotID] = .existing(id: id, title: "", agentId: defaultAgentID)
                    setPath([.sessionChat(route)], for: .conversations)
                }
            }
        default:
            break
        }
    }

    func clearAllStacksForGatewaySwitch() {
        tabPaths.removeAll()
        sessionConversations.removeAll()
        personalConversation = nil
        selectedTab = .ada
        externalIntake = nil
        externalIntakeError = nil
    }
}
