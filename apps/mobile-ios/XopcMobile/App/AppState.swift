import Foundation
import Observation

@MainActor
@Observable
// swiftlint:disable:next type_body_length
final class AppState {
    var homePath: [HomeDestination] = []
    private(set) var externalIntake: ExternalIntakeBatch?
    private(set) var externalIntakeRevision = 0
    private(set) var listCacheRevision = 0
    private(set) var externalIntakeError: String?
    func openExternalIntake(_ batch: ExternalIntakeBatch, conversation: ConversationSelection) {
        guard batch.target?.scope == ComposerDraftStore.accountScope(gatewayConfiguration) else { externalIntakeRevision += 1; return }
        externalIntakeError = nil
        selectHomeConversation(conversation)
        externalIntake = batch
    }

    func externalIntakeFinished(_ id: UUID, error: String?) {
        guard externalIntake?.id == id else { return }
        externalIntake = nil
        externalIntakeError = error
        externalIntakeRevision += 1
    }

    private(set) var gatewayConfiguration: GatewayConfiguration {
        didSet { restoreConversationSelection() }
    }

    private(set) var selectedConversation: ConversationSelection?
    private var remembersCurrentConversation = false

    private var selectionScope = ""
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
        restoreConversationSelection()
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
            if let previousProfile {
                let scope = ComposerDraftStore.accountScope(identity: previousProfile.id)
                MobileListCache.shared.remove(scope: scope)
                await RecentConversationsStore.shared.remove(scope: scope)
                listCacheRevision += 1
            }
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
        return GatewayConfiguration(baseURL: connection.baseURL, token: connection.accessToken, localIdentity: id)
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

    func activateGatewayProfile(id: String) -> Bool {
        guard id != activeGatewayProfileID else { return false }
        do {
            gatewayConfiguration = try configurationStore.activateProfile(id: id)
            activeGatewayProfileID = id
            connectionStorageError = nil
            if let expiry = gatewayTokenExpiries[id] {
                scheduleGatewayRefresh(expiry: expiry)
            } else {
                Task { await refreshActiveGateway() }
            }
            homePath.removeAll()
            return true
        } catch {
            connectionStorageError = error.localizedDescription
            return false
        }
    }

    func removeGatewayProfile(id: String) {
        do {
            if activeGatewayProfileID == id {
                gatewayRefreshTask?.cancel()
                gatewayTokenExpiry = nil
            }
            let scope = ComposerDraftStore.accountScope(identity: id)
            try configurationStore.removeProfile(id: id)
            MobileListCache.shared.remove(scope: scope)
            Task { await RecentConversationsStore.shared.remove(scope: scope) }
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

    private func selectHomeConversation(_ conversation: ConversationSelection, remember: Bool = true) {
        selectedConversation = conversation
        remembersCurrentConversation = remember
        if remember {
            persistSelection(conversation)
            homePath = []
        }
    }

    private func persistSelection(_ conversation: ConversationSelection) {
        do { try ComposerDraftStore().saveSelection(conversation, configuration: gatewayConfiguration) }
        catch { connectionStorageError = error.localizedDescription }
    }

    func open(_ conversation: ConversationSummary) {
        selectHomeConversation(ConversationSelection(summary: conversation))
    }

    func openConversation(id: String, title: String, agentId: String) {
        selectHomeConversation(.existing(id: id, title: title, agentId: agentId))
    }

    func openPersonalConversation(_ record: PersonalAgentRecord, remember: Bool) {
        selectHomeConversation(.existing(id: record.conversationId, title: record.displayName, agentId: record.agentId),
                               remember: remember)
    }

    func conversationUnavailable(_ id: String) {
        guard selectedConversation?.id == id else { return }
        do { try ComposerDraftStore().clearSelection(configuration: gatewayConfiguration) }
        catch { connectionStorageError = error.localizedDescription }
        selectedConversation = nil
        remembersCurrentConversation = false
    }

    func startConversation(agentId: String) {
        selectHomeConversation(.draft(agentId: agentId))
    }

    func startCapabilityChat(agentId: String, prompt: String, agentSetupLanguage: String?) {
        let draft = ConversationSelection.draft(agentId: agentId, agentSetupLanguage: agentSetupLanguage)
        do {
            try ComposerDraftStore().save(SavedComposerDraft(text: prompt),
                                          scope: ComposerDraftStore.scope(gatewayConfiguration, conversationID: draft.id))
            selectHomeConversation(draft)
        } catch {
            connectionStorageError = error.localizedDescription
        }
    }

    func startScopedConversation(project: ProjectRecord?, executionMode: String?, agentId: String) {
        selectHomeConversation(project.map {
            .projectDraft(project: $0, executionMode: executionMode, agentId: agentId)
        } ?? .draft(agentId: agentId))
    }

    func startLibraryConversation(configuration: GatewayConfiguration, agentID: String, attachment: MessageAttachment,
                                  origin: LibraryOrigin?) async throws
    {
        var draft = ConversationSelection.draft(agentId: agentID)
        if origin?.available == true, let projectID = origin?.projectId {
            let project = try await GatewayClient(configuration: configuration).fetchProject(id: projectID)
            draft = .projectDraft(project: project)
        }
        guard configuration == gatewayConfiguration else { throw CancellationError() }
        try ComposerDraftStore().save(SavedComposerDraft(attachments: [attachment]),
                                      scope: ComposerDraftStore.scope(configuration, conversationID: draft.id))
        selectHomeConversation(draft)
    }

    func updateConversation(_ conversation: ConversationSelection) {
        guard selectedConversation?.id == conversation.id else { return }
        selectedConversation = conversation
        if remembersCurrentConversation {
            persistSelection(conversation)
        }
    }
}

private extension AppState {
    func restoreConversationSelection() {
        let scope = ComposerDraftStore.accountScope(gatewayConfiguration)
        guard scope != selectionScope else { return }
        selectionScope = scope
        if !homePath.isEmpty {
            homePath = [.settings]
        }
        do { selectedConversation = try ComposerDraftStore().readSelection(configuration: gatewayConfiguration) }
        catch { selectedConversation = nil; connectionStorageError = error.localizedDescription }
        remembersCurrentConversation = selectedConversation != nil
    }
}

enum HomeDestination: Hashable {
    case conversations, conversationSearch, progress, projects, automations, library, capabilities, settings
    case personalOverview(allowsConversationSharing: Bool)
    case libraryTask(String), libraryAutomationRun(String)
}
