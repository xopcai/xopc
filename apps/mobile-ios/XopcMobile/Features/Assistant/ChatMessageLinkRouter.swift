import Observation
import SwiftUI

@MainActor @Observable final class ChatMessageLinkRouter {
    var destination: ChatMessageLink?
    var errorMessage: String?
    @ObservationIgnored private var lookup: Task<Void, Never>?

    func open(_ link: ChatMessageLink, appState: AppState) {
        lookup?.cancel()
        errorMessage = nil
        guard case let .route(page, id) = link else { destination = link; return }
        if page == "settings" {
            destination = nil
            appState.push(MobileSettingsSection(rawValue: id).map(HomeDestination.settingsSection) ?? .settings)
            return
        }
        if page == "tasks" {
            destination = nil
            appState.openTaskChat(taskID: id)
            return
        }
        guard page == "chat" else { destination = link; return }
        let configuration = appState.gatewayConfiguration
        let sourceID = appState.activeConversation?.id
        lookup = Task {
            do {
                let result: ChatLinkedSession = try await GatewayClient(configuration: configuration)
                    .request(path: "/api/sessions/\(id)/history", queryItems: [
                        URLQueryItem(name: "view", value: "compact"), URLQueryItem(name: "limit", value: "1")
                    ])
                guard !Task.isCancelled, configuration == appState.gatewayConfiguration,
                      sourceID == appState.activeConversation?.id else { return }
                appState.openConversation(id: result.session.key, title: result.session.name ?? "对话", agentId: result.session.agentId)
            } catch is CancellationError { } catch {
                guard !Task.isCancelled, configuration == appState.gatewayConfiguration,
                      sourceID == appState.activeConversation?.id else { return }
                errorMessage = error.localizedDescription
            }
        }
    }
}

struct ChatMessageLinkDestination: View {
    let link: ChatMessageLink
    let appState: AppState
    let router: ChatMessageLinkRouter
    let defaultAgentID: String

    var body: some View {
        if case let .mcpSetup(name, serverURL) = link {
            LinkedMcpSetupView(configuration: appState.gatewayConfiguration, name: name, serverURL: serverURL,
                               onClose: { router.destination = nil }, onUseInChat: { prompt in
                                   router.destination = nil
                                   appState.startCapabilityChat(agentId: defaultAgentID,
                                                                prompt: prompt, agentSetupLanguage: nil)
                               })
        } else {
            NavigationStack {
                if case .route("tasks", _) = link {
                    content
                } else {
                    content.toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { router.destination = nil } } }
                }
            }
        }
    }

    private func openConversation(_ id: String, _ title: String, _ agentID: String) {
        router.destination = nil
        appState.openConversation(id: id, title: title, agentId: agentID)
    }

    @ViewBuilder private var content: some View {
        switch link {
        case let .route(page, id):
            switch page {
            case "notes": NoteDetailView(configuration: appState.gatewayConfiguration, noteID: id, onOpenConversation: openConversation)
            case "tasks": TaskConversationView(configuration: appState.gatewayConfiguration, taskID: id, returnLabel: "返回会话")
            case "projects": ProjectDetailView(configuration: appState.gatewayConfiguration, projectID: id,
                                               onOpenConversation: openConversation)
            case "automation-run": AutomationRunDetailView(configuration: appState.gatewayConfiguration, runID: id,
                                                           initialRun: nil, onOpenConversation: openConversation)
            case "automations": AutomationDetailView(configuration: appState.gatewayConfiguration, automationID: id,
                                                     onOpenConversation: openConversation)
            default: ChatLinkedFileView(link: link, configuration: appState.gatewayConfiguration, conversationID: appState.activeConversation?.id)
            }
        case .mcpSetup: EmptyView()
        case .workspaceFile, .managedFile:
            ChatLinkedFileView(link: link, configuration: appState.gatewayConfiguration, conversationID: appState.activeConversation?.id)
        }
    }
}

private struct ChatLinkedSession: Decodable { let session: ChatLinkedSessionIdentity }
private struct ChatLinkedSessionIdentity: Decodable { let key: String; let name: String?; let agentId: String }
