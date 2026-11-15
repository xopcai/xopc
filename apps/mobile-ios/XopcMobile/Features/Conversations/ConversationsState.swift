import Foundation
import Observation

@MainActor
@Observable
final class ConversationsState {
    private(set) var conversations: [ConversationSummary] = []
    private(set) var childrenByConversationID: [String: SidebarTaskGroup] = [:]
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var hasMore = false
    private(set) var errorMessage: String?
    private(set) var operatingConversationID: String?
    var searchText = ""
    var scope: ConversationHistoryScope = .recent
    private var activeScope: ConversationHistoryScope = .recent
    var personalConversationID: String?
    var cacheScope: String?
    private var activeSearch = ""
    private var generation = 0
    private var nextOffset = 0

    var visibleConversations: [ConversationSummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query == activeSearch, scope == activeScope else { return [] }
        let history = conversations.filter(isVisible)
        guard !query.isEmpty else { return history }
        let titleMatches = history.filter { $0.displayName.localizedCaseInsensitiveContains(query) }
        let otherMatches = history.filter { !$0.displayName.localizedCaseInsensitiveContains(query) }
        return titleMatches + otherMatches
    }

    private func isVisible(_ row: ConversationSummary) -> Bool {
        guard row.messageCount > 0, row.id != personalConversationID, row.status != "archived" else { return false }
        if case .expert = activeScope { return row.customData?.agentSetup != true }
        return true
    }

    func load(using gateway: any GatewayServing) async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        generation += 1
        let current = generation
        let requestedAt = Date.now
        if query != activeSearch || scope != activeScope {
            conversations = []
            childrenByConversationID = [:]
            nextOffset = 0
            hasMore = false
        }
        activeSearch = query
        activeScope = scope
        let requestedScope = scope
        if query.isEmpty && requestedScope == .recent {
            restoreCachedHistory()
        }
        isLoading = true
        isLoadingMore = false
        errorMessage = nil
        defer {
            if current == generation {
                isLoading = false
            }
        }

        do {
            var rows: [ConversationSummary] = []
            var groups: [String: SidebarTaskGroup] = [:]
            var offset = 0
            var more = false
            repeat {
                let page = try await gateway.fetchConversationHistory(search: query, offset: offset, scope: requestedScope)
                guard current == generation, !Task.isCancelled else { return }
                if query.isEmpty, requestedScope == .recent, offset == 0, let cacheScope {
                    MobileListCache.shared.write(page, to: .conversations, scope: cacheScope, requestedAt: requestedAt)
                }
                rows.append(contentsOf: page.items)
                groups.merge(page.childrenByConversationId ?? [:]) { _, new in new }
                offset += page.items.count
                more = page.hasMore && !page.items.isEmpty
            } while more && !rows.contains(where: isVisible)
            conversations = rows
            childrenByConversationID = groups
            nextOffset = offset
            hasMore = more
        } catch is CancellationError {
            return
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    private func restoreCachedHistory() {
        if conversations.isEmpty, let cacheScope,
           let cached: ConversationPage = MobileListCache.shared.read(.conversations, scope: cacheScope)
        {
            conversations = cached.items
            childrenByConversationID = cached.childrenByConversationId ?? [:]
            nextOffset = cached.items.count
            hasMore = cached.hasMore && !cached.items.isEmpty
        }
    }

    func loadMore(using gateway: any GatewayServing) async {
        guard hasMore, !isLoading, !isLoadingMore, scope == activeScope,
              activeSearch == searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        else { return }
        let current = generation
        isLoadingMore = true
        defer {
            if current == generation {
                isLoadingMore = false
            }
        }
        do {
            let visibleCount = visibleConversations.count
            repeat {
                let page = try await gateway.fetchConversationHistory(search: activeSearch, offset: nextOffset, scope: activeScope)
                guard current == generation, !Task.isCancelled else { return }
                let existing = Set(conversations.map(\.id))
                conversations.append(contentsOf: page.items.filter { !existing.contains($0.id) })
                childrenByConversationID.merge(page.childrenByConversationId ?? [:]) { _, new in new }
                nextOffset += page.items.count
                hasMore = page.hasMore && !page.items.isEmpty
            } while hasMore && visibleConversations.count == visibleCount
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
            await removeCachedConversation(conversation.id)
        }
    }

    func togglePin(_ conversation: ConversationSummary, using gateway: any GatewayServing) async {
        let action: ConversationMutation = conversation.status == "pinned" ? .unpin : .pin
        await perform(on: conversation.id) {
            try await gateway.mutateConversation(id: conversation.id, action: action)
            await load(using: gateway)
        }
    }

    func delete(_ conversation: ConversationSummary, using gateway: any GatewayServing) async -> Bool {
        await perform(on: conversation.id) {
            try await gateway.deleteConversation(id: conversation.id)
            await removeCachedConversation(conversation.id)
        }
    }

    private func removeCachedConversation(_ id: String) async {
        conversations.removeAll { $0.id == id }
        guard let cacheScope else { return }
        MobileListCache.shared.remove(.conversations, scope: cacheScope)
        await RecentConversationsStore.shared.removeConversation(id, scope: cacheScope)
    }

    @discardableResult
    private func perform(on id: String, operation: () async throws -> Void) async -> Bool {
        guard operatingConversationID == nil else { return false }
        operatingConversationID = id
        errorMessage = nil
        defer { operatingConversationID = nil }
        do {
            try await operation()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}
