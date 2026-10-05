import Foundation
import Testing
@testable import XopcMobile

struct DiscussionStatusTests {
    @Test func discussionDetailDecodesOrganizedSummary() throws {
        let payload = """
        {
          "discussion": {"id":"discussion-1","noteId":"note-1","status":"completed","updatedAt":1},
          "note": {"id":"note-1","title":"Recording","markdown":"","kind":"voice","status":"inbox","createdAt":1,"updatedAt":1},
          "transcript": {"revision":1,"segments":[{"sequence":1,"status":"confirmed","startedAtMs":3000,"rawText":"hello"}],"text":"hello","stats":{"uploaded":1,"transcribing":0,"confirmed":1,"failed":0}},
          "organization": {
            "status": "completed",
            "organization": {
              "title": "Review", "summary": "Ship Friday.", "keyPoints": ["Ready"],
              "decisions": [{"id":"decision-1","text":"Ship Friday.","evidenceSegmentIds":[1]}],
              "actionItems": [{"id":"action-1","title":"Prepare release","evidenceSegmentIds":[1]}],
              "risks": [], "openQuestions": [], "chapters": []
            }
          }
        }
        """

        let detail = try JSONDecoder().decode(DiscussionDetail.self, from: Data(payload.utf8))

        #expect(detail.organization?.organization?.summary == "Ship Friday.")
        #expect(detail.organization?.organization?.decisions.first?.text == "Ship Friday.")
        #expect(detail.organization?.organization?.actionItems.first?.title == "Prepare release")
        #expect(detail.transcript.segments.first?.startedAtMs == 3000)
    }

    @Test func retryWithSavedAudioShowsTranscriptionProgress() {
        let note = NoteDetail(
            id: "note-1", title: "Recording", markdown: "", kind: "voice", status: "inbox",
            createdAt: 0, updatedAt: 0, tags: nil, pinned: nil, remoteVersion: nil, attachments: nil
        )
        let transcript = DiscussionTranscript(
            revision: 0, segments: [], text: "",
            stats: DiscussionTranscriptStats(expected: nil, uploaded: 0, transcribing: 0, confirmed: 0, failed: 0)
        )
        let savedAudio = DiscussionDetail(
            discussion: DiscussionCapture(
                id: "discussion-1", noteId: "note-1", status: "stopping", durationMs: 1000,
                audioAttachmentId: "audio-1", failureStage: nil, failureMessage: nil, updatedAt: 0
            ),
            note: note, transcript: transcript, recordingJob: nil
        )
        let unsavedAudio = DiscussionDetail(
            discussion: DiscussionCapture(
                id: "discussion-1", noteId: "note-1", status: "stopping", durationMs: 1000,
                audioAttachmentId: nil, failureStage: nil, failureMessage: nil, updatedAt: 0
            ),
            note: note, transcript: transcript, recordingJob: nil
        )
        let locale = Locale(identifier: "zh-Hans")
        #expect(AppLocalization.resolve(savedAudio.statusTitle, locale: locale) == "正在生成转写")
        #expect(AppLocalization.resolve(unsavedAudio.statusTitle, locale: locale) == "正在保存录音")
    }
}
