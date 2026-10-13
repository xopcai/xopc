import Observation
import SwiftUI

@MainActor @Observable final class ChatMessageLinkRouter {
    var destination: ChatMessageLink?
    var errorMessage: String?
    @ObservationIgnored private var lookup: Task<Void, Never>?

    func open(_ link: ChatMessageLink, appState: AppState) {
        lookup?.cancel()
        errorMessage = nil
        guard case let .route(page, id) = link, page == "chat" else { destination = link; return }
        let configuration = appState.gatewayConfiguration
        lookup = Task {
            do {
                let result: ChatLinkedSession = try await GatewayClient(configuration: configuration)
                    .request(path: "/api/sessions/\(id)/history", queryItems: [
                        URLQueryItem(name: "view", value: "compact"), URLQueryItem(name: "limit", value: "1")
                    ])
                guard !Task.isCancelled, configuration == appState.gatewayConfiguration else { return }
                appState.openConversation(id: result.session.key, title: result.session.name ?? "对话", agentId: result.session.agentId)
            } catch is CancellationError { } catch {
                guard !Task.isCancelled, configuration == appState.gatewayConfiguration else { return }
                errorMessage = error.localizedDescription
            }
        }
    }
}

struct ChatMessageLinkDestination: View {
    let link: ChatMessageLink
    let appState: AppState
    let router: ChatMessageLinkRouter

    var body: some View {
        NavigationStack {
            content.toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { router.destination = nil } } }
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
            case "tasks": TaskDetailView(configuration: appState.gatewayConfiguration, taskID: id, onOpenConversation: openConversation)
            case "projects": ProjectDetailView(configuration: appState.gatewayConfiguration, projectID: id,
                                               onOpenConversation: openConversation, onStartProjectConversation: { project in
                                                   router.destination = nil; appState.startProjectConversation(project)
                                               })
            case "automations": AutomationDetailView(configuration: appState.gatewayConfiguration, automationID: id,
                                                     onOpenConversation: openConversation)
            case "workflows": WorkflowRunDetailView(configuration: appState.gatewayConfiguration, runID: id)
            default: ChatLinkedFileView(link: link, configuration: appState.gatewayConfiguration, conversationID: appState.selectedConversation?.id)
            }
        case .workspaceFile, .managedFile:
            ChatLinkedFileView(link: link, configuration: appState.gatewayConfiguration, conversationID: appState.selectedConversation?.id)
        }
    }
}

private struct ChatLinkedSession: Decodable { let session: ChatLinkedSessionIdentity }
private struct ChatLinkedSessionIdentity: Decodable { let key: String; let name: String?; let agentId: String }
