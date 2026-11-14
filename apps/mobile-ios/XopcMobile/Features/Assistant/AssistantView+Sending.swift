import Foundation

extension AssistantView {
    func send(delivery: MessageDelivery) {
        guard let conversation, let scope = composerDraftScope,
              scope == ComposerDraftStore.scope(configuration, conversationID: conversation.id) else { return }
        let text = draft
        let selectedAttachments = attachments
        let selectedReferences = references
        let queueing = state.isRunActive
        draft = ""
        attachments = []
        references = []
        attachmentError = nil
        Task {
            let gateway = GatewayClient(configuration: configuration)
            if queueing {
                if await !state.queueMessage(
                    text,
                    attachments: selectedAttachments,
                    references: selectedReferences,
                    delivery: delivery,
                    in: conversation,
                    using: gateway
                ) {
                    restoreDraft(text, attachments: selectedAttachments, references: selectedReferences, scope: scope)
                }
                return
            }
            let materialized = await state.send(
                text,
                attachments: selectedAttachments,
                references: selectedReferences,
                delivery: delivery,
                to: conversation,
                using: gateway,
                onMaterialized: onConversationUpdated,
                onEnqueued: reserveReplySpace
            )
            if materialized == nil {
                restoreDraft(text, attachments: selectedAttachments, references: selectedReferences, scope: scope)
            }
        }
    }

    private func restoreDraft(
        _ text: String,
        attachments selectedAttachments: [MessageAttachment],
        references selectedReferences: [ContextReference],
        scope: String
    ) {
        guard composerDraftScope == scope else {
            let store = ComposerDraftStore()
            do {
                var saved = try store.read(scope)
                if saved.text.isEmpty {
                    saved.text = text
                }
                if saved.attachments.isEmpty {
                    saved.attachments = selectedAttachments
                }
                if saved.references.isEmpty {
                    saved.references = selectedReferences
                }
                try store.save(saved, scope: scope)
            } catch {
                attachmentError = error.localizedDescription
            }
            return
        }
        if draft.isEmpty {
            draft = text
        }
        if attachments.isEmpty {
            attachments = selectedAttachments
        }
        if references.isEmpty {
            references = selectedReferences
        }
        saveComposerDraft()
    }
}
