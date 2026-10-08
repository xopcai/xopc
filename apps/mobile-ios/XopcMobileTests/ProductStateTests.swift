import Foundation
import Testing
@testable import XopcMobile

@MainActor
struct ProductStateTests {
    @Test func canonicalWavRemovesRecorderMetadataChunks() {
        let samples = Data(repeating: 0, count: 32000)
        var recorderWav = Data("RIFF".utf8)
        recorderWav.appendUInt32LEForTest(UInt32(48 + samples.count))
        recorderWav.append(Data("WAVEJUNK".utf8))
        recorderWav.appendUInt32LEForTest(4)
        recorderWav.append(Data(repeating: 0, count: 4))
        recorderWav.append(Data("fmt ".utf8))
        recorderWav.appendUInt32LEForTest(16)
        recorderWav.appendUInt16LEForTest(1)
        recorderWav.appendUInt16LEForTest(1)
        recorderWav.appendUInt32LEForTest(16000)
        recorderWav.appendUInt32LEForTest(32000)
        recorderWav.appendUInt16LEForTest(2)
        recorderWav.appendUInt16LEForTest(16)
        recorderWav.append(Data("data".utf8))
        recorderWav.appendUInt32LEForTest(UInt32(samples.count))
        recorderWav.append(samples)

        let normalized = CanonicalWav.normalizedPCM16Mono(recorderWav)

        #expect(normalized?.count == 44 + samples.count)
        #expect(normalized?.subdata(in: 0 ..< 4) == Data("RIFF".utf8))
        #expect(normalized?.subdata(in: 36 ..< 40) == Data("data".utf8))
    }

    @Test func voiceNoteDraftSurvivesStoreRecreationAndKeepsRequestIdentity() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "xopc-voice-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let gateway = try #require(URL(string: "http://127.0.0.1:8765"))
        let audio = RecordedAudio(
            data: CanonicalWav.silence(duration: 1.2),
            fileName: "语音消息.wav",
            mimeType: "audio/wav",
            duration: 1.2
        )
        let firstStore = PendingVoiceNoteStore(gatewayURL: gateway, rootDirectory: root)
        let pending = try await firstStore.save(audio)
        var updated = pending
        updated.noteID = "note-1"
        try await firstStore.update(updated)

