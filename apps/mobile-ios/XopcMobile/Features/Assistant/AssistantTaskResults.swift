import Foundation

extension AssistantState {
    func observeTaskResults(in conversation: ConversationSelection, using gateway: any GatewayServing) async {
        var delay = 1
        while !Task.isCancelled {
            do {
                await refreshTaskResults(in: conversation, using: gateway)
                for try await _ in gateway.streamTaskResults(conversationID: conversation.id) {
                    delay = 1
                    await refreshTaskResults(in: conversation, using: gateway)
                }
            } catch is CancellationError { return }
            catch { /* Recover durable history on reconnect. */ }
            do { try await Task.sleep(for: .seconds(delay)) }
            catch { return }
            delay = min(delay * 2, 30)
        }
    }
}
