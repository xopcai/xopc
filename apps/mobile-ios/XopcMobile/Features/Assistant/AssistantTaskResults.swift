import Foundation

extension AssistantState {
    func observeTaskResults(in conversation: ConversationSelection, using gateway: any GatewayServing) async {
        var delay = 1
        while !Task.isCancelled {
            var subscribed = false
            do {
                await refreshTaskResults(in: conversation, using: gateway)
                for try await event in gateway.streamTaskResults(conversationID: conversation.id) {
                    delay = 1
                    if event.name == "realtime.subscribed" {
                        subscribed = true
                        invalidateNextTurnSuggestion()
                    } else if event.name == "session.next-turn-suggestion.changed" {
                        invalidateNextTurnSuggestion()
                    } else {
                        await refreshTaskResults(in: conversation, using: gateway)
                    }
                }
            } catch is CancellationError { return }
            catch { /* Recover durable history on reconnect. */ }
            if subscribed {
                invalidateNextTurnSuggestion()
            }
            do { try await Task.sleep(for: .seconds(delay)) }
            catch { return }
            delay = min(delay * 2, 30)
        }
    }
}
