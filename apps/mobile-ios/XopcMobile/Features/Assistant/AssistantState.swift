import Foundation
import Observation

@MainActor
@Observable
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
    private var contextGeneration = 0

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
        if let conversation,
           !conversation.isDraft,
           conversation.id == loadedConversationID,
           isSending,
           !messages.isEmpty
        {
            await loadContext(for: conversation, using: gateway)
            await refreshClarification(for: conversation, using: gateway)
            await refreshInputState(for: conversation, using: gateway)
            return
        }
        loadedConversationID = conversation?.id
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
            guard !Task.isCancelled else { return }
            messages = Self.timeline(from: history.session.messages)
            let run = try await gateway.fetchActiveRun(conversationID: conversation.id)
            runID = run.active ? run.runId : nil
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
        to conversation: ConversationSelection,
        using gateway: any GatewayServing,
        onMaterialized: ((ConversationSelection) -> Void)? = nil
    ) async -> ConversationSelection? {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !attachments.isEmpty || !references.isEmpty, !isSending else { return nil }
        if conversation.isDraft { loadedConversationID = conversation.id }
        isSending = true
        errorMessage = nil
        executionActivity = []
        activityLabel = AppLocalization.resolve("正在准备")
        let optimisticID = "local-\(UUID().uuidString)"
        let optimisticText = content.isEmpty
            ? Self.payloadSummary(attachments: attachments, references: references)
            : content
        messages.append(.init(id: optimisticID, role: "user", text: optimisticText, isPending: true, turnId: nil))

        do {
            defer { isSending = false }
            let result = try await gateway.sendMessage(
                content,
                attachments: attachments,
                references: references,
                delivery: .next,
                to: conversation
            )
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

    private static func payloadSummary(attachments: [MessageAttachment], references: [ContextReference]) -> String {
        var parts: [String] = []
        if !attachments.isEmpty {
            parts.append(AppLocalization.resolve("\(attachments.count) 个附件"))
        }
        if !references.isEmpty {
            parts.append(AppLocalization.resolve("\(references.count) 个引用"))
        }
        return AppLocalization.resolve("已发送 ") + parts.joined(separator: AppLocalization.resolve("、"))
    }

    private func followRun(
        of conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        if runID == nil {
            runID = await findActiveRun(in: conversation, using: gateway)
        }
        guard let activeRunID = runID else {
            await reload(conversation, using: gateway)
            return
        }
        do {
            for try await event in gateway.streamRun(runID: activeRunID) {
                apply(event, runID: activeRunID)
                if event.name == "clarify_request" {
                    await refreshClarification(for: conversation, using: gateway)
                }
            }
            await reload(conversation, using: gateway)
        } catch is CancellationError {
            return
        } catch {
            await waitForCompletion(of: conversation, using: gateway)
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
        let liveID = "live:\(runID)"
        if let index = messages.firstIndex(where: { $0.id == liveID }) {
            if let offset = event.offset, offset != messages[index].text.utf16.count {
                return
            }
            messages[index].text += delta
        } else {
            guard event.offset == nil || event.offset == 0 else { return }
            messages.append(.init(id: liveID, role: "assistant", text: delta, isPending: true, turnId: runID))
        }
    }

    private func reload(
        _ conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        do {
            let history = try await gateway.fetchHistory(conversationID: conversation.id)
            messages = Self.timeline(from: history.session.messages)
            runID = nil
            activityLabel = nil
            await refreshClarification(for: conversation, using: gateway)
            await refreshInputState(for: conversation, using: gateway)
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func stop(using gateway: any GatewayServing) async {
        guard let runID else { return }
        do {
            try await gateway.abort(runID: runID)
            self.runID = nil
            isSending = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func waitForCompletion(
        of conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        for _ in 0 ..< 600 {
            guard !Task.isCancelled else { return }
            do {
                try await Task.sleep(for: .milliseconds(500))
                let run = try await gateway.fetchActiveRun(conversationID: conversation.id)
                runID = run.active ? run.runId : nil
                if !run.active {
                    await reload(conversation, using: gateway)
                    return
                }
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        errorMessage = AppLocalization.resolve("助手执行时间过长，请稍后刷新")
    }
}

extension AssistantState {
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

    var selectedAgent: AgentSummary? {
        agents.first { $0.id == selectedAgentID }
    }

    var isRunActive: Bool {
        isSending || runID != nil
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
