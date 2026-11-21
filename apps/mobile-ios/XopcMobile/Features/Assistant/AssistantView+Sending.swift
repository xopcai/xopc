import Foundation

extension AssistantView {
    // swiftlint:disable:next function_body_length
    func send(voice: MessageAttachment? = nil) {
        guard let conversation, let scope = composerDraftScope,
              scope == ComposerDraftStore.scope(configuration, conversationID: conversation.id) else { return }
        let text = voice == nil ? draft : ""
        let selectedAttachments = voice.map { [$0] } ?? attachments
        let selectedReferences = voice == nil ? references : []
        let candidate = state.acceptedSuggestion
        let impression = voice == nil && candidate?.gateway.configuration == configuration &&
            candidate?.suggestion.conversationId == conversation.id &&
            candidate?.suggestion.transcriptId == state.historyTranscriptID(for: conversation) ? candidate : nil
        if voice == nil {
            state.acceptedSuggestion = nil
            draft = ""
            attachments = []
            references = []
        }
        attachmentError = nil
        Task {
            let gateway = GatewayClient(configuration: configuration)
            let materialized = await state.send(
                text,
                attachments: selectedAttachments,
                references: selectedReferences,
                to: conversation,
                using: gateway,
                onMaterialized: onConversationUpdated,
                onEnqueued: { _ in followLatestAfterSend() }
            )
            if materialized != nil {
                reportSuggestedSend(impression, text: text)
            } else {
                restoreSuggestionAfterFailure(impression, scope: scope)
                restoreDraft(text, attachments: selectedAttachments, references: selectedReferences, scope: scope, voice: voice)
            }
        }
    }

    private func restoreSuggestionAfterFailure(_ impression: AssistantState.SuggestionImpression?, scope: String) {
        if let impression, composerDraftScope == scope, draft.isEmpty {
            state.acceptedSuggestion = impression
        }
    }

    private func reportSuggestedSend(_ impression: AssistantState.SuggestionImpression?, text: String) {
        guard let impression else { return }
        let edited = text.trimmingCharacters(in: .whitespacesAndNewlines) != impression.suggestion.prompt
        Task {
            await impression.acceptance?.value
            await impression.gateway.reportNextTurnSuggestion(impression.suggestion, impressionID: impression.id,
                                                              event: "submitted", edited: edited)
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