        let reopenedStore = PendingVoiceNoteStore(gatewayURL: gateway, rootDirectory: root)
        #expect(try await reopenedStore.load() == updated)
        #expect(try await reopenedStore.audio(for: updated).data == audio.data)
        await #expect(throws: PendingVoiceNoteError.self) {
            try await reopenedStore.save(audio)
        }
        #expect(try await reopenedStore.clearIfUploaded(noteID: "another-note") == false)
        #expect(try await reopenedStore.audio(for: updated).data == audio.data)
        #expect(try await reopenedStore.clearIfUploaded(noteID: "note-1"))
        #expect(try await reopenedStore.load() == nil)
    }

    @Test func gatewayProbeDistinguishesHighLatencyWithoutBlockingReachableConnection() {
        let checkedAt = Date(timeIntervalSince1970: 1_791_100_800)
        let fast = GatewayProbeState.reachable(milliseconds: 142, checkedAt: checkedAt)
        let slow = GatewayProbeState.reachable(milliseconds: 2314, checkedAt: checkedAt)

        #expect(fast == .online(milliseconds: 142, checkedAt: checkedAt))
        #expect(slow == .warning(milliseconds: 2314, checkedAt: checkedAt))
        #expect(slow.isOnline)
        #expect(slow.checkedAt == checkedAt)
    }

    @Test func automationRunDetailDecodesLiveStateAndTimeline() throws {
        let payload = Data("""
        {"run":{"id":"run-1","automationId":"automation-1","automationName":"Sweep","status":"running",
          "createdAtMs":1000,"conversationId":"conversation-1"}}
        """.utf8)
        let detail = try JSONDecoder().decode(AutomationRunDetailEnvelope.self, from: payload)
        #expect(detail.run.isActive)
        #expect(!detail.run.canRerun)
        #expect(detail.run.conversationId == "conversation-1")

        let events = try JSONDecoder().decode(AutomationRunEventsEnvelope.self, from: Data("""
        {"events":[{"id":"event-1","runId":"run-1","automationId":"automation-1",
          "type":"run.started","message":"Automation run started","createdAtMs":1001}]}
        """.utf8))
        #expect(events.events.map(\.message) == ["Automation run started"])

        let failed = try JSONDecoder().decode(AutomationRunDetailEnvelope.self, from: Data("""
        {"run":{"id":"run-2","automationId":"automation-1","automationName":"Sweep",
          "status":"failed","createdAtMs":1000}}
        """.utf8))
        #expect(!failed.run.isActive)
        #expect(failed.run.canRerun)
    }

    @Test func memoryMaintenanceSummaryTurnsCompactJSONIntoMetrics() throws {
        let summary = try #require(MemoryMaintenanceSummary("""
        Memory maintenance completed: {"scanned":2,"stale":0,"needsReview":1,"archived":3}
        """))
        #expect(summary.metrics.map(\.key) == ["scanned", "stale", "needsReview", "archived"])
        #expect(summary.metrics.map(\.count) == [2, 0, 1, 3])
        #expect(MemoryMaintenanceSummary("Memory maintenance completed: {bad json}") == nil)
        #expect(MemoryMaintenanceSummary("A regular assistant response") == nil)
    }

    @Test func automationEventCopyLocalizesKnownMessagesAndPreservesUnknownDetails() {
        #expect(AutomationRunEventCopy.display("Running system action", locale: Locale(identifier: "zh-Hans")) == "正在执行系统操作")
        #expect(AutomationRunEventCopy.display("Running system action", locale: Locale(identifier: "en")) == "Running system action")
        #expect(AutomationRunEventCopy.display("Event automation.schedule.due queued automation", locale: Locale(identifier: "zh-Hans")) == "事件触发，已加入队列")
        #expect(AutomationRunEventCopy.display("Unknown server detail", locale: Locale(identifier: "zh-Hans")) == "Unknown server detail")
    }

    @Test func automationErrorCopyLocalizesKnownCodesAndPreservesUnknownDetails() {
        #expect(AutomationRunErrorCopy.display("not_found", locale: Locale(identifier: "zh-Hans")) == "自动化目标不存在或已被移除。")
        #expect(AutomationRunErrorCopy.display("NOT_FOUND", locale: Locale(identifier: "en")) == "The automation target does not exist or has been removed.")
        #expect(AutomationRunErrorCopy.display("Backend diagnostic", locale: Locale(identifier: "zh-Hans")) == "Backend diagnostic")
    }

    @Test func voiceNoteDraftRecoversAudioWrittenBeforeMetadata() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "xopc-voice-recovery-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let gateway = try #require(URL(string: "http://127.0.0.1:8765"))
        let store = PendingVoiceNoteStore(gatewayURL: gateway, rootDirectory: root)
        let audio = RecordedAudio(
            data: CanonicalWav.silence(duration: 1),
            fileName: "语音消息.wav",
            mimeType: "audio/wav",
            duration: 1
        )
        _ = try await store.save(audio)
        let directory = try #require(FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: nil
        ).first)
        try FileManager.default.removeItem(at: directory.appending(path: "draft.json"))

        let recovered = try #require(await store.load())

        #expect(try await store.audio(for: recovered).data == audio.data)
        #expect(recovered.duration == audio.duration)
    }

    @Test func voiceNoteKeepsLocalAudioAcrossUploadAndSealFailures() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "xopc-voice-failure-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let gatewayURL = try #require(URL(string: "http://127.0.0.1:8765"))
        let audio = RecordedAudio(
            data: CanonicalWav.silence(duration: 1.2),
            fileName: "语音消息.wav",
            mimeType: "audio/wav",
            duration: 1.2
        )
        let store = PendingVoiceNoteStore(gatewayURL: gatewayURL, rootDirectory: root)
        let pending = try await store.save(audio)
        let gateway = FaultingVoiceNoteGateway()
        let submission = VoiceNoteSubmission(store: store, gateway: gateway)

        await #expect(throws: VoiceNoteTestError.self) { try await submission.resume(pending) }
        let reopened = PendingVoiceNoteStore(gatewayURL: gatewayURL, rootDirectory: root)
        let afterUploadFailure = try #require(await reopened.load())
        #expect(afterUploadFailure.noteID == "note-1")
        #expect(try await reopened.audio(for: afterUploadFailure).data == audio.data)

        await #expect(throws: VoiceNoteTestError.self) { try await submission.resume(afterUploadFailure) }
        let afterSealFailure = try #require(await reopened.load())
        #expect(try await reopened.audio(for: afterSealFailure).data == audio.data)

        #expect(try await submission.resume(afterSealFailure) == "note-1")
        #expect(try await reopened.load() != nil)
        await gateway.markSealing()
        #expect(try await submission.resume(afterSealFailure) == "note-1")
        #expect(try await reopened.audio(for: afterSealFailure).data == audio.data)
        await gateway.confirmAttachment()
        #expect(try await submission.resume(afterSealFailure) == "note-1")
        #expect(try await reopened.load() == nil)
    }

    @Test func renamingGatewayKeepsItsIdentityAndAddress() throws {
        let suite = "xopc-gateway-rename-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let profile = try GatewayProfile(
            id: "gateway-1",
            name: "Old Name",
            baseURL: #require(URL(string: "https://gateway.example.test"))
        )
        try defaults.set(JSONEncoder().encode([profile]), forKey: "gateway.profiles")
        let store = GatewayConfigurationStore(defaults: defaults)

        try store.renameProfile(id: profile.id, name: "New Name")

        let renamed = try #require(store.loadProfiles().first)
        #expect(renamed.id == profile.id)
        #expect(renamed.name == "New Name")
        #expect(renamed.baseURL == profile.baseURL)
    }

    @Test func removingLastGatewayDoesNotRecreateLegacyProfile() throws {
        let suite = "xopc-gateway-remove-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let url = try #require(URL(string: "https://gateway.example.test"))
        let profile = GatewayProfile(id: "gateway-remove-test", name: "Gateway", baseURL: url)
        try defaults.set(JSONEncoder().encode([profile]), forKey: "gateway.profiles")
        defaults.set(profile.id, forKey: "gateway.activeProfile")
        defaults.set(url.absoluteString, forKey: "gateway.baseURL")
        let store = GatewayConfigurationStore(defaults: defaults, tokenStore: MemoryGatewayTokenStore())

        try store.removeProfile(id: profile.id)

        #expect(store.loadProfiles().isEmpty)
        #expect(store.activeProfileID() == nil)
        #expect(store.load().baseURL.absoluteString == "http://127.0.0.1:18790")
    }

    @Test func changingPairedRouteKeepsGatewayProfileIdentity() throws {
        let suite = "xopc-gateway-route-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = GatewayConfigurationStore(defaults: defaults, tokenStore: MemoryGatewayTokenStore())
        let original = try store.saveProfile(
            name: "Work Gateway",
            configuration: GatewayConfiguration(baseURL: #require(URL(string: "https://first.example.test")), token: "first")
        )
        _ = try store.activateProfile(id: original.id)

        let updated = try store.updateProfile(
            id: original.id, name: original.name,
            configuration: GatewayConfiguration(baseURL: #require(URL(string: "https://second.example.test")), token: "second")
        )

        #expect(store.loadProfiles().count == 1)
        #expect(updated.id == original.id)
        #expect(store.load().baseURL == updated.baseURL)
        #expect(store.load().token == "second")
    }

    @Test func homeRoutesRejectExternalLinksAndResolveKnownDetails() {
        #expect(HomeOpenRoute(href: "/tasks/task-1") == .task("task-1"))
        #expect(HomeOpenRoute(href: "/automations?automation=automation-1") == .automation("automation-1"))
        #expect(HomeOpenRoute(href: "/notes?item=note-1") == .note("note-1"))
        #expect(HomeOpenRoute(href: "https://example.com/tasks/1") == nil)
        #expect(HomeOpenRoute(href: "//example.com/tasks/1") == nil)
        #expect(HomeOpenRoute(href: "/workflows?runId=run-1") == nil)
    }

    @Test func homeActionAcceptsOnlySupportedCommands() {
        let approval = HomeAction(
            type: "connector_decision", label: "允许", href: nil,
            approvalId: "approval-1", decision: "approve", subjectKind: nil, runId: nil
        )
        let invalid = HomeAction(
            type: "connector_decision", label: "允许", href: nil,
            approvalId: "approval-1", decision: "unknown", subjectKind: nil, runId: nil
        )

        #expect(approval.command?.kind == "connector_approval")
        #expect(approval.command?.approvalId == "approval-1")
        #expect(invalid.command == nil)
    }
}

private enum VoiceNoteTestError: Error {
    case injected
}

private actor FaultingVoiceNoteGateway: VoiceNoteUploading {
    private var uploadFailuresRemaining = 1
    private var sealFailuresRemaining = 1
    private var attachmentConfirmed = false
    private var status = "recording"

    func fetchDiscussionCaptureSettings() async throws -> DiscussionCaptureSettings {
        DiscussionCaptureSettings(consentPolicyVersion: 1, consentAcknowledgedAt: 1)
    }

    func createDiscussion(consentPolicyVersion _: Int, clientRequestID _: String, recordedAt _: Int64) async throws -> DiscussionDetail {
        let attachment = attachmentConfirmed ? ",\"audioAttachmentId\":\"audio-1\"" : ""
        let payload = """
        {"discussion":{"id":"discussion-1","noteId":"note-1","status":"\(status)","updatedAt":1\(attachment)},
         "note":{"id":"note-1","title":"Voice","markdown":"","kind":"voice","status":"inbox","createdAt":1,"updatedAt":1},
         "transcript":{"revision":0,"segments":[],"text":"","stats":{"uploaded":0,"transcribing":0,"confirmed":0,"failed":0}}}
        """
        return try JSONDecoder().decode(DiscussionDetail.self, from: Data(payload.utf8))
    }

    func uploadDiscussionRecording(id _: String, audio _: RecordedAudio) async throws {
        if uploadFailuresRemaining > 0 {
            uploadFailuresRemaining -= 1
            throw VoiceNoteTestError.injected
        }
    }

    func sealDiscussion(id _: String, audio _: RecordedAudio) async throws -> DiscussionRecordingJob {
        if sealFailuresRemaining > 0 {
            sealFailuresRemaining -= 1
            throw VoiceNoteTestError.injected
        }
        return DiscussionRecordingJob(state: "queued", error: nil)
    }

    func confirmAttachment() {
        attachmentConfirmed = true
    }

    func markSealing() {
        status = "stopping"
    }
}

private extension Data {
    mutating func appendUInt16LEForTest(_ value: UInt16) {
        append(UInt8(value & 0xFF))
        append(UInt8(value >> 8))
    }

    mutating func appendUInt32LEForTest(_ value: UInt32) {
        append(UInt8(value & 0xFF))
        append(UInt8(value >> 8 & 0xFF))
        append(UInt8(value >> 16 & 0xFF))
        append(UInt8(value >> 24))
    }
}

@MainActor
private final class MemoryGatewayTokenStore: GatewayTokenStoring {
    private var values: [String: String] = [:]

    func load(account: String) -> String? {
        values[account]
    }

    func save(_ token: String, account: String) {
        if token.isEmpty {
            values.removeValue(forKey: account)
        } else {
            values[account] = token
        }
    }
}
