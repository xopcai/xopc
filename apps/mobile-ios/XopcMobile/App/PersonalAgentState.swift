import Observation

@MainActor
@Observable
final class PersonalAgentState {
    private(set) var record: PersonalAgentRecord?
    private(set) var isLoading = false
    private(set) var isOpening = false
    private(set) var errorMessage: String?
    private var generation = 0

    func applyProfile(_ updated: PersonalAgentRecord) {
        record = updated
    }

    func refresh(using configuration: GatewayConfiguration) async {
        generation += 1
        let current = generation
        record = nil
        errorMessage = nil
        isLoading = true
        defer { if current == generation { isLoading = false } }
        do {
            let result = try await GatewayClient(configuration: configuration).fetchPersonalAgent()
            guard current == generation, !Task.isCancelled else { return }
            record = result
        } catch is CancellationError {
            return
        } catch {
            guard current == generation else { return }
            errorMessage = error.localizedDescription
        }
    }

    func open(using configuration: GatewayConfiguration) async -> PersonalAgentRecord? {
        guard !isOpening else { return nil }
        if let record, record.isReady { return record }
        isOpening = true
        errorMessage = nil
        let current = generation
        defer { isOpening = false }
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
