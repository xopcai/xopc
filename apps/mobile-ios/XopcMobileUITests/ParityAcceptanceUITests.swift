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
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 10))
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
            XCTAssertTrue(app.navigationBars["消息详情"].waitForExistence(timeout: 5))
            capture("12-message-detail")
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
            navigateBack()
            dismissSheet()
        }

        let add = app.buttons["添加附件或引用"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        capture("30-composer-actions")
        tapIfExists("关闭添加面板")
    }

    func testAssistantMessageReadAloudControls() {
        openTab("对话")
        XCTAssertTrue(openCell(at: 3))
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

    func testAssistantMessageSaveToNotesAndCleanup() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"] else {
            throw XCTSkip("A Gateway token is required for note cleanup")
        }
        let before = try await noteIDs(token: token)
        openTab("对话")
        XCTAssertTrue(openCell(at: 3))
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
        app.buttons["新对话"].tap()
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
        XCTAssertTrue(app.buttons["新建会话"].exists)
        XCTAssertGreaterThan(app.buttons["照片"].frame.minY, app.descendants(matching: .any)["assistant-chat-composer"].frame.maxY)
        XCTAssertFalse(app.buttons["home-tab-assistant"].exists)
        app.buttons["引用任务"].tap()
        XCTAssertTrue(app.navigationBars["添加引用"].waitForExistence(timeout: 5))
        app.buttons["取消"].tap()
        add.tap()
        app.buttons["关闭添加面板"].tap()
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 5))
    }

    func testAssistantKeyboardAndAddPanelAreMutuallyExclusive() {
        app.buttons["新对话"].tap()
        let composer = app.descendants(matching: .any)["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))

        app.buttons["添加附件或引用"].tap()
        let panel = app.collectionViews["assistant-action-panel"]
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        capture("assistant-add-panel-after-keyboard")

        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(panel.exists)
        capture("assistant-keyboard-after-add-panel")
    }

    func testAssistantActionPanelAccessibilityAudit() throws {
        app.buttons["新对话"].tap()
        let add = app.buttons["添加附件或引用"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        XCTAssertTrue(app.collectionViews["assistant-action-panel"].waitForExistence(timeout: 5))

        try app.performAccessibilityAudit(for: [
            .elementDetection,
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
            .trait
        ], logAccessibilityIssue)
        capture("assistant-action-panel-accessibility-audit")
    }

    func testPrimaryTabsAccessibilityAudit() throws {
        for tab in ["助手", "对话", "进展", "笔记", "我的"] {
            openTab(tab)
            XCTAssertTrue(app.navigationBars[tab].waitForExistence(timeout: 8), "Missing page: \(tab)")
            try app.performAccessibilityAudit(for: [
                .elementDetection,
                .hitRegion,
                .sufficientElementDescription,
                .textClipped,
                .trait
            ])
        }
        capture("primary-tabs-accessibility-audit")
    }

    func testProgressDestinationsAccessibilityAudit() throws {
        openTab("进展")
        for destination in ["任务", "项目", "自动化"] {
            let link = app.buttons[destination]
            XCTAssertTrue(link.waitForExistence(timeout: 8), "Missing destination: \(destination)")
            link.tap()
            XCTAssertTrue(app.navigationBars[destination].waitForExistence(timeout: 8), "Missing page: \(destination)")
            try app.performAccessibilityAudit(for: [
                .elementDetection,
                .hitRegion,
                .sufficientElementDescription,
                .textClipped,
                .trait
            ])
            navigateBack()
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
        XCTAssertTrue(app.buttons["编辑"].waitForExistence(timeout: 10))
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
        app.buttons["文字笔记"].tap()
        XCTAssertTrue(app.navigationBars["新建笔记"].waitForExistence(timeout: 8))
        try performCoreAccessibilityAudit()
        app.buttons["取消"].tap()

        app.buttons["新建笔记"].tap()
        app.buttons["语音笔记"].tap()
        XCTAssertTrue(app.navigationBars["语音笔记"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["开始录音"].waitForExistence(timeout: 8))
        try performCoreAccessibilityAudit()
        app.buttons["取消"].tap()

        openTab("进展")
        app.buttons["自动化"].tap()
        XCTAssertTrue(app.buttons["新建自动化"].waitForExistence(timeout: 8))
        app.buttons["新建自动化"].tap()
        XCTAssertTrue(app.navigationBars["新建自动化"].waitForExistence(timeout: 8))
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
        app.buttons["新建笔记"].tap()
        app.buttons["语音笔记"].tap()
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
        let search = app.textFields["automation-search"]
        XCTAssertTrue(search.exists)
        search.tap()
        search.typeText("xopc-ios-no-matching-automation")
        XCTAssertTrue(app.staticTexts["没有匹配的自动化"].waitForExistence(timeout: 5))
        app.buttons["清除搜索"].tap()
        XCTAssertFalse(app.staticTexts["没有匹配的自动化"].exists)
        app.buttons["automation-filter-paused"].tap()
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
        app.buttons["添加附件或引用"].tap()
        let panel = app.collectionViews["assistant-action-panel"]
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        panel.swipeLeft()
        let voice = app.buttons["语音助手"]
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
        app.buttons["添加附件或引用"].tap()
        let panel = app.collectionViews["assistant-action-panel"]
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        panel.swipeLeft()
        app.buttons["实时语音"].tap()
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
        app.buttons["home-tab-conversations"].tap()
        XCTAssertTrue(openCell(at: 3))

        app.buttons["Add Attachments or References"].tap()
        XCTAssertTrue(app.buttons["Reference Note"].waitForExistence(timeout: 5))
        app.buttons["Reference Note"].tap()
        XCTAssertTrue(app.navigationBars["Add Reference"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.searchFields["Search Notes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.segmentedControls.buttons["Notes"].exists)
        app.segmentedControls.buttons["Tasks"].tap()
        XCTAssertTrue(app.searchFields["Search Tasks"].waitForExistence(timeout: 5))
        app.segmentedControls.buttons["Files"].tap()
        XCTAssertTrue(app.searchFields["Search Files"].waitForExistence(timeout: 5))
        capture("english-reference-picker")
        app.buttons["Cancel"].tap()

        app.buttons["Add Attachments or References"].tap()
        let panel = app.collectionViews["assistant-action-panel"]
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        panel.swipeLeft()
        let voice = app.buttons["Voice Assistant"]
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
        app.buttons["home-tab-notes"].tap()
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

        app.buttons["home-tab-progress"].tap()
        let automations = app.buttons["Automations"]
        XCTAssertTrue(automations.waitForExistence(timeout: 8))
        automations.tap()
        let newAutomation = app.buttons["New Automation"]
        XCTAssertTrue(newAutomation.waitForExistence(timeout: 8))
        newAutomation.tap()
        XCTAssertTrue(app.navigationBars["New Automation"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["Cron Expression"].exists)
        XCTAssertTrue(app.switches["Enable after creation"].exists)
        capture("english-automation-editor")
        app.buttons["Cancel"].tap()
    }

    func testHomeDockQuickComposerAndTabAlignment() {
        openTab("对话")
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "条消息")).firstMatch.waitForExistence(timeout: 8)
        )
        let quickInput = app.descendants(matching: .any)["home-quick-composer"]
        XCTAssertTrue(quickInput.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["语音对话"].exists)
        XCTAssertTrue(app.buttons["添加内容"].exists)
        let quickMicFrame = app.buttons["语音对话"].frame
        let quickAddFrame = app.buttons["添加内容"].frame
        let firstTab = app.buttons["home-tab-assistant"]
        let lastTab = app.buttons["home-tab-profile"]
        XCTAssertGreaterThan(firstTab.frame.minX, 0)
        XCTAssertLessThan(lastTab.frame.maxX, app.frame.maxX)
        capture("40-home-dock-conversations")

        openTab("进展")
        XCTAssertTrue(quickInput.exists)
        capture("41-home-dock-progress")

        openTab("笔记")
        capture("42-home-dock-library")
        app.buttons["添加内容"].tap()
        XCTAssertTrue(app.buttons["照片"].waitForExistence(timeout: 5))
        capture("43-home-dock-actions")

        app.buttons["关闭添加面板"].tap()
        openTab("助手")
        XCTAssertTrue(app.descendants(matching: .any)["assistant-chat-composer"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["语音对话"].exists)
        XCTAssertTrue(app.buttons["添加附件或引用"].exists)
        XCTAssertEqual(app.buttons["语音对话"].frame.minX, quickMicFrame.minX, accuracy: 2)
        XCTAssertEqual(app.buttons["添加附件或引用"].frame.maxX, quickAddFrame.maxX, accuracy: 2)
        XCTAssertLessThan(app.buttons["语音对话"].frame.maxY, app.buttons["home-tab-assistant"].frame.minY)
        capture("45-home-dock-assistant")
    }

    func testConversationListStartsNewChat() {
        openTab("对话")
        let newChat = app.buttons["新建对话"]
        XCTAssertTrue(newChat.waitForExistence(timeout: 5))
        newChat.tap()
        XCTAssertTrue(app.descendants(matching: .any)["assistant-chat-composer"].waitForExistence(timeout: 5))
    }

    func testNotesTabRemainsSelectedAfterRelaunch() {
        for _ in 0 ..< 3 {
            relaunch()
            openTab("笔记")
            XCTAssertTrue(app.navigationBars["笔记"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.textFields["notes-search-field"].waitForExistence(timeout: 5))
        }
        XCTAssertTrue(app.buttons["notes-files-button"].exists)
        app.buttons["新建笔记"].tap()
        XCTAssertTrue(app.buttons["notes-create-text"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["notes-create-voice"].exists)
        app.buttons["notes-create-text"].tap()
        XCTAssertTrue(app.navigationBars["新建笔记"].waitForExistence(timeout: 5))
    }

    func testNotesFilesEntryOpensFileLibrary() {
        openTab("笔记")
        let files = app.buttons["notes-files-button"]
        XCTAssertTrue(files.waitForExistence(timeout: 5))
        files.tap()
        XCTAssertTrue(app.navigationBars["文件"].waitForExistence(timeout: 5))
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

    func testLanguageSwitchUpdatesVisibleNavigationAndDock() {
        openTab("我的")
        app.swipeUp()
        app.buttons["应用设置"].tap()
        app.buttons["语言"].tap()
        tapPickerOption("English")

        XCTAssertTrue(app.navigationBars["Language"].waitForExistence(timeout: 5))
        navigateBack()
        navigateBack()
        XCTAssertEqual(app.buttons["home-tab-assistant"].label, "Assistant")
        XCTAssertEqual(app.buttons["home-tab-conversations"].label, "Chats")

        app.buttons["home-tab-conversations"].tap()
        XCTAssertTrue(app.navigationBars["Chats"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "messages")).firstMatch.waitForExistence(timeout: 8)
        )
        capture("46-english-conversations")
        openTab("我的")

        app.buttons["App Settings"].tap()
        app.buttons["Language"].tap()
        tapPickerOption("Simplified Chinese")
        XCTAssertTrue(app.navigationBars["语言"].waitForExistence(timeout: 5))
    }

    func testEnglishProjectCreationLabels() {
        openTab("我的")
        app.swipeUp()
        app.buttons["应用设置"].tap()
        app.buttons["语言"].tap()
        tapPickerOption("English")
        navigateBack()
        navigateBack()

        openTab("进展")
        app.buttons["Projects"].tap()
        XCTAssertTrue(openCell(at: 1))
        let sections = app.segmentedControls.firstMatch
        sections.buttons["Tasks"].tap()
        app.buttons["New Project Task"].tap()
        XCTAssertTrue(app.navigationBars["New Project Task"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Task Goal"].exists)
        XCTAssertTrue(app.staticTexts["The task will be added to this project's backlog. The assistant will not start it immediately."].exists)
    }

    func testQuickComposerStartsAndSendsConversation() {
        openTab("对话")
        let quickInput = app.descendants(matching: .any)["home-quick-composer"]
        XCTAssertTrue(quickInput.waitForExistence(timeout: 5))
        quickInput.tap()
        let prompt = "iOS quick dock E2E \(UUID().uuidString.prefix(8))"
        quickInput.typeText(prompt)
        app.buttons["发送快捷消息"].tap()
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[prompt].waitForExistence(timeout: 12))
        XCTAssertTrue(app.buttons["添加附件或引用"].waitForExistence(timeout: 5))
        capture("44-quick-message-sent")
    }

    func testProgressJourneys() {
        openTab("进展")
        capture("15-progress-home")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "项待处理")).firstMatch.waitForExistence(timeout: 8))
        app.buttons["任务"].tap()
        capture("16-tasks-list")
        checkTaskFilters()
        if openCell(at: 1) {
            capture("17-task-detail")
            XCTAssertTrue(app.staticTexts["详细信息"].waitForExistence(timeout: 8))
            checkTaskEditor()
            app.swipeUp()
            checkTaskConversation()
        }

        relaunch()
        openTab("进展")

        tapIfExists("项目")
        capture("19-projects-list")
        XCTAssertTrue(app.segmentedControls.buttons["已归档"].exists)
        if openCell(at: 1) {
            capture("20-project-detail")
            XCTAssertTrue(app.buttons["新建项目对话"].waitForExistence(timeout: 5))
            let sections = app.segmentedControls.firstMatch
            for section in ["概览", "对话", "任务", "笔记", "自动化"] {
                XCTAssertTrue(sections.buttons[section].exists, "Missing project section: \(section)")
            }
            for section in ["对话", "任务", "笔记", "自动化"] {
                sections.buttons[section].tap()
                capture("21-project-\(section)")
            }
            checkProjectCreationForms(in: sections)
            sections.buttons["对话"].tap()
            app.buttons["新建项目对话"].tap()
            XCTAssertTrue(app.buttons["添加附件或引用"].waitForExistence(timeout: 8))
            capture("21-project-new-conversation")
            relaunch()
            openTab("进展")
        }

        tapIfExists("自动化")
        capture("22-automations-list")
        XCTAssertTrue(app.buttons["automation-filter-paused"].exists)
        checkAutomationCreation()
        if openCell(at: 1) {
            capture("23-automation-detail")
            XCTAssertTrue(app.staticTexts["最近运行"].waitForExistence(timeout: 8))
        }
    }

    private func checkProjectCreationForms(in sections: XCUIElement) {
        for (section, action, formTitle) in [
            ("任务", "新建项目任务", "新建项目任务"),
            ("笔记", "新建项目笔记", "新建笔记"),
            ("自动化", "新建项目自动化", "新建自动化")
        ] {
            sections.buttons[section].tap()
            let create = app.buttons[action]
            XCTAssertTrue(create.waitForExistence(timeout: 5), "Missing project action: \(action)")
            create.tap()
            XCTAssertTrue(app.navigationBars[formTitle].waitForExistence(timeout: 5))
            capture("21-project-create-\(section)")
            app.buttons["取消"].tap()
        }
    }

    private func checkTaskEditor() {
        app.buttons["编辑"].tap()
        XCTAssertTrue(app.navigationBars["编辑任务"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["优先级"].exists)
        capture("17-task-edit")
        app.buttons["取消"].tap()
    }

    private func checkTaskConversation() {
        let taskConversation = app.buttons["打开任务对话"]
        if taskConversation.waitForExistence(timeout: 8) {
            taskConversation.tap()
            capture("18-task-conversation")
        } else {
            navigateBack()
        }
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
        app.buttons["文字笔记"].tap()
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
        app.buttons["新建笔记"].tap()
        app.buttons["语音笔记"].tap()
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
    func testProfileSettingsGatewayAndFilesJourneys() {
        openTab("我的")
        capture("24-profile")

        app.swipeUp()
        app.buttons["应用设置"].tap()
        capture("25-settings")
        app.buttons["语言"].tap()
        capture("28-language")
        tapPickerOption("English")
        XCTAssertTrue(app.buttons["Simplified Chinese"].waitForExistence(timeout: 5))
        tapPickerOption("Simplified Chinese")
        XCTAssertTrue(app.buttons["English"].waitForExistence(timeout: 5))
        navigateBack()
        app.buttons["主题"].tap()
        capture("29-theme")
        navigateBack()
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
        openTab("我的")
        app.swipeUp()
        app.buttons["Gateway 管理"].tap()
        capture("26-gateway-management")
        let details = app.buttons["详情"].firstMatch
        if details.waitForExistence(timeout: 5) {
            details.tap()
            capture("27-gateway-detail")
        }
    }

    func testFileTransferControlsWithoutWritingUserFiles() {
        openTab("我的")
        app.swipeUp()
        app.buttons["文件"].tap()
        XCTAssertTrue(app.buttons["刷新"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["上传"].waitForExistence(timeout: 8))
        app.buttons["上传"].tap()
        XCTAssertTrue(app.buttons["取消"].waitForExistence(timeout: 8))
        capture("32-file-upload-picker")
        app.buttons["取消"].tap()

        app.swipeDown()
        let searchField = app.searchFields.firstMatch
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("README.md\n")
        let readme = app.cells.containing(.staticText, identifier: "README.md").firstMatch
        XCTAssertTrue(readme.waitForExistence(timeout: 8))
        readme.tap()
        XCTAssertTrue(app.buttons["下载"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["刷新"].exists)
        capture("35-file-transfer-controls")
        app.buttons["下载"].tap()
        XCTAssertTrue(app.buttons["关闭"].waitForExistence(timeout: 10))
        capture("35-file-share-sheet")
        app.buttons["关闭"].tap()
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
        openTab("我的")
        app.swipeUp()
        app.buttons["文件"].tap()
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

        openTab("我的")
        app.swipeUp()
        app.buttons["文件"].tap()
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

        openTab("我的")
        app.swipeUp()
        app.buttons["文件"].tap()
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
        XCTAssertTrue(app.buttons["home-tab-profile"].waitForExistence(timeout: 10))
        openTab("我的")
        app.swipeUp()
        app.buttons["文件"].tap()
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
        XCTAssertTrue(app.buttons["home-tab-notes"].waitForExistence(timeout: 10))
        openTab("笔记")
        app.buttons["新建笔记"].tap()
        app.buttons["文字笔记"].tap()
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
        let tab = ["助手": "assistant", "对话": "conversations", "进展": "progress", "笔记": "notes", "我的": "profile"][label] ?? label
        let button = app.buttons["home-tab-\(tab)"]
        XCTAssertTrue(button.waitForExistence(timeout: 5), "Missing tab: \(label)")
        button.tap()
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
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 10))
    }

    private func checkAutomationCreation() {
        app.buttons["新建自动化"].tap()
        XCTAssertTrue(app.textFields["Cron 表达式"].waitForExistence(timeout: 5))
        app.buttons["取消"].tap()
    }

    private func checkTaskFilters() {
        XCTAssertTrue(app.segmentedControls.buttons["已关闭"].exists)
        app.segmentedControls.buttons["已关闭"].tap()
        app.segmentedControls.buttons["进行中"].tap()
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
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 10))
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
