import XCTest

@MainActor
final class ProjectTaskRoundTripUITests: XCTestCase {
    private var app: XCUIApplication!
    private var createdTitle: String?
    private var createdNoteTitle: String?
    private var createdAutomationName: String?
    private var startedAtMs: Int64 = 0
    private var gatewayToken: String?

    override func setUp() async throws {
        continueAfterFailure = false
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("A Gateway token is required for automatic test task cleanup")
        }
        gatewayToken = token
        startedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = "http://127.0.0.1:18790"
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-progress"].waitForExistence(timeout: 10))
    }

    func testProjectTaskCreateAndEditRoundTrip() {
        let title = "xopc-ios-parity-e2e-\(UUID().uuidString.lowercased())"
        createdTitle = title
        app.buttons["home-tab-progress"].tap()
        app.buttons["项目"].tap()
        let project = app.cells.element(boundBy: 1)
        XCTAssertTrue(project.waitForExistence(timeout: 10))
        project.tap()
        app.segmentedControls.firstMatch.buttons["任务"].tap()
        app.buttons["新建项目任务"].tap()
        let objective = app.textFields["描述需要完成的事项"]
        XCTAssertTrue(objective.waitForExistence(timeout: 5))
        objective.tap()
        objective.typeText(title)
        app.buttons["保存"].tap()

        let created = app.staticTexts[title].firstMatch
        XCTAssertTrue(created.waitForExistence(timeout: 15))
        created.tap()
        XCTAssertTrue(app.staticTexts[title].firstMatch.waitForExistence(timeout: 5))
        app.buttons["编辑"].tap()
        XCTAssertTrue(app.navigationBars["编辑任务"].waitForExistence(timeout: 5))
        let description = app.textFields["任务说明"]
        XCTAssertTrue(description.waitForExistence(timeout: 5))
        description.tap()
        description.typeText("iOS parity task edit verified")
        app.buttons["保存"].tap()
        XCTAssertTrue(app.staticTexts["iOS parity task edit verified"].waitForExistence(timeout: 12))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "17-task-create-edit-result"
        attachment.lifetime = .keepAlways
        add(attachment)

        XCTAssertTrue(app.navigationBars["编辑任务"].waitForNonExistence(timeout: 10))
        app.collectionViews.firstMatch.swipeUp()
        let close = app.buttons["关闭任务"].firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertTrue(close.isHittable, app.debugDescription)
        close.tap()
        let confirmClose = app.sheets.buttons["关闭任务"]
        XCTAssertTrue(confirmClose.waitForExistence(timeout: 5), app.debugDescription)
        confirmClose.tap()
        let reopen = app.buttons["重新打开"].firstMatch
        XCTAssertTrue(reopen.waitForExistence(timeout: 12))
        reopen.tap()
        XCTAssertTrue(app.buttons["关闭任务"].firstMatch.waitForExistence(timeout: 12))
    }

    func testProjectNoteCreateAndOpenRoundTrip() {
        let title = "xopc-ios-project-note-e2e-\(UUID().uuidString.lowercased())"
        createdNoteTitle = title
        app.buttons["home-tab-progress"].tap()
        app.buttons["项目"].tap()
        let project = app.cells.element(boundBy: 1)
        XCTAssertTrue(project.waitForExistence(timeout: 10))
        project.tap()
        app.segmentedControls.firstMatch.buttons["笔记"].tap()
        app.buttons["新建项目笔记"].tap()
        XCTAssertTrue(app.navigationBars["新建笔记"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["note-markdown-toolbar"].exists)
        XCTAssertTrue(app.buttons["添加附件"].exists)
        XCTAssertTrue(app.buttons["完成"].exists)
        let editorAttachment = XCTAttachment(screenshot: app.screenshot())
        editorAttachment.name = "34-project-note-editor"
        editorAttachment.lifetime = .keepAlways
        add(editorAttachment)
        let titleField = app.textFields["标题"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 5))
        titleField.tap()
        titleField.typeText(title)
        let body = app.textViews["笔记正文"]
        XCTAssertTrue(body.waitForExistence(timeout: 5))
        body.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        body.typeText("iOS")
        XCTAssertEqual(body.value as? String, "iOS")
        body.typeText(" project")
        XCTAssertEqual(body.value as? String, "iOS project")
        body.typeText(" note persistence verified")
        XCTAssertEqual(body.value as? String, "iOS project note persistence verified")
        app.buttons["完成"].tap()

        let created = app.staticTexts[title].firstMatch
        XCTAssertTrue(created.waitForExistence(timeout: 15))
        created.tap()
        XCTAssertTrue(app.staticTexts["iOS project note persistence verified"].waitForExistence(timeout: 10))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "21-project-note-create-result"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testProjectAutomationCreatedPaused() async throws {
        let name = "xopc-ios-project-automation-e2e-\(UUID().uuidString.lowercased())"
        let instructionText = String(repeating: "iOS parity instruction; do not execute or change data. ", count: 10)
        createdAutomationName = name
        app.buttons["home-tab-progress"].tap()
        app.buttons["项目"].tap()
        let project = app.cells.element(boundBy: 1)
        XCTAssertTrue(project.waitForExistence(timeout: 10))
        project.tap()
        app.segmentedControls.firstMatch.buttons["自动化"].tap()
        app.buttons["新建项目自动化"].tap()
        XCTAssertTrue(app.navigationBars["新建自动化"].waitForExistence(timeout: 5))
        let nameField = app.textFields["名称"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 5))
        nameField.tap()
        nameField.typeText(name)
        let instruction = app.textFields["automation-instruction"]
        XCTAssertTrue(instruction.waitForExistence(timeout: 5))
        instruction.tap()
        instruction.typeText(instructionText)
        let cron = app.textFields["Cron 表达式"]
        XCTAssertTrue(cron.waitForExistence(timeout: 5))
        cron.tap()
        cron.typeText("0 0 1 1 *")
        let enabled = app.switches["创建后启用"]
        XCTAssertTrue(enabled.waitForExistence(timeout: 5))
        enabled.switches.firstMatch.tap()
        XCTAssertEqual(enabled.value as? String, "0", app.debugDescription)
        app.buttons["保存"].tap()

        let created = app.staticTexts[name].firstMatch
        XCTAssertTrue(created.waitForExistence(timeout: 15))
        created.tap()
        XCTAssertTrue(app.buttons["启用"].waitForExistence(timeout: 10))
        let plan = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "0 0 1 1 *")).firstMatch
        XCTAssertTrue(plan.exists, app.debugDescription)
        verifyAutomationDefinitionExpansion()
        app.buttons["编辑自动化"].tap()
        XCTAssertTrue(app.navigationBars["编辑自动化"].waitForExistence(timeout: 5))
        let updatedInstruction = app.textFields["automation-instruction"]
        XCTAssertTrue(updatedInstruction.waitForExistence(timeout: 5))
        updatedInstruction.tap()
        updatedInstruction.typeText(" edited")
        app.buttons["保存"].tap()
        let edited = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "edited")).firstMatch
        XCTAssertTrue(edited.waitForExistence(timeout: 12))
        XCTAssertTrue(app.buttons["启用"].exists)
        let token = try XCTUnwrap(gatewayToken)
        try await verifyPauseResume(name: name, token: token)
        captureAutomationScreenshot("23-project-automation-paused-result")
    }

    private func verifyAutomationDefinitionExpansion() {
        let definition = app.staticTexts["automation-definition-body"]
        XCTAssertTrue(definition.waitForExistence(timeout: 5))
        let collapsedHeight = definition.frame.height
        captureAutomationScreenshot("23-automation-definition-collapsed")
        let definitionToggle = app.buttons["automation-definition-toggle"]
        XCTAssertTrue(definitionToggle.waitForExistence(timeout: 5))
        definitionToggle.tap()
        XCTAssertTrue(app.buttons["收起完整内容"].waitForExistence(timeout: 5))
        XCTAssertGreaterThan(definition.frame.height, collapsedHeight)
        captureAutomationScreenshot("23-automation-definition-expanded")
        definitionToggle.tap()
        XCTAssertTrue(app.buttons["展开完整内容"].waitForExistence(timeout: 5))
    }

    private func captureAutomationScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func verifyPauseResume(name: String, token: String) async throws {
        let initiallyPaused = try await automationByName(name, token: token)?["enabled"] as? Bool
        XCTAssertEqual(initiallyPaused, false)
        app.buttons["启用"].tap()
        XCTAssertTrue(app.buttons["暂停"].waitForExistence(timeout: 12))
        let resumed = try await automationByName(name, token: token)?["enabled"] as? Bool
        XCTAssertEqual(resumed, true)
        app.buttons["暂停"].tap()
        XCTAssertTrue(app.buttons["启用"].waitForExistence(timeout: 12))
        let pausedAgain = try await automationByName(name, token: token)?["enabled"] as? Bool
        XCTAssertEqual(pausedAgain, false)
    }

    override func tearDown() async throws {
        defer { app = nil }
        guard let token = gatewayToken else { return }
        if let title = createdTitle {
            try await deleteCreatedTask(title: title, token: token)
        }
        if let title = createdNoteTitle {
            try await deleteCreatedNote(title: title, token: token)
        }
        if let name = createdAutomationName {
            try await deleteCreatedAutomation(name: name, token: token)
        }
    }

    private func deleteCreatedTask(title: String, token: String) async throws {
        var components = URLComponents(string: "http://127.0.0.1:18790/api/tasks")!
        components.queryItems = [URLQueryItem(name: "search", value: title), URLQueryItem(name: "limit", value: "200")]
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let page = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let items = page["items"] as? [[String: Any]] ?? []
        let matches = items.compactMap { $0["task"] as? [String: Any] }.filter {
            ($0["title"] as? String) == title &&
                (($0["createdAt"] as? NSNumber)?.int64Value ?? 0) >= startedAtMs
        }
        XCTAssertLessThanOrEqual(matches.count, 1)
        for task in matches {
            let id = try XCTUnwrap(task["id"] as? String)
            var delete = URLRequest(url: URL(string: "http://127.0.0.1:18790/api/tasks/\(id)")!)
            delete.httpMethod = "DELETE"
            delete.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (deletedData, deletedResponse) = try await URLSession.shared.data(for: delete)
            let result = try XCTUnwrap(JSONSerialization.jsonObject(with: deletedData) as? [String: Any])
            XCTAssertEqual((deletedResponse as? HTTPURLResponse)?.statusCode, 200)
            XCTAssertEqual(result["deleted"] as? Bool, true)
        }
    }

    private func deleteCreatedNote(title: String, token: String) async throws {
        var components = URLComponents(string: "http://127.0.0.1:18790/api/notes")!
        components.queryItems = [URLQueryItem(name: "search", value: title), URLQueryItem(name: "limit", value: "100")]
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let page = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matches = (page["items"] as? [[String: Any]] ?? []).filter {
            ($0["title"] as? String) == title &&
                (($0["createdAt"] as? NSNumber)?.int64Value ?? 0) >= startedAtMs
        }
        XCTAssertLessThanOrEqual(matches.count, 1)
        for note in matches {
            let id = try XCTUnwrap(note["id"] as? String)
            var delete = URLRequest(url: URL(string: "http://127.0.0.1:18790/api/notes/\(id)")!)
            delete.httpMethod = "DELETE"
            delete.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (_, deletedResponse) = try await URLSession.shared.data(for: delete)
            XCTAssertEqual((deletedResponse as? HTTPURLResponse)?.statusCode, 200)
        }
    }
}

