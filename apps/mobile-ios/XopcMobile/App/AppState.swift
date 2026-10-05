import Foundation
import Observation

@MainActor
@Observable
final class AppState {
    var selectedTab = AppTab.assistant
    private(set) var quickChatHandoff: QuickChatHandoff?
    private(set) var gatewayConfiguration: GatewayConfiguration
    private(set) var selectedConversation: ConversationSelection?
    private(set) var connectionStorageError: String?
    private(set) var gatewayProfiles: [GatewayProfile]
    private(set) var activeGatewayProfileID: String?
    private let configurationStore: GatewayConfigurationStore

    var gatewayProfileConfigurations: [String: GatewayConfiguration] {
        Dictionary(uniqueKeysWithValues: gatewayProfiles.compactMap { profile in
            configurationStore.configuration(profileID: profile.id).map { (profile.id, $0) }
        })
    }

    init(configurationStore: GatewayConfigurationStore = GatewayConfigurationStore()) {
        self.configurationStore = configurationStore
        #if DEBUG
            let e2eConfiguration = Self.bootstrapGatewayForE2EIfNeeded(store: configurationStore)
        #endif
        gatewayProfiles = configurationStore.loadProfiles()
        activeGatewayProfileID = configurationStore.activeProfileID()
        #if DEBUG
            gatewayConfiguration = e2eConfiguration ?? configurationStore.load()
        #else
            gatewayConfiguration = configurationStore.load()
        #endif
    }

    #if DEBUG
        private static func bootstrapGatewayForE2EIfNeeded(store: GatewayConfigurationStore) -> GatewayConfiguration? {
            let environment = ProcessInfo.processInfo.environment
            guard let token = environment["XOPC_E2E_GATEWAY_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !token.isEmpty
            else {
                return nil
            }
            let baseURL = environment["XOPC_E2E_GATEWAY_URL"].flatMap(URL.init(string:)) ?? URL(string: "http://127.0.0.1:18790")!
            let configuration = GatewayConfiguration(baseURL: baseURL, token: token)
            try? store.save(configuration)
            return configuration
        }

    #endif

    func updateGateway(baseURL: URL, token: String) {
        let configuration = GatewayConfiguration(
            baseURL: baseURL,
            token: token.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        gatewayConfiguration = configuration
        do {
            try configurationStore.save(configuration)
            gatewayProfiles = configurationStore.loadProfiles()
            activeGatewayProfileID = configurationStore.activeProfileID()
            connectionStorageError = nil
        } catch {
            connectionStorageError = error.localizedDescription
        }
    }

    func saveGatewayProfile(name: String, baseURL: URL, token: String) {
        do {
            let configuration = GatewayConfiguration(baseURL: baseURL, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
            _ = try configurationStore.saveProfile(name: name, configuration: configuration)
            gatewayProfiles = configurationStore.loadProfiles()
            activeGatewayProfileID = configurationStore.activeProfileID()
            connectionStorageError = nil
        } catch { connectionStorageError = error.localizedDescription }
    }

    func activateGatewayProfile(id: String) {
        do {
            gatewayConfiguration = try configurationStore.activateProfile(id: id)
            activeGatewayProfileID = id
            connectionStorageError = nil
        } catch { connectionStorageError = error.localizedDescription }
    }

    func removeGatewayProfile(id: String) {
        do {
            try configurationStore.removeProfile(id: id)
            gatewayProfiles = configurationStore.loadProfiles()
            activeGatewayProfileID = configurationStore.activeProfileID()
            gatewayConfiguration = configurationStore.load()
            connectionStorageError = nil
        } catch { connectionStorageError = error.localizedDescription }
    }

    func renameGatewayProfile(id: String, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            try configurationStore.renameProfile(id: id, name: trimmed)
            gatewayProfiles = configurationStore.loadProfiles()
            connectionStorageError = nil
        } catch { connectionStorageError = error.localizedDescription }
    }

    func open(_ conversation: ConversationSummary) {
        selectedConversation = ConversationSelection(summary: conversation)
        selectedTab = .assistant
    }

    func openConversation(id: String, title: String, agentId: String) {
        selectedConversation = .existing(id: id, title: title, agentId: agentId)
        selectedTab = .assistant
    }

    func startConversation(agentId: String) {
        selectedConversation = .draft(agentId: agentId)
        selectedTab = .assistant
    }

    func startProjectConversation(_ project: ProjectRecord) {
        selectedConversation = .projectDraft(project: project)
        selectedTab = .assistant
    }

    func startScopedConversation(project: ProjectRecord?, executionMode: String?, agentId: String) {
        selectedConversation = project.map {
            .projectDraft(project: $0, executionMode: executionMode, agentId: agentId)
        } ?? .draft(agentId: agentId)
        selectedTab = .assistant
    }

    func showConversations() {
        selectedTab = .conversations
    }

    func openQuickChat(_ handoff: QuickChatHandoff) {
        selectedConversation = .draft(agentId: "main")
        quickChatHandoff = handoff
        selectedTab = .assistant
    }

    func consumeQuickChatHandoff(_ id: UUID) {
        if quickChatHandoff?.id == id {
            quickChatHandoff = nil
        }
    }

    func updateConversation(_ conversation: ConversationSelection) {
        selectedConversation = conversation
    }
}

struct QuickChatHandoff: Equatable {
    enum Action: Equatable {
        case send
        case voice
        case attachments
    }

    let id = UUID()
    let text: String
    let action: Action
}

enum AppTab: Hashable {
    case assistant
    case conversations
    case progress
    case notes
    case profile
}
