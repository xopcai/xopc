import Foundation

extension AssistantView {
    func send(delivery: MessageDelivery) {
        guard let conversation else { return }
        let text = draft
        let selectedAttachments = attachments
        let selectedReferences = references
        draft = ""
        attachments = []
        references = []
        attachmentError = nil
        Task {
            let gateway = GatewayClient(configuration: configuration)
            if state.isRunActive {
                if await !state.queueMessage(
                    text,
                    attachments: selectedAttachments,
                    references: selectedReferences,
                    delivery: delivery,
                    in: conversation,
                    using: gateway
                ) {
                    restoreDraft(text, attachments: selectedAttachments, references: selectedReferences)
                }
                return
            }
            let materialized = await state.send(
                text,
                attachments: selectedAttachments,
                references: selectedReferences,
                to: conversation,
                using: gateway,
                onMaterialized: onConversationUpdated
            )
            if materialized == nil {
                restoreDraft(text, attachments: selectedAttachments, references: selectedReferences)
            }
        }
    }

    private func restoreDraft(
        _ text: String,
        attachments selectedAttachments: [MessageAttachment],
        references selectedReferences: [ContextReference]
    ) {
        if draft.isEmpty {
            draft = text
        }
        if attachments.isEmpty {
            attachments = selectedAttachments
        }
        if references.isEmpty {
            references = selectedReferences
        }
    }
}
