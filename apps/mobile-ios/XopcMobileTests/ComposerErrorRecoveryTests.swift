import Foundation
import Testing
@testable import XopcMobile

@MainActor
struct ComposerErrorRecoveryTests {
    @Test func dismissingRecordingFeedbackDoesNotDiscardTheRecorderState() {
        let recorder = VoiceRecorder()
        #expect(recorder.finishRecording() == nil)
        #expect(recorder.errorMessage != nil)
        recorder.dismissError()
        #expect(recorder.errorMessage == nil)
        #expect(!recorder.isRecording)
        #expect(!recorder.isPaused)
    }

    @Test func cancellingClearsPermissionFeedback() async {
        let recorder = VoiceRecorder()
        await recorder.start(requestPermission: { false })
        #expect(recorder.isMicrophonePermissionDenied)
        recorder.cancel()
        #expect(!recorder.isMicrophonePermissionDenied)
        #expect(recorder.errorMessage == nil)
    }

    @Test func latePermissionCannotStartRecordingAfterTheSheetCloses() async {
        let recorder = VoiceRecorder()
        let permission = ComposerPermissionGate()
        let starting = Task { await recorder.start(requestPermission: { await permission.wait() }) }
        while await !(permission.waiting) {
            await Task.yield()
        }
        recorder.cancel()
        await permission.resolve()
        await starting.value
        #expect(!recorder.isRecording)
        #expect(!recorder.isMicrophonePermissionDenied)
        #expect(recorder.errorMessage == nil)
    }
}

private actor ComposerPermissionGate {
    private var continuation: CheckedContinuation<Bool, Never>?
    var waiting: Bool {
        continuation != nil
    }

    func wait() async -> Bool {
        await withCheckedContinuation { continuation = $0 }
    }

    func resolve() {
        continuation?.resume(returning: true); continuation = nil
    }
}
