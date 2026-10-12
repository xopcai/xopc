import Foundation

extension AssistantState {
    func findActiveRun(
        in conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async -> String? {
        for _ in 0 ..< 20 {
            guard !Task.isCancelled else { return nil }
            do {
                let run = try await gateway.fetchActiveRun(conversationID: conversation.id)
                if let runID = run.runId, run.active {
                    return runID
                }
                try await Task.sleep(for: .milliseconds(100))
            } catch {
                return nil
            }
        }
        return nil
    }
}
