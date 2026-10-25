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
    private var gatewayRefreshTask: Task<Void, Never>?
    private var gatewayTokenExpiry: Date?
    private var gatewayTokenExpiries: [String: Date] = [:]

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
        Task { await refreshActiveGateway() }
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

    func pairGateway(link: String, onCode: @escaping @MainActor (String) -> Void) async throws {
        let connection = try await GatewayPairingService.shared.pair(link: link, onCode: onCode)
        try Task.checkCancellation()
        let configuration = GatewayConfiguration(baseURL: connection.baseURL, token: connection.accessToken)
        if gatewayProfiles.contains(where: {
            $0.baseURL == connection.baseURL
                && GatewayPairingService.shared.gatewayID(profileID: $0.id) != nil
                && GatewayPairingService.shared.gatewayID(profileID: $0.id) != connection.gatewayID
        }) {
            throw GatewayPairingError.identityMismatch
        }
        let previousProfile = gatewayProfiles.first {
            let pairedGatewayID = GatewayPairingService.shared.gatewayID(profileID: $0.id)
            return pairedGatewayID == connection.gatewayID
                || (pairedGatewayID == nil && $0.baseURL == connection.baseURL)
        }
        let profile: GatewayProfile = if let previousProfile {
            try configurationStore.updateProfile(
                id: previousProfile.id, name: previousProfile.name, configuration: configuration
            )
        } else {
            try configurationStore.saveProfile(name: connection.name, configuration: configuration)
        }
        do {
            try GatewayPairingService.shared.save(connection, profileID: profile.id)
            gatewayConfiguration = try configurationStore.activateProfile(id: profile.id)
            gatewayProfiles = configurationStore.loadProfiles()
            activeGatewayProfileID = profile.id
            connectionStorageError = nil
            GatewayPairingService.shared.clearJournal()
            gatewayTokenExpiries[profile.id] = connection.accessTokenExpiresAt
            scheduleGatewayRefresh(expiry: connection.accessTokenExpiresAt)
        } catch {
            if previousProfile == nil {
                try? configurationStore.removeProfile(id: profile.id)
            }
            throw error
        }
    }

    func refreshGatewayProfile(id: String) async throws -> GatewayConfiguration {
        guard let connection = try await GatewayPairingService.shared.refresh(profileID: id) else {
            guard let configuration = configurationStore.configuration(profileID: id) else {
                throw GatewayConfigurationStoreError.profileNotFound
            }
            return configuration
        }
        _ = try configurationStore.updateProfile(
            id: id, name: gatewayProfiles.first(where: { $0.id == id })?.name ?? connection.name,
            configuration: GatewayConfiguration(baseURL: connection.baseURL, token: connection.accessToken)
        )
        gatewayProfiles = configurationStore.loadProfiles()
        gatewayTokenExpiries[id] = connection.accessTokenExpiresAt
        if id == activeGatewayProfileID {
            gatewayConfiguration = configurationStore.load()
            scheduleGatewayRefresh(expiry: connection.accessTokenExpiresAt)
        }
        return GatewayConfiguration(baseURL: connection.baseURL, token: connection.accessToken)
    }

    private func refreshActiveGateway() async {
        guard let activeGatewayProfileID else { return }
        do {
            _ = try await refreshGatewayProfile(id: activeGatewayProfileID)
            connectionStorageError = nil
        } catch {
            connectionStorageError = error.localizedDescription
        }
    }

    func refreshGatewayOnForeground() async {
        guard activeGatewayProfileID != nil else { return }
        if let gatewayTokenExpiry, gatewayTokenExpiry > Date().addingTimeInterval(120) {
            do {
                _ = try await GatewayClient(configuration: gatewayConfiguration).fetchAgents()
                return
            } catch is CancellationError {
                return
            } catch {}
        }
        await refreshActiveGateway()
    }

    private func scheduleGatewayRefresh(expiry: Date) {
        gatewayTokenExpiry = expiry
        gatewayRefreshTask?.cancel()
        gatewayRefreshTask = Task {
            let seconds = max(1, expiry.timeIntervalSinceNow - 60)
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            await refreshActiveGateway()
        }
    }

    func activateGatewayProfile(id: String) {
        do {
            gatewayConfiguration = try configurationStore.activateProfile(id: id)
            activeGatewayProfileID = id
            connectionStorageError = nil
            if let expiry = gatewayTokenExpiries[id] {
                scheduleGatewayRefresh(expiry: expiry)
            } else {
                Task { await refreshActiveGateway() }
            }
        } catch { connectionStorageError = error.localizedDescription }
    }

    func removeGatewayProfile(id: String) {
        do {
            if activeGatewayProfileID == id {
                gatewayRefreshTask?.cancel()
                gatewayTokenExpiry = nil
            }
            try configurationStore.removeProfile(id: id)
            GatewayPairingService.shared.remove(profileID: id)
            gatewayTokenExpiries.removeValue(forKey: id)
            gatewayProfiles = configurationStore.loadProfiles()
            activeGatewayProfileID = configurationStore.activeProfileID()
            gatewayConfiguration = configurationStore.load()
            connectionStorageError = nil
            Task { await refreshActiveGateway() }
        } catch {
            gatewayProfiles = configurationStore.loadProfiles()
            activeGatewayProfileID = configurationStore.activeProfileID()
            gatewayConfiguration = configurationStore.load()
            if !gatewayProfiles.contains(where: { $0.id == id }) {
                GatewayPairingService.shared.remove(profileID: id)
                gatewayTokenExpiries.removeValue(forKey: id)
            }
            connectionStorageError = error.localizedDescription
        }
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
