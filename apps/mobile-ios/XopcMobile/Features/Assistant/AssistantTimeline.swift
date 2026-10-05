import Foundation

extension AssistantState {
    static func timeline(from messages: [WireMessage]) -> [TimelineMessage] {
        messages.enumerated().compactMap { index, message in
            let text = message.content.text.trimmingCharacters(in: .whitespacesAndNewlines)
            var seenMedia = Set<String>()
            let attachments = ((message.media ?? []) + (message.attachments ?? []))
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
            guard !text.isEmpty || !attachments.isEmpty || !references.isEmpty || !details.isEmpty,
                  message.role == "user" || message.role == "assistant"
            else {
                return nil
            }
            return TimelineMessage(
                id: message.id ?? message.messageId ?? "\(message.role)-\(index)",
                role: message.role,
                text: text,
                isPending: false,
                turnId: message.turnId,
                markdownParts: message.role == "assistant" ? MarkdownBlock.parse(text).map(MarkdownPart.init) : [],
                details: details,
                attachments: attachments,
                references: references
            )
        }
    }
}
