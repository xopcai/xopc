import XCTest

@MainActor
// swiftlint:disable:next type_body_length
final class VoiceRecoveryUITests: XCTestCase {
    private struct VoiceOutageCopy {
        let newNote: String
        let voiceNote: String
        let start: String
        let consent: String
        let pause: String
        let save: String
        let waiting: String
        let continueProcessing: String
        let uploadError: String
        let recoveryTitle: String
        let recording: String
        let play: String
        let permissionError: String
        let openSettings: String
        let resume: String
        let interruption: String
        let screenshotSuffix: String

        static let chinese = VoiceOutageCopy(
            newNote: "新建笔记", voiceNote: "语音笔记", start: "开始录音", consent: "同意并开始",
            pause: "暂停", save: "保存", waiting: "录音仍保存在此设备，等待服务器确认保存",
            continueProcessing: "继续处理", uploadError: "上传暂时失败，请检查网络后重试。",
            recoveryTitle: "继续处理语音笔记", recording: "语音记录", play: "播放录音",
            permissionError: "未获得麦克风权限，请在系统设置中允许访问。", openSettings: "打开设置",
            resume: "继续", interruption: "录音被系统中断，已自动暂停。可以继续录音或保存当前内容。", screenshotSuffix: "zh"
        )
        static let english = VoiceOutageCopy(
            newNote: "New Note", voiceNote: "Voice Note", start: "Start Recording", consent: "Agree and Start",
            pause: "Pause", save: "Save",
            waiting: "The recording remains on this device until the server confirms it is saved",
            continueProcessing: "Continue",
            uploadError: "Upload temporarily failed. Check your connection and try again.",
            recoveryTitle: "Resume Voice Note", recording: "Voice Recording", play: "Play Recording",
            permissionError: "Microphone access is disabled. Allow it in Settings.",
            openSettings: "Open Settings", resume: "Resume",
            interruption: "Recording was interrupted and paused. You can resume or save what was recorded.", screenshotSuffix: "en"
        )
    }

    private var app: XCUIApplication!
    private var gatewayToken = ""
    private var baselineIDs: Set<String> = []
    private var createdNoteID: String?
    private var startedAtMs: Int64 = 0

