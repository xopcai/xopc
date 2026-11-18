import Foundation
import Observation

// swiftlint:disable file_length

@MainActor
@Observable
// swiftlint:disable:next type_body_length
final class AssistantState {
    private(set) var agents: [AgentSummary] = []
    private(set) var selectedAgentID: String?
    private(set) var defaultAgentID: String?
    private(set) var unavailableConversationID: String?
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var messages: [TimelineMessage] = []
    private(set) var isLoadingHistory = false
    private(set) var isSending = false
    private(set) var runID: String?
    private(set) var musicJobsRevision = 0
    private(set) var suggestionRevision = 0
    private(set) var nextTurnSuggestion: NextTurnSuggestion?
    private var suggestionImpression: SuggestionImpression?
    var acceptedSuggestion: SuggestionImpression?

    struct SuggestionImpression {
        let suggestion: NextTurnSuggestion
        let id = UUID()
        let gateway: GatewayClient
        var acceptance: Task<Void, Never>?
    }
    private(set) var contextSummary: ConversationContextSummary?
    private(set) var isLoadingContext = false
    private(set) var contextError: String?
    private(set) var executionActivity: [ExecutionActivityItem] = []
    private(set) var runProgress = AssistantRunProgress()
    private(set) var activityLabel: String?
    private var clarificationAttempt: (id: String, command: ClarificationResponseCommand)?
    private(set) var clarification: ClarificationRequest?
    private(set) var clarificationError: String?
    private(set) var isRespondingToClarification = false
    var pendingInputs: [QueuedInput] = []
    var queueError: String?
    var isUpdatingQueue = false
    private var loadedConversationID: String?
    private var loadedTranscriptID: String?
    private struct SendDraft: Equatable {
        let conversationID: String
        let content: String
        let attachments: [MessageAttachment]
        let references: [ContextReference]
        let delivery: MessageDelivery
    }

    @ObservationIgnored private var failedSend: (id: String, draft: SendDraft)?

    func historyTranscriptID(for conversation: ConversationSelection?) -> String? {
        loadedConversationID == conversation?.id ? loadedTranscriptID ?? conversation?.transcriptId : conversation?.transcriptId
    }

    private var historyGeneration = 0
    private var contextGeneration = 0
    private var runObservation: Task<Void, Never>?
    private var runGeneration = 0
    private var isForeground = true
    @ObservationIgnored private let streamBuffer = ChatStreamBuffer()
    @ObservationIgnored private var streamCommit: Task<Void, Never>?
    @ObservationIgnored private var streamGap = false

    func load(using gateway: any GatewayServing) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let catalog = try await gateway.fetchAgents()
            guard !Task.isCancelled else { return }
            agents = catalog.agents
            defaultAgentID = catalog.defaultId
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

