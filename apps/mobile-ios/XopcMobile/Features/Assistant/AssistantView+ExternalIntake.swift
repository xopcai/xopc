import Foundation

extension AssistantView {
    private var composerSnapshot: SavedComposerDraft {
        SavedComposerDraft(text: draft, attachments: attachments, references: references, intakeReceipts: intakeReceipts)
    }

    func saveComposerDraft() {
        composerSaveTask?.cancel()
        guard let scope = composerDraftScope else { return }
        do { try ComposerDraftStore().save(composerSnapshot, scope: scope) }
        catch { attachmentError = error.localizedDescription }
    }

    func scheduleComposerSave() {
        composerSaveTask?.cancel()
        let scope = composerDraftScope
        composerSaveTask = Task {
            do { try await Task.sleep(for: .milliseconds(300)) }
            catch { return }
            guard composerDraftScope == scope else { return }
            saveComposerDraft()
        }
    }

    func restoreComposerDraft() {
        let next = ComposerDraftStore.scope(configuration, conversationID: conversation?.id)
        if next != composerDraftScope {
            saveComposerDraft()
            composerDraftScope = next
            do {
                let saved = try ComposerDraftStore().read(next)
                draft = saved.text; attachments = saved.attachments; references = saved.references; intakeReceipts = saved.intakeReceipts
                attachmentError = nil
            } catch {
                draft = ""; attachments = []; references = []; intakeReceipts = []
                attachmentError = error.localizedDescription
            }
        }
        handleExternalIntake()
    }

    func handleExternalIntake() {
        guard let batch = externalIntake, let target = batch.target,
              target.conversationID == conversation?.id,
              target.scope == ComposerDraftStore.accountScope(configuration),
              composerDraftScope == ComposerDraftStore.scope(configuration, conversationID: conversation?.id) else { return }
        do {
            let merged = try composerSnapshot.addingExternalFiles(batch, store: ExternalIntakeStore())
            attachments = merged.attachments; intakeReceipts = merged.intakeReceipts
            composerSaveTask?.cancel()
            try ComposerDraftStore().save(composerSnapshot, scope: composerDraftScope!)
            try ExternalIntakeStore().remove(batch.id)
            onExternalIntakeFinished(batch.id, nil)
        } catch {
            attachmentError = error.localizedDescription
            onExternalIntakeFinished(batch.id, error.localizedDescription)
        }
    }
}