    override func setUp() async throws {
        continueAfterFailure = false
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("A Gateway token is required for voice note cleanup")
        }
        gatewayToken = token
        baselineIDs = try await Set(listNotes().compactMap { $0["id"] as? String })
        startedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launchEnvironment["XOPC_UI_TEST_SYNTHETIC_AUDIO"] = "1"
        if let spokenAudio = ProcessInfo.processInfo.environment["XOPC_UI_TEST_SPOKEN_AUDIO_BASE64"] {
            app.launchEnvironment["XOPC_UI_TEST_SPOKEN_AUDIO_BASE64"] = spokenAudio
        }
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_PROXY_URL"]
            ?? "http://127.0.0.1:18790"
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-notes"].waitForExistence(timeout: 10))
    }

    func testSavedVoiceNoteSurvivesBackgroundAndColdRelaunch() async throws {
        app.buttons["home-tab-notes"].tap()
        app.buttons["新建笔记"].tap()
        app.buttons["语音笔记"].tap()
        app.buttons["开始录音"].tap()
        let consent = app.buttons["同意并开始"]
        if consent.waitForExistence(timeout: 2) {
            consent.tap()
        }
        XCTAssertTrue(app.buttons["暂停"].waitForExistence(timeout: 5))
        app.buttons["暂停"].tap()
        app.buttons["保存"].tap()
        XCTAssertTrue(app.staticTexts["语音记录"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["播放录音"].waitForExistence(timeout: 8))

        let created = try await createdVoiceNotes()
        XCTAssertEqual(created.count, 1)
        let note = try XCTUnwrap(created.first)
        let id = try XCTUnwrap(note["id"] as? String)
        let title = try XCTUnwrap(note["title"] as? String)
        createdNoteID = id

        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["播放录音"].waitForExistence(timeout: 10))

        app.terminate()
        app.launch()
        let notesTab = app.buttons["home-tab-notes"]
        XCTAssertTrue(notesTab.waitForExistence(timeout: 10))
        notesTab.tap()
        let savedNote = app.staticTexts[title].firstMatch
        XCTAssertTrue(savedNote.waitForExistence(timeout: 12))
        savedNote.tap()
        XCTAssertTrue(app.staticTexts["语音记录"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["播放录音"].waitForExistence(timeout: 8))

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "10-voice-cold-relaunch-result"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testUploadOutageSurvivesColdRelaunchAndResumes() async throws {
        try await runUploadOutageJourney(copy: .chinese)
    }

    func testEnglishUploadOutageSurvivesColdRelaunchAndResumes() async throws {
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "english"
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-notes"].waitForExistence(timeout: 10))
        try await runUploadOutageJourney(copy: .english)
    }

    func testMicrophonePermissionDenialOffersSettingsRecovery() throws {
        try runMicrophonePermissionDenialJourney(copy: .chinese)
    }

    func testEnglishMicrophonePermissionDenialOffersSettingsRecovery() throws {
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "english"
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-notes"].waitForExistence(timeout: 10))
        try runMicrophonePermissionDenialJourney(copy: .english)
    }

    func testAudioInterruptionPausesAndCanResumeRecording() {
        runAudioInterruptionJourney(copy: .chinese)
    }

    func testEnglishAudioInterruptionPausesAndCanResumeRecording() {
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "english"
        app.launchEnvironment["XOPC_UI_TEST_AUDIO_INTERRUPTION"] = "1"
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-notes"].waitForExistence(timeout: 10))
        runAudioInterruptionJourney(copy: .english, relaunch: false)
    }

    func testSpokenVoiceNoteReachesCompletedTranscript() async throws {
        guard ProcessInfo.processInfo.environment["XOPC_UI_TEST_SPOKEN_AUDIO_BASE64"] != nil else {
            throw XCTSkip("A spoken PCM WAV fixture is required")
        }
        app.buttons["home-tab-notes"].tap()
        app.buttons["新建笔记"].tap()
        app.buttons["语音笔记"].tap()
        app.buttons["开始录音"].tap()
        let consent = app.buttons["同意并开始"]
        if consent.waitForExistence(timeout: 2) {
            consent.tap()
        }
        XCTAssertTrue(app.buttons["暂停"].waitForExistence(timeout: 5))
        app.buttons["暂停"].tap()
        app.buttons["保存"].tap()

        XCTAssertTrue(app.staticTexts["转写已完成"].waitForExistence(timeout: 120))
        XCTAssertTrue(app.buttons["逐字稿"].exists)
        let created = try await createdVoiceNotes()
        XCTAssertEqual(created.count, 1)
        let noteID = try XCTUnwrap(created.first?["id"] as? String)
        createdNoteID = noteID
        let discussion = try await discussionForNote(noteID)
        XCTAssertEqual(discussion.status, "completed")
        XCTAssertFalse(discussion.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        capture("voice-spoken-transcription-completed")
    }

    private func runAudioInterruptionJourney(copy: VoiceOutageCopy, relaunch: Bool = true) {
        if relaunch {
            app.terminate()
            app.launchEnvironment["XOPC_UI_TEST_AUDIO_INTERRUPTION"] = "1"
            app.launch()
            XCTAssertTrue(app.buttons["home-tab-notes"].waitForExistence(timeout: 10))
        }
        app.buttons["home-tab-notes"].tap()
        app.buttons[copy.newNote].tap()
        app.buttons[copy.voiceNote].tap()
        app.buttons[copy.start].tap()
        let consent = app.buttons[copy.consent]
        if consent.waitForExistence(timeout: 2) {
            consent.tap()
        }

        let interruption = app.staticTexts[copy.interruption]
        XCTAssertTrue(interruption.waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons[copy.resume].exists)
        XCTAssertTrue(app.buttons[copy.save].exists)
        capture("voice-audio-interruption-paused-\(copy.screenshotSuffix)")
        app.buttons[copy.resume].tap()
        XCTAssertTrue(app.buttons[copy.pause].waitForExistence(timeout: 5))
        XCTAssertTrue(interruption.waitForNonExistence(timeout: 5))

        app.buttons[copy.screenshotSuffix == "en" ? "Cancel" : "取消"].tap()
        let discard = copy.screenshotSuffix == "en" ? "Discard Recording" : "丢弃录音"
        XCTAssertTrue(app.buttons[discard].waitForExistence(timeout: 5))
        app.buttons[discard].tap()
    }

    private func runMicrophonePermissionDenialJourney(copy: VoiceOutageCopy) throws {
        guard ProcessInfo.processInfo.environment["XOPC_E2E_MICROPHONE_DENIED"] == "1" else {
            throw XCTSkip("Run after denying microphone access for the app")
        }
        app.buttons["home-tab-notes"].tap()
        app.buttons[copy.newNote].tap()
        app.buttons[copy.voiceNote].tap()
        app.buttons[copy.start].tap()
        let consentButton = app.buttons[copy.consent]
        if consentButton.waitForExistence(timeout: 2) {
            consentButton.tap()
        }

        XCTAssertTrue(app.staticTexts[copy.permissionError].waitForExistence(timeout: 5))
        let settingsButton = app.buttons["voice-open-settings"]
        XCTAssertTrue(settingsButton.exists)
        XCTAssertEqual(settingsButton.label, copy.openSettings)
        settingsButton.tap()

        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 5))
        app.activate()
        XCTAssertTrue(app.buttons["voice-open-settings"].waitForExistence(timeout: 5))
        capture("voice-microphone-permission-denied-\(copy.screenshotSuffix)")
    }

    private func runUploadOutageJourney(copy: VoiceOutageCopy) async throws {
        guard ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_PROXY_URL"] != nil else {
            throw XCTSkip("A discussion upload fault proxy is required")
        }
        app.buttons["home-tab-notes"].tap()
        app.buttons[copy.newNote].tap()
        app.buttons[copy.voiceNote].tap()
        app.buttons[copy.start].tap()
        let consent = app.buttons[copy.consent]
        if consent.waitForExistence(timeout: 2) {
            consent.tap()
        }
        XCTAssertTrue(app.buttons[copy.pause].waitForExistence(timeout: 5))
        app.buttons[copy.pause].tap()
        app.buttons[copy.save].tap()
        XCTAssertTrue(app.staticTexts[copy.waiting].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons[copy.continueProcessing].exists)
        XCTAssertTrue(app.staticTexts[copy.uploadError].exists)
        capture("voice-upload-outage-\(copy.screenshotSuffix)")

        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-notes"].waitForExistence(timeout: 10))
        app.buttons["home-tab-notes"].tap()
        let recovery = app.buttons.matching(NSPredicate(
            format: "label CONTAINS %@",
            copy.recoveryTitle
        )).firstMatch
        XCTAssertTrue(recovery.waitForExistence(timeout: 10))
        recovery.tap()
        XCTAssertTrue(app.buttons[copy.continueProcessing].waitForExistence(timeout: 8))

        try await releaseUploadProxy()
        app.buttons[copy.continueProcessing].tap()
        XCTAssertTrue(app.staticTexts[copy.recording].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons[copy.play].waitForExistence(timeout: 10))
        if copy.screenshotSuffix == "en" {
            XCTAssertTrue(app.staticTexts["Inbox"].exists)
            XCTAssertTrue(app.staticTexts["Voice Message.wav"].exists)
        }

        let created = try await createdVoiceNotes()
        XCTAssertEqual(created.count, 1)
        createdNoteID = try XCTUnwrap(created.first?["id"] as? String)
        capture("voice-upload-recovered-after-relaunch-\(copy.screenshotSuffix)")
    }

    override func tearDown() async throws {
        defer { app = nil }
        guard !gatewayToken.isEmpty else { return }
        let candidates = try await createdVoiceNotes()
        if createdNoteID == nil, candidates.count == 1 {
            createdNoteID = candidates.first?["id"] as? String
        }
        guard let id = createdNoteID else {
            XCTAssertTrue(candidates.isEmpty, "Unexpected new voice notes require manual review")
            return
        }
        let candidate = candidates.first { ($0["id"] as? String) == id }
        XCTAssertNotNil(candidate)
        guard candidate != nil else { return }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:18790/api/notes/\(id)")!)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(gatewayToken)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let remaining = try await createdVoiceNotes()
        XCTAssertFalse(remaining.contains { ($0["id"] as? String) == id })
    }

    private func createdVoiceNotes() async throws -> [[String: Any]] {
        try await listNotes().filter {
            ($0["kind"] as? String) == "voice" &&
                (($0["createdAt"] as? NSNumber)?.int64Value ?? 0) >= startedAtMs &&
                !baselineIDs.contains($0["id"] as? String ?? "")
        }
    }

    private func listNotes() async throws -> [[String: Any]] {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:18790/api/notes?limit=100")!)
        request.setValue("Bearer \(gatewayToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let page = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return page["items"] as? [[String: Any]] ?? []
    }

    private func discussionForNote(_ noteID: String) async throws -> (status: String, transcript: String) {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:18790/api/discussions/by-note/\(noteID)")!)
        request.setValue("Bearer \(gatewayToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let discussion = try XCTUnwrap(payload["discussion"] as? [String: Any])
        let transcript = try XCTUnwrap(payload["transcript"] as? [String: Any])
        let status = try XCTUnwrap(discussion["status"] as? String)
        return (status, transcript["text"] as? String ?? "")
    }

    private func releaseUploadProxy() async throws {
        guard let rawURL = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_PROXY_URL"],
              let url = URL(string: rawURL)?.appending(path: "__release-upload")
        else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 204)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
