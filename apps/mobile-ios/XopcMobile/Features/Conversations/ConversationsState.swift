import Foundation
import Observation

@MainActor
@Observable
final class ConversationsState {
    private(set) var conversations: [ConversationSummary] = []
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var hasMore = false
    private(set) var errorMessage: String?
    private(set) var operatingConversationID: String?
    var searchText = ""
    private var activeSearch = ""
    private var generation = 0
    private var nextOffset = 0

    var visibleConversations: [ConversationSummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query == activeSearch else { return [] }
        guard !query.isEmpty else { return conversations }
        let titleMatches = conversations.filter { $0.displayName.localizedCaseInsensitiveContains(query) }
        let otherMatches = conversations.filter { !$0.displayName.localizedCaseInsensitiveContains(query) }
        return titleMatches + otherMatches
    }

    func load(using gateway: any GatewayServing) async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        generation += 1
        let current = generation
        if query != activeSearch {
            conversations = []
            nextOffset = 0
            hasMore = false
        }
        activeSearch = query
        isLoading = true
        isLoadingMore = false
        errorMessage = nil
        defer {
            if current == generation {
                isLoading = false
            }
        }

        do {
            let page = try await gateway.fetchConversations(search: query, offset: 0)
            guard current == generation, !Task.isCancelled else { return }
            conversations = page.items
            nextOffset = page.items.count
            hasMore = page.hasMore
        } catch is CancellationError {
            return
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            conversations = []
            nextOffset = 0
            hasMore = false
            errorMessage = error.localizedDescription
        }
    }

    func loadMore(using gateway: any GatewayServing) async {
        guard hasMore, !isLoading, !isLoadingMore,
              activeSearch == searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        else { return }
        let current = generation
        let offset = nextOffset
        isLoadingMore = true
        defer {
            if current == generation {
                isLoadingMore = false
            }
        }
        do {
            let page = try await gateway.fetchConversations(search: activeSearch, offset: offset)
            guard current == generation, !Task.isCancelled else { return }
            let existing = Set(conversations.map(\.id))
            conversations.append(contentsOf: page.items.filter { !existing.contains($0.id) })
            nextOffset += page.items.count
            hasMore = page.hasMore && !page.items.isEmpty
        } catch is CancellationError {
            return
        } catch {
            guard current == generation, !Task.isCancelled else { return }
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
