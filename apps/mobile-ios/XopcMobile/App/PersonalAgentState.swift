import Observation

@MainActor
@Observable
final class PersonalAgentState {
    private(set) var record: PersonalAgentRecord?
    private(set) var isLoading = false
    private(set) var isOpening = false
    private(set) var errorMessage: String?
    private var generation = 0
    private var accountScope: String?

    func record(using configuration: GatewayConfiguration) -> PersonalAgentRecord? {
        ComposerDraftStore.accountScope(configuration) == accountScope ? record : nil
    }

    func applyProfile(_ updated: PersonalAgentRecord, using configuration: GatewayConfiguration) {
        guard !isOpening, ComposerDraftStore.accountScope(configuration) == accountScope else { return }
        generation += 1
        isLoading = false
        errorMessage = nil
        record = updated
    }

    func refresh(using configuration: GatewayConfiguration) async {
        let scope = ComposerDraftStore.accountScope(configuration)
        if scope != accountScope {
            accountScope = scope
            record = nil
            isOpening = false
        }
        guard !isOpening else { return }
        generation += 1
        let current = generation
        errorMessage = nil
        isLoading = true
        defer {
            if current == generation {
                isLoading = false
            }
        }
        do {
            let result = try await GatewayClient(configuration: configuration).fetchPersonalAgent()
            guard current == generation, !Task.isCancelled else { return }
            record = result
        } catch is CancellationError {
            return
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    func open(using configuration: GatewayConfiguration) async -> PersonalAgentRecord? {
        guard !isOpening else { return nil }
        if ComposerDraftStore.accountScope(configuration) == accountScope, let record, record.isReady {
            return record
        }
        generation += 1
        let current = generation
        accountScope = ComposerDraftStore.accountScope(configuration)
        isOpening = true
        isLoading = false
        errorMessage = nil
        defer {
            if current == generation {
                isOpening = false
            }
        }
        do {
            let result = try await GatewayClient(configuration: configuration).createPersonalAgent()
            guard current == generation, !Task.isCancelled else { return nil }
            record = result
            return result
        } catch is CancellationError {
            return nil
        } catch {
            guard current == generation else { return nil }
            errorMessage = error.localizedDescription
            return nil
        }
    }
}
