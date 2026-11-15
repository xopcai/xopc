import Foundation

extension AssistantView {
    func send(delivery: MessageDelivery, voice: MessageAttachment? = nil) {
        guard let conversation, let scope = composerDraftScope,
              scope == ComposerDraftStore.scope(configuration, conversationID: conversation.id) else { return }
        let text = voice == nil ? draft : ""
        let selectedAttachments = voice.map { [$0] } ?? attachments
        let selectedReferences = voice == nil ? references : []
        let queueing = state.isRunActive
        if voice == nil {
            draft = ""
            attachments = []
            references = []
        }
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
                    restoreDraft(text, attachments: selectedAttachments, references: selectedReferences, scope: scope, voice: voice)
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
                onEnqueued: { _ in followLatestAfterSend() }
            )
            if materialized == nil {
                restoreDraft(text, attachments: selectedAttachments, references: selectedReferences, scope: scope, voice: voice)
            }
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    private func restoreDraft(
        _ text: String,
        attachments selectedAttachments: [MessageAttachment],
        references selectedReferences: [ContextReference],
        scope: String,
        voice: MessageAttachment?
    ) {
        if let voice {
            do {
                if composerDraftScope == scope {
                    try AttachmentPolicy.validateChat(size: voice.size, current: attachments)
                    attachments.append(voice)
                    saveComposerDraft()
                } else {
                    let store = ComposerDraftStore()
                    var saved = try store.read(scope)
                    try AttachmentPolicy.validateChat(size: voice.size, current: saved.attachments)
                    saved.attachments.append(voice)
                    try store.save(saved, scope: scope)
                }
            } catch { attachmentError = error.localizedDescription }
            return
        }
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