    private func prepareConversation(_ conversation: ConversationSelection?) {
        runID = nil
        loadedConversationID = conversation?.id
        loadedTranscriptID = conversation?.transcriptId
        contextGeneration += 1
        messages = []
        failedSend = nil
        nextTurnSuggestion = nil
        suggestionImpression = nil
        acceptedSuggestion = nil
        streamBuffer.reset()
        streamGap = false
        executionActivity = []
        runProgress = AssistantRunProgress()
        activityLabel = nil
        errorMessage = nil
        contextSummary = nil
        contextError = nil
        clarification = nil
        clarificationError = nil
        pendingInputs = []
        queueError = nil
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    func loadConversation(_ conversation: ConversationSelection?, using gateway: any GatewayServing) async {
        isForeground = true
        unavailableConversationID = nil
        historyGeneration += 1
        let generation = historyGeneration
        isLoadingHistory = false
        if let conversation,
           !conversation.isDraft,
           conversation.id == loadedConversationID,
           conversation.transcriptId == nil || conversation.transcriptId == loadedTranscriptID,
           !messages.isEmpty
        {
            await resumeConversation(conversation, using: gateway)
            guard generation == historyGeneration, !Task.isCancelled, unavailableConversationID == nil else { return }
            await loadContext(for: conversation, using: gateway)
            await refreshClarification(for: conversation, using: gateway)
            await refreshInputState(for: conversation, using: gateway)
            return
        }
        cancelRunObservation()
        prepareConversation(conversation)
        guard let conversation, !conversation.isDraft else { return }
        isLoadingHistory = true
        defer {
            if generation == historyGeneration {
                isLoadingHistory = false
            }
        }
        do {
            let history = try await gateway.fetchHistory(conversationID: conversation.id)
            guard generation == historyGeneration, !Task.isCancelled else { return }
            let projected = await projectHistory(history)
            guard generation == historyGeneration, !Task.isCancelled else { return }
            loadedTranscriptID = history.session.transcriptId ?? conversation.transcriptId
            messages = projected
            isLoadingHistory = false
            let run = try await gateway.fetchActiveRun(conversationID: conversation.id)
            guard generation == historyGeneration, !Task.isCancelled else { return }
            runID = run.active ? run.runId : nil
            if let runID {
                runProgress.begin(runID); runProgress.restore(history.session.messages)
            }
            if runID != nil {
                startFollowing(conversation, using: gateway)
            }
            await loadContext(for: conversation, using: gateway)
            await refreshClarification(for: conversation, using: gateway)
            await refreshInputState(for: conversation, using: gateway)
        } catch is CancellationError {
            return
        } catch {
            guard generation == historyGeneration, !Task.isCancelled else { return }
            reportHistoryFailure(error, conversationID: conversation.id)
        }
    }

    private func reportHistoryFailure(_ error: Error, conversationID: String) {
        if case .http(statusCode: 404, message: _) = error as? GatewayClientError {
            unavailableConversationID = conversationID
            messages = []
            runID = nil
        }
        errorMessage = error.localizedDescription
    }

    func isCurrentConversation(_ id: String) -> Bool {
        loadedConversationID == id
    }

    // swiftlint:disable:next function_body_length
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
        guard !content.isEmpty || !attachments.isEmpty || !references.isEmpty, !isSending,
              loadedConversationID == nil || loadedConversationID == conversation.id else { return nil }
        if conversation.isDraft {
            loadedConversationID = conversation.id
        }
        isSending = true
        errorMessage = nil
        executionActivity = []
        if runID == nil {
            runProgress = AssistantRunProgress()
        }
        activityLabel = AppLocalization.resolve("正在准备")
        let input = SendDraft(conversationID: conversation.id, content: content, attachments: attachments,
                              references: references, delivery: delivery)
        let retryID = failedSend.flatMap { $0.draft == input ? $0.id : nil }
        let optimisticID = retryID ?? UUID().uuidString.lowercased()
        failedSend = nil
        let optimisticText = content.isEmpty
            ? Self.payloadSummary(attachments: attachments, references: references)
            : content
        if retryID != nil, let index = messages.firstIndex(where: { $0.scrollID == optimisticID }) {
            messages[index].isPending = true
        } else {
            onEnqueued?(optimisticID)
            messages.append(.init(id: optimisticID, role: "user", text: optimisticText, isPending: true,
                                  turnId: nil, clientMessageID: optimisticID))
        }

        defer { isSending = false }
        do {
            let result = try await gateway.sendMessage(
                content,
                attachments: attachments,
                references: references,
                delivery: delivery,
                to: conversation,
                clientMessageID: optimisticID
            )
            let materialized = conversation.materialized(transcriptId: result.receipt.transcriptId)
            guard loadedConversationID == conversation.id else { return materialized }
            loadedTranscriptID = result.receipt.transcriptId
            if let index = messages.firstIndex(where: { $0.id == optimisticID }) {
                messages[index].isPending = false
            }
            onMaterialized?(materialized)
            runID = result.inputState.activeRunId
            await followRun(of: materialized, using: gateway)
            return materialized
        } catch is CancellationError {
            return nil
        } catch {
            guard loadedConversationID == conversation.id else { return nil }
            failedSend = (optimisticID, input)
            if let index = messages.firstIndex(where: { $0.id == optimisticID }) {
                messages[index].isPending = false
            }
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func pauseConversation() {
        isForeground = false
        cancelRunObservation()
    }

    private func cancelRunObservation() {
        flushStream()
        runGeneration += 1
        runObservation?.cancel()
        runObservation = nil
    }

    func resumeConversation(_ conversation: ConversationSelection, using gateway: any GatewayServing) async {
        guard loadedConversationID == conversation.id, !conversation.isDraft else { return }
        isForeground = true
        // Sending an input owns its initial subscription until its receipt arrives.
        guard !isSending || runID != nil else { return }
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
            guard loadedConversationID == conversation.id, generation == runGeneration, !Task.isCancelled else { return }
            reportHistoryFailure(error, conversationID: conversation.id)
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
            if streamGap {
                streamGap = false
                throw GatewayClientError.server("实时事件中断，正在恢复历史记录")
            }
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
            flushStream()
            var saved = await projectHistory(history)
            guard isObserving(conversation, generation: generation) else { return }
            loadedTranscriptID = history.session.transcriptId ?? loadedTranscriptID
            if retainLive {
                for index in saved.indices where streamBuffer.containsLive(saved[index].id) {
                    saved[index].isPending = true
                }
            }
            let savedIDs = Set(saved.flatMap { [$0.id, $0.scrollID] })
            if let runID {
                runProgress.begin(runID)
            }
            runProgress.restore(history.session.messages)
            let live = messages.filter { message in
                (streamBuffer.containsLive(message.id) || (retainLive && message.isPending)) && !savedIDs.contains(message.id)
            }
            streamBuffer.confirm(Set(saved.filter { !$0.isPending }.map(\.id)))
            messages = saved + live
            errorMessage = nil
        } catch is CancellationError { return }
        catch {
            guard loadedConversationID == conversation.id, generation == runGeneration, !Task.isCancelled else { return }
            reportHistoryFailure(error, conversationID: conversation.id)
        }
    }

    func flushStream() {
        streamCommit?.cancel(); streamCommit = nil
        messages = streamBuffer.drain(messages)
    }

    func apply(_ event: RunStreamEvent, runID: String) {
        if event.name == "tool_end", event.toolName == "music_generation", event.status == "success" {
            musicJobsRevision += 1
        }
        runProgress.begin(runID)
        if event.name != "assistant_delta" {
            flushStream()
        }
        if event.isTerminal {
            runProgress.status = event.name == "error" ? "error" : event.status ?? "success"
            streamGap = false
            messages = streamBuffer.finish(messages)
            self.runID = nil
        }
        if event.name == "error" {
            errorMessage = event.errorMessage ?? AppLocalization.resolve("助手执行失败")
            return
        }
        updateActivity(with: event)
        handleMessageEnd(event, runID: runID)
        guard event.name == "assistant_delta" else { return }
        let result = streamBuffer.append(event, runID: runID, visible: messages)
        if result == "gap" {
            streamGap = true
        }
        if result == "first" {
            flushStream()
        } else if result == "accepted", streamCommit == nil {
            streamCommit = Task { [weak self] in
                do { try await Task.sleep(for: .milliseconds(32)) } catch { return }
                self?.flushStream()
            }
        }
    }

    private func handleMessageEnd(_ event: RunStreamEvent, runID: String) {
        guard event.name == "assistant_message_end" else { return }
        let id = event.messageId ?? runID
        if event.presentation == "narration" {
            if let narration = messages.first(where: { $0.id == id }) {
                runProgress.record(id: id, text: narration.text)
                appendActivity(id: "narration:\(id)", title: String(narration.text.prefix(160)), status: "done")
            }
            streamBuffer.closeNarration(id)
            messages.removeAll { $0.id == id }
        } else if event.presentation == "answer", let index = messages.firstIndex(where: { $0.id == id }) {
            messages[index].answerConfirmed = true
            messages[index].revealAnswer = true
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
        flushStream()
        guard let runID else { return }
        do {
            try await gateway.abort(runID: runID)
            runProgress.begin(runID)
            runProgress.status = "cancelled"
            pauseConversation()
            self.runID = nil
            isSending = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

extension AssistantState {
    func refreshTaskResults(in conversation: ConversationSelection, using gateway: any GatewayServing) async {
        do {
            let history = try await gateway.fetchHistory(conversationID: conversation.id)
            guard loadedConversationID == conversation.id, !Task.isCancelled else { return }
            let projected = await projectHistory(history)
            guard loadedConversationID == conversation.id, !Task.isCancelled else { return }
            if let transcript = history.session.transcriptId, transcript == loadedTranscriptID {
                let savedUsers = Dictionary(projected.filter { $0.role == "user" }.map { ($0.id, $0) },
                                            uniquingKeysWith: { _, latest in latest })
                for index in messages.indices where messages[index].role == "user" {
                    if let saved = savedUsers[messages[index].id] {
                        messages[index].agentReaction = saved.agentReaction
                    }
                }
                let visible = Set(messages.map(\.id))
                messages.append(contentsOf: projected.filter { $0.role == "user" && $0.agentReaction != nil && !visible.contains($0.id) })
            }
            let results = projected.filter { $0.turnId?.hasPrefix("task-result:") == true }
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

    private func prepareClarificationCommand(_ prompt: ClarificationRequest, action: String,
                                             submission: ClarificationSubmission?) throws -> ClarificationResponseCommand?
    {
        let previous = clarificationAttempt
        let candidate = ClarificationResponseCommand(action: action, response: submission?.response, decision: submission?.decision,
                                                     expectedVersion: prompt.version, idempotencyKey: previous?.command.idempotencyKey ?? UUID().uuidString.lowercased())
        var command = previous?.id == prompt.id && previous?.command == candidate ? candidate
            : ClarificationResponseCommand(action: action, response: submission?.response, decision: submission?.decision,
                                           expectedVersion: prompt.version, idempotencyKey: UUID().uuidString.lowercased())
        guard prompt.schemaVersion == 2 else { return command }
        command.schemaVersion = 2
        command.answers = action == "answer" ? submission?.answers : nil
        if action == "answer", !prompt.accepts(command.answers ?? []) {
            return nil
        }
        if let pending: ClarificationResponseCommand = ClarificationPersistence.read(prompt, "attempt", as: ClarificationResponseCommand.self) {
            return pending
        }
        try ClarificationPersistence.write(prompt, "attempt", command)
        return command
    }

    func respondToClarification(
        action: String,
        submission: ClarificationSubmission?,
        in conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        guard let clarification, !isRespondingToClarification, !clarification.isExpired else { return }
        if action == "answer", submission == nil {
            return
        }
        if clarification.kind == "approval", action == "agent_decide" {
            return
        }
        let frozenCommand: ClarificationResponseCommand
        do {
            guard let prepared = try prepareClarificationCommand(clarification, action: action, submission: submission) else { return }
            frozenCommand = prepared
        } catch { clarificationError = error.localizedDescription; return }
        clarificationAttempt = (clarification.id, frozenCommand)

        isRespondingToClarification = true
        clarificationError = nil
        do {
            try await gateway.respondToClarification(
                clarification,
                command: frozenCommand
            )
            if clarification.schemaVersion == 2 {
                try? ClarificationPersistence.clear(clarification)
            }
            guard self.clarification?.id == clarification.id else { isRespondingToClarification = false; return }
            self.clarification = nil
            clarificationAttempt = nil
            isSending = true
            activityLabel = AppLocalization.resolve("正在继续")
            runID = await findActiveRun(in: conversation, using: gateway)
            await followRun(of: conversation, using: gateway)
            isSending = false
        } catch is CancellationError {
            isSending = false
        } catch {
            let responseError = error.localizedDescription
            await refreshClarification(for: conversation, using: gateway)
            if self.clarification?.id == clarification.id {
                clarificationError = responseError
            }
            isSending = false
        }
        isRespondingToClarification = false
    }
}

private extension AssistantState {
    func updateActivity(with event: RunStreamEvent) {
        let updated = Self.activity(event, label: activityLabel, items: executionActivity)
        activityLabel = updated.label
        executionActivity = updated.items
    }

    func appendActivity(id: String, title: String, status: String) {
        guard !executionActivity.contains(where: { $0.id == id }) else { return }
        executionActivity.append(.init(id: id, title: title, status: status))
    }
}

extension AssistantState {
    func invalidateNextTurnSuggestion() {
        nextTurnSuggestion = nil
        suggestionRevision += 1
    }

    func observeNextTurnSuggestion(in conversation: ConversationSelection?, transcriptID: String?,
                                   locale: String, using gateway: GatewayClient) async {
        guard !Task.isCancelled else { return }
        nextTurnSuggestion = nil
        guard let conversation, let transcriptID else { return }
        let revision = suggestionRevision
        do {
            for _ in 0..<8 {
                try Task.checkCancellation()
                let response = try await gateway.fetchNextTurnSuggestion(conversationID: conversation.id, locale: locale)
                try Task.checkCancellation()
                guard isCurrentConversation(conversation.id), historyTranscriptID(for: conversation) == transcriptID,
                      suggestionRevision == revision else { return }
                if response.status == "ready", let suggestion = response.suggestion,
                   suggestion.conversationId == conversation.id, suggestion.transcriptId == transcriptID,
                   suggestion.agentId == conversation.agentId, suggestion.locale == locale, suggestion.isCurrent,
                   !suggestion.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    if suggestionImpression?.suggestion.id != suggestion.id ||
                        suggestionImpression?.gateway.configuration != gateway.configuration {
                        let impression = SuggestionImpression(suggestion: suggestion, gateway: gateway)
                        suggestionImpression = impression
                        Task { await gateway.reportNextTurnSuggestion(suggestion, impressionID: impression.id, event: "shown") }
                    }
                    nextTurnSuggestion = suggestion
                    let now = Int64(Date.now.timeIntervalSince1970 * 1000)
                    try await Task.sleep(for: .milliseconds(max(0, suggestion.expiresAt - now)))
                    nextTurnSuggestion = nil
                    return
                }
                guard response.status == "pending" else { return }
                try await Task.sleep(for: .milliseconds(600))
            }
        } catch { /* The ordinary placeholder also covers unavailable Gateways. */ }
    }

    func visibleNextTurnSuggestion(using configuration: GatewayConfiguration) -> NextTurnSuggestion? {
        guard suggestionImpression?.gateway.configuration == configuration else { return nil }
        return nextTurnSuggestion
    }

    func acceptNextTurnSuggestion(_ suggestion: NextTurnSuggestion, using configuration: GatewayConfiguration) -> String? {
        guard suggestion == visibleNextTurnSuggestion(using: configuration), suggestion.isCurrent,
              var impression = suggestionImpression, impression.suggestion.id == suggestion.id else { return nil }
        let gateway = impression.gateway
        let id = impression.id
        impression.acceptance = Task {
            await gateway.reportNextTurnSuggestion(suggestion, impressionID: id, event: "accepted")
        }
        acceptedSuggestion = impression
        nextTurnSuggestion = nil
        return suggestion.prompt
    }
}
