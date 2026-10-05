import Foundation
import Observation

@MainActor
@Observable
final class ConversationsState {
    private(set) var conversations: [ConversationSummary] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var operatingConversationID: String?
    var searchText = ""

    var visibleConversations: [ConversationSummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return conversations }
        return conversations.filter {
            $0.displayName.localizedCaseInsensitiveContains(query)
                || $0.agentId.localizedCaseInsensitiveContains(query)
        }
    }

    func load(using gateway: any GatewayServing) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let page = try await gateway.fetchConversations(search: "")
            guard !Task.isCancelled else { return }
            conversations = page.items
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    func rename(_ conversation: ConversationSummary, to name: String, using gateway: any GatewayServing) async {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { return }
        await perform(on: conversation.id) {
            try await gateway.renameConversation(id: conversation.id, name: trimmedName)
            await load(using: gateway)
        }
    }

    func archive(_ conversation: ConversationSummary, using gateway: any GatewayServing) async {
        await perform(on: conversation.id) {
            try await gateway.mutateConversation(id: conversation.id, action: .archive)
            conversations.removeAll { $0.id == conversation.id }
        }
    }

    func togglePin(_ conversation: ConversationSummary, using gateway: any GatewayServing) async {
        let action: ConversationMutation = conversation.status == "pinned" ? .unpin : .pin
        await perform(on: conversation.id) {
            try await gateway.mutateConversation(id: conversation.id, action: action)
            await load(using: gateway)
        }
    }

    func delete(_ conversation: ConversationSummary, using gateway: any GatewayServing) async {
        await perform(on: conversation.id) {
            try await gateway.deleteConversation(id: conversation.id)
            conversations.removeAll { $0.id == conversation.id }
        }
    }

    private func perform(on id: String, operation: () async throws -> Void) async {
        guard operatingConversationID == nil else { return }
        operatingConversationID = id
        errorMessage = nil
        defer { operatingConversationID = nil }
        do {
            try await operation()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