private extension ProjectTaskRoundTripUITests {
    func deleteCreatedAutomation(name: String, token: String) async throws {
        let matches = try await automationsByName(name, token: token)
        XCTAssertLessThanOrEqual(matches.count, 1)
        for automation in matches {
            let id = try XCTUnwrap(automation["id"] as? String)
            if automation["enabled"] as? Bool == true {
                let revision = try XCTUnwrap(automation["updatedAtMs"] as? NSNumber).int64Value
                var pause = URLRequest(url: URL(string: "http://127.0.0.1:18790/api/automations/\(id)/pause")!)
                pause.httpMethod = "POST"
                pause.httpBody = try JSONSerialization.data(withJSONObject: ["expectedRevision": revision])
                pause.setValue("application/json", forHTTPHeaderField: "Content-Type")
                pause.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                let (_, pausedResponse) = try await URLSession.shared.data(for: pause)
                XCTAssertEqual((pausedResponse as? HTTPURLResponse)?.statusCode, 200)
            }
            var delete = URLRequest(url: URL(string: "http://127.0.0.1:18790/api/automations/\(id)")!)
            delete.httpMethod = "DELETE"
            delete.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (_, deletedResponse) = try await URLSession.shared.data(for: delete)
            XCTAssertEqual((deletedResponse as? HTTPURLResponse)?.statusCode, 200)
        }
    }

    func automationByName(_ name: String, token: String) async throws -> [String: Any]? {
        try await automationsByName(name, token: token).first
    }

    func automationsByName(_ name: String, token: String) async throws -> [[String: Any]] {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:18790/api/automations")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let page = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return (page["automations"] as? [[String: Any]] ?? []).filter {
            ($0["name"] as? String) == name &&
                (($0["createdAtMs"] as? NSNumber)?.int64Value ?? 0) >= startedAtMs
        }
    }
}
