import Foundation

extension AssistantState {
    func projectHistory(_ history: ConversationHistory) async -> [TimelineMessage] {
        let previous = messages
        return await Task.detached(priority: .userInitiated) {
            Self.timeline(from: history.session.messages, previous: previous)
        }.value
    }

    var selectedAgent: AgentSummary? {
        agents.first { $0.id == selectedAgentID }
    }

    var isRunActive: Bool {
        isSending || runID != nil
    }

    nonisolated static func timeline(from messages: [WireMessage], previous: [TimelineMessage] = []) -> [TimelineMessage] {
        let retained = Dictionary(previous.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        return messages.enumerated().compactMap { index, message in
            guard message.display != false, message.metadata?.hiddenFromClient != true else { return nil }
            let text = (message.role == "assistant" ? message.answerText : message.content.text)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            var seenMedia = Set<String>()
            let attachments = ((message.media ?? []) + (message.attachments ?? [])
                + (message.metadata?.turnOutcome?.deliverables.compactMap(\.attachment) ?? []))
                .filter { seenMedia.insert($0.id).inserted }
            let references = message.metadata?.sourceContexts?.compactMap { source -> ContextReference? in
                guard let kind = ContextReferenceKind(rawValue: source.kind) else { return nil }
                let title = source.title?.trimmingCharacters(in: .whitespacesAndNewlines)
                return ContextReference(
                    kind: kind,
                    sourceId: source.sourceId,
                    expectedVersion: source.version,
                    title: title?.isEmpty == false ? title! : source.sourceId
                )
            } ?? []
            let details = message.details
            let resultLinks = message.metadata?.turnOutcome?.deliverables.compactMap(\.link) ?? []
            let unavailableOutputs = message.metadata?.turnOutcome?.deliverables
                .filter { $0.availability != "available" }.map(\.title) ?? []
            let receipts = taskReceipts(from: message.deliveries)
            guard !text.isEmpty || !attachments.isEmpty || !references.isEmpty || !receipts.isEmpty
                || !resultLinks.isEmpty || !unavailableOutputs.isEmpty,
                message.role == "user" || message.role == "assistant"
            else {
                return nil
            }
            let id = message.id ?? message.messageId ?? "\(message.role)-\(index)"
            let old = retained[id]
            let parts = message.role == "assistant" ? (old?.text == text && old?.markdownParts.isEmpty == false ? old?.markdownParts ?? [] :
                MarkdownPart.project(MarkdownBlock.parse(text), previous: old?.markdownParts ?? [])) : []
            return TimelineMessage(
                id: id,
                role: message.role,
                text: text,
                isPending: false,
                turnId: message.turnId,
                markdownParts: parts,
                details: details,
                attachments: attachments,
                references: references,
                resultLinks: resultLinks,
                unavailableOutputs: unavailableOutputs,
                taskReceipts: receipts
            )
        }
    }

    private nonisolated static func taskReceipts(from deliveries: [HistoryProductDelivery]?) -> [HistoryTaskReceipt] {
        (deliveries ?? []).compactMap { delivery -> HistoryTaskReceipt? in
            guard let product = delivery.primary, product.kind == "task" else { return nil }
            return HistoryTaskReceipt(id: product.id, title: product.title, operation: delivery.operation,
                                      canOpen: product.capabilities?.contains("open") == true)
        }
    }

    static func payloadSummary(attachments: [MessageAttachment], references: [ContextReference]) -> String {
        var parts: [String] = []
        if !attachments.isEmpty {
            parts.append(AppLocalization.resolve("\(attachments.count) 个附件"))
        }
        if !references.isEmpty {
            parts.append(AppLocalization.resolve("\(references.count) 个引用"))
        }
        return AppLocalization.resolve("已发送 ") + parts.joined(separator: AppLocalization.resolve("、"))
    }
}
