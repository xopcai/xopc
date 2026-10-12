import Foundation
import Observation

@MainActor
@Observable
// swiftlint:disable:next type_body_length
final class AssistantState {
    private(set) var agents: [AgentSummary] = []
    private(set) var selectedAgentID: String?
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var messages: [TimelineMessage] = []
    private(set) var isLoadingHistory = false
    private(set) var isSending = false
    private(set) var runID: String?
    private(set) var contextSummary: ConversationContextSummary?
    private(set) var isLoadingContext = false
    private(set) var contextError: String?
    private(set) var executionActivity: [ExecutionActivityItem] = []
    private(set) var activityLabel: String?
    private(set) var clarification: ClarificationRequest?
    private(set) var clarificationError: String?
    private(set) var isRespondingToClarification = false
    var pendingInputs: [QueuedInput] = []
    var queueError: String?
    var isUpdatingQueue = false
    private var loadedConversationID: String?
    private var loadedTranscriptID: String?
    private var contextGeneration = 0
    private var runObservation: Task<Void, Never>?
    private var runGeneration = 0
    private var isForeground = true

    func load(using gateway: any GatewayServing) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let catalog = try await gateway.fetchAgents()
            guard !Task.isCancelled else { return }
            agents = catalog.agents
            if !agents.contains(where: { $0.id == selectedAgentID }) {
                selectedAgentID = catalog.defaultId
            }
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    func loadConversation(_ conversation: ConversationSelection?, using gateway: any GatewayServing) async {
        isForeground = true
        if let conversation,
           !conversation.isDraft,
           conversation.id == loadedConversationID,
           conversation.transcriptId == loadedTranscriptID,
           !messages.isEmpty
        {
            await resumeConversation(conversation, using: gateway)
            await loadContext(for: conversation, using: gateway)
            await refreshClarification(for: conversation, using: gateway)
            await refreshInputState(for: conversation, using: gateway)
            return
        }
        cancelRunObservation()
        runID = nil
        loadedConversationID = conversation?.id
        loadedTranscriptID = conversation?.transcriptId
        contextGeneration += 1
        messages = []
        executionActivity = []
        activityLabel = nil
        errorMessage = nil
        contextSummary = nil
        contextError = nil
        clarification = nil
        clarificationError = nil
        pendingInputs = []
        queueError = nil
        guard let conversation, !conversation.isDraft else { return }
        isLoadingHistory = true
        defer { isLoadingHistory = false }
        do {
            let history = try await gateway.fetchHistory(conversationID: conversation.id)
            guard !Task.isCancelled, loadedConversationID == conversation.id else { return }
            messages = Self.timeline(from: history.session.messages)
            let run = try await gateway.fetchActiveRun(conversationID: conversation.id)
            guard !Task.isCancelled, loadedConversationID == conversation.id else { return }
            runID = run.active ? run.runId : nil
            if runID != nil {
                startFollowing(conversation, using: gateway)
            }
            await loadContext(for: conversation, using: gateway)
            await refreshClarification(for: conversation, using: gateway)
            await refreshInputState(for: conversation, using: gateway)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    func send(
        _ text: String,
        attachments: [MessageAttachment] = [],
        references: [ContextReference] = [],
        delivery: MessageDelivery = .next,
        to conversation: ConversationSelection,
        using gateway: any GatewayServing,
        onMaterialized: ((ConversationSelection) -> Void)? = nil,
        onEnqueued: ((String) -> Void)? = nil
    ) async -> ConversationSelection? {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !attachments.isEmpty || !references.isEmpty, !isSending else { return nil }
        if conversation.isDraft {
            loadedConversationID = conversation.id
        }
        isSending = true
        errorMessage = nil
        executionActivity = []
        activityLabel = AppLocalization.resolve("正在准备")
        let optimisticID = "local-\(UUID().uuidString)"
        let optimisticText = content.isEmpty
            ? Self.payloadSummary(attachments: attachments, references: references)
            : content
        onEnqueued?(optimisticID)
        messages.append(.init(id: optimisticID, role: "user", text: optimisticText, isPending: true, turnId: nil))

        do {
            defer { isSending = false }
            let result = try await gateway.sendMessage(
                content,
                attachments: attachments,
                references: references,
                delivery: delivery,
                to: conversation
            )
            guard loadedConversationID == conversation.id else { return nil }
            loadedTranscriptID = result.receipt.transcriptId
            if let index = messages.firstIndex(where: { $0.id == optimisticID }) {
                messages[index].isPending = false
            }
            let materialized = conversation.materialized(transcriptId: result.receipt.transcriptId)
            onMaterialized?(materialized)
            runID = result.inputState.activeRunId
            await followRun(of: materialized, using: gateway)
            return materialized
        } catch is CancellationError {
            isSending = false
            return nil
        } catch {
            if let index = messages.firstIndex(where: { $0.id == optimisticID }) {
                messages[index].isPending = false
            }
            errorMessage = error.localizedDescription
            isSending = false
            return nil
        }
    }

    func pauseConversation() {
        isForeground = false
        cancelRunObservation()
    }

    private func cancelRunObservation() {
        runGeneration += 1
        runObservation?.cancel()
        runObservation = nil
    }

    func resumeConversation(_ conversation: ConversationSelection, using gateway: any GatewayServing) async {
        guard loadedConversationID == conversation.id, !conversation.isDraft else { return }
        // Sending an input owns its initial subscription until its receipt arrives.
        guard !isSending || runID != nil else { return }
        isForeground = true
        cancelRunObservation()
        let generation = runGeneration
        do {
            let run = try await gateway.fetchActiveRun(conversationID: conversation.id)
            guard loadedConversationID == conversation.id, generation == runGeneration, !Task.isCancelled else { return }
            runID = run.active ? run.runId : nil
            await refreshHistory(conversation, using: gateway, retainLive: run.active)
            guard loadedConversationID == conversation.id, generation == runGeneration, !Task.isCancelled else { return }
            if runID != nil {
                startFollowing(conversation, using: gateway)
            } else {
                activityLabel = nil
            }
        } catch is CancellationError { return }
        catch {
            guard loadedConversationID == conversation.id, generation == runGeneration else { return }
            errorMessage = error.localizedDescription
            // A transient REST failure must not disable the existing run's reconnect loop.
            if runID != nil {
                startFollowing(conversation, using: gateway)
            }
        }
    }

    @discardableResult
    private func startFollowing(_ conversation: ConversationSelection, using gateway: any GatewayServing) -> Task<Void, Never> {
        cancelRunObservation()
        let generation = runGeneration
        let observation = Task<Void, Never> { [weak self] in
            guard let self else { return }
            await observeRun(conversation, using: gateway, generation: generation)
        }
        runObservation = observation
        return observation
    }

    private func followRun(of conversation: ConversationSelection, using gateway: any GatewayServing) async {
        if runID == nil {
            let activeRunID = await findActiveRun(in: conversation, using: gateway)
            guard loadedConversationID == conversation.id, !Task.isCancelled else { return }
            runID = activeRunID
        }
        guard loadedConversationID == conversation.id, !Task.isCancelled, isForeground else { return }
        guard runID != nil else { await reload(conversation, using: gateway); return }
        await startFollowing(conversation, using: gateway).value
    }

    private func observeRun(_ conversation: ConversationSelection, using gateway: any GatewayServing, generation: Int) async {
        while isObserving(conversation, generation: generation) {
            guard let activeRunID = runID else { return }
            do {
                if try await consumeRun(activeRunID, in: conversation, using: gateway, generation: generation) {
                    return
                }
            } catch is CancellationError { return }
            catch { /* Reconcile and reconnect the active run after transport loss. */ }
            do {
                let run = try await gateway.fetchActiveRun(conversationID: conversation.id)
                guard isObserving(conversation, generation: generation) else { return }
                runID = run.active ? run.runId : nil
                await refreshHistory(conversation, using: gateway, retainLive: run.active)
                if !run.active {
                    activityLabel = nil; return
                }
                try await Task.sleep(for: .seconds(1))
            } catch is CancellationError { return }
            catch { await waitAfterFailure(error, in: conversation, generation: generation) }
        }
    }

    private func waitAfterFailure(_ error: Error, in conversation: ConversationSelection, generation: Int) async {
        guard isObserving(conversation, generation: generation) else { return }
        errorMessage = error.localizedDescription
        try? await Task.sleep(for: .seconds(2))
    }

    private func isObserving(_ conversation: ConversationSelection, generation: Int) -> Bool {
        !Task.isCancelled && loadedConversationID == conversation.id && generation == runGeneration
    }

    private func consumeRun(_ activeRunID: String, in conversation: ConversationSelection,
                            using gateway: any GatewayServing, generation: Int) async throws -> Bool
    {
        for try await event in gateway.streamRun(runID: activeRunID) {
            guard isObserving(conversation, generation: generation) else { return true }
            apply(event, runID: activeRunID)
            if event.name == "clarify_request" {
                await refreshClarification(for: conversation, using: gateway)
            }
            if event.isTerminal {
                await reload(conversation, using: gateway); return true
            }
        }
        return false
    }

    private func refreshHistory(_ conversation: ConversationSelection, using gateway: any GatewayServing, retainLive: Bool) async {
        let generation = runGeneration
        do {
            let history = try await gateway.fetchHistory(conversationID: conversation.id)
            guard isObserving(conversation, generation: generation) else { return }
            let saved = Self.timeline(from: history.session.messages)
            let live = retainLive ? messages.filter { message in
                message.isPending && !saved.contains { durable in
                    durable.id == message.id || message.id == "live:\(message.turnId ?? ""):\(durable.id)"
                }
            } : []
            messages = saved + live
            errorMessage = nil
        } catch is CancellationError { return }
        catch {
            guard loadedConversationID == conversation.id, generation == runGeneration else { return }
            errorMessage = error.localizedDescription
        }
    }

    private func findActiveRun(
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

    func apply(_ event: RunStreamEvent, runID: String) {
        if event.name == "error" {
            errorMessage = event.errorMessage ?? AppLocalization.resolve("助手执行失败")
            return
        }
        updateActivity(with: event)
        guard event.name == "assistant_delta", let delta = event.delta, !delta.isEmpty else { return }
        let segmentID = event.messageId ?? runID
        if messages.contains(where: { !$0.isPending && $0.id == segmentID }) {
            return
        }
        let liveID = "live:\(runID):\(segmentID)"
        if let index = messages.firstIndex(where: { $0.id == liveID }) {
            if let offset = event.offset, offset != messages[index].text.utf16.count {
                // Replayed prefixes are already visible. Missing prefixes are recovered from history.
                return
            }
            messages[index].text += delta
        } else {
            guard event.offset == nil || event.offset == 0 else { return }
            messages.append(.init(id: liveID, role: "assistant", text: delta, isPending: true, turnId: runID))
        }
    }

    private func reload(_ conversation: ConversationSelection, using gateway: any GatewayServing) async {
        let generation = runGeneration
        await refreshHistory(conversation, using: gateway, retainLive: false)
        guard isObserving(conversation, generation: generation) else { return }
        runID = nil
        activityLabel = nil
        await refreshClarification(for: conversation, using: gateway)
        await refreshInputState(for: conversation, using: gateway)
    }

    func stop(using gateway: any GatewayServing) async {
        guard let runID else { return }
        do {
            try await gateway.abort(runID: runID)
            pauseConversation()
            self.runID = nil
            isSending = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

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

    private func refreshTaskResults(in conversation: ConversationSelection, using gateway: any GatewayServing) async {
        do {
            let history = try await gateway.fetchHistory(conversationID: conversation.id)
            guard loadedConversationID == conversation.id, !Task.isCancelled else { return }
            let results = Self.timeline(from: history.session.messages).filter {
                $0.turnId?.hasPrefix("task-result:") == true
            }
            let known = Set(messages.compactMap(\.turnId))
            messages.append(contentsOf: results.filter { !known.contains($0.turnId ?? "") })
        } catch { /* Background refresh must not erase the live reply. */ }
    }

    func loadContext(
        for conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        guard !conversation.isDraft, loadedConversationID == conversation.id else { return }
        contextGeneration += 1
        let generation = contextGeneration
        isLoadingContext = true
        contextError = nil
        contextSummary = nil
        defer {
            if loadedConversationID == conversation.id, contextGeneration == generation {
                isLoadingContext = false
            }
        }
        do {
            let summary = try await gateway.fetchContext(conversationID: conversation.id)
            guard loadedConversationID == conversation.id,
                  contextGeneration == generation,
                  !Task.isCancelled else { return }
            guard summary.conversationId == conversation.id else {
                contextError = "会话上下文不匹配，请重试"
                return
            }
            contextSummary = summary
        } catch is CancellationError {
            return
        } catch {
            guard loadedConversationID == conversation.id, contextGeneration == generation else { return }
            contextError = error.localizedDescription
        }
    }

    func select(_ agent: AgentSummary) {
        selectedAgentID = agent.id
    }

    func refreshClarification(
        for conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        guard !conversation.isDraft else {
            clarification = nil
            return
        }
        do {
            clarification = try await gateway.fetchClarification(conversationID: conversation.id)
            clarificationError = nil
        } catch is CancellationError {
            return
        } catch {
            clarificationError = error.localizedDescription
        }
    }

    func respondToClarification(
        action: String,
        answer: String?,
        in conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        guard let clarification, !isRespondingToClarification else { return }
        let normalizedAnswer = answer?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard action != "answer" || normalizedAnswer?.isEmpty == false else { return }

        isRespondingToClarification = true
        clarificationError = nil
        do {
            try await gateway.respondToClarification(
                clarification,
                action: action,
                answer: normalizedAnswer
            )
            self.clarification = nil
            isSending = true
            activityLabel = AppLocalization.resolve("正在继续")
            runID = await findActiveRun(in: conversation, using: gateway)
            await followRun(of: conversation, using: gateway)
            isSending = false
        } catch is CancellationError {
            isSending = false
        } catch {
            clarificationError = error.localizedDescription
            await refreshClarification(for: conversation, using: gateway)
            isSending = false
        }
        isRespondingToClarification = false
    }
}

private extension AssistantState {
    func updateActivity(with event: RunStreamEvent) {
        switch event.name {
        case "thinking_delta":
            activityLabel = AppLocalization.resolve("正在思考")
            appendActivity(id: "thinking", title: AppLocalization.resolve("分析问题"), status: "running")
        case "tool_start":
            let title = event.toolName.map { AppLocalization.resolve("正在使用 \($0)") }
                ?? AppLocalization.resolve("正在使用工具")
            activityLabel = title
            appendActivity(id: "event:\(event.sequence)", title: title, status: "running")
        case "tool_end":
            if let index = executionActivity.lastIndex(where: { $0.status == "running" }) {
                executionActivity[index].status = event.status == "error" ? "error" : "done"
            }
            activityLabel = event.status == "error"
                ? AppLocalization.resolve("工具执行失败")
                : AppLocalization.resolve("继续处理")
        case "progress":
            activityLabel = event.stage ?? event.errorMessage ?? AppLocalization.resolve("正在处理")
        case "assistant_delta":
            activityLabel = AppLocalization.resolve("正在回答")
        case "run_end":
            activityLabel = nil
        default:
            break
        }
    }

    func appendActivity(id: String, title: String, status: String) {
        guard !executionActivity.contains(where: { $0.id == id }) else { return }
        executionActivity.append(.init(id: id, title: title, status: status))
    }
}
