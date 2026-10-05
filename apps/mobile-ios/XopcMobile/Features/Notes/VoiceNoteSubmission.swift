import Foundation

protocol VoiceNoteUploading: Sendable {
    func fetchDiscussionCaptureSettings() async throws -> DiscussionCaptureSettings
    func createDiscussion(consentPolicyVersion: Int, clientRequestID: String, recordedAt: Int64) async throws -> DiscussionDetail
    func uploadDiscussionRecording(id: String, audio: RecordedAudio) async throws
    func sealDiscussion(id: String, audio: RecordedAudio) async throws -> DiscussionRecordingJob
}

extension GatewayClient: VoiceNoteUploading {}

struct VoiceNoteSubmission: Sendable {
    let store: PendingVoiceNoteStore
    let gateway: any VoiceNoteUploading

    func resume(_ pending: PendingVoiceNote) async throws -> String {
        let settings = try await gateway.fetchDiscussionCaptureSettings()
        let detail = try await gateway.createDiscussion(
            consentPolicyVersion: settings.consentPolicyVersion,
            clientRequestID: pending.clientRequestID,
            recordedAt: pending.recordedAt
        )
        var updated = pending
        updated.noteID = detail.note.id
        try await store.update(updated)

        if detail.discussion.audioAttachmentId != nil {
            try await store.clearIfUploaded(noteID: detail.note.id)
            return detail.note.id
        }
        if ["stopping", "sealing", "organizing"].contains(detail.discussion.status) {
            return detail.note.id
        }

        let audio = try await store.audio(for: updated)
        try await gateway.uploadDiscussionRecording(id: detail.discussion.id, audio: audio)
        _ = try await gateway.sealDiscussion(id: detail.discussion.id, audio: audio)
        return detail.note.id
    }
}
