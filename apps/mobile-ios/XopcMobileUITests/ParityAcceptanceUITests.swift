import XCTest

// swiftlint:disable file_length

@MainActor
// swiftlint:disable:next type_body_length
final class ParityAcceptanceUITests: XCTestCase {
    private var app: XCUIApplication!
    private var isolatedAutomationID: String?
    private var isolatedGatewayURL: URL?
    private var isolatedGatewayToken: String?
    private var createdNoteID: String?

    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        if let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"] {
            app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        }
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launchEnvironment["XOPC_UI_TEST_SYNTHETIC_AUDIO"] = "1"
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = "http://127.0.0.1:18790"
        app.launch()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 10))
    }

    override func tearDown() async throws {
        defer { app = nil }
        if let createdNoteID,
           let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"]
        {
            try await deleteNote(id: createdNoteID, token: token)
        }
        if let isolatedAutomationID, let isolatedGatewayURL, let isolatedGatewayToken {
            var request = URLRequest(url: isolatedGatewayURL.appending(path: "api/automations/\(isolatedAutomationID)"))
            request.httpMethod = "DELETE"
            request.setValue("Bearer \(isolatedGatewayToken)", forHTTPHeaderField: "Authorization")
            let (_, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        }
    }

    func testAssistantConversationAndComposerJourneys() {
        capture("01-assistant-home")
        openTab("对话")
        capture("02-conversations")
        XCTAssertTrue(openCell(at: 3))
        capture("03-chat-detail")

        let moreButtons = app.buttons.matching(identifier: "更多")
        let more = moreButtons.firstMatch
        if more.waitForExistence(timeout: 5), more.isHittable {
            more.tap()
            capture("11-message-actions")
            app.buttons.matching(NSPredicate(format: "label == %@", "消息详情")).firstMatch.tap()
            XCTAssertTrue(app.descendants(matching: .any)["message-detail-content"].waitForExistence(timeout: 5))
            capture("12-message-detail")
            dismissSheet()
            more.tap()
            let execution = app.buttons["执行过程"]
            XCTAssertTrue(execution.waitForExistence(timeout: 5))
            execution.tap()
            XCTAssertTrue(app.navigationBars["执行过程"].waitForExistence(timeout: 5))
            capture("13-execution-process")
            let groupedSearch = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "搜索网页")).firstMatch
            if groupedSearch.waitForExistence(timeout: 3) {
                groupedSearch.tap()
                capture("14-step-detail")
            }
            dismissSheet()
        }

        let add = app.buttons["添加附件或引用"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        capture("30-composer-actions")
        tapIfExists("关闭添加面板")
    }

    func testSlashCommandAndSkillPalette() {
        openNewConversation()
        let composer = app.textFields["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 8))
        composer.tap()
        composer.typeText("/")
        let suggestion = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "composer-palette-")
        ).firstMatch
        XCTAssertTrue(suggestion.waitForExistence(timeout: 8))
        suggestion.tap()
        XCTAssertTrue((composer.value as? String)?.hasPrefix("/") == true)
    }

    private func openAssistantMessageActions() {
        let message = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "chat-message-assistant-")
        ).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 8))
        message.press(forDuration: 0.6)
    }

    func testAssistantMessageReadAloudControls() {
        openTab("对话")
        XCTAssertTrue(openCell(at: 3))
        openAssistantMessageActions()
        let readButton = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "chat-read-aloud-")).firstMatch
        XCTAssertTrue(readButton.waitForExistence(timeout: 8))
        readButton.tap()
        XCTAssertTrue(app.descendants(matching: .any)["chat-read-aloud-bar"].waitForExistence(timeout: 8))
        capture("assistant-read-aloud-bar")
        let stop = app.buttons["chat-read-aloud-stop"]
        XCTAssertTrue(stop.exists)
        stop.tap()
        XCTAssertFalse(app.descendants(matching: .any)["chat-read-aloud-bar"].exists)
    }

    func testExistingChatImageMediaPreview() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"],
              let conversationID = ProcessInfo.processInfo.environment["XOPC_E2E_MEDIA_CONVERSATION_ID"]
        else { throw XCTSkip("An existing image conversation and Gateway token are required") }
        var request = try URLRequest(url: XCTUnwrap(URL(
            string: "http://127.0.0.1:18790/api/sessions?limit=50&offset=0&channel=webchat&sortBy=updatedAt&sortOrder=desc"
        )))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let page = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let rows = page["items"] as? [[String: Any]] ?? []
        guard let title = rows.first(where: { $0["key"] as? String == conversationID })?["name"] as? String else {
            throw XCTSkip("The image conversation is outside the currently loaded 50 conversations")
        }

        app.openHomeDestination("search")
        let search = app.textFields["conversations-search-field"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(title)
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        let image = app.buttons["markdown-image-preview"].firstMatch
        let timeline = app.scrollViews.firstMatch
        for _ in 0 ..< 12 where !image.exists {
            timeline.swipeDown()
        }
        XCTAssertTrue(image.waitForExistence(timeout: 20), "Persisted chat image should render as a thumbnail")
        image.tap()
        XCTAssertTrue(app.buttons["关闭"].waitForExistence(timeout: 5))
        capture("chat-history-image-preview")
        app.buttons["关闭"].tap()
    }

    func testExistingChatDocumentMediaPreview() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"],
              let conversationID = ProcessInfo.processInfo.environment["XOPC_E2E_MEDIA_CONVERSATION_ID"]
        else { throw XCTSkip("An isolated media conversation and Gateway token are required") }
        var request = try URLRequest(url: XCTUnwrap(URL(
            string: "http://127.0.0.1:18790/api/sessions/\(conversationID)/history?limit=50"
        )))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let session = try XCTUnwrap(envelope["session"] as? [String: Any])
        let title = try XCTUnwrap(session["name"] as? String)
        app.openHomeDestination("search")
        let search = app.textFields["conversations-search-field"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(title)
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        let document = app.buttons["chat-attachment-preview-fixture-document"]
        let timeline = app.scrollViews.firstMatch
        for _ in 0 ..< 12 where !document.exists {
            timeline.swipeDown()
        }
        XCTAssertTrue(document.waitForExistence(timeout: 12))
        document.tap()
        capture("chat-history-document-preview")
        XCTAssertTrue(app.navigationBars["fixture.txt"].waitForExistence(timeout: 10))
    }

    func testIsolatedAssistantReadAloudControls() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"],
              let conversationID = ProcessInfo.processInfo.environment["XOPC_E2E_MEDIA_CONVERSATION_ID"]
        else { throw XCTSkip("An isolated media conversation and Gateway token are required") }
        var request = try URLRequest(url: XCTUnwrap(URL(
            string: "http://127.0.0.1:18790/api/sessions/\(conversationID)/history?limit=50"
        )))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let session = try XCTUnwrap(envelope["session"] as? [String: Any])
        let title = try XCTUnwrap(session["name"] as? String)
        app.openHomeDestination("search")
        let search = app.textFields["conversations-search-field"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(title)
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        openAssistantMessageActions()
        let read = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "chat-read-aloud-")).firstMatch
        XCTAssertTrue(read.waitForExistence(timeout: 8))
        read.tap()
        XCTAssertTrue(app.descendants(matching: .any)["chat-read-aloud-bar"].waitForExistence(timeout: 8))
        app.buttons["chat-read-aloud-stop"].tap()
        XCTAssertFalse(app.descendants(matching: .any)["chat-read-aloud-bar"].exists)
    }

    func testExistingChatVoiceMediaRestored() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"],
              let conversationID = ProcessInfo.processInfo.environment["XOPC_E2E_VOICE_CONVERSATION_ID"]
        else { throw XCTSkip("An existing voice conversation and Gateway token are required") }
        var request = try URLRequest(url: XCTUnwrap(URL(
            string: "http://127.0.0.1:18790/api/sessions/\(conversationID)/history?limit=50"
        )))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let session = try XCTUnwrap(envelope["session"] as? [String: Any])
        let title = try XCTUnwrap(session["name"] as? String)
        let messages = session["messages"] as? [[String: Any]] ?? []
        let voiceID = try XCTUnwrap(messages.flatMap { $0["media"] as? [[String: Any]] ?? [] }
            .first(where: { $0["type"] as? String == "voice" })?["id"] as? String)

        app.openHomeDestination("search")
        let search = app.textFields["conversations-search-field"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(title)
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Server search should find older conversations")
        row.tap()
        let voice = app.buttons["chat-audio-\(voiceID)"].firstMatch
        let timeline = app.scrollViews.firstMatch
        for _ in 0 ..< 30 where !voice.exists {
            timeline.swipeDown()
        }
        XCTAssertTrue(voice.waitForExistence(timeout: 10), "Historical voice message should be restored")
    }

    func testAssistantMessageSaveToNotesAndCleanup() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"] else {
            throw XCTSkip("A Gateway token is required for note cleanup")
        }
        let before = try await noteIDs(token: token)
        openTab("对话")
        XCTAssertTrue(openCell(at: 3))
        openAssistantMessageActions()
        let save = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "chat-save-note-")).firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        save.tap()
        let saved = app.alerts["已保存到笔记"].waitForExistence(timeout: 12)
        capture("assistant-save-note-result")

        let created = try await noteIDs(token: token).subtracting(before)
        if created.count == 1, let noteID = created.first {
            try await deleteNote(id: noteID, token: token)
        }
        XCTAssertTrue(saved)
        XCTAssertEqual(created.count, 1, "Only the note created by this test may be deleted")
        let remaining = try await noteIDs(token: token)
        XCTAssertEqual(remaining, before)
    }

    func testAssistantAddPanelActionsAndPlacement() {
        openNewConversation()
        let add = app.buttons["添加附件或引用"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        XCTAssertTrue(app.buttons["照片"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["拍照"].exists)
        XCTAssertTrue(app.buttons["本地文件"].exists)
        XCTAssertTrue(app.buttons["语音输入"].exists)
        XCTAssertTrue(app.buttons["引用笔记"].exists)
        XCTAssertTrue(app.buttons["引用任务"].exists)
        XCTAssertTrue(app.buttons["引用文件"].exists)
        XCTAssertFalse(app.buttons["assistant-action-newConversation"].exists)
        XCTAssertGreaterThan(app.buttons["照片"].frame.minY, app.descendants(matching: .any)["assistant-chat-composer"].frame.maxY)
        app.buttons["引用任务"].tap()
        XCTAssertTrue(app.navigationBars["添加引用"].waitForExistence(timeout: 5))
        app.buttons["取消"].tap()
        add.tap()
        app.buttons["关闭添加面板"].tap()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 5))
    }

    func testAssistantVoiceModeReplacesTheComposerWithHoldToSpeak() {
        openNewConversation()
        app.buttons["语音输入"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["chat-hold-to-speak"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["语音"].exists)
        app.buttons["键盘输入"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["assistant-chat-composer"].firstMatch.waitForExistence(timeout: 5))
    }

    func testAssistantKeyboardAndAddPanelAreMutuallyExclusive() {
        openNewConversation()
        let composer = app.descendants(matching: .any)["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertLessThan(app.keyboards.firstMatch.frame.minY, app.frame.maxY)
        capture("assistant-keyboard-tab-visibility")

        app.buttons["添加附件或引用"].tap()
        let panel = app.descendants(matching: .any)["assistant-action-panel"].firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        capture("assistant-add-panel-after-keyboard")

        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(panel.exists)
        capture("assistant-keyboard-after-add-panel")

        app.buttons["添加附件或引用"].tap()
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        app.buttons["关闭添加面板"].tap()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 5))
    }

    func testSessionContextLivesInToolbarMenu() {
        XCTAssertFalse(app.buttons["新对话"].exists)
        let actions = app.buttons["会话信息与设置"]
        XCTAssertTrue(actions.waitForExistence(timeout: 5))
        actions.tap()
        XCTAssertTrue(app.navigationBars["会话信息与设置"].waitForExistence(timeout: 5))
        app.buttons["当前上下文"].tap()
        XCTAssertTrue(app.navigationBars["当前上下文"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["新对话尚无上下文"].exists)
        app.swipeUp()
        let addReference = app.buttons["添加单次引用"]
        XCTAssertTrue(addReference.waitForExistence(timeout: 5))
        addReference.tap()
        XCTAssertTrue(app.navigationBars["添加引用"].waitForExistence(timeout: 5))
        app.buttons["取消"].tap()
        navigateBack()
        app.buttons["执行环境与范围"].tap()
        XCTAssertTrue(app.navigationBars["执行环境与范围"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["不关联项目"].exists)
        app.buttons["不关联项目"].tap()
        XCTAssertTrue(app.navigationBars["执行环境与范围"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["会话信息与设置"].waitForExistence(timeout: 5))
    }

    func testAssistantActionPanelAccessibilityAudit() throws {
        openNewConversation()
        let add = app.buttons["添加附件或引用"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        XCTAssertTrue(app.descendants(matching: .any)["assistant-action-panel"].firstMatch.waitForExistence(timeout: 5))

        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)
        capture("assistant-action-panel-accessibility-audit")
    }

    func testHomeDestinationsAccessibilityAudit() throws {
        for page in ["对话", "进展", "资料", "设置"] {
            openTab(page)
            XCTAssertTrue(app.navigationBars[page].waitForExistence(timeout: 8), "Missing page: \(page)")
            try app.performAccessibilityAudit(for: [
                .elementDetection,
                .hitRegion,
                .sufficientElementDescription,
                .textClipped,
                .trait
            ])
        }
        capture("home-destinations-accessibility-audit")
    }

    func testProgressDestinationsAccessibilityAudit() throws {
        openTab("进展")
        for (page, destination) in [("tasks", "任务"), ("projects", "项目")] {
            app.selectPageOption("work-page-\(page)", from: "work-page-menu")
            XCTAssertTrue(app.navigationBars[destination].waitForExistence(timeout: 8), "Missing page: \(destination)")
            try app.performAccessibilityAudit(for: [
                .elementDetection,
                .hitRegion,
                .sufficientElementDescription,
                .textClipped,
                .trait
            ])
        }
        capture("progress-destinations-accessibility-audit")
    }

    func testConversationDetailAccessibilityAudit() throws {
        openTab("对话")
        XCTAssertTrue(openCell(at: 3))
        XCTAssertTrue(app.descendants(matching: .any)["assistant-chat-composer"].waitForExistence(timeout: 8))
        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)
        capture("conversation-detail-accessibility-audit")
    }

    func testAutomationDetailsAccessibilityAudit() throws {
        openTab("进展")
        app.buttons["自动化"].tap()
        let automation = app.buttons["automation-system-memory-temporal-sweep"]
        XCTAssertTrue(automation.waitForExistence(timeout: 10))
        automation.tap()
        XCTAssertTrue(app.staticTexts["最近运行"].waitForExistence(timeout: 10))
        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)

        let run = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "automation-run-")).firstMatch
        XCTAssertTrue(run.waitForExistence(timeout: 10))
        run.tap()
        XCTAssertTrue(app.staticTexts["时间线"].waitForExistence(timeout: 10))
        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)
        capture("automation-details-accessibility-audit")
    }

    func testTaskDetailAccessibilityAudit() throws {
        openTab("进展")
        app.buttons["任务"].tap()
        let task = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "task-")).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        task.tap()
        XCTAssertTrue(app.buttons["task-chat-details-tip"].waitForExistence(timeout: 10))
        app.buttons["task-chat-details-tip"].tap()
        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)
        capture("task-detail-accessibility-audit")
    }

    func testProjectDetailAccessibilityAudit() throws {
        openTab("进展")
        app.buttons["项目"].tap()
        let project = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-")).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 10))
        project.tap()
        XCTAssertTrue(app.buttons["新建项目对话"].waitForExistence(timeout: 10))
        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)
        capture("project-detail-accessibility-audit")
    }

    func testNoteDetailAccessibilityAudit() throws {
        openTab("笔记")
        let note = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "note-row-")).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 10))
        note.tap()
        XCTAssertTrue(app.buttons["编辑"].waitForExistence(timeout: 10))
        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)
        capture("note-detail-accessibility-audit")
    }

    func testCreationEditorsAccessibilityAudit() throws {
        openTab("笔记")
        app.buttons["新建笔记"].tap()
        XCTAssertTrue(app.navigationBars["新建笔记"].waitForExistence(timeout: 8))
        try performCoreAccessibilityAudit()
        app.buttons["取消"].tap()

        app.buttons["notes-create-voice"].tap()
        XCTAssertTrue(app.navigationBars["语音笔记"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["开始录音"].waitForExistence(timeout: 8))
        try performCoreAccessibilityAudit()
        app.buttons["取消"].tap()

        openTab("进展")
        app.buttons["自动化"].tap()
        XCTAssertTrue(app.buttons["新建自动化"].waitForExistence(timeout: 8))
        app.buttons["新建自动化"].tap()
        XCTAssertTrue(app.navigationBars["用对话创建定时任务"].waitForExistence(timeout: 8))
        try performCoreAccessibilityAudit()
        capture("creation-editors-accessibility-audit")
    }

    func testAssistantMessageAndExecutionAccessibilityAudit() throws {
        openTab("对话")
        XCTAssertTrue(openCell(at: 3))
        let more = app.buttons.matching(identifier: "更多").firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 8))
        more.tap()
        let details = app.buttons.matching(NSPredicate(format: "label == %@", "消息详情")).firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: 5))
        details.tap()
        XCTAssertTrue(app.navigationBars["消息详情"].waitForExistence(timeout: 8))
        try performCoreAccessibilityAudit()

        let execution = app.buttons["执行过程"]
        XCTAssertTrue(execution.waitForExistence(timeout: 8))
        execution.tap()
        XCTAssertTrue(app.navigationBars["执行过程"].waitForExistence(timeout: 8))
        try performCoreAccessibilityAudit()
        capture("assistant-message-execution-accessibility-audit")
    }

    func testVoiceNoteLifecycleAccessibilityAudit() throws {
        openTab("笔记")
        app.buttons["notes-create-voice"].tap()
        let discardPending = app.buttons["丢弃这段录音"]
        if discardPending.waitForExistence(timeout: 3) {
            discardPending.tap()
            let confirmDiscard = app.buttons["丢弃录音"]
            XCTAssertTrue(confirmDiscard.waitForExistence(timeout: 3))
            confirmDiscard.tap()
        }
        let start = app.buttons["开始录音"]
        XCTAssertTrue(start.waitForExistence(timeout: 8))
        start.tap()
        let consent = app.buttons["同意并开始"]
        if consent.waitForExistence(timeout: 3) {
            consent.tap()
        }

        XCTAssertTrue(app.buttons["暂停"].waitForExistence(timeout: 8))
        try performCoreAccessibilityAudit()
        app.buttons["暂停"].tap()
        XCTAssertTrue(app.buttons["继续"].waitForExistence(timeout: 5))
        try performCoreAccessibilityAudit()

        app.buttons["保存"].tap()
        XCTAssertTrue(app.navigationBars["笔记"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["语音记录"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["逐字稿"].exists)
        try performContentAccessibilityAudit()
        assertVoiceDetailHitTargets()

        let retry = app.buttons["重试"]
        XCTAssertTrue(retry.waitForExistence(timeout: 20))
        try performContentAccessibilityAudit()
        assertVoiceDetailHitTargets()
        retry.tap()
        XCTAssertTrue(app.buttons["播放录音"].waitForExistence(timeout: 8))
        try performContentAccessibilityAudit()
        assertVoiceDetailHitTargets()
        capture("voice-note-lifecycle-accessibility-audit")

        let more = app.buttons["更多"]
        if more.waitForExistence(timeout: 3) {
            more.tap()
            let delete = app.buttons["删除"].firstMatch
            if delete.waitForExistence(timeout: 3) {
                delete.tap()
                let confirm = app.buttons["删除"].firstMatch
                if confirm.waitForExistence(timeout: 3) {
                    confirm.tap()
                }
            }
        }
    }

    func testExistingAutomationRunShowsTimeline() {
        openTab("进展")
        app.buttons["自动化"].tap()
        app.buttons["automation-filter-enabled"].tap()
        let automation = app.buttons["automation-system-memory-temporal-sweep"]
        XCTAssertTrue(automation.waitForExistence(timeout: 10))
        automation.tap()
        let run = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "automation-run-")).firstMatch
        XCTAssertTrue(run.waitForExistence(timeout: 10))
        run.tap()
        XCTAssertTrue(app.staticTexts["记忆维护已完成"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["时间线"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["自动化运行已开始"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["返回自动化"].exists)
        capture("automation-run-timeline")
        app.buttons["返回自动化"].tap()
        XCTAssertTrue(app.staticTexts["最近运行"].waitForExistence(timeout: 5))
    }

    func testAutomationListSearchAndFilters() {
        openTab("进展")
        app.buttons["自动化"].tap()
        let all = app.buttons["automation-filter-all"]
        XCTAssertTrue(all.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["管理定时运行、状态与最近结果"].exists)
        app.buttons["automation-open-search"].tap()
        let search = app.textFields["automation-search"]
        XCTAssertTrue(search.exists)
        search.tap()
        search.typeText("xopc-ios-no-matching-automation")
        XCTAssertTrue(app.staticTexts["没有匹配的自动化"].waitForExistence(timeout: 5))
        app.buttons["清除搜索"].tap()
        XCTAssertFalse(app.staticTexts["没有匹配的自动化"].exists)
        app.selectPageOption("automation-filter-paused", from: "automation-filter-menu")
        XCTAssertTrue(app.buttons["automation-filter-enabled"].exists)
        all.tap()
        capture("22-automations-search-filters")
    }

    // swiftlint:disable:next function_body_length
    func testIsolatedAutomationRunAndRerun() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let rawURL = environment["XOPC_ISOLATED_GATEWAY_URL"], let url = URL(string: rawURL),
              let token = environment["XOPC_ISOLATED_GATEWAY_TOKEN"]
        else {
            throw XCTSkip("An isolated Gateway is required for automation write tests")
        }
        isolatedGatewayURL = url
        isolatedGatewayToken = token
        let id = "ios-isolated-run-\(UUID().uuidString.lowercased())"
        let name = "iOS isolated automation run"
        var create = URLRequest(url: url.appending(path: "api/automations"))
        create.httpMethod = "POST"
        create.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        create.setValue("application/json", forHTTPHeaderField: "Content-Type")
        create.httpBody = try JSONSerialization.data(withJSONObject: [
            "id": id,
            "name": name,
            "enabled": false,
            "trigger": ["kind": "manual"],
            "action": [
                "kind": "task_command",
                "taskId": "missing-ios-isolated-task",
                "command": ["type": "mark_ready"]
            ]
        ])
        let (_, createdResponse) = try await URLSession.shared.data(for: create)
        XCTAssertEqual((createdResponse as? HTTPURLResponse)?.statusCode, 201)
        isolatedAutomationID = id

        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = rawURL
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        app.launch()
        openTab("进展")
        app.buttons["自动化"].tap()
        app.buttons["automation-open-search"].tap()
        let search = app.textFields["automation-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText(name)
        let automation = app.buttons["automation-\(id)"]
        XCTAssertTrue(automation.waitForExistence(timeout: 10))
        automation.tap()
        app.buttons["立即运行"].tap()
        XCTAssertTrue(app.buttons["重新运行"].waitForExistence(timeout: 25))
        XCTAssertTrue(app.staticTexts["自动化目标不存在或已被移除。"].exists)
        XCTAssertFalse(app.staticTexts["not_found"].exists)
        capture("23-isolated-automation-failed-run")
        app.buttons["重新运行"].tap()
        XCTAssertTrue(app.buttons["返回自动化"].waitForExistence(timeout: 15))
        let runs = try await isolatedAutomationRuns(id: id, url: url, token: token)
        XCTAssertEqual(runs.count, 2)
        capture("23-isolated-automation-rerun")
    }

    func testIsolatedQueuedAutomationCancellation() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let rawURL = environment["XOPC_ISOLATED_GATEWAY_URL"], let url = URL(string: rawURL),
              let token = environment["XOPC_ISOLATED_GATEWAY_TOKEN"],
              let automationID = environment["XOPC_ISOLATED_AUTOMATION_ID"],
              let runID = environment["XOPC_ISOLATED_RUN_ID"],
              let name = environment["XOPC_ISOLATED_AUTOMATION_NAME"]
        else {
            throw XCTSkip("An isolated Gateway with a queued run is required for cancellation tests")
        }
        isolatedGatewayURL = url
        isolatedGatewayToken = token
        isolatedAutomationID = automationID

        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = rawURL
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        app.launch()
        openTab("进展")
        app.buttons["自动化"].tap()
        app.buttons["automation-open-search"].tap()
        let search = app.textFields["automation-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText(name)
        let automation = app.buttons["automation-\(automationID)"]
        XCTAssertTrue(automation.waitForExistence(timeout: 10))
        automation.tap()
        let queuedRun = app.buttons["automation-run-\(runID)"]
        XCTAssertTrue(queuedRun.waitForExistence(timeout: 10))
        queuedRun.tap()
        XCTAssertTrue(app.buttons["取消运行"].waitForExistence(timeout: 10))
        app.buttons["取消运行"].tap()
        XCTAssertTrue(app.buttons["确认取消运行"].waitForExistence(timeout: 5))
        app.buttons["确认取消运行"].tap()
        XCTAssertTrue(app.buttons["重新运行"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["已确认取消运行"].waitForExistence(timeout: 5))
        capture("24-isolated-automation-cancelled")
    }

    func testIsolatedAutomationOpensAssociatedConversation() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let rawURL = environment["XOPC_ISOLATED_GATEWAY_URL"], let url = URL(string: rawURL),
              let token = environment["XOPC_ISOLATED_GATEWAY_TOKEN"],
              let automationID = environment["XOPC_ISOLATED_AUTOMATION_ID"],
              let runID = environment["XOPC_ISOLATED_RUN_ID"],
              let name = environment["XOPC_ISOLATED_AUTOMATION_NAME"],
              let marker = environment["XOPC_ISOLATED_CONVERSATION_MARKER"]
        else {
            throw XCTSkip("An isolated Gateway with an associated conversation is required")
        }
        isolatedGatewayURL = url
        isolatedGatewayToken = token
        isolatedAutomationID = automationID

        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = rawURL
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        app.launch()
        openTab("进展")
        app.buttons["自动化"].tap()
        app.buttons["automation-open-search"].tap()
        let search = app.textFields["automation-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText(name)
        let automation = app.buttons["automation-\(automationID)"]
        XCTAssertTrue(automation.waitForExistence(timeout: 10))
        automation.tap()
        let completedRun = app.buttons["automation-run-\(runID)"]
        XCTAssertTrue(completedRun.waitForExistence(timeout: 10))
        completedRun.tap()
        let openConversation = app.buttons["打开会话"]
        XCTAssertTrue(openConversation.waitForExistence(timeout: 10))
        openConversation.tap()
        XCTAssertTrue(app.textFields["assistant-chat-composer"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts[marker].waitForExistence(timeout: 10))
        capture("25-isolated-automation-associated-conversation")
    }

    private func isolatedAutomationRuns(id: String, url: URL, token: String) async throws -> [[String: Any]] {
        var components = URLComponents(url: url.appending(path: "api/automation-runs"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "automationId", value: id)]
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let page = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return page["runs"] as? [[String: Any]] ?? []
    }

    func testRealtimeVoiceAssistantSessionAndControls() {
        openTab("对话")
        XCTAssertTrue(openCell(at: 3))
        let voice = app.buttons["chat-header-voice-call"]
        XCTAssertTrue(voice.waitForExistence(timeout: 5))
        XCTAssertTrue(voice.isEnabled)
        voice.tap()
        XCTAssertTrue(app.buttons["voice-call-minimize"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["正在聆听"].waitForExistence(timeout: 20))
        capture("voice-assistant-connected")
        app.buttons["voice-call-minimize"].tap()
        XCTAssertTrue(app.buttons["返回语音通话"].waitForExistence(timeout: 5))
        capture("voice-assistant-mini")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["返回语音通话"].waitForExistence(timeout: 8))
        app.buttons["返回语音通话"].tap()
        XCTAssertTrue(app.buttons["voice-call-minimize"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["正在聆听"].waitForExistence(timeout: 8))
        app.buttons["voice-call-end"].tap()
        XCTAssertFalse(app.buttons["voice-call-minimize"].waitForExistence(timeout: 3))
    }

    func testRealtimeVoiceNaturalReportsFailureOrConnects() {
        openTab("对话")
        XCTAssertTrue(openCell(at: 3))
        let voice = app.buttons["chat-header-voice-call"]
        XCTAssertTrue(voice.waitForExistence(timeout: 5))
        voice.tap()
        XCTAssertTrue(app.buttons["voice-call-minimize"].waitForExistence(timeout: 8))
        let paused = app.staticTexts["通话已暂停"]
        let connected = app.staticTexts["正在聆听"]
        let deadline = Date().addingTimeInterval(20)
        while !paused.exists, !connected.exists, Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertTrue(paused.exists || connected.exists, "Voice must not remain connecting indefinitely")
        capture("voice-natural-result")
        if paused.exists {
            XCTAssertTrue(app.buttons["重试"].exists)
            let error = app.staticTexts["voice-call-error"]
            XCTAssertTrue(error.exists)
            XCTAssertFalse(error.label.contains("OMNI_"))
        }
        app.buttons["voice-call-end"].tap()
        XCTAssertFalse(app.buttons["voice-call-minimize"].waitForExistence(timeout: 3))
    }

    func testEnglishAssistantReferencesAndVoiceControls() {
        relaunchInEnglish()
        app.openHomeDestination("conversations")
        XCTAssertTrue(openCell(at: 3))

        app.buttons["Add Attachments or References"].tap()
        XCTAssertTrue(app.buttons["Reference Note"].waitForExistence(timeout: 5))
        app.buttons["Reference Note"].tap()
        XCTAssertTrue(app.navigationBars["Add Reference"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.searchFields["Search Notes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["reference-tab-note"].exists)
        app.buttons["reference-tab-task"].tap()
        XCTAssertTrue(app.searchFields["Search Tasks"].waitForExistence(timeout: 5))
        app.buttons["reference-tab-file"].tap()
        XCTAssertTrue(app.searchFields["Search Files"].waitForExistence(timeout: 5))
        capture("english-reference-picker")
        app.buttons["Cancel"].tap()

        let voice = app.buttons["chat-header-voice-call"]
        XCTAssertTrue(voice.waitForExistence(timeout: 5))
        voice.tap()
        XCTAssertTrue(app.buttons["voice-call-minimize"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Voice Assistant"].exists)
        XCTAssertTrue(app.staticTexts["Listening"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["Mute"].exists)
        XCTAssertTrue(app.buttons["Speaker"].exists)
        XCTAssertTrue(app.buttons["End"].exists)
        capture("english-voice-assistant")
        app.buttons["voice-call-minimize"].tap()
        XCTAssertTrue(app.buttons["Return to Voice Call"].waitForExistence(timeout: 5))
        app.buttons["Return to Voice Call"].tap()
        app.buttons["voice-call-end"].tap()
        XCTAssertFalse(app.buttons["voice-call-minimize"].waitForExistence(timeout: 3))
    }

    func testEnglishNotesAndAutomationEditors() {
        relaunchInEnglish()
        app.openHomeDestination("notes")
        let newNote = app.buttons["New Note"]
        XCTAssertTrue(newNote.waitForExistence(timeout: 8))
        newNote.tap()
        app.buttons["Text Note"].tap()
        XCTAssertTrue(app.navigationBars["New Note"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Unsaved"].exists)
        XCTAssertTrue(app.buttons["Add Attachment"].exists)
        capture("english-note-editor")
        app.buttons["Cancel"].tap()

        newNote.tap()
        app.buttons["Voice Note"].tap()
        XCTAssertTrue(app.navigationBars["Voice Note"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Start Recording"].exists)
        capture("english-voice-note")
        app.buttons["Cancel"].tap()

        app.openHomeDestination("progress")
        let automations = app.buttons["Automations"]
        XCTAssertTrue(automations.waitForExistence(timeout: 8))
        automations.tap()
        let newAutomation = app.buttons["New Automation"]
        XCTAssertTrue(newAutomation.waitForExistence(timeout: 8))
        newAutomation.tap()
        XCTAssertTrue(app.navigationBars["Create a schedule in chat"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["assistant-chat-composer"].firstMatch.exists)
        XCTAssertFalse(app.textFields["Cron Expression"].exists)
        capture("english-automation-chat")
        app.buttons["automation-setup-close"].tap()
    }

    func testConversationListStartsNewChat() {
        openTab("对话")
        let newChat = app.buttons["新建对话"]
        XCTAssertTrue(newChat.waitForExistence(timeout: 5))
        newChat.tap()
        XCTAssertTrue(app.descendants(matching: .any)["assistant-chat-composer"].waitForExistence(timeout: 5))
    }

    func testNotesCanBeReopenedAfterRelaunch() {
        for _ in 0 ..< 3 {
            relaunch()
            openTab("笔记")
            XCTAssertTrue(app.navigationBars["笔记"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.buttons["notes-open-search"].waitForExistence(timeout: 5))
            XCTAssertFalse(app.textFields["notes-search-field"].exists)
        }
        XCTAssertTrue(app.buttons["notes-create-voice"].exists)
        app.buttons["notes-create-text"].tap()
        XCTAssertTrue(app.navigationBars["新建笔记"].waitForExistence(timeout: 5))
    }

    func testCompletedDiscussionShowsOrganizedSummary() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"] else {
            throw XCTSkip("A Gateway token is required for read-only discussion verification")
        }
        var request = try URLRequest(url: XCTUnwrap(URL(string: "http://127.0.0.1:18790/api/discussions?limit=100")))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let page = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let discussions = page["items"] as? [[String: Any]] ?? []
        guard let noteID = discussions.first(where: { ($0["status"] as? String) == "completed" })?["noteId"] as? String else {
            throw XCTSkip("No completed discussion note is available for read-only verification")
        }
        openTab("笔记")
        let row = app.buttons["note-row-\(noteID)"]
        for _ in 0 ..< 8 {
            if row.isHittable {
                break
            }
            app.swipeUp()
        }
        XCTAssertTrue(row.waitForExistence(timeout: 8))
        row.tap()
        XCTAssertTrue(app.staticTexts["讨论纪要"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["关键要点"].exists)
        XCTAssertTrue(app.staticTexts["行动项"].exists)
        XCTAssertTrue(app.staticTexts["待确认问题"].exists)
        capture("47-completed-discussion-summary")
        let transcript = app.buttons["逐字稿"]
        XCTAssertTrue(transcript.exists)
        XCTAssertTrue(app.staticTexts["00:00"].exists)
        transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        capture("48-after-transcript-toggle")
        XCTAssertTrue(app.staticTexts["00:00"].waitForNonExistence(timeout: 3))
        transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts["00:00"].waitForExistence(timeout: 3))
    }

    func testLanguageSwitchUpdatesSidebar() {
        openTab("设置")
        app.buttons["语言"].tap()
        tapPickerOption("English")

        XCTAssertTrue(app.navigationBars["Language"].waitForExistence(timeout: 5))
        navigateBack()
        navigateBack()
        XCTAssertTrue(app.openHomeSidebar())
        XCTAssertEqual(app.buttons["chat-sidebar-search"].label, "Search Chats")

        app.openHomeDestination("conversations")
        XCTAssertTrue(app.navigationBars["Chats"].waitForExistence(timeout: 5))
        capture("46-english-conversations")
        openTab("设置")

        app.buttons["Language"].tap()
        tapPickerOption("Simplified Chinese")
        XCTAssertTrue(app.navigationBars["语言"].waitForExistence(timeout: 5))
    }

    func testEnglishProjectCreationLabels() {
        openTab("设置")
        app.buttons["语言"].tap()
        tapPickerOption("English")
        navigateBack()
        navigateBack()

        openTab("进展")
        app.buttons["Projects"].tap()
        XCTAssertTrue(openCell(at: 1))
        app.selectPageOption("project-tab-tasks", from: "project-tabs")
        app.buttons["New Project Task"].tap()
        XCTAssertTrue(app.navigationBars["New Project Task"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Task Goal"].exists)
        XCTAssertTrue(app.staticTexts["The task will be added to this project's backlog. The assistant will not start it immediately."].exists)
    }

    func testProgressJourneys() {
        openTab("进展")
        capture("15-progress-home")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "项待处理")).firstMatch.waitForExistence(timeout: 8))
        app.buttons["任务"].tap()
        capture("16-tasks-list")
        checkTaskFilters()
        let taskRow = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "task-")).firstMatch
        if taskRow.waitForExistence(timeout: 2) {
            taskRow.tap()
            capture("17-task-detail")
            XCTAssertTrue(app.buttons["task-chat-details-tip"].waitForExistence(timeout: 8))
            checkTaskEditor()
            capture("18-task-conversation")
            navigateBack()
        }

        checkProgressProjects()

        tapIfExists("自动化")
        capture("22-automations-list")
        XCTAssertTrue(app.buttons["automation-filter-menu"].exists)
        checkAutomationCreation()
        let automationRow = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@ AND NOT identifier BEGINSWITH %@ AND identifier != %@",
                                  "automation-", "automation-filter-", "automation-search")).firstMatch
        if automationRow.waitForExistence(timeout: 2) {
            automationRow.tap()
            capture("23-automation-detail")
            XCTAssertTrue(app.staticTexts["最近运行"].waitForExistence(timeout: 8))
        }
    }

    private func checkProgressProjects() {
        relaunch()
        openTab("进展")
        tapIfExists("项目")
        capture("19-projects-list")
        XCTAssertTrue(app.buttons["projects-filter-archived"].exists)
        let projectRow = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-")).firstMatch
        if projectRow.waitForExistence(timeout: 2) {
            projectRow.tap()
            capture("20-project-detail")
            XCTAssertTrue(app.buttons["新建项目对话"].waitForExistence(timeout: 5))
            let sections = ["overview", "conversations", "tasks", "notes", "automations"]
            for section in sections.dropFirst() {
                app.selectPageOption("project-tab-\(section)", from: "project-tabs")
                capture("21-project-\(section)")
            }
            checkProjectCreationForms()
            app.selectPageOption("project-tab-conversations", from: "project-tabs")
            app.buttons["新建项目对话"].tap()
            XCTAssertTrue(app.buttons["添加附件或引用"].waitForExistence(timeout: 8))
            capture("21-project-new-conversation")
            relaunch()
            openTab("进展")
        }
    }

    private func checkProjectCreationForms() {
        for (section, action, formTitle) in [
            ("tasks", "新建项目任务", "新建项目任务"),
            ("notes", "新建项目笔记", "新建笔记"),
            ("automations", "新建项目自动化", "用对话创建定时任务")
        ] {
            app.selectPageOption("project-tab-\(section)", from: "project-tabs")
            let create = app.buttons[action]
            XCTAssertTrue(create.waitForExistence(timeout: 5), "Missing project action: \(action)")
            create.tap()
            XCTAssertTrue(app.navigationBars[formTitle].waitForExistence(timeout: 5))
            capture("21-project-create-\(section)")
            app.buttons[section == "automations" ? "automation-setup-close" : "取消"].tap()
        }
    }

    private func checkTaskEditor() {
        app.buttons["task-chat-details-tip"].tap()
        app.buttons["task-chat-edit"].tap()
        XCTAssertTrue(app.navigationBars["编辑任务"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["优先级"].exists)
        capture("17-task-edit")
        app.buttons["取消"].tap()
        XCTAssertTrue(app.buttons["task-chat-status"].waitForExistence(timeout: 5))
        app.buttons["task-chat-details-close"].tap()
    }

    func testNotesJourneys() {
        openTab("笔记")
        capture("04-notes-list")
        if openCell(at: 1) {
            capture("05-voice-note-detail")
            let more = app.buttons["更多"]
            if more.waitForExistence(timeout: 3) {
                more.tap()
                capture("06-note-actions")
            }
            relaunch()
            openTab("笔记")
        }

        captureTextNoteJourneys()
        relaunch()
        openTab("笔记")

        app.buttons["新建笔记"].tap()
        capture("07-note-create")
        app.buttons["粗体"].tap()
        XCTAssertTrue((app.textViews["笔记正文"].value as? String)?.contains("**粗体**") == true)
        app.buttons["撤销"].tap()
        XCTAssertFalse((app.textViews["笔记正文"].value as? String)?.contains("**粗体**") == true)
        app.buttons["重做"].tap()
        XCTAssertTrue((app.textViews["笔记正文"].value as? String)?.contains("**粗体**") == true)
        tapIfExists("取消")

        captureVoiceNoteJourneys()
    }

    private func captureVoiceNoteJourneys() {
        app.buttons["notes-create-voice"].tap()
        capture("08-voice-ready")
        let start = app.buttons["开始录音"]
        if start.waitForExistence(timeout: 3) {
            start.tap()
            let consent = app.buttons["同意并开始"]
            if consent.waitForExistence(timeout: 2) {
                consent.tap()
            }
            XCTAssertTrue(app.buttons["暂停"].waitForExistence(timeout: 5))
            capture("08-voice-recording")
            app.buttons["暂停"].tap()
            capture("09-voice-paused")
            app.buttons["保存"].tap()
            XCTAssertTrue(app.navigationBars["笔记"].waitForExistence(timeout: 20))
            XCTAssertTrue(app.staticTexts["语音记录"].waitForExistence(timeout: 8))
            XCTAssertTrue(app.staticTexts["逐字稿"].exists)
            capture("10-voice-result")
            XCTAssertTrue(app.buttons["重试"].waitForExistence(timeout: 20))
            capture("10-voice-retry")
            app.buttons["重试"].tap()
            XCTAssertTrue(app.staticTexts["语音记录"].waitForExistence(timeout: 8))
            XCTAssertTrue(app.buttons["播放录音"].waitForExistence(timeout: 8))
            capture("10-voice-after-retry")
            let more = app.buttons["更多"]
            if more.waitForExistence(timeout: 3) {
                more.tap()
                let delete = app.buttons["删除"].firstMatch
                if delete.waitForExistence(timeout: 3) {
                    delete.tap()
                    let confirm = app.buttons["删除"].firstMatch
                    if confirm.waitForExistence(timeout: 3) {
                        confirm.tap()
                    }
                }
            }
        } else {
            tapIfExists("取消")
        }
    }

    // swiftlint:disable:next function_body_length
    func testSettingsGatewayAndFilesJourneys() {
        openTab("设置")
        capture("25-settings")
        app.buttons["语言"].tap()
        capture("28-language")
        tapPickerOption("English")
        XCTAssertTrue(app.buttons["Simplified Chinese"].waitForExistence(timeout: 5))
        tapPickerOption("Simplified Chinese")
        XCTAssertTrue(app.buttons["English"].waitForExistence(timeout: 5))
        navigateBack()
        app.buttons["外观"].tap()
        capture("29-theme")
        navigateBack()
        app.buttons["文件"].tap()
        capture("31-files")
        if openCell(at: 0) {
            capture("32-folder")
            navigateBack()
        }
        app.swipeDown()
        let searchField = app.searchFields.firstMatch
        if searchField.waitForExistence(timeout: 5) {
            searchField.tap()
            searchField.typeText("README")
            searchField.typeText("\n")
            let readme = app.cells.containing(.staticText, identifier: "README.md").firstMatch
            if readme.waitForExistence(timeout: 5) {
                readme.tap()
                capture("33-text-note-detail")
                capture("35-file-preview")
                let edit = app.buttons["编辑"]
                if edit.waitForExistence(timeout: 8) {
                    edit.tap()
                    capture("34-editor")
                    tapIfExists("取消")
                }
            }
        }
        relaunch()
        openTab("设置")
        app.buttons["Gateway 管理"].tap()
        capture("26-gateway-management")
        app.buttons["添加"].tap()
        XCTAssertTrue(app.buttons["gateway-pairing-scan"].waitForExistence(timeout: 5))
        app.buttons["粘贴连接链接"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["gateway-pairing-link"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["访问令牌"].exists)
        app.buttons["取消"].tap()
        let gatewayProfile = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "gateway-profile-")).firstMatch
        if gatewayProfile.waitForExistence(timeout: 5) {
            gatewayProfile.tap()
        }
        let details = app.buttons["详情"].firstMatch
        if details.waitForExistence(timeout: 5) {
            details.tap()
            capture("27-gateway-detail")
        }
    }

    func testFileTransferControlsWithoutWritingUserFiles() {
        openTab("设置")
        app.buttons["文件"].tap()
        openFileSpaceForUpload()
        XCTAssertFalse(app.buttons["刷新"].exists)
        app.buttons["上传"].tap()
        XCTAssertTrue(app.buttons["取消"].waitForExistence(timeout: 8))
        capture("32-file-upload-picker")
        app.buttons["取消"].tap()
        navigateBack()

        app.swipeDown()
        let searchField = app.searchFields.firstMatch
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("README.md\n")
        let readme = app.cells.containing(.staticText, identifier: "README.md").firstMatch
        XCTAssertTrue(readme.waitForExistence(timeout: 8))
        readme.tap()
        XCTAssertTrue(app.buttons["下载"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["刷新"].exists)
        capture("35-file-transfer-controls")
        app.buttons["下载"].tap()
        XCTAssertTrue(app.buttons["关闭"].waitForExistence(timeout: 10))
        capture("35-file-share-sheet")
        app.buttons["关闭"].tap()
    }

    private func openFileSpaceForUpload(_ id: String? = nil) {
        let spaces = app.descendants(matching: .any)
        let row: XCUIElement = if let id {
            spaces["file-space-\(id)"].firstMatch
        } else {
            spaces.matching(NSPredicate(format: "identifier BEGINSWITH %@", "file-space-")).firstMatch
        }
        XCTAssertTrue(row.waitForExistence(timeout: 8))
        row.tap()
        XCTAssertTrue(app.buttons["上传"].waitForExistence(timeout: 8))
    }

    func testFilePickerUploadRoundTrip() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"] else {
            throw XCTSkip("Gateway token is required for upload cleanup")
        }
        let fileName = "xopc-ios-picker-e2e-20261005.txt"
        let spaceID = try await defaultFileSpaceID(token: token)
        let before = try await fileResources(spaceID: spaceID, token: token)
        XCTAssertFalse(before.contains { $0.name == fileName })
        addTeardownBlock {
            try await Self.removeFileNamed(fileName, spaceID: spaceID, token: token)
        }
        openTab("设置")
        app.buttons["文件"].tap()
        openFileSpaceForUpload(spaceID)
        app.buttons["上传"].tap()
        let fixture = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "xopc-ios-picker-e2e-20261005")).firstMatch
        guard fixture.waitForExistence(timeout: 8) else {
            throw XCTSkip("The simulator's local Files provider does not contain the upload fixture")
        }
        capture("32-file-picker-fixture")
        fixture.tap()

        var uploaded: FileIDItem?
        for _ in 0 ..< 10 {
            uploaded = try await fileResources(spaceID: spaceID, token: token).first { $0.name == fileName }
            if uploaded != nil {
                break
            }
            try await Task.sleep(for: .seconds(1))
        }
        XCTAssertNotNil(uploaded)
        if let uploaded {
            let content = try await fileContents(id: uploaded.id, token: token)
            XCTAssertEqual(content, "iOS file picker upload acceptance fixture.\n")
            app.swipeDown()
            let searchField = app.searchFields.firstMatch
            XCTAssertTrue(searchField.waitForExistence(timeout: 5))
            searchField.tap()
            searchField.typeText("\(fileName)\n")
            XCTAssertTrue(app.cells.containing(.staticText, identifier: fileName).firstMatch.waitForExistence(timeout: 8))
            capture("32-file-upload-result")
            try await deleteFile(id: uploaded.id, token: token)
        }
        let after = try await fileResources(spaceID: spaceID, token: token)
        XCTAssertFalse(after.contains { $0.name == fileName })
    }

    func testFilePickerConflictRenamesWithoutOverwriting() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"] else {
            throw XCTSkip("Gateway token is required for upload cleanup")
        }
        let fileName = "xopc-ios-picker-e2e-20261005.txt"
        let renamedName = "xopc-ios-picker-e2e-20261005 (1).txt"
        let spaceID = try await defaultFileSpaceID(token: token)
        let before = try await fileResources(spaceID: spaceID, token: token)
        XCTAssertFalse(before.contains { $0.name == fileName || $0.name == renamedName })
        addTeardownBlock {
            try await Self.removeFileNamed(fileName, spaceID: spaceID, token: token)
            try await Self.removeFileNamed(renamedName, spaceID: spaceID, token: token)
        }

        openTab("设置")
        app.buttons["文件"].tap()
        openFileSpaceForUpload(spaceID)
        app.buttons["上传"].tap()
        let fixture = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "xopc-ios-picker-e2e-20261005")).firstMatch
        guard fixture.waitForExistence(timeout: 8) else {
            throw XCTSkip("The simulator's local Files provider does not contain the upload fixture")
        }
        try await createTestFile(name: fileName, content: "Original file stays unchanged.\n", spaceID: spaceID, token: token)
        fixture.tap()

        let conflict = app.alerts["同名文件已存在"]
        XCTAssertTrue(conflict.waitForExistence(timeout: 10))
        XCTAssertEqual(app.textFields["文件名"].value as? String, renamedName)
        capture("32-file-upload-conflict")
        app.buttons["改名上传"].tap()

        var renamed: FileIDItem?
        for _ in 0 ..< 10 {
            renamed = try await fileResources(spaceID: spaceID, token: token).first { $0.name == renamedName }
            if renamed != nil {
                break
            }
            try await Task.sleep(for: .seconds(1))
        }
        XCTAssertNotNil(renamed)
        let resources = try await fileResources(spaceID: spaceID, token: token)
        let original = try XCTUnwrap(resources.first { $0.name == fileName })
        let originalContent = try await fileContents(id: original.id, token: token)
        XCTAssertEqual(originalContent, "Original file stays unchanged.\n")
        if let renamed {
            let renamedContent = try await fileContents(id: renamed.id, token: token)
            XCTAssertEqual(renamedContent, "iOS file picker upload acceptance fixture.\n")
        }
    }

    func testFilePickerRejectsOversizedFileBeforeUpload() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"] else {
            throw XCTSkip("Gateway token is required to verify upload was rejected")
        }
        let fileName = "xopc-ios-over-limit-e2e-20261005.txt"
        let spaceID = try await defaultFileSpaceID(token: token)
        let before = try await fileResources(spaceID: spaceID, token: token)
        XCTAssertFalse(before.contains { $0.name == fileName })
        addTeardownBlock {
            try await Self.removeFileNamed(fileName, spaceID: spaceID, token: token)
        }

        openTab("设置")
        app.buttons["文件"].tap()
        openFileSpaceForUpload(spaceID)
        app.buttons["上传"].tap()
        let fixture = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "xopc-ios-over-limit-e2e-20261005")).firstMatch
        guard fixture.waitForExistence(timeout: 8) else {
            throw XCTSkip("The simulator's local Files provider does not contain the oversized fixture")
        }
        fixture.tap()
        XCTAssertTrue(app.alerts["上传失败"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["上传文件不能超过 8 MiB"].exists)
        XCTAssertFalse(app.buttons["重试"].exists)
        capture("32-file-upload-too-large")
        app.buttons["取消"].tap()

        let after = try await fileResources(spaceID: spaceID, token: token)
        XCTAssertFalse(after.contains { $0.name == fileName })
    }

    func testFilePickerRetriesTransientUploadFailure() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"],
              let proxyURL = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_PROXY_URL"]
        else {
            throw XCTSkip("Gateway token and isolated fault proxy are required")
        }
        let fileName = "xopc-ios-retry-e2e-20261005.txt"
        let spaceID = try await defaultFileSpaceID(token: token)
        let before = try await fileResources(spaceID: spaceID, token: token)
        XCTAssertFalse(before.contains { $0.name == fileName })
        addTeardownBlock {
            try await Self.removeFileNamed(fileName, spaceID: spaceID, token: token)
        }

        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = proxyURL
        app.launch()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 10))
        openTab("设置")
        app.buttons["文件"].tap()
        openFileSpaceForUpload(spaceID)
        app.buttons["上传"].tap()
        let fixture = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "xopc-ios-retry-e2e-20261005")).firstMatch
        guard fixture.waitForExistence(timeout: 8) else {
            throw XCTSkip("The simulator's local Files provider does not contain the retry fixture")
        }
        fixture.tap()

        XCTAssertTrue(app.alerts["上传失败"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["上传暂时失败，请检查网络后重试。"].exists)
        XCTAssertTrue(app.buttons["重试"].exists)
        capture("32-file-upload-retry")
        app.buttons["重试"].tap()

        var uploaded: FileIDItem?
        for _ in 0 ..< 10 {
            uploaded = try await fileResources(spaceID: spaceID, token: token).first { $0.name == fileName }
            if uploaded != nil {
                break
            }
            try await Task.sleep(for: .seconds(1))
        }
        let uploadedFile = try XCTUnwrap(uploaded)
        let content = try await fileContents(id: uploadedFile.id, token: token)
        XCTAssertEqual(content, "iOS upload retry acceptance fixture.\n")
        try await deleteFile(id: uploadedFile.id, token: token)
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = "http://127.0.0.1:18790"
        app.launch()
    }

    func testNoteEditorRetriesTransientAttachmentUploadFailure() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"],
              let proxyURL = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_PROXY_URL"]
        else {
            throw XCTSkip("Gateway token and a one-shot note attachment fault proxy are required")
        }
        let before = try await noteIDs(token: token)
        let title = "iOS attachment retry \(Int(Date().timeIntervalSince1970))"

        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = proxyURL
        app.launch()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 10))
        openTab("笔记")
        app.buttons["新建笔记"].tap()
        let titleField = app.textFields["标题"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 5))
        titleField.tap()
        titleField.typeText(title)
        app.buttons["添加附件"].tap()
        let fixture = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "xopc-ios-retry-e2e-20261005")).firstMatch
        guard fixture.waitForExistence(timeout: 8) else {
            throw XCTSkip("The simulator's local Files provider does not contain the retry fixture")
        }
        fixture.tap()
        XCTAssertTrue(app.descendants(matching: .any)["note-staged-attachments"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()

        XCTAssertTrue(app.alerts["笔记已保存，附件待上传"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["上传暂时失败，请检查网络后重试。"].exists)
        let created = try await noteIDs(token: token).subtracting(before)
        XCTAssertEqual(created.count, 1)
        createdNoteID = try XCTUnwrap(created.first)
        capture("note-attachment-upload-retry")
        app.buttons["好"].tap()
        XCTAssertTrue(app.staticTexts["附件待上传"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["note-staged-attachments"].exists)

        app.buttons["完成"].tap()
        XCTAssertTrue(app.navigationBars["新建笔记"].waitForNonExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 10))
        let noteID = try XCTUnwrap(createdNoteID)
        let attachmentNames = try await noteAttachmentNames(id: noteID, token: token)
        XCTAssertEqual(attachmentNames, ["xopc-ios-retry-e2e-20261005.txt"])
        capture("note-attachment-upload-recovered")
    }

    private func openTab(_ label: String) {
        let destination = ["助手": "assistant", "对话": "conversations", "进展": "progress", "笔记": "notes",
                           "设置": "profile"][label] ?? label
        app.openHomeDestination(destination)
    }

    private func openNewConversation() {
        openTab("对话")
        let create = app.buttons["新建对话"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        create.tap()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 5))
    }

    private func relaunchInEnglish() {
        app.terminate()
        app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"] {
            app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        }
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "english"
        app.launchEnvironment["XOPC_UI_TEST_SYNTHETIC_AUDIO"] = "1"
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = "http://127.0.0.1:18790"
        app.launch()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 10))
    }

    private func checkAutomationCreation() {
        app.buttons["新建自动化"].tap()
        XCTAssertTrue(app.navigationBars["用对话创建定时任务"].waitForExistence(timeout: 5))
        app.buttons["automation-setup-close"].tap()
    }

    private func checkTaskFilters() {
        XCTAssertTrue(app.buttons["tasks-filter-closed"].exists)
        app.buttons["tasks-filter-closed"].tap()
        app.buttons["tasks-filter-open"].tap()
    }

    private func captureTextNoteJourneys() {
        XCTAssertTrue(app.navigationBars["笔记"].waitForExistence(timeout: 5))
        app.swipeDown()
        let noteSearch = app.searchFields.firstMatch
        guard noteSearch.waitForExistence(timeout: 5) else { return }
        noteSearch.tap()
        noteSearch.typeText("Recurring work spec")
        noteSearch.typeText("\n")
        guard openCell(at: 1) else { return }
        XCTAssertTrue(app.navigationBars["笔记"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["添加附件"].exists)
        capture("33-text-note-detail")
        app.buttons["编辑"].tap()
        XCTAssertTrue(app.navigationBars["编辑笔记"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["粗体"].exists)
        XCTAssertTrue(app.buttons["一级标题"].exists)
        capture("34-editor")
        app.buttons["取消"].tap()
    }

    private func relaunch() {
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 10))
    }

    private func tapIfExists(_ label: String) {
        let button = app.buttons[label]
        if button.waitForExistence(timeout: 3), button.isHittable {
            button.tap()
        }
    }

    private func tapPickerOption(_ label: String) {
        let button = app.buttons[label]
        if button.waitForExistence(timeout: 2), button.isHittable {
            button.tap()
            return
        }
        let text = app.staticTexts[label]
        XCTAssertTrue(text.waitForExistence(timeout: 3), "Missing picker option: \(label)")
        text.tap()
    }

    @discardableResult
    private func openCell(at index: Int) -> Bool {
        let cell = app.cells.element(boundBy: index)
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND hittable == true"),
            object: cell
        )
        guard XCTWaiter.wait(for: [expectation], timeout: 8) == .completed else { return false }
        cell.tap()
        return true
    }

    private func navigateBack() {
        let back = app.buttons["BackButton"]
        if back.waitForExistence(timeout: 3), back.isHittable {
            back.tap()
        }
    }

    private func dismissSheet() {
        if app.buttons["完成"].exists {
            app.buttons["完成"].tap()
        } else if app.buttons["取消"].exists {
            app.buttons["取消"].tap()
        } else {
            app.swipeDown()
        }
    }

    private struct NoteIDPage: Decodable {
        let items: [NoteIDItem]
    }

    private struct NoteIDItem: Decodable { let id: String }

    private struct FileIDPage: Decodable, Sendable { let items: [FileIDItem] }
    private struct FileIDItem: Decodable, Sendable { let id: String; let name: String }
    private struct FileSpaceIDEnvelope: Decodable { let space: FileSpaceID }
    private struct FileSpaceID: Decodable { let id: String }

    private static func removeFileNamed(_ name: String, spaceID: String, token: String) async throws {
        guard let listURL = URL(string: "http://127.0.0.1:18790/api/files/spaces/\(spaceID)/children") else { return }
        var listRequest = URLRequest(url: listURL)
        listRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: listRequest)
        if let created = try JSONDecoder().decode(FileIDPage.self, from: data).items.first(where: { $0.name == name }),
           let deleteURL = URL(string: "http://127.0.0.1:18790/api/files/\(created.id)")
        {
            var deleteRequest = URLRequest(url: deleteURL)
            deleteRequest.httpMethod = "DELETE"
            deleteRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try await URLSession.shared.data(for: deleteRequest)
        }
    }

    private func createTestFile(name: String, content: String, spaceID: String, token: String) async throws {
        let boundary = "xopc-ios-ui-test-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"directory\"\r\n\r\n\r\n".utf8))
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: text/plain\r\n\r\n".utf8))
        body.append(Data(content.utf8))
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = try URLRequest(url: XCTUnwrap(URL(string: "http://127.0.0.1:18790/api/files/spaces/\(spaceID)/upload")))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 201)
    }

    private func defaultFileSpaceID(token: String) async throws -> String {
        var request = try URLRequest(url: XCTUnwrap(URL(string: "http://127.0.0.1:18790/api/files/default-space")))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONDecoder().decode(FileSpaceIDEnvelope.self, from: data).space.id
    }

    private func fileResources(spaceID: String, token: String) async throws -> [FileIDItem] {
        var request = try URLRequest(url: XCTUnwrap(URL(string: "http://127.0.0.1:18790/api/files/spaces/\(spaceID)/children")))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONDecoder().decode(FileIDPage.self, from: data).items
    }

    private func deleteFile(id: String, token: String) async throws {
        var request = try URLRequest(url: XCTUnwrap(URL(string: "http://127.0.0.1:18790/api/files/\(id)")))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }

    private func fileContents(id: String, token: String) async throws -> String {
        var request = try URLRequest(url: XCTUnwrap(URL(string: "http://127.0.0.1:18790/api/files/\(id)/content")))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try XCTUnwrap(String(data: data, encoding: .utf8))
    }

    private func noteIDs(token: String) async throws -> Set<String> {
        var request = try URLRequest(url: XCTUnwrap(URL(string: "http://127.0.0.1:18790/api/notes?limit=100")))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try Set(JSONDecoder().decode(NoteIDPage.self, from: data).items.map(\.id))
    }

    private func deleteNote(id: String, token: String) async throws {
        var request = try URLRequest(url: XCTUnwrap(URL(string: "http://127.0.0.1:18790/api/notes/\(id)")))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertTrue((200 ..< 300).contains((response as? HTTPURLResponse)?.statusCode ?? 0))
    }

    private func noteAttachmentNames(id: String, token: String) async throws -> [String] {
        var request = try URLRequest(url: XCTUnwrap(URL(string: "http://127.0.0.1:18790/api/notes/\(id)")))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let note = try XCTUnwrap(payload["note"] as? [String: Any])
        let attachments = note["attachments"] as? [[String: Any]] ?? []
        return attachments.compactMap { $0["fileName"] as? String }
    }

    private func logAccessibilityIssue(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
        print("Accessibility audit: \(issue.compactDescription) — \(issue.detailedDescription)")
        if let element = issue.element {
            print(element.debugDescription)
        }
        return false
    }

    private func performCoreAccessibilityAudit() throws {
        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)
    }

    private func performContentAccessibilityAudit() throws {
        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)
    }

    private func assertVoiceDetailHitTargets() {
        for label in ["逐字稿", "播放录音", "重试", "重新上传本地录音"] {
            let button = app.buttons[label]
            guard button.exists else { continue }
            XCTAssertGreaterThanOrEqual(button.frame.width, 44, "Voice detail button is too narrow: \(label)")
            XCTAssertGreaterThanOrEqual(button.frame.height, 44, "Voice detail button is too short: \(label)")
        }
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

@MainActor
final class GatewayPairingE2EUITests: XCTestCase {
    // swiftlint:disable:next function_body_length
    func testPairsWithLocalGateway() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("A local Gateway token is required")
        }
        let baseURL = try XCTUnwrap(URL(string: "http://127.0.0.1:18790"))
        let created = try await request(baseURL: baseURL, token: token, path: "/api/device-pairing/setups",
                                        method: "POST", body: ["targetKind": "mobile"])
        let setup = try XCTUnwrap(created["setup"] as? [String: Any])
        let setupID = try XCTUnwrap(setup["id"] as? String)
        let link = try XCTUnwrap(setup["universalLink"] as? String)
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launch()
        XCTAssertTrue(app.navigationBars["连接 Gateway"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["chat-header-sidebar"].exists)
        if app.buttons["粘贴连接链接"].exists {
            app.buttons["粘贴连接链接"].tap()
        }
        let field = app.descendants(matching: .any)["gateway-pairing-link"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        if let existing = field.value as? String, !existing.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
        }
        field.typeText(link)
        app.buttons["连接 Gateway"].tap()

        var pending: [String: Any]?
        for _ in 0 ..< 15 {
            let status = try await request(baseURL: baseURL, token: token,
                                           path: "/api/device-pairing/setups/\(setupID)")
            pending = status["request"] as? [String: Any]
            if pending != nil {
                break
            }
            let keychainError = app.staticTexts.matching(NSPredicate(
                format: "label BEGINSWITH %@", "无法保存设备凭据"
            )).firstMatch
            if keychainError.exists {
                XCTFail(keychainError.label)
                return
            }
            if app.staticTexts["设备凭据已丢失，请重新扫码连接。"].exists {
                XCTFail("The app lost its pairing credentials before submitting the request")
                return
            }
            try await Task.sleep(for: .seconds(1))
        }
        XCTAssertNotNil(pending, "The app did not submit a pairing request to the local Gateway")
        let requestID = try XCTUnwrap(pending?["requestId"] as? String)
        let revision = try XCTUnwrap(pending?["revision"] as? Int)
        _ = try await request(baseURL: baseURL, token: token,
                              path: "/api/device-pairing/requests/\(requestID)/decision",
                              method: "POST", body: ["decision": "approve", "expectedRevision": revision])

        var result: [String: Any]?
        for _ in 0 ..< 25 {
            let status = try await request(baseURL: baseURL, token: token,
                                           path: "/api/device-pairing/setups/\(setupID)")
            result = status["request"] as? [String: Any]
            if result?["status"] as? String == "completed" {
                break
            }
            try await Task.sleep(for: .seconds(1))
        }
        XCTAssertEqual(result?["status"] as? String, "completed")
        let editorDismissed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: app.navigationBars["连接 Gateway"]
        )
        XCTAssertEqual(XCTWaiter.wait(for: [editorDismissed], timeout: 10), .completed)
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 10))
        let testDeviceID = try XCTUnwrap(result?["deviceId"] as? String)
        _ = try await request(baseURL: baseURL, token: token,
                              path: "/api/endpoint-tools/devices/revoke", method: "POST",
                              body: ["ids": [testDeviceID]])
    }

    private func request(baseURL: URL, token: String, path: String, method: String = "GET",
                         body: [String: Any]? = nil) async throws -> [String: Any]
    {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertTrue((200 ..< 300).contains((response as? HTTPURLResponse)?.statusCode ?? 0))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

@MainActor
// swiftlint:disable:next type_body_length
final class MobileLayoutParityUITests: XCTestCase {
    private var app: XCUIApplication!

    private var fixtureBase: String {
        ProcessInfo.processInfo.environment["XOPC_PARITY_FIXTURE_URL"] ?? "http://127.0.0.1:18791"
    }

    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = "synthetic-layout-fixture"
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase
        app.launchEnvironment["XOPC_UI_TEST_RESET_NAVIGATION"] = "1"
        app.launch()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 10))
    }

    func testGlobalTasksSearchAndCreate() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/workspace-parity"
        app.launch()
        tab("progress")
        app.selectPageOption("work-page-tasks", from: "work-page-menu")
        XCTAssertTrue(app.buttons["task-task-header"].waitForExistence(timeout: 8))
        let search = app.textFields["tasks-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("80")
        XCTAssertTrue(app.buttons["task-task-history-80"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["task-task-header"].exists)
        let create = app.buttons["tasks-create"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        create.tap()
        XCTAssertTrue(app.navigationBars["新建任务"].waitForExistence(timeout: 5))
        let title = app.textFields["任务标题"]
        title.tap()
        title.typeText("模拟器新增任务")
        app.navigationBars["新建任务"].buttons["保存"].tap()
        XCTAssertTrue(app.staticTexts["模拟器新增任务"].firstMatch.waitForExistence(timeout: 10))
        capture("task-created-from-workbench")
    }

    func testProjectRemainsUsableWhenNotesFail() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/project-partial"
        app.launch()
        tab("projects")
        let project = app.descendants(matching: .any)["project-fixture-project"].firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 8))
        project.tap()
        XCTAssertTrue(app.navigationBars["项目详情"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["资料测试项目"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["project-add"].isHittable)
        XCTAssertTrue(app.buttons["重试"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.alerts.firstMatch.exists)
        capture("project-partial-retry")
    }

    func testFilesShowsRecentAndSpaceAndReturnsToRoot() {
        tab("profile")
        app.buttons["文件"].tap()
        XCTAssertTrue(app.staticTexts["最近文件"].firstMatch.waitForExistence(timeout: 5))
        let space = app.buttons["测试文件空间"].firstMatch
        XCTAssertTrue(space.waitForExistence(timeout: 5))
        space.tap()
        XCTAssertTrue(app.buttons["上传"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["版本验收.txt"].firstMatch.waitForExistence(timeout: 5))
        app.navigationBars.firstMatch.buttons.firstMatch.tap()
        XCTAssertTrue(space.waitForExistence(timeout: 5))
        capture("files-root-spaces-and-recent")
    }

    func testChatSettingsLinkOpensLanguageAndReturns() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/settings-link"
        app.launch()
        let link = app.links["打开语言设置"].firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 8))
        link.tap()
        let settings = app.navigationBars["语言"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.buttons.firstMatch.tap()
        XCTAssertTrue(link.waitForExistence(timeout: 8))
        capture("settings-link-return")
    }

    func testChatMcpLinkPrefillsConnectionAndWaitsForConfirmation() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/settings-link"
        app.launch()
        let link = app.links["打开连接设置"].firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 8))
        link.tap()
        let address = app.textFields["capability-field-url"]
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        XCTAssertEqual(address.value as? String, "https://example.com/mcp")
        XCTAssertTrue(app.buttons["capability-panel-create"].exists)
        XCTAssertFalse(app.buttons["capability-panel-save"].exists)
        app.buttons["capability-panel-close"].tap()
        XCTAssertTrue(link.waitForExistence(timeout: 5))
    }

    func testInlineSkillKeepsTextBeforeSlash() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = "inline-skill-\(UUID().uuidString)"
        app.launch()
        openChat()
        let composer = app.textFields["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("Please /meet")
        let skill = app.buttons["composer-palette-skill:meeting"]
        XCTAssertTrue(skill.waitForExistence(timeout: 8))
        skill.tap()
        XCTAssertEqual(composer.value as? String, "Please /skill:meeting ")
        capture("inline-skill-in-draft")
    }

    func testNotesSearchUpdatesResultsAndRestoresList() {
        tab("notes")
        let note = app.buttons["note-row-note-1"]
        XCTAssertTrue(note.waitForExistence(timeout: 6))
        app.buttons["notes-open-search"].tap()
        let search = app.textFields["notes-search-field"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("no matching note")
        XCTAssertTrue(app.staticTexts["没有匹配的笔记"].waitForExistence(timeout: 6))
        XCTAssertFalse(note.exists)
        app.buttons["notes-open-search-close"].tap()
        XCTAssertTrue(note.waitForExistence(timeout: 6))
        capture("notes-search-restored")
    }

    func testGlobalNotesOpenRichDetailAndEditor() {
        tab("notes")
        XCTAssertTrue(app.navigationBars["笔记"].waitForExistence(timeout: 5))
        let note = app.buttons["note-row-note-1"]
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        note.tap()
        XCTAssertTrue(app.staticTexts["格式示例"].waitForExistence(timeout: 5))
        app.buttons["编辑"].tap()
        XCTAssertTrue(app.buttons["预览"].waitForExistence(timeout: 5))
        app.buttons["预览"].tap()
        XCTAssertTrue(app.staticTexts["格式示例"].waitForExistence(timeout: 5))
        app.buttons["取消"].tap()
        app.buttons["关闭"].tap()
        XCTAssertTrue(note.waitForExistence(timeout: 5))
    }

    func testNoteOutlineAndDraftSurviveRelaunch() {
        tab("notes")
        let note = app.buttons["note-row-note-1"]
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        note.tap()
        let readingTools = app.buttons["note-reading-tools"]
        XCTAssertTrue(readingTools.waitForExistence(timeout: 5))
        readingTools.tap()
        XCTAssertTrue(app.navigationBars["目录"].waitForExistence(timeout: 5))
        app.buttons["格式示例"].tap()
        XCTAssertTrue(app.navigationBars["目录"].waitForNonExistence(timeout: 5))
        app.buttons["关闭"].tap()

        let draftText = "Recovered offline note"
        app.buttons["notes-create-text"].tap()
        let title = app.textFields["标题"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText(draftText)
        XCTAssertEqual(title.value as? String, draftText)
        app.terminate()
        app.launch()
        tab("notes")
        app.buttons["notes-create-text"].tap()
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertEqual(title.value as? String, draftText)
        app.buttons["取消"].tap()
        app.buttons["放弃并关闭"].tap()
        XCTAssertTrue(title.waitForNonExistence(timeout: 5))
    }

    func testCapabilityNavigationChoiceRestoresAfterAppRelaunch() {
        tab("capabilities")
        app.selectCapability("capability-category-skills")
        XCTAssertTrue(app.buttons["capability-row-meeting-skill"].waitForExistence(timeout: 6))

        app.terminate()
        app.launchEnvironment.removeValue(forKey: "XOPC_UI_TEST_RESET_NAVIGATION")
        app.launch()
        tab("capabilities")
        XCTAssertTrue(app.buttons["capability-row-meeting-skill"].waitForExistence(timeout: 6))
    }

    func testGatewayManagementDismissesToSettings() {
        tab("profile")
        let gateway = app.buttons["Gateway 管理"]
        XCTAssertTrue(gateway.waitForExistence(timeout: 5))
        gateway.tap()
        XCTAssertTrue(app.navigationBars["Gateway 管理"].waitForExistence(timeout: 5))
        app.buttons["添加"].tap()
        XCTAssertTrue(app.buttons["gateway-pairing-scan"].waitForExistence(timeout: 5))
        app.buttons["取消"].tap()
        XCTAssertTrue(app.navigationBars["Gateway 管理"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        XCTAssertTrue(gateway.waitForExistence(timeout: 5))
        XCTAssertTrue(gateway.isHittable)
    }

    func testModelSettingsShowsTaskAndMediaPickersInline() {
        tab("profile")
        let entry = app.buttons["settings-models"]
        XCTAssertTrue(entry.waitForExistence(timeout: 6))
        if !entry.isHittable {
            app.swipeUp()
        }
        entry.tap()

        let taskModel = app.buttons["model-task-coding"]
        XCTAssertTrue(taskModel.waitForExistence(timeout: 6))
        taskModel.tap()
        XCTAssertTrue(app.buttons["model-choice-inherit"].waitForExistence(timeout: 6))
        app.buttons["关闭"].tap()

        let speechModel = app.buttons["model-setting-speech"]
        if !speechModel.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(speechModel.waitForExistence(timeout: 6))
        speechModel.tap()
        XCTAssertTrue(app.buttons["model-choice-fixture/tts"].waitForExistence(timeout: 6))
    }

    func testCloudMusicAndVideoModelsCanBeSelected() {
        tab("profile")
        let entry = app.buttons["settings-models"]
        XCTAssertTrue(entry.waitForExistence(timeout: 6))
        if !entry.isHittable {
            app.swipeUp()
        }
        entry.tap()

        for kind in ["music", "video"] {
            let setting = app.buttons["model-setting-\(kind)"]
            for _ in 0 ..< 3 where !setting.isHittable {
                app.swipeUp()
            }
            XCTAssertTrue(setting.isHittable, "The \(kind) setting should be reachable")
            setting.tap()

            let cloud = app.buttons["model-choice-xopc-cloud/\(kind)"]
            XCTAssertTrue(cloud.waitForExistence(timeout: 6))
            cloud.tap()
            let confirm = app.buttons["model-settings-confirm"]
            XCTAssertTrue(confirm.isEnabled)
            confirm.tap()
            XCTAssertTrue(confirm.waitForNonExistence(timeout: 6))
            let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "XOPC Cloud"), object: setting)
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 6), .completed, "The \(kind) choice should be saved")
        }
    }

    func testAutomationAndLibraryFiltersRestoreIndependently() {
        tab("automations")
        XCTAssertFalse(app.buttons["work-page-menu"].exists)
        XCTAssertTrue(app.buttons["automation-filter-menu"].waitForExistence(timeout: 6))
        app.selectPageOption("automation-filter-paused", from: "automation-filter-menu")

        tab("library")
        app.selectPageOption("library-scope-favorites", from: "space-scope-menu")
        tab("automations")
        let filter = app.buttons["automation-filter-menu"]
        XCTAssertTrue(filter.waitForExistence(timeout: 6))
        filter.tap()
        XCTAssertTrue(app.buttons["automation-filter-paused"].isSelected)
        app.buttons["automation-filter-paused"].tap()

        tab("library")
        let scope = app.buttons["space-scope-menu"]
        XCTAssertTrue(scope.waitForExistence(timeout: 6))
        XCTAssertTrue(scope.label.contains("收藏"))
    }

    func testNextTurnSuggestionFillsDraftWithoutSending() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/next-turn"
        app.launch()

        let suggestion = app.buttons["assistant-next-turn-suggestion"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["assistant-chat-send"].exists)
        XCTAssertTrue(suggestion.label.contains("把刚才的结果拆成三个步骤"))
        suggestion.tap()

        let composer = app.descendants(matching: .any)["assistant-chat-composer"].firstMatch
        XCTAssertEqual(composer.value as? String, "把刚才的结果拆成三个步骤")
        XCTAssertFalse(suggestion.exists)
        XCTAssertTrue(app.buttons["assistant-chat-send"].isHittable)
        XCTAssertFalse(app.keyboards.firstMatch.exists)
    }

    func testComposerPlacesAddOnTheLeftAndVoiceOnTheRight() {
        let composer = app.descendants(matching: .any)["assistant-chat-composer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        let add = app.buttons["添加附件或引用"]
        let voice = app.buttons["语音输入"]
        XCTAssertLessThan(add.frame.midX, composer.frame.minX)
        XCTAssertGreaterThan(voice.frame.midX, composer.frame.maxX)
        add.tap()
        let panel = app.descendants(matching: .any)["assistant-action-panel"].firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        app.buttons["关闭添加面板"].tap()
        voice.tap()
        XCTAssertTrue(app.descendants(matching: .any)["chat-hold-to-speak"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["键盘输入"].tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
    }

    func testLibraryUsesWorkspaceResultsWithVersionsFavoritesAndTrash() async throws {
        var reset = try URLRequest(url: XCTUnwrap(URL(string: fixtureBase + "/fixture/space-reset")))
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)

        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-library"].tap()
        let item = app.buttons["space-item-55555555-5555-4555-8555-555555555555"]
        XCTAssertTrue(item.waitForExistence(timeout: 6))
        XCTAssertFalse(app.staticTexts["最近交付"].exists)
        XCTAssertFalse(app.staticTexts["布局检查笔记"].exists)
        item.tap()
        XCTAssertTrue(app.staticTexts["Library version two"].waitForExistence(timeout: 5))
        app.buttons["preview-actions"].tap()
        app.buttons["preview-version-1"].tap()
        XCTAssertTrue(app.staticTexts["Library version one"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["查看来源"].exists)
        XCTAssertTrue(app.buttons["在对话中使用"].exists)
        app.buttons["preview-actions"].tap()
        app.buttons["preview-favorite"].tap()
        app.buttons["preview-actions"].tap()
        app.buttons["移到回收站"].tap()
        XCTAssertTrue(app.buttons["撤销"].waitForExistence(timeout: 5))
        XCTAssertTrue(item.waitForNonExistence(timeout: 5))
        app.buttons["撤销"].tap()
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        app.selectPageOption("library-scope-favorites", from: "space-scope-menu")
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        app.selectPageOption("library-scope-trash", from: "space-scope-menu")
        XCTAssertTrue(app.staticTexts["回收站为空"].waitForExistence(timeout: 5))
        app.selectPageOption("library-scope-all", from: "space-scope-menu")
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.tap()
        app.buttons["在对话中使用"].tap()
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 5))
        let attachment = app.buttons["assistant-file-preview"]
        XCTAssertTrue(attachment.waitForExistence(timeout: 5))
        XCTAssertEqual(attachment.label, "验收.txt")
    }

    func testChatHeaderControlsStayInPlaceWhileHistoryScrolls() {
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-personal"].tap()
        let avatar = app.buttons["chat-header-personal"]
        XCTAssertTrue(avatar.waitForExistence(timeout: 6))
        let timeline = app.scrollViews.firstMatch
        let olderMessage = app.descendants(matching: .any)["chat-message-user-history-1"].firstMatch
        let avatarFrame = avatar.frame
        let voiceCall = app.buttons["chat-header-voice-call"]
        let voiceFrame = voiceCall.frame
        for _ in 0 ..< 6 where !olderMessage.isHittable {
            timeline.swipeDown(velocity: .slow)
        }
        XCTAssertTrue(olderMessage.isHittable)
        XCTAssertEqual(avatar.frame, avatarFrame)
        XCTAssertEqual(voiceCall.frame, voiceFrame)
        capture("ios-scroll-under-personal-header")
        avatar.tap()
        XCTAssertTrue(app.scrollViews["personal-overview-scroll"].waitForExistence(timeout: 6))
        app.buttons["personal-overview-close"].tap()
        XCTAssertTrue(avatar.waitForExistence(timeout: 6))
    }

    func testTappingChatDismissesKeyboardWithoutDiscardingDraft() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = "keyboard-dismiss-\(UUID().uuidString)"
        app.launch()
        openChat()
        let composer = app.textFields["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        composer.typeText("Keep this draft")

        let conversationArea = app.scrollViews["chat-message-timeline"]
        conversationArea.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.55)).tap()
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5))
        XCTAssertEqual(composer.value as? String, "Keep this draft")
        capture("chat-tap-dismissed-keyboard")
    }

    func testLongTimelineScrollsAndReturnsToLatest() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/long-history"
        app.launch()
        openChat()
        let timeline = app.scrollViews["chat-message-timeline"]
        let latest = app.staticTexts["长对话的最新消息"]
        XCTAssertTrue(latest.waitForExistence(timeout: 10))
        XCTAssertTrue(latest.isHittable)
        let jump = app.buttons["chat-jump-bottom"]
        let dragStart = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.83, dy: 0.32))
        let dragEnd = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.83, dy: 0.76))
        for _ in 0 ..< 4 where !jump.exists {
            dragStart.press(forDuration: 0.05, thenDragTo: dragEnd, withVelocity: .slow, thenHoldForDuration: 0)
        }
        capture("long-timeline-after-drag")
        XCTAssertTrue(jump.isHittable)
        XCTAssertFalse(app.buttons["chat-sidebar-close"].isHittable)
        XCTAssertFalse(latest.isHittable)
        jump.tap()
        XCTAssertTrue(jump.waitForNonExistence(timeout: 6))
        XCTAssertTrue(latest.isHittable)
        capture("long-timeline-latest")
    }

    func testHistoricalAssistantPreviewOpensFullMessageWithoutViewMore() {
        openChat()
        let timeline = app.scrollViews["chat-message-timeline"]
        let preview = app.buttons["chat-message-preview-long-ai"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 8))
        if !preview.isHittable {
            timeline.swipeDown(velocity: .slow)
        }
        XCTAssertTrue(preview.isHittable)
        XCTAssertFalse(app.buttons["查看更多"].exists)
        XCTAssertFalse(app.buttons["View more"].exists)
        capture("historical-assistant-preview")
        preview.tap()
        XCTAssertTrue(app.scrollViews["message-detail-content"].waitForExistence(timeout: 6))
    }

    func testFirstSentMessageAppearsBelowTheHeader() {
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-new"].tap()
        let composer = app.textFields["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 6))
        let text = "Anchor the first question"
        composer.tap()
        composer.typeText(text)
        let send = app.buttons["assistant-chat-send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        send.tap()
        let row = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "chat-message-user-")
        ).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 6))
        let header = app.buttons["chat-header-sidebar"]
        XCTAssertGreaterThanOrEqual(row.frame.minY, header.frame.maxY - 2)
        XCTAssertLessThan(row.frame.minY, app.frame.height * 0.35)
    }

    func testReferencePickerSwipesBetweenNotesAndTasks() {
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-personal"].tap()
        app.buttons["添加附件或引用"].tap()
        app.buttons["引用笔记"].tap()

        let note = app.buttons["reference-item-note-note-1"]
        let task = app.buttons["reference-item-task-task-header"]
        XCTAssertTrue(note.waitForExistence(timeout: 6))
        note.swipeLeft()
        XCTAssertTrue(task.waitForExistence(timeout: 6))
        XCTAssertTrue(app.buttons["reference-tab-task"].isSelected)
        XCTAssertFalse(note.exists)

        task.swipeRight()
        XCTAssertTrue(note.waitForExistence(timeout: 6))
        XCTAssertTrue(app.buttons["reference-tab-note"].isSelected)
        XCTAssertFalse(task.exists)
    }

    func testPersonalOverviewScrollTasksAndScheduleDraft() {
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-personal"].tap()
        app.buttons["chat-header-personal"].tap()
        let scroll = app.scrollViews["personal-overview-scroll"]
        XCTAssertTrue(scroll.waitForExistence(timeout: 5))
        let task = app.buttons["personal-overview-task-task-header"]
        XCTAssertTrue(task.waitForExistence(timeout: 6))
        let initialTop = scroll.frame.minY
        scroll.swipeUp(velocity: .slow)
        XCTAssertLessThan(scroll.frame.minY, initialTop)
        let example = app.buttons.matching(identifier: "schedule-example").firstMatch
        for _ in 0 ..< 4 where !example.isHittable {
            scroll.swipeUp()
        }
        XCTAssertTrue(example.isHittable)
        example.tap()
        let title = app.navigationBars["用对话创建定时任务"]
        XCTAssertTrue(title.waitForExistence(timeout: 8))
        let draft = app.descendants(matching: .any)["assistant-chat-composer"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 5))
        XCTAssertTrue((draft.value as? String)?.contains("提醒我查看待处理事项") == true)
        XCTAssertTrue(app.buttons["assistant-chat-send"].exists)
        XCTAssertFalse(app.textFields["Cron 表达式"].exists)
        app.buttons["automation-setup-close"].tap()
        XCTAssertTrue(scroll.waitForExistence(timeout: 6))
        let library = app.buttons["personal-overview-library-tab"]
        XCTAssertTrue(library.waitForExistence(timeout: 5))
        let tasksTab = app.buttons["personal-overview-tasks-tab"]
        XCTAssertGreaterThan(library.frame.maxX - tasksTab.frame.minX, app.frame.width * 0.8)
        scroll.swipeLeft()
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == true"), object: library
        )], timeout: 5), .completed)
        scroll.swipeRight()
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == true"), object: tasksTab
        )], timeout: 5), .completed)
        library.tap()
        XCTAssertTrue(library.isSelected)
        XCTAssertFalse(tasksTab.isSelected)
        let attachment = app.buttons["chat-attachment-preview-fixture-file"]
        XCTAssertTrue(attachment.waitForExistence(timeout: 6))
        capture("ios-personal-overview-library")
        attachment.tap()
        XCTAssertTrue(app.staticTexts["File version fixture"].waitForExistence(timeout: 6))
        XCTAssertFalse(app.buttons["file-save-version"].exists)
        app.buttons["preview-close"].tap()
        app.buttons["personal-overview-close"].tap()
        XCTAssertTrue(app.buttons["chat-header-personal"].waitForExistence(timeout: 5))
    }

    func testProjectChatBackPreservesTheProjectAndMainConversation() {
        tab("projects")
        let project = app.descendants(matching: .any)["project-fixture-project"].firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        project.tap()
        app.selectPageOption("project-tab-conversations", from: "project-tabs")
        XCTAssertTrue(app.buttons["project-tabs"].exists)
        let create = app.buttons["新建项目对话"]
        XCTAssertTrue(create.waitForExistence(timeout: 6))
        create.tap()
        let chat = app.navigationBars["新建项目对话"]
        XCTAssertTrue(chat.waitForExistence(timeout: 6))
        let draft = app.descendants(matching: .any)["assistant-chat-composer"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 5))
        chat.buttons.firstMatch.tap()
        XCTAssertTrue(app.navigationBars["项目详情"].waitForExistence(timeout: 6))
        XCTAssertTrue(create.exists)
        XCTAssertTrue(app.buttons["对话草稿"].exists)
    }

    func testAgentPickerShowsLocalizedBuiltInNames() {
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-new"].tap()
        let add = app.buttons["添加附件或引用"]
        XCTAssertTrue(add.waitForExistence(timeout: 6))
        XCTAssertLessThan(app.buttons["chat-header-sidebar"].frame.maxX, app.frame.midX)
        XCTAssertFalse(app.buttons["chat-header-agent"].exists)
        XCTAssertTrue(app.buttons["chat-header-voice-call"].exists)
        XCTAssertFalse(app.buttons["chat-header-new"].exists)
        XCTAssertFalse(app.buttons["assistant-options"].exists)
        add.tap()
        let switchAgent = app.buttons["assistant-action-switch-agent"]
        XCTAssertTrue(switchAgent.waitForExistence(timeout: 6))
        switchAgent.tap()
        let coder = app.buttons["agent-picker-coder"]
        XCTAssertTrue(coder.waitForExistence(timeout: 6))
        XCTAssertTrue(coder.label.contains("编程") || coder.label.contains("代码"))
        coder.tap()
        XCTAssertTrue(add.waitForExistence(timeout: 6))
    }

    func testAssistantBubbleFitsShortTextAndKeepsCodeReadable() throws {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/bubble-width"
        app.launch()
        XCTAssertTrue(app.buttons["chat-header-personal"].waitForExistence(timeout: 8))

        let short = app.descendants(matching: .any)["chat-message-assistant-bubble-short"].firstMatch
        let code = app.descendants(matching: .any)["chat-message-assistant-bubble-code"].firstMatch
        XCTAssertTrue(short.waitForExistence(timeout: 8))
        XCTAssertTrue(code.waitForExistence(timeout: 8))
        XCTAssertTrue(short.staticTexts["OK"].exists)
        let image = try XCTUnwrap(app.screenshot().image.cgImage)
        let shortWidth = try assistantBubbleFillWidth(in: short.frame, image: image)
        let codeWidth = try assistantBubbleFillWidth(in: code.frame, image: image)
        XCTAssertGreaterThan(codeWidth, 200)
        XCTAssertLessThanOrEqual(codeWidth, (app.frame.width - 40) * 0.84 + 2)
        XCTAssertLessThan(shortWidth, codeWidth / 2)
        capture("message-bubble-widths")
    }

    private func assistantBubbleFillWidth(in row: CGRect, image: CGImage) throws -> CGFloat {
        // The accessibility element spans the full aligned row. Sample the painted bubble above the text.
        let scale = CGFloat(image.width) / app.frame.width
        let strip = try XCTUnwrap(image.cropping(to: CGRect(x: row.minX * scale, y: (row.minY + 8) * scale,
                                                            width: row.width * scale, height: 1).integral))
        var pixels = [UInt8](repeating: 0, count: strip.width * 4)
        return try pixels.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: strip.width, height: 1,
                                                  bitsPerComponent: 8, bytesPerRow: strip.width * 4,
                                                  space: CGColorSpaceCreateDeviceRGB(),
                                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
            context.draw(strip, in: CGRect(x: 0, y: 0, width: strip.width, height: 1))
            let start = Int(24 * scale)
            let bytes = buffer.bindMemory(to: UInt8.self)
            let end = (start ..< strip.width).first { column in
                (0 ..< 3).contains { channel in abs(Int(bytes[4 * column + channel]) - Int(bytes[4 * start + channel])) > 4 }
            } ?? strip.width
            return CGFloat(end) / scale
        }
    }

    func testMusicCardAppearsAndUpdatesWithoutReopeningTheConversation() async throws {
        let base = fixtureBase + "/music-live"
        let stateURL = try XCTUnwrap(URL(string: base + "/fixture/music-state"))
        func setMusicState(_ state: String) async throws {
            var request = URLRequest(url: stateURL)
            request.httpMethod = "POST"
            request.httpBody = try JSONEncoder().encode(["state": state])
            let (_, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        }
        try await setMusicState("")
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = base
        app.launch()
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-personal"].tap()
        XCTAssertTrue(app.buttons["chat-header-personal"].waitForExistence(timeout: 5))
        let title = app.staticTexts["模拟器背景音乐"]
        XCTAssertFalse(title.exists)

        try await setMusicState("running")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertTrue(title.isHittable)
        XCTAssertFalse(app.buttons["generated-music-open-fixture-older-song"].exists)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "生成中")).firstMatch.exists)

        try await setMusicState("completed")
        let player = app.buttons["generated-music-open-fixture-song"]
        XCTAssertTrue(player.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["generated-music-open-fixture-older-song"].exists)
        XCTAssertLessThan(player.frame.minX - app.frame.minX, 38)
        XCTAssertTrue(app.buttons["chat-header-personal"].exists)
    }

    // swiftlint:disable:next function_body_length
    func testGeneratedMusicContinuesAcrossConversationAndBackground() async throws {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/music"
        app.launch()
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-personal"].tap()
        let musicCard = app.buttons["generated-music-open-fixture-song"]
        XCTAssertTrue(musicCard.waitForExistence(timeout: 10))
        XCTAssertLessThan(musicCard.frame.minX - app.frame.minX, 38)
        musicCard.tap()
        XCTAssertTrue(app.staticTexts["music-elapsed"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.buttons["music-play-toggle"].waitForExistence(timeout: 6))
        let progress = app.sliders["music-progress"]
        XCTAssertFalse(progress.isEnabled)
        app.buttons["music-play-toggle"].tap()
        let seekReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: progress)
        await fulfillment(of: [seekReady], timeout: 6)
        progress.adjust(toNormalizedSliderPosition: 0)
        app.buttons["music-player-close"].tap()
        XCTAssertTrue(musicCard.waitForExistence(timeout: 6))
        app.swipeDown()
        let sticky = app.descendants(matching: .any)["music-sticky-player"].firstMatch
        XCTAssertTrue(sticky.waitForExistence(timeout: 6))
        XCTAssertTrue(app.openHomeSidebar())
        let recent = app.buttons["chat-sidebar-session-11111111-1111-4111-8111-111111111111"]
        XCTAssertTrue(recent.waitForExistence(timeout: 5))
        recent.tap()
        let open = app.buttons["music-open-player"]
        XCTAssertTrue(open.waitForExistence(timeout: 6))
        open.tap()
        let elapsed = app.staticTexts["music-elapsed"]
        XCTAssertTrue(elapsed.waitForExistence(timeout: 6))
        let before = elapsed.label
        XCUIDevice.shared.press(.home)
        try await Task.sleep(for: .seconds(3))
        app.activate()
        XCTAssertTrue(elapsed.waitForExistence(timeout: 5))
        XCTAssertNotEqual(elapsed.label, before)
        XCTAssertEqual(app.buttons["music-play-toggle"].label, "暂停")
        app.buttons["music-play-toggle"].tap()
        XCTAssertEqual(app.buttons["music-play-toggle"].label, "播放")
        progress.adjust(toNormalizedSliderPosition: 0)
        XCTAssertEqual(elapsed.label, "0:00")
        app.buttons["music-skip-forward"].tap()
        XCTAssertEqual(elapsed.label, "0:15")
        app.buttons["music-skip-back"].tap()
        XCTAssertEqual(elapsed.label, "0:00")
        let lyrics = app.staticTexts["music-lyrics-text"]
        XCTAssertFalse(lyrics.exists)
        app.buttons["music-lyrics"].tap()
        XCTAssertTrue(lyrics.waitForExistence(timeout: 5))
        let controlY = app.buttons["music-play-toggle"].frame.midY
        app.buttons["music-lyrics"].tap()
        XCTAssertFalse(lyrics.exists)
        XCTAssertEqual(app.buttons["music-play-toggle"].frame.midY, controlY, accuracy: 1)
        app.buttons["music-lyrics"].tap()
        XCTAssertTrue(lyrics.waitForExistence(timeout: 5))
        capture("ios-global-music-player")
        app.buttons["preview-actions"].tap()
        app.buttons["music-return-source"].tap()
        XCTAssertTrue(app.buttons["chat-header-personal"].waitForExistence(timeout: 6))
        XCTAssertTrue(musicCard.waitForExistence(timeout: 6))
    }

    func testMusicUsesTheSameLyricsAndPlaybackPositionInChatAndLibrary() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/music"
        app.launch()
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-personal"].tap()
        let card = app.buttons["generated-music-open-fixture-song"]
        XCTAssertTrue(card.waitForExistence(timeout: 8))
        card.tap()
        let play = app.buttons["music-play-toggle"]
        XCTAssertTrue(play.waitForExistence(timeout: 5))
        app.buttons["music-lyrics"].tap()
        let lyrics = app.staticTexts["music-lyrics-text"]
        XCTAssertTrue(lyrics.waitForExistence(timeout: 3))
        let originalLyrics = lyrics.label
        play.tap()
        let progress = app.sliders["music-progress"]
        let seekReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: progress)
        XCTAssertEqual(XCTWaiter.wait(for: [seekReady], timeout: 5), .completed)
        play.tap()
        app.buttons["music-skip-forward"].tap()
        let elapsed = app.staticTexts["music-elapsed"].label
        XCTAssertNotEqual(elapsed, "0:00")
        app.buttons["music-player-close"].tap()

        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-library"].tap()
        let libraryMusic = app.buttons["space-item-88888888-8888-4888-8888-888888888888"]
        XCTAssertTrue(libraryMusic.waitForExistence(timeout: 5))
        libraryMusic.tap()
        XCTAssertTrue(play.waitForExistence(timeout: 5))
        XCTAssertTrue(progress.isEnabled)
        XCTAssertEqual(app.staticTexts["music-elapsed"].label, elapsed)
        XCTAssertFalse(lyrics.exists)
        app.buttons["music-lyrics"].tap()
        XCTAssertTrue(lyrics.waitForExistence(timeout: 3))
        XCTAssertEqual(lyrics.label, originalLyrics)
        capture("ios-library-music-preview")
    }

    func testSidebarSwipeAndSecondaryDestinations() {
        let sidebar = app.buttons["chat-header-sidebar"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 10))
        _ = app.openHomeSidebar()
        let personal = app.buttons["chat-sidebar-personal"]
        XCTAssertTrue(personal.waitForExistence(timeout: 5))
        personal.tap()
        let header = app.buttons["chat-header-personal"]
        XCTAssertTrue(header.waitForExistence(timeout: 5))
        XCTAssertEqual(header.frame.midX, app.frame.midX, accuracy: 3)
        capture("ios-personal-chat")
        let inside = app.coordinate(withNormalizedOffset: CGVector(dx: 0.28, dy: 0.55))
        let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.025, dy: 0.55))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.55))
        edge.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertFalse(app.buttons["chat-sidebar-close"].isHittable)
        inside.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(app.buttons["chat-sidebar-profile"].waitForExistence(timeout: 5))
        let create = app.buttons["chat-sidebar-new"]
        XCTAssertTrue(create.exists)
        XCTAssertLessThan(create.frame.minX, 30)
        capture("ios-chat-sidebar")
        for name in ["progress", "projects", "automations", "notes", "profile"] {
            tab(name)
            XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 5))
            XCTAssertFalse(app.textFields["assistant-chat-composer"].isHittable)
        }
    }

    func testSidebarSessionLongPressAndBatchDelete() async throws {
        app.terminate()
        let base = fixtureBase + "/sidebar-actions"
        var reset = try URLRequest(url: XCTUnwrap(URL(string: base + "/fixture/reset")))
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = base
        app.launch()
        XCTAssertTrue(app.openHomeSidebar())
        let first = app.buttons["chat-sidebar-session-11111111-2026-4000-9000-000000000001"]
        let second = app.buttons["chat-sidebar-session-11111111-2026-4000-9000-000000000002"]
        XCTAssertTrue(second.waitForExistence(timeout: 6))
        second.press(forDuration: 0.8)
        let rename = app.buttons["重命名"]
        XCTAssertTrue(rename.waitForExistence(timeout: 5))
        capture("ios-sidebar-session-menu")
        rename.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        let field = alert.textFields.firstMatch
        XCTAssertEqual(field.value as? String, "Sidebar 2")
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 9) + "Renamed")
        alert.buttons["保存"].tap()
        let renamed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Renamed"), object: second)
        await fulfillment(of: [renamed], timeout: 6)
        second.press(forDuration: 0.8)
        app.buttons["置顶"].tap()
        let pinnedFirst = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            second.isHittable && second.frame.minY < first.frame.minY
        }, object: second)
        await fulfillment(of: [pinnedFirst], timeout: 6)
        second.press(forDuration: 0.8)
        app.buttons["多选"].tap()
        XCTAssertTrue(app.staticTexts["已选 1 项"].exists)
        first.tap()
        let batchDelete = app.buttons["chat-sidebar-batch-delete"]
        batchDelete.tap()
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.buttons["取消"].tap()
        XCTAssertTrue(first.exists && second.exists)
        batchDelete.tap()
        alert.buttons["删除"].tap()
        XCTAssertTrue(first.waitForNonExistence(timeout: 6))
        XCTAssertFalse(second.exists)
    }

    func testSidebarSearchSwipesAcrossHistoryModes() {
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-search"].tap()
        let search = app.textFields["conversations-search-field"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        let title = app.buttons["sessions-mode-menu"]
        XCTAssertTrue(title.label.contains("最近"))
        let pager = app.descendants(matching: .any)["sessions-mode-pager"].firstMatch
        XCTAssertTrue(pager.waitForExistence(timeout: 5))
        pager.swipeLeft()
        XCTAssertTrue(title.label.contains("项目"))
        XCTAssertTrue(search.exists)
        pager.swipeLeft()
        XCTAssertTrue(title.label.contains("专家"))
        XCTAssertTrue(search.exists)
        pager.swipeRight()
        XCTAssertTrue(title.label.contains("项目"))
        XCTAssertTrue(search.exists)
    }

    func testSidebarScrollsShortcutsAndAutomaticallyAppendsOlderConversations() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/sidebar-pagination"
        app.launch()
        XCTAssertTrue(app.openHomeSidebar())

        let list = app.scrollViews["chat-sidebar-list"]
        let search = app.buttons["chat-sidebar-search"]
        let personal = app.buttons["chat-sidebar-personal"]
        let first = app.buttons["chat-sidebar-session-11111111-2026-4000-8000-000000000001"]
        let older = app.buttons["chat-sidebar-session-11111111-2026-4000-8000-000000000024"]
        XCTAssertTrue(first.waitForExistence(timeout: 8))
        XCTAssertTrue(search.isHittable)
        XCTAssertEqual(personal.label, "Ada")
        XCTAssertFalse(older.isHittable)
        for _ in 0 ..< 8 where !older.isHittable {
            list.swipeUp()
        }
        XCTAssertTrue(older.isHittable)
        XCTAssertFalse(search.isHittable)
        XCTAssertFalse(personal.isHittable)
        XCTAssertTrue(app.buttons["chat-sidebar-new"].isHittable)

        app.buttons["chat-sidebar-close"].tap()
        XCTAssertTrue(app.openHomeSidebar())
        XCTAssertTrue(older.isHittable)

        for _ in 0 ..< 8 where !search.isHittable || !personal.isHittable {
            list.swipeDown()
        }
        XCTAssertTrue(search.isHittable)
        XCTAssertTrue(personal.isHittable)
        search.tap()
        XCTAssertTrue(app.textFields["conversations-search-field"].waitForExistence(timeout: 5))
    }

    func testSidebarAndCapabilitySwipesDoNotOpenRows() {
        XCTAssertTrue(app.openHomeSidebar())
        let progress = app.buttons["chat-sidebar-workbench"]
        XCTAssertTrue(progress.waitForExistence(timeout: 5))
        progress.swipeLeft()
        XCTAssertTrue(progress.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["chat-header-sidebar"].isHittable)

        tab("capabilities")
        let menu = app.buttons["capability-page-menu"]
        XCTAssertTrue(menu.label.contains("插件"))
        let plugin = app.buttons["capability-row-meeting-plugin"]
        XCTAssertTrue(plugin.waitForExistence(timeout: 5))
        plugin.swipeLeft()
        let skill = app.buttons["capability-row-meeting-skill"]
        XCTAssertTrue(skill.waitForExistence(timeout: 5))
        XCTAssertTrue(menu.label.contains("技能"))
        XCTAssertFalse(app.buttons["capability-panel-close"].exists)
        skill.swipeRight()
        XCTAssertTrue(plugin.waitForExistence(timeout: 5))
        app.selectCapability("capability-category-skills")
        XCTAssertTrue(skill.waitForExistence(timeout: 5))
        XCTAssertTrue(menu.label.contains("技能"))
        menu.tap()
        XCTAssertTrue(app.buttons["capability-category-devices"].waitForExistence(timeout: 5))
        capture("capability-header-menu")
        app.buttons["capability-category-plugins"].tap()
        XCTAssertTrue(plugin.waitForExistence(timeout: 5))
        plugin.tap()
        XCTAssertTrue(app.buttons["capability-panel-close"].waitForExistence(timeout: 5))
    }

    func testCapabilityPagerKeepsSearchDuringSlowLoadAndAllowsEdgeBack() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/slow-capabilities"
        app.launch()
        tab("capabilities")
        let plugin = app.buttons["capability-row-meeting-plugin"]
        XCTAssertTrue(plugin.waitForExistence(timeout: 5))
        let search = app.textFields["capability-search"]
        search.tap()
        search.typeText("Meeting")
        let shortStart = plugin.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5))
        shortStart.press(forDuration: 0.25, thenDragTo: shortStart.withOffset(CGVector(dx: -25, dy: 0)),
                         withVelocity: .slow, thenHoldForDuration: 0.2)
        XCTAssertTrue(plugin.isHittable, "A short drag should return to the plugin category")
        app.scrollViews["capability-catalog-plugins"].swipeUp()
        XCTAssertFalse(plugin.isHittable, "The long filtered list should scroll past its first row")
        app.selectCapability("capability-category-channels")
        XCTAssertTrue(app.descendants(matching: .any)["capability-loading"].firstMatch.waitForExistence(timeout: 3))
        app.selectCapability("capability-category-plugins")
        XCTAssertEqual(search.value as? String, "Meeting")
        XCTAssertFalse(plugin.isHittable, "Returning to plugins should restore its scroll position")
        XCTAssertFalse(app.buttons["capability-row-document-plugin"].exists)
        app.selectCapability("capability-category-skills")
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.45)).withOffset(CGVector(dx: 2, dy: 0))
        let finish = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.45))
        start.press(forDuration: 0.04, thenDragTo: finish)
        XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 5),
                      "The system edge gesture should leave the capabilities page")
    }

    func testCapabilitySetupPrefersAuthorizationAndSavesScanOnlyQr() {
        tab("capabilities")
        app.selectCapability("capability-category-channels")
        let direct = app.buttons["capability-row-mail-channel"]
        XCTAssertTrue(direct.waitForExistence(timeout: 8))
        direct.tap()
        let pair = app.buttons["capability-panel-pair"]
        XCTAssertTrue(pair.waitForExistence(timeout: 5))
        pair.tap()
        XCTAssertTrue(app.buttons["capability-panel-open-authorization"].waitForExistence(timeout: 5))
        let close = app.buttons["capability-panel-close"]
        let compactTop = close.frame.minY
        capture("capability-drawer-authorization")
        let qrImage = app.images["capability-panel-qr"]
        XCTAssertFalse(qrImage.exists)
        let otherMethods = app.buttons["capability-panel-other-methods"]
        otherMethods.tap()
        XCTAssertTrue(qrImage.exists)
        let expanded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in close.frame.minY < compactTop - 80 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 5), .completed)
        capture("capability-drawer-authorization-expanded")
        otherMethods.tap()
        let collapsed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in close.frame.minY >= compactTop - 8 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [collapsed], timeout: 5), .completed)
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))

        app.buttons["capability-row-scan-channel"].tap()
        XCTAssertTrue(pair.waitForExistence(timeout: 5))
        pair.tap()
        let save = app.buttons["capability-panel-save-qr"]
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["capability-panel-open-authorization"].exists)
        capture("capability-drawer-qr")
        save.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.alerts.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "允许"])).firstMatch
        if allow.waitForExistence(timeout: 3) {
            allow.tap()
        }
        XCTAssertTrue(app.staticTexts["已保存到相册。"].waitForExistence(timeout: 8))
    }

    func testCapabilityLongFormExpandsAndKeepsSaveVisible() {
        tab("capabilities")
        app.selectCapability("capability-category-channels")
        let form = app.buttons["capability-row-form-channel"]
        XCTAssertTrue(form.waitForExistence(timeout: 5))
        form.tap()
        let save = app.buttons["capability-panel-save"]
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        let close = app.buttons["capability-panel-close"]
        let expanded = XCTNSPredicateExpectation(predicate: NSPredicate { [app] _, _ in
            guard let app else { return false }
            return close.frame.minY < app.frame.height * 0.34
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 5), .completed)
        let lastField = app.textFields["capability-field-option-10"]
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0))
        let scrollStart = top.withOffset(CGVector(dx: 0, dy: save.frame.minY - app.frame.minY - 30))
        let scrollEnd = top.withOffset(CGVector(dx: 0, dy: close.frame.maxY - app.frame.minY + 30))
        for _ in 0 ..< 4 where !lastField.isHittable {
            scrollStart.press(forDuration: 0.05, thenDragTo: scrollEnd)
        }
        XCTAssertTrue(lastField.isHittable)
        XCTAssertTrue(save.isHittable)
        capture("capability-drawer-long-form")
    }

    func testDeviceConnectionsAuthorizeAndRevokeReportedCapability() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/device-capability-access"
        app.launch()
        tab("capabilities")
        app.selectCapability("capability-category-devices")
        let toggle = app.switches["device-grant-mobile.file.pick"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 6))
        XCTAssertEqual(toggle.value as? String, "0")
        toggle.tap()
        XCTAssertTrue(app.staticTexts["已授权"].waitForExistence(timeout: 6))
        XCTAssertEqual(toggle.value as? String, "1")
        capture("device-capability-authorization")
        toggle.tap()
        XCTAssertTrue(app.staticTexts["未授权"].waitForExistence(timeout: 6))
        XCTAssertEqual(toggle.value as? String, "0")
    }

    func testDeviceConnectionsShowFolderPermissionsAndOpenTheSelectedComputerChat() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/device-connections"
        app.launch()
        tab("capabilities")
        app.selectCapability("capability-category-connections")
        let connection = app.buttons["capability-row-drive-connection"]
        XCTAssertTrue(connection.waitForExistence(timeout: 6))
        let connectionFrame = connection.frame
        app.selectCapability("capability-category-devices")

        let files = app.buttons["device-tool-mobile.file.pick"]
        XCTAssertTrue(files.waitForExistence(timeout: 6))
        XCTAssertEqual(files.frame.minX, connectionFrame.minX, accuracy: 1)
        XCTAssertEqual(files.frame.width, connectionFrame.width, accuracy: 1)
        XCTAssertEqual(files.frame.height, connectionFrame.height, accuracy: 1)
        capture("device-connection-cards")
        let offline = app.buttons["connected-device-test-offline-pc"]
        if !offline.isHittable {
            app.swipeUp()
        }
        offline.tap()
        XCTAssertTrue(app.staticTexts["在这台电脑上打开 xopc 并检查网络连接。"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["device-use-in-chat"].exists)
        app.buttons["返回设备连接"].tap()
        let computer = app.buttons["connected-device-test-mac"]
        if !computer.isHittable {
            app.swipeUp()
        }
        computer.tap()
        XCTAssertTrue(app.staticTexts["下载"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["已授权 · 只读"].exists)
        let use = app.buttons["device-use-in-chat"]
        if !use.isHittable {
            app.swipeUp()
        }
        use.tap()
        let target = app.descendants(matching: .any).matching(identifier: "chat-execution-device").firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 8))
        XCTAssertTrue(target.label.contains("工作 MacBook"))
        capture("device-connection-chat")
    }

    // swiftlint:disable:next function_body_length
    func testCapabilityCatalogDefaultsToPluginsAndSearchStaysInItsCategory() {
        tab("capabilities")
        let header = app.navigationBars.firstMatch
        let plugin = app.buttons["capability-row-meeting-plugin"]
        let close = app.buttons["capability-panel-close"]
        XCTAssertTrue(plugin.waitForExistence(timeout: 5))
        XCTAssertTrue(header.exists)
        XCTAssertEqual(app.buttons.matching(identifier: "capability-refresh").count, 0)
        XCTAssertGreaterThan(app.buttons["capability-add-plugins"].frame.midX, app.frame.midX)
        capture("capability-plugins")
        plugin.tap()
        XCTAssertTrue(app.buttons["capability-panel-start"].waitForExistence(timeout: 5))
        close.tap()
        let search = app.textFields["capability-search"]
        search.tap()
        search.typeText("Meeting")
        XCTAssertTrue(plugin.exists)
        XCTAssertFalse(app.buttons["capability-row-meeting-skill"].exists)
        XCTAssertFalse(app.buttons["capability-row-document-plugin"].exists)
        for (category, id) in [
            ("skills", "meeting-skill"), ("connections", "drive-connection"), ("agents", "coder"), ("channels", "mail-channel")
        ] {
            app.selectCapability("capability-category-\(category)")
            XCTAssertTrue(header.exists)
            let row = app.buttons["capability-row-\(id)"]
            XCTAssertTrue(row.waitForExistence(timeout: 5))
            XCTAssertFalse(plugin.exists)
            XCTAssertNotEqual(search.value as? String, "Meeting")
            let add = app.buttons["capability-add-\(category)"]
            if category == "skills" {
                XCTAssertTrue(add.exists)
                XCTAssertGreaterThan(add.frame.midX, header.frame.midX)
                add.tap()
                XCTAssertTrue(app.textFields["capability-field-query"].waitForExistence(timeout: 5))
                close.tap()
            }
            XCTAssertEqual(app.buttons["capability-chat-setup-\(category)"].exists, category == "skills" || category == "agents")
            XCTAssertEqual(app.buttons["capability-add-mcp"].exists, category == "connections")
            if category == "connections" {
                let deadline = Date().addingTimeInterval(5)
                var brandRendered = hasRedCapabilityLogo(in: row.frame)
                while !brandRendered, Date() < deadline {
                    Thread.sleep(forTimeInterval: 0.2)
                    brandRendered = hasRedCapabilityLogo(in: row.frame)
                }
                XCTAssertTrue(brandRendered, "The gateway-provided Gmail SVG should render rather than its initials.")
            }
            capture("capability-\(category)")
            if category == "agents" {
                app.buttons["capability-settings-\(id)"].tap()
            } else {
                row.tap()
            }
            XCTAssertTrue(close.waitForExistence(timeout: 5))
            if category == "connections" {
                XCTAssertTrue(app.buttons["capability-use-in-chat"].waitForExistence(timeout: 5))
            }
            if category == "agents" {
                XCTAssertTrue(app.buttons["capability-panel-save"].waitForExistence(timeout: 5))
            }
            if category == "channels" {
                XCTAssertTrue(app.buttons["capability-panel-pair"].waitForExistence(timeout: 5))
            }
            XCTAssertFalse(app.buttons["capability-open-chat"].exists)
            close.tap()
        }
        app.selectCapability("capability-category-skills")
        app.buttons["capability-row-meeting-skill"].tap()
        let skill = app.switches["启用技能"]
        XCTAssertTrue(skill.waitForExistence(timeout: 5))
        let initial = skill.value as? String
        skill.tap()
        app.buttons["capability-panel-save"].tap()
        close.tap()
        app.buttons["capability-row-meeting-skill"].tap()
        XCTAssertTrue(skill.waitForExistence(timeout: 5))
        XCTAssertNotEqual(skill.value as? String, initial)
        close.tap()
        XCTAssertFalse(app.buttons["capability-discover"].exists)
    }

    func testCapabilityAgentRowAndSettingsHaveSeparateActions() {
        tab("capabilities")
        app.selectCapability("capability-category-agents")
        let expert = app.buttons["capability-row-coder"]
        let settings = app.buttons["capability-settings-coder"]
        XCTAssertTrue(expert.waitForExistence(timeout: 5))
        XCTAssertTrue(settings.isHittable)
        XCTAssertLessThan(expert.frame.midX, settings.frame.midX)
        capture("capability-agent-actions")
        settings.tap()
        XCTAssertTrue(app.buttons["capability-panel-save"].waitForExistence(timeout: 5))
        app.buttons["capability-panel-close"].tap()
        expert.tap()
        XCTAssertTrue(app.descendants(matching: .any)["assistant-chat-composer"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["capability-panel-close"].exists)
    }

    func testCapabilityCreationOpensAnUnsentConversationDraft() {
        for (category, expected) in [("agents", "创建一个助手或专家"), ("skills", "创建一个技能")] {
            tab("capabilities")
            app.selectCapability("capability-category-\(category)")
            app.buttons["capability-chat-setup-\(category)"].tap()
            let composer = app.descendants(matching: .any)["assistant-chat-composer"].firstMatch
            XCTAssertTrue(composer.waitForExistence(timeout: 5))
            XCTAssertTrue((composer.value as? String)?.contains(expected) == true)
        }
    }

    func testCustomMcpConnectionOpensFormAndShowsSuccess() {
        tab("capabilities")
        app.selectCapability("capability-category-connections")
        app.buttons["capability-add-mcp"].tap()
        let address = app.textFields["capability-field-url"]
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        address.tap()
        address.typeText("https://example.com/mcp")
        app.buttons["capability-panel-create"].tap()
        let addConnection = app.buttons["capability-panel-save"]
        XCTAssertTrue(addConnection.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["连接已添加"].exists)
        capture("custom-mcp-confirm-link")
        addConnection.tap()
        XCTAssertTrue(app.staticTexts["连接已添加"].waitForExistence(timeout: 5))
        app.buttons["capability-panel-done"].tap()
        XCTAssertFalse(app.buttons["capability-panel-close"].exists)
    }

    func testCustomMcpJsonPreviewsAndRetainsConfigurationOnBack() {
        tab("capabilities")
        app.selectCapability("capability-category-connections")
        app.buttons["capability-add-mcp"].tap()
        let pasteTab = app.buttons["粘贴 JSON"]
        XCTAssertTrue(pasteTab.waitForExistence(timeout: 5))
        pasteTab.tap()
        let preview = app.buttons["capability-panel-preview"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["capability-panel-create"].exists)
        let json = app.textViews["capability-field-mcp-json"]
        XCTAssertTrue(json.waitForExistence(timeout: 5))
        capture("custom-mcp-json-entry")
        json.tap()
        json.typeText("{\"url\":\"https://example.com/mcp\"}")
        preview.tap()
        let check = app.buttons["capability-panel-select"]
        XCTAssertTrue(check.waitForExistence(timeout: 5))
        capture("custom-mcp-json-preview")
        app.buttons["capability-panel-edit"].tap()
        XCTAssertTrue(json.waitForExistence(timeout: 5))
        XCTAssertTrue((json.value as? String)?.contains("https://example.com/mcp") == true)
        preview.tap()
        XCTAssertTrue(check.waitForExistence(timeout: 5))
        check.tap()
        let addConnection = app.buttons["capability-panel-save"]
        XCTAssertTrue(addConnection.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["连接已添加"].exists)
        addConnection.tap()
        XCTAssertTrue(app.staticTexts["连接已添加"].waitForExistence(timeout: 5))
    }

    func testCustomMcpCommandReviewsBeforeCheckAndAdd() {
        tab("capabilities")
        app.selectCapability("capability-category-connections")
        app.buttons["capability-add-mcp"].tap()
        let commandMode = app.buttons["命令启动"]
        XCTAssertTrue(commandMode.waitForExistence(timeout: 5))
        commandMode.tap()
        let command = app.textFields["capability-field-command"]
        XCTAssertTrue(command.waitForExistence(timeout: 5))
        command.tap()
        command.typeText("node")
        app.buttons["capability-panel-review-command"].tap()
        XCTAssertTrue(app.staticTexts["capability-panel-review-text"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["capability-panel-save"].exists)
        capture("custom-mcp-command-review")
        app.buttons["capability-panel-confirm-check"].tap()
        let add = app.buttons["capability-panel-save"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["连接已添加"].exists)
        add.tap()
        XCTAssertTrue(app.staticTexts["连接已添加"].waitForExistence(timeout: 5))
    }

    private func hasRedCapabilityLogo(in row: CGRect) -> Bool {
        guard let screen = app.screenshot().image.cgImage else { return false }
        let scale = CGFloat(screen.width) / app.frame.width
        let area = CGRect(x: row.minX + 20, y: row.midY - 16, width: 32, height: 32)
        guard let logo = screen.cropping(to: area.applying(.init(scaleX: scale, y: scale)).integral) else { return false }
        let side = 24
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        return pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: side, height: side,
                                          bitsPerComponent: 8, bytesPerRow: side * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            context.draw(logo, in: CGRect(x: 0, y: 0, width: side, height: side))
            let bytes = buffer.bindMemory(to: UInt8.self)
            return stride(from: 0, to: bytes.count, by: 4).filter { index in
                bytes[index] > 180 && bytes[index + 1] < 140 && bytes[index + 2] < 140
            }.count >= 10
        }
    }

    func testCapabilityMarketplaceAndPluginShowOnlyTheNextStep() {
        tab("capabilities")
        let plugin = app.buttons["capability-row-meeting-plugin"]
        XCTAssertTrue(plugin.waitForExistence(timeout: 5))
        plugin.tap()
        let enable = app.buttons["capability-panel-start"]
        XCTAssertTrue(enable.waitForExistence(timeout: 5))
        enable.tap()
        XCTAssertFalse(app.buttons["capability-use-in-chat"].exists)
        XCTAssertTrue(app.staticTexts["已启用"].waitForExistence(timeout: 9))
        XCTAssertTrue(app.buttons["capability-use-in-chat"].exists)
        capture("capability-plugin-ready")
        let disable = app.buttons["capability-panel-disable"]
        XCTAssertFalse(disable.exists)
        app.buttons["更多选项"].tap()
        XCTAssertTrue(disable.exists)
        app.buttons["capability-panel-close"].tap()

        app.selectCapability("capability-category-skills")
        app.buttons["capability-add-skills"].tap()
        let query = app.textFields["例如：会议纪要、PDF"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap()
        query.typeText("Meeting")
        app.buttons["capability-panel-search"].tap()
        XCTAssertTrue(app.staticTexts["Meeting Summary"].waitForExistence(timeout: 5))
        app.buttons["capability-panel-install:sample"].tap()
        app.alerts.buttons["确认"].tap()
        XCTAssertTrue(app.staticTexts["技能已安装"].waitForExistence(timeout: 5))
        capture("capability-skill-installed")
        app.buttons["capability-use-in-chat"].tap()
        let composer = app.descendants(matching: .any)["assistant-chat-composer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        XCTAssertEqual((composer.value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), "/skill:meeting-summary")
    }

    func testSecondarySearchOpensFromHeaderAndSidebarShortcut() {
        for (destination, buttonID, fieldID) in [
            ("conversations", "conversations-open-search", "conversations-search-field"),
            ("projects", "projects-open-search", "projects-search"),
            ("automations", "automation-open-search", "automation-search"),
            ("notes", "notes-open-search", "notes-search-field")
        ] {
            tab(destination)
            let header = app.navigationBars.firstMatch
            let searchButton = header.buttons[buttonID]
            XCTAssertTrue(searchButton.waitForExistence(timeout: 5))
            let field = app.textFields[fieldID]
            XCTAssertFalse(field.exists)
            searchButton.tap()
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            field.typeText("layout-query")
            XCTAssertEqual(field.value as? String, "layout-query")
            header.buttons[buttonID + "-close"].tap()
            XCTAssertFalse(field.exists)
            searchButton.tap()
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            XCTAssertNotEqual(field.value as? String, "layout-query")
            header.buttons[buttonID + "-close"].tap()
        }

        tab("search")
        XCTAssertTrue(app.textFields["conversations-search-field"].waitForExistence(timeout: 5))
    }

    func testStartupRestoresTheLastSelectedConversationAndItsDraft() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = "sidebar-restore-\(UUID().uuidString)"
        app.launch()
        XCTAssertTrue(app.buttons["chat-header-personal"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.openHomeSidebar())
        let ordinary = app.buttons["chat-sidebar-session-11111111-1111-4111-8111-111111111111"]
        XCTAssertTrue(ordinary.waitForExistence(timeout: 5))
        ordinary.tap()
        let field = app.textFields["assistant-chat-composer"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        let usable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [usable], timeout: 8), .completed)
        field.tap()
        let draft = "keep this draft"
        field.typeText(draft)
        app.buttons["chat-header-sidebar"].tap()
        app.buttons["chat-sidebar-personal"].tap()
        XCTAssertTrue(app.buttons["chat-header-personal"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.openHomeSidebar())
        ordinary.tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, draft)
        app.terminate()
        app.launch()
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["chat-header-personal"].exists)
        XCTAssertEqual(field.value as? String, draft)
    }

    func testManagedFilePreviewUsesTallDrawer() {
        XCTAssertTrue(app.openHomeSidebar())
        app.buttons["chat-sidebar-personal"].tap()
        let personal = app.buttons["chat-header-personal"]
        XCTAssertTrue(personal.waitForExistence(timeout: 5))
        personal.tap()
        let library = app.buttons["personal-overview-library-tab"]
        XCTAssertTrue(library.waitForExistence(timeout: 5))
        library.tap()
        let file = app.buttons["chat-attachment-preview-fixture-file"]
        XCTAssertTrue(file.waitForExistence(timeout: 5))
        file.tap()

        let close = app.buttons["preview-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["File version fixture"].exists)
        XCTAssertLessThan(close.frame.minY, app.frame.height * 0.20)
        XCTAssertFalse(app.buttons["file-save-version"].exists)
        close.tap()
        XCTAssertTrue(library.waitForExistence(timeout: 5))
    }

    func testAutomationDetailsAndRunReturnToSidebarDestination() {
        tab("automations")
        let automation = app.descendants(matching: .any)["automation-fixture-automation"].firstMatch
        XCTAssertTrue(automation.waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["自动化"].buttons["刷新"].exists)
        automation.tap()
        XCTAssertTrue(app.staticTexts["整理最近纪要"].waitForExistence(timeout: 5))
        let run = app.descendants(matching: .any)["automation-run-fixture-automation-run"].firstMatch
        XCTAssertTrue(run.waitForExistence(timeout: 5))
        run.tap()
        let detail = app.navigationBars["运行详情"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        detail.buttons.firstMatch.tap()
        XCTAssertTrue(run.waitForExistence(timeout: 5))
        app.navigationBars["自动化"].buttons.firstMatch.tap()
        XCTAssertTrue(automation.waitForExistence(timeout: 5))
    }

    func testProjectDetailReturnsToProjectList() {
        tab("projects")
        let project = app.descendants(matching: .any)["project-fixture-project"].firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["项目"].buttons["刷新"].exists)
        project.tap()
        let detail = app.navigationBars["项目详情"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        XCTAssertFalse(detail.buttons["刷新"].exists)
        XCTAssertTrue(app.staticTexts["资料测试项目"].firstMatch.waitForExistence(timeout: 5))
        detail.buttons.firstMatch.tap()
        XCTAssertTrue(project.waitForExistence(timeout: 5))
    }

    func testLibraryResultMatchesProgressAndProjectAndReturnsToResults() {
        app.terminate()
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = fixtureBase + "/task-delivery"
        app.launch()
        tab("library")
        let file = app.buttons["space-item-55555555-5555-4555-8555-555555555555"]
        XCTAssertTrue(file.waitForExistence(timeout: 10))
        file.tap()
        let source = app.buttons["查看来源"]
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        source.tap()
        XCTAssertTrue(app.staticTexts["任务顶部栏检查"].waitForExistence(timeout: 10))
        app.navigationBars["任务对话"].buttons.firstMatch.tap()
        XCTAssertTrue(file.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["布局检查笔记"].exists)

        let result = app.descendants(matching: .any)["delivery-task:fixture-delivery"].firstMatch
        tab("progress")
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        result.tap()
        XCTAssertTrue(app.staticTexts["任务顶部栏检查"].waitForExistence(timeout: 10))
        app.navigationBars["任务对话"].buttons.firstMatch.tap()

        app.selectPageOption("work-page-projects", from: "work-page-menu")
        let project = app.staticTexts["资料测试项目"]
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        project.tap()
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        result.tap()
        XCTAssertTrue(app.staticTexts["任务顶部栏检查"].waitForExistence(timeout: 10))
    }

    func testProgressTaskReviewAllowsManualCompletionWithUnverifiedCriteria() {
        tab("progress")
        let review = app.buttons["查看结果并验收"]
        XCTAssertTrue(review.waitForExistence(timeout: 10))
        review.tap()
        XCTAssertTrue(app.buttons["task-chat-details-tip"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["确认"].exists)
        app.buttons["task-chat-details-tip"].tap()
        app.buttons["task-chat-status"].tap()
        XCTAssertTrue(app.navigationBars["调整状态"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["task-phase-active"].isEnabled)
        let complete = app.buttons["task-complete"]
        XCTAssertTrue(complete.exists)
        XCTAssertTrue(complete.isEnabled)
        XCTAssertTrue(app.buttons["task-phase-closed"].isEnabled)
        XCTAssertTrue(app.buttons["task-cancel"].exists)
    }

    func testTaskConversationKeepsHeaderSettingsAccessible() {
        tab("progress")
        let task = app.buttons["查看任务"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        task.tap()
        let tasks = app.buttons["task-task-header"]
        XCTAssertTrue(tasks.waitForExistence(timeout: 10))
        tasks.tap()
        let toggle = app.buttons["task-chat-details-tip"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        let composer = app.textFields["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        XCTAssertFalse(app.scrollViews["task-chat-overview"].exists)
        toggle.tap()
        let overview = app.scrollViews["task-chat-overview"]
        XCTAssertTrue(overview.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(overview.frame.minY, 0)
        let edit = app.buttons["task-chat-edit"]
        XCTAssertTrue(edit.isHittable)
        edit.tap()
        let editor = app.navigationBars["编辑任务"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.buttons["取消"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        capture("task-chat-overview-expanded")
        overview.swipeUp()
        app.buttons["task-chat-details-close"].tap()
        XCTAssertTrue(overview.waitForNonExistence(timeout: 5))
        XCTAssertTrue(composer.isHittable)
        app.buttons["task-chat-menu"].tap()
        XCTAssertFalse(app.buttons["编辑"].exists)
        XCTAssertFalse(app.buttons["编辑任务"].exists)
        XCTAssertFalse(app.buttons["调整状态"].exists)
        XCTAssertFalse(app.buttons["取消任务"].exists)
        app.buttons["会话选项"].tap()
        XCTAssertTrue(app.navigationBars["会话选项"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["新建会话"].exists)
        app.navigationBars["会话选项"].buttons["关闭"].tap()
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        capture("task-chat-overview-collapsed")
        app.navigationBars["任务对话"].buttons.firstMatch.tap()
        XCTAssertTrue(tasks.waitForExistence(timeout: 5))
    }

    func testTaskReceiptOpensChatAndReturnsToTheSourceMessage() {
        XCTAssertTrue(app.openHomeSidebar())
        let personal = app.buttons["chat-sidebar-personal"]
        XCTAssertTrue(personal.waitForExistence(timeout: 10))
        personal.tap()
        XCTAssertTrue(app.buttons["chat-header-voice-call"].waitForExistence(timeout: 10))
        let predicate = NSPredicate(format: "label CONTAINS %@", "任务顶部栏检查")
        let button = app.buttons.matching(predicate).firstMatch
        let receipt = button.waitForExistence(timeout: 3) ? button : app.links.matching(predicate).firstMatch
        XCTAssertTrue(receipt.waitForExistence(timeout: 5))
        receipt.tap()
        XCTAssertTrue(app.buttons["task-chat-details-tip"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["assistant-chat-composer"].exists)
        app.buttons["task-chat-close"].tap()
        XCTAssertTrue(app.buttons["chat-header-voice-call"].waitForExistence(timeout: 5))
        XCTAssertTrue(receipt.isHittable)
    }

    private func openChatMessageSearch() {
        app.buttons["assistant-options"].tap()
        let search = app.buttons["assistant-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
    }

    func testMessageSearchBottomControlsAndClose() {
        XCTAssertTrue(app.openHomeSidebar())
        let ordinary = app.buttons["chat-sidebar-session-11111111-1111-4111-8111-111111111111"]
        XCTAssertTrue(ordinary.waitForExistence(timeout: 10))
        ordinary.tap()
        openChatMessageSearch()
        let input = app.textFields["chat-message-search-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let tabs = ["messages", "files", "links", "images"].map { app.buttons["chat-search-category-\($0)"] }
        tabs.forEach { XCTAssertTrue($0.exists) }
        XCTAssertLessThanOrEqual(tabs[0].frame.maxY, input.frame.minY)
        XCTAssertLessThanOrEqual(input.frame.maxY, app.keyboards.firstMatch.frame.minY + 4)
        input.typeText("检查结果")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "所有改动均已记录")).firstMatch.waitForExistence(timeout: 5))
        capture("message-search-bottom-controls")
        app.buttons["chat-search-close"].tap()
        XCTAssertTrue(app.buttons["chat-header-voice-call"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["chat-message-search-input"].exists)
    }

    private func openPersonalAgentEditor() {
        let avatar = app.buttons["chat-header-personal"]
        XCTAssertTrue(avatar.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["assistant-options"].exists)
        avatar.tap()
        let edit = app.buttons["personal-overview-avatar"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        edit.tap()
    }

    func testPersonalAgentSettingsSaveModel() {
        XCTAssertTrue(app.openHomeSidebar())
        let personal = app.buttons["chat-sidebar-personal"]
        XCTAssertTrue(personal.waitForExistence(timeout: 10))
        personal.tap()
        openPersonalAgentEditor()
        let model = app.buttons["personal-setting-model"]
        XCTAssertTrue(model.waitForExistence(timeout: 5))
        model.tap()
        let alternate = app.buttons["Second Fixture Model"]
        XCTAssertTrue(alternate.waitForExistence(timeout: 5))
        alternate.tap()
        XCTAssertTrue(model.waitForExistence(timeout: 5))
        XCTAssertTrue(model.label.contains("Second Fixture Model"))
        XCTAssertFalse(app.buttons["personal-setting-thinking"].exists)
        app.buttons["personal-setting-close"].tap()
        let edit = app.buttons["personal-overview-avatar"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        edit.tap()
        XCTAssertTrue(model.waitForExistence(timeout: 5))
        XCTAssertTrue(model.label.contains("Second Fixture Model"))
    }

    func testPersonalCallModeSavesAndHidesVoiceDetailsForDirectConversation() {
        XCTAssertTrue(app.openHomeSidebar())
        let personal = app.buttons["chat-sidebar-personal"]
        XCTAssertTrue(personal.waitForExistence(timeout: 10))
        personal.tap()
        openPersonalAgentEditor()
        let mode = app.buttons["personal-setting-call-mode"]
        let form = app.collectionViews.firstMatch
        XCTAssertTrue(form.waitForExistence(timeout: 5))
        XCTAssertTrue(mode.waitForExistence(timeout: 5))
        if !mode.isHittable || mode.frame.maxY > form.frame.maxY - 20 {
            form.swipeUp(velocity: .fast)
        }
        mode.tap()
        let direct = app.buttons["直接对话"]
        XCTAssertTrue(direct.waitForExistence(timeout: 5))
        direct.tap()
        XCTAssertTrue(direct.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["声音与问候"].waitForNonExistence(timeout: 5))
        XCTAssertFalse(app.buttons["保存"].exists)
        let close = app.buttons["personal-setting-close"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: close)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
        close.tap()
        XCTAssertTrue(mode.waitForNonExistence(timeout: 5))
        app.buttons["personal-overview-avatar"].tap()
        XCTAssertTrue(form.waitForExistence(timeout: 5))
        XCTAssertTrue(mode.waitForExistence(timeout: 5))
        if !mode.isHittable || mode.frame.maxY > form.frame.maxY - 20 {
            form.swipeUp(velocity: .fast)
        }
        XCTAssertTrue(mode.label.contains("直接对话") || (mode.value as? String) == "直接对话")
        mode.tap()
        let assistant = app.buttons["语音助手"]
        XCTAssertTrue(assistant.waitForExistence(timeout: 5))
        assistant.tap()
        XCTAssertTrue(assistant.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["声音与问候"].waitForExistence(timeout: 5))
    }

    func testPersonalChatHeaderVoiceAndSettings() {
        XCTAssertTrue(app.openHomeSidebar())
        let personal = app.buttons["chat-sidebar-personal"]
        XCTAssertTrue(personal.waitForExistence(timeout: 10))
        personal.tap()
        let voice = app.buttons["chat-header-voice-call"]
        XCTAssertTrue(voice.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(voice.frame.height, 44)
        capture("personal-chat-capsule-header")
        openPersonalAgentEditor()
        XCTAssertFalse(app.buttons["assistant-search"].exists)
        XCTAssertTrue(app.textFields["名称"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["上传头像"].exists)
        capture("personal-ai-profile-settings")
        app.swipeUp()
        app.swipeUp()
        let details = app.buttons["声音与问候"]
        if !details.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(details.waitForExistence(timeout: 5))
        details.tap()
        XCTAssertTrue(app.buttons["personal-agent-voice-choice"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Gateway 请求失败（404）"].exists)
        XCTAssertFalse(app.staticTexts["更多设置请前往 PC 或 Web 端。"].exists)
        capture("personal-ai-mobile-settings")
        app.buttons["personal-setting-close"].tap()
    }

    func testConversationDraftFilteringAndChildren() {
        tab("conversations")
        let expand = app.buttons["conversation-expand-11111111-1111-4111-8111-111111111111"]
        XCTAssertTrue(expand.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["丢弃草稿"].exists)
        XCTAssertFalse(app.staticTexts["新对话"].exists)
        expand.tap()
        let child = app.buttons["conversation-child-task-child"]
        XCTAssertTrue(child.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(child.frame.height, 52)
        XCTAssertLessThanOrEqual(child.frame.height, 60.5)
        XCTAssertLessThan(abs(expand.frame.midY - app.staticTexts["移动端布局检查"].frame.midY), 12)
        capture("conversations-children")
        child.tap()
        XCTAssertTrue(app.buttons["task-chat-details-tip"].waitForExistence(timeout: 10))
        app.navigationBars["任务对话"].buttons.firstMatch.tap()
        XCTAssertTrue(child.waitForExistence(timeout: 5))
    }

    func testWorkingLogoAndCompactVoicePlayback() async throws {
        tab("conversations")
        let expand = app.buttons["conversation-expand-11111111-1111-4111-8111-111111111111"]
        XCTAssertTrue(expand.waitForExistence(timeout: 10))
        expand.tap()
        app.buttons["conversation-child-task-child"].tap()
        let jump = app.buttons["chat-jump-bottom"]
        XCTAssertTrue(app.buttons["chat-audio-voice"].waitForExistence(timeout: 10))
        revealJumpToLatest(jump)
        XCTAssertTrue(jump.waitForExistence(timeout: 10))
        XCTAssertEqual(jump.value as? String, "正在回答")
        XCTAssertEqual(jump.frame.midX, app.frame.midX, accuracy: 3)
        let first = jump.screenshot().pngRepresentation
        try await Task.sleep(for: .milliseconds(900))
        let second = jump.screenshot().pngRepresentation
        XCTAssertNotEqual(first, second)
        capture("working-logo-animation")
        jump.tap()
        let voice = app.buttons["chat-audio-voice"]
        XCTAssertTrue(voice.waitForExistence(timeout: 5))
        XCTAssertEqual(voice.frame.height, 48, accuracy: 2)
        XCTAssertLessThan(voice.frame.width, 133)
        voice.tap()
        let playing = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "停止播放语音"), object: voice)
        await fulfillment(of: [playing], timeout: 5)
        capture("voice-inline-playing")
        voice.tap()
        XCTAssertEqual(voice.label, "播放语音")
    }

    func testAssistantSelectTextOpensInline() {
        openChat()
        let answer = app.descendants(matching: .any)["chat-message-assistant-ai-1"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 5))
        answer.press(forDuration: 1)
        let select = app.buttons["选择文本"].firstMatch
        XCTAssertTrue(select.waitForExistence(timeout: 5))
        select.tap()
        let selection = app.descendants(matching: .any)["chat-inline-text-selection"].firstMatch
        XCTAssertTrue(selection.waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["message-detail-content"].exists)
        capture("message-inline-text-selection")
        let copy = app.menuItems["复制"].firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 5))
        XCTAssertTrue(app.menuItems["分享"].exists)
        app.menuItems["全选"].tap()
        XCTAssertTrue(copy.waitForExistence(timeout: 5))
        copy.tap()
        XCTAssertFalse(selection.exists)
    }

    func testMessageLongPressDetailOptionsAndJump() {
        openChat()
        let user = app.staticTexts["请整理移动端布局"].firstMatch
        XCTAssertTrue(user.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["chat-user-copy-user-1"].exists)
        XCTAssertFalse(app.buttons["chat-user-reuse-user-1"].exists)
        user.press(forDuration: 1)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == %@", "再次编辑")).firstMatch.waitForExistence(timeout: 5))
        capture("message-long-press")
        app.buttons.matching(NSPredicate(format: "label == %@", "再次编辑")).firstMatch.tap()
        XCTAssertEqual(app.textFields["assistant-chat-composer"].value as? String, "请整理移动端布局")
        let answer = app.descendants(matching: .any)["chat-message-assistant-ai-1"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 5))
        answer.press(forDuration: 1)
        app.buttons.matching(NSPredicate(format: "label == %@", "消息详情")).firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["message-detail-content"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["消息详情"].exists)
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label == %@", "执行过程")).firstMatch.isHittable)
        capture("message-content-detail")
        let detail = app.descendants(matching: .any)["message-detail-content"].firstMatch
        let handle = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.midX, dy: detail.frame.minY + 8))
        handle.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)))
        let options = app.buttons["assistant-options"]
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: options)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 5), .completed)
        options.tap()
        XCTAssertTrue(app.navigationBars["会话选项"].waitForExistence(timeout: 5))
        capture("conversation-options")
        app.staticTexts["思考档位"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == %@", "高")).firstMatch.waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "label == %@", "高")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["会话选项"].waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "label == %@", "关闭")).firstMatch.tap()
        let jump = app.buttons["chat-jump-bottom"]
        revealJumpToLatest(jump)
        XCTAssertTrue(jump.waitForExistence(timeout: 5))
        XCTAssertEqual(jump.frame.midX, app.frame.midX, accuracy: 3)
        capture("message-jump-centered")
        jump.tap()
        XCTAssertFalse(jump.exists)
        app.buttons["assistant-options"].tap()
        app.staticTexts["新建会话"].tap()
        dismissNewConversationConfirmation()
        XCTAssertEqual(app.textFields["assistant-chat-composer"].value as? String, "请整理移动端布局")
    }

    private func dismissNewConversationConfirmation() {
        let confirmation = app.buttons.matching(NSPredicate(format: "label == %@", "开始新对话")).firstMatch
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        let cancel = app.buttons.matching(NSPredicate(format: "label == %@", "取消")).firstMatch
        if cancel.exists {
            cancel.tap()
        } else {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    private func revealJumpToLatest(_ jump: XCUIElement) {
        let timeline = app.scrollViews["chat-message-timeline"]
        for _ in 0 ..< 4 where !jump.isHittable {
            timeline.swipeDown()
        }
    }

    func testGlobalModelSettingsSearchAndPersist() {
        let settings = app.buttons["chat-sidebar-profile"]
        app.buttons["chat-header-sidebar"].tap()
        if !settings.waitForExistence(timeout: 3) {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: 0.86))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.86))
            start.press(forDuration: 0.08, thenDragTo: end)
        }
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let entry = app.buttons["settings-models"]
        XCTAssertTrue(entry.waitForExistence(timeout: 5))
        if !entry.isHittable {
            app.swipeUp()
        }
        entry.tap()
        let active = app.buttons["model-setting-chat"]
        XCTAssertTrue(active.waitForExistence(timeout: 5))
        let changeToSecond = !active.label.contains("Second Fixture Model")
        let target = changeToSecond ? "Second Fixture Model" : "Fixture Model"
        active.tap()
        let search = app.textFields["model-settings-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(changeToSecond ? "Second" : "Fixture")
        app.buttons[changeToSecond ? "model-choice-test/model-two" : "model-choice-test/model"].tap()
        app.buttons["model-settings-confirm"].tap()
        XCTAssertTrue(active.waitForExistence(timeout: 5))
        XCTAssertTrue(active.label.contains(target))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(entry.waitForExistence(timeout: 5))
        entry.tap()
        XCTAssertTrue(active.waitForExistence(timeout: 5))
        XCTAssertTrue(active.label.contains(target))
    }

    func testHistoryLibraryAndProjectTitlesFollowHorizontalSwipes() {
        func assertTitle(_ id: String, contains title: String) {
            let menu = app.buttons.matching(identifier: id)
                .matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
            XCTAssertTrue(menu.waitForExistence(timeout: 6), "Expected \(title) in \(id)")
        }

        tab("conversations")
        assertTitle("sessions-mode-menu", contains: "最近")
        let history = app.descendants(matching: .any)["sessions-mode-pager"].firstMatch
        XCTAssertTrue(history.exists)
        let conversation = app.staticTexts["移动端布局检查"].firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 6))
        conversation.swipeLeft()
        assertTitle("sessions-mode-menu", contains: "项目")
        let group = app.staticTexts["未分配"].firstMatch
        XCTAssertTrue(group.waitForExistence(timeout: 6))
        let rowY = (group.frame.midY - history.frame.minY) / history.frame.height
        let start = history.coordinate(withNormalizedOffset: CGVector(dx: 0.22, dy: rowY))
        let end = history.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: rowY))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .fast, thenHoldForDuration: 0)
        assertTitle("sessions-mode-menu", contains: "最近")

        tab("library")
        assertTitle("space-scope-menu", contains: "全部资料")
        let item = app.buttons["space-item-55555555-5555-4555-8555-555555555555"]
        XCTAssertTrue(item.waitForExistence(timeout: 6))
        item.swipeLeft()
        assertTitle("space-scope-menu", contains: "收藏")
        XCTAssertFalse(app.buttons["preview-actions"].exists)

        tab("progress")
        app.selectPageOption("work-page-projects", from: "work-page-menu")
        let project = app.descendants(matching: .any)["project-fixture-project"].firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 6))
        project.tap()
        let projectPager = app.descendants(matching: .any)["project-pager"].firstMatch
        XCTAssertTrue(projectPager.waitForExistence(timeout: 6))
        projectPager.swipeLeft()
        assertTitle("project-tabs", contains: "对话")
    }

    func testGoalCapsulesAndListSwipeBetweenOngoingAndAchieved() {
        tab("profile")
        app.buttons["settings-goals"].tap()
        let ongoing = app.buttons["personal-goals-ongoing"]
        let achieved = app.buttons["personal-goals-achieved"]
        let activeGoal = app.buttons["goal-fixture-ongoing"]
        let completedGoal = app.buttons["goal-fixture-achieved"]
        XCTAssertTrue(activeGoal.waitForExistence(timeout: 6))
        XCTAssertTrue(ongoing.isSelected)
        XCTAssertFalse(completedGoal.exists)

        activeGoal.swipeLeft()
        XCTAssertTrue(completedGoal.waitForExistence(timeout: 6))
        XCTAssertTrue(achieved.isSelected)
        XCTAssertFalse(activeGoal.exists)

        achieved.swipeRight()
        XCTAssertTrue(activeGoal.waitForExistence(timeout: 6))
        XCTAssertTrue(ongoing.isSelected)
        achieved.tap()
        XCTAssertTrue(completedGoal.waitForExistence(timeout: 6))
    }

    func testPrivacyMemorySwipesAndTitleMenuStayInSync() {
        tab("profile")
        app.buttons["settings-privacy-memory"].tap()
        let menu = app.buttons["about-you-menu"]
        let overview = app.buttons["about-you-work-memory"]
        XCTAssertTrue(overview.waitForExistence(timeout: 6))
        overview.swipeLeft()

        let search = app.buttons["about-you-search-toggle"]
        XCTAssertTrue(search.waitForExistence(timeout: 6))
        XCTAssertTrue(menu.label.contains("记住的你"))

        let pager = app.descendants(matching: .any)["about-you-pager"].firstMatch
        XCTAssertTrue(pager.exists)
        pager.swipeLeft()
        let decision = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "移动端项目决定")).firstMatch
        XCTAssertTrue(decision.waitForExistence(timeout: 6))
        XCTAssertTrue(menu.label.contains("工作记忆"))
        XCTAssertFalse(search.exists)

        decision.swipeRight()
        XCTAssertTrue(search.waitForExistence(timeout: 6))
        app.selectPageOption("about-you-tab-overview", from: "about-you-menu")
        XCTAssertTrue(overview.waitForExistence(timeout: 6))
        XCTAssertTrue(menu.label.contains("概览"))
    }

    func testPrivacyWorkMemoryAndInactiveShareHistory() {
        tab("profile")
        app.buttons["settings-privacy-memory"].tap()
        let work = app.buttons["about-you-work-memory"]
        XCTAssertTrue(work.waitForExistence(timeout: 6))
        work.tap()
        let decision = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "移动端项目决定")).firstMatch
        XCTAssertTrue(decision.waitForExistence(timeout: 6))
        XCTAssertLessThan(decision.frame.minY, app.frame.midY)
        decision.tap()
        let loadMore = app.buttons["加载更多"]
        if !loadMore.isHittable {
            app.swipeUp()
        }
        loadMore.tap()
        XCTAssertTrue(app.staticTexts["验收经验：先使用独立数据。"].waitForExistence(timeout: 6))
        capture("work-memory")

        app.navigationBars.buttons.firstMatch.tap()
        let history = app.buttons["settings-share-history"]
        if !history.isHittable {
            app.swipeUp()
        }
        history.tap()
        XCTAssertTrue(app.staticTexts["已过期的对话链接"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.staticTexts["已撤销的笔记链接"].exists)
        capture("share-history")
        app.buttons["share-filter-active"].tap()
        XCTAssertTrue(app.staticTexts["没有有效的分享链接"].exists)
        XCTAssertFalse(app.staticTexts["已过期的对话链接"].exists)
        app.buttons["share-filter-all"].tap()
        XCTAssertTrue(app.staticTexts["已撤销的笔记链接"].exists)
    }

    func testProgressLibraryAndSettingsLayout() {
        tab("progress")
        XCTAssertTrue(app.navigationBars["进展"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["工作进展"].exists)
        XCTAssertFalse(app.staticTexts["查看助理的工作、需要你的决定和最新交付。"].exists)
        XCTAssertTrue(app.staticTexts["需要验收"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["进行中的工作"].exists)
        XCTAssertTrue(app.staticTexts["明日计划"].exists)
        XCTAssertFalse(app.staticTexts["不应重复显示的计划"].exists)
        XCTAssertLessThan(app.staticTexts["需要你处理"].frame.minY, app.staticTexts["正在进行"].frame.minY)
        XCTAssertLessThan(app.staticTexts["正在进行"].frame.minY, app.staticTexts["接下来"].frame.minY)
        capture("progress-sections")
        let library = app.buttons["progress-open-library"]
        if !library.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(library.isHittable)
        library.tap()
        XCTAssertTrue(app.buttons["space-scope-menu"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["space-item-55555555-5555-4555-8555-555555555555"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["布局检查笔记"].exists)
        capture("library-layout")
        tab("profile")
        XCTAssertTrue(app.buttons["profile-personal-agent-configure"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["settings-goals"].exists)
        app.buttons["settings-privacy-memory"].tap()
        XCTAssertTrue(app.buttons["about-you-menu"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["about-you-search-toggle"].exists)
        app.selectPageOption("about-you-tab-understanding", from: "about-you-menu")
        app.buttons["about-you-search-toggle"].tap()
        XCTAssertTrue(app.textFields["about-you-search"].waitForExistence(timeout: 5))
        app.selectPageOption("about-you-tab-overview", from: "about-you-menu")
        XCTAssertFalse(app.textFields["about-you-search"].exists)
        app.navigationBars.buttons.firstMatch.tap()
        let about = app.buttons["settings-about"]
        if !about.isHittable {
            app.swipeUp()
        }
        about.tap()
        XCTAssertTrue(app.staticTexts["settings-about-version"].waitForExistence(timeout: 5))
        for link in ["website", "support", "privacy", "terms"] {
            XCTAssertTrue(app.descendants(matching: .any)["settings-about-\(link)"].exists)
        }
        capture("settings-about-app")
    }

    func testAutomationFilterAndMenusStayOnTheirPages() {
        tab("automations")
        let card = app.descendants(matching: .any)["automation-fixture-automation"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["每周一 09:00"].exists || card.label.contains("每周一 09:00"))
        XCTAssertFalse(app.staticTexts["0 9 * * 1"].exists)
        app.buttons["automation-filter-menu"].tap()
        XCTAssertTrue(app.buttons["automation-filter-all"].isSelected)
        app.buttons["automation-filter-paused"].tap()
        XCTAssertTrue(card.waitForNonExistence(timeout: 5))
        app.selectPageOption("automation-filter-all", from: "automation-filter-menu")

        let more = app.buttons["automation-card-menu-fixture-automation"]
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        more.tap()
        XCTAssertTrue(app.buttons["automation-menu-toggle"].exists)
        app.buttons["automation-menu-edit"].tap()
        XCTAssertTrue(app.navigationBars["编辑自动化"].waitForExistence(timeout: 5))
        app.buttons["取消"].tap()
        card.tap()
        let detailMenu = app.buttons["automation-detail-menu"]
        XCTAssertTrue(detailMenu.waitForExistence(timeout: 5))
        detailMenu.tap()
        XCTAssertTrue(app.buttons["automation-menu-delete"].waitForExistence(timeout: 5))
    }

    func testWorkbenchMenuAndSwipesStayInSync() {
        tab("progress")
        let menu = app.buttons["work-page-menu"]
        let pager = app.descendants(matching: .any)["work-page-pager"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        menu.tap()
        XCTAssertTrue(app.buttons["work-page-progress"].isSelected)
        XCTAssertFalse(app.buttons["work-page-automations"].exists)
        app.buttons["work-page-progress"].tap()
        pager.swipeLeft()
        let openTasks = app.buttons["tasks-filter-open"]
        XCTAssertTrue(openTasks.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["tasks-filter-all"].isSelected)
        let filters = app.descendants(matching: .any)["tasks-filter-tabs"].firstMatch
        let start = filters.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
        let end = filters.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(openTasks.isSelected)
        app.buttons["tasks-filter-closed"].tap()
        XCTAssertTrue(app.buttons["tasks-filter-closed"].isSelected)
        XCTAssertFalse(app.buttons["projects-open-search"].exists)
        openTasks.tap()
        app.selectPageOption("work-page-projects", from: "work-page-menu")
        XCTAssertTrue(app.buttons["projects-open-search"].waitForExistence(timeout: 5))
        pager.swipeRight()
        XCTAssertTrue(app.buttons["tasks-filter-open"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["projects-open-search"].exists)
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.buttons["chat-sidebar-workbench"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["chat-sidebar-projects"].exists)
        app.buttons["chat-sidebar-workbench"].tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        menu.tap()
        XCTAssertTrue(app.buttons["work-page-progress"].isSelected)
        app.buttons["work-page-progress"].tap()
        tab("automations")
        XCTAssertTrue(app.buttons["automation-filter-menu"].waitForExistence(timeout: 5))
        XCTAssertFalse(menu.exists)
    }
}

private extension MobileLayoutParityUITests {
    private func openChat() {
        tab("conversations")
        let title = app.staticTexts["移动端布局检查"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        title.tap()
    }

    private func tab(_ name: String) {
        app.openHomeDestination(name)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

@MainActor
extension XCUIApplication {
    func selectCapability(_ identifier: String) {
        selectPageOption(identifier, from: "capability-page-menu")
    }

    func selectPageOption(_ identifier: String, from menu: String) {
        let switcher = buttons[menu]
        XCTAssertTrue(switcher.waitForExistence(timeout: 5))
        switcher.tap()
        let option = buttons[identifier]
        XCTAssertTrue(option.waitForExistence(timeout: 5))
        option.tap()
    }

    @discardableResult
    func openHomeSidebar() -> Bool {
        let header = buttons["chat-header-sidebar"]
        let close = buttons["chat-sidebar-close"]
        _ = header.waitForExistence(timeout: 1)
        for _ in 0 ..< 6 {
            if close.isHittable {
                return true
            }
            if header.isHittable {
                header.tap()
                return close.waitForExistence(timeout: 5)
            }
            let back = navigationBars.buttons.firstMatch
            guard back.isHittable else { break }
            back.tap()
        }
        return close.isHittable
    }

    func openHomeDestination(_ destination: String) {
        XCTAssertTrue(openHomeSidebar(), "Could not open navigation")
        if destination == "assistant" {
            buttons["chat-sidebar-close"].tap()
            return
        }
        let identifier = ["conversations": "search", "progress": "workbench", "projects": "workbench"][destination] ?? destination
        let button = buttons["chat-sidebar-\(identifier)"]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
        if destination == "conversations" {
            let closeSearch = navigationBars.firstMatch.buttons["conversations-open-search-close"]
            XCTAssertTrue(closeSearch.waitForExistence(timeout: 5))
            closeSearch.tap()
        } else if destination == "projects" {
            selectPageOption("work-page-projects", from: "work-page-menu")
        }
    }
}
