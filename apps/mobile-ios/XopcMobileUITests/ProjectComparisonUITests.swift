import XCTest

@MainActor
final class ProjectComparisonUITests: XCTestCase {
    func testProjectComparisonThroughGateway() async throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        guard let base = environment["XOPC_COMPARISON_GATEWAY"],
              let token = environment["XOPC_COMPARISON_TOKEN"],
              let conversationId = environment["XOPC_COMPARISON_CONVERSATION"]
        else { throw XCTSkip("Requires scripts/verify-project-comparison-chat.mts --keep-gateway") }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launch()
        if !app.buttons["chat-header-sidebar"].waitForExistence(timeout: 3) {
            try await pair(app, base: base, token: token)
        }
        openComparison(app, conversationId: conversationId)
        let atlas = app.buttons["Inspect Atlas"].firstMatch
        XCTAssertTrue(atlas.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["active · at risk"].exists)
        capture(app, name: "iOS comparison initial")
        atlas.tap()
        let selected = app.staticTexts["Selected Atlas · active · on track · Infrastructure migration"].firstMatch
        XCTAssertTrue(selected.waitForExistence(timeout: 15))
        capture(app, name: "iOS comparison action")
        app.buttons["chat-header-sidebar"].tap()
        app.buttons["chat-sidebar-personal"].tap()
        XCTAssertTrue(selected.waitForNonExistence(timeout: 10))
        openComparison(app, conversationId: conversationId)
        XCTAssertTrue(selected.waitForExistence(timeout: 10))
        let orbit = app.buttons["Inspect Orbit"].firstMatch
        XCTAssertTrue(orbit.waitForExistence(timeout: 5))
        orbit.tap()
        XCTAssertTrue(app.staticTexts["Selected Orbit · active · on track · Design rollout"].firstMatch.waitForExistence(timeout: 10))
        capture(app, name: "iOS comparison restored")
    }

    private func openComparison(_ app: XCUIApplication, conversationId: String) {
        let sidebar = app.buttons["chat-header-sidebar"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 10))
        sidebar.tap()
        let row = app.buttons["chat-sidebar-session-\(conversationId)"]
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
    }

    private func pair(_ app: XCUIApplication, base: String, token: String) async throws {
        let setup = try await request(base, token, "/api/device-pairing/setups", body: ["targetKind": "mobile"])
        let data = try XCTUnwrap(setup["setup"] as? [String: Any])
        let id = try XCTUnwrap(data["id"] as? String)
        let link = try XCTUnwrap(data["universalLink"] as? String)
        let paste = app.buttons["粘贴连接链接"]
        if paste.waitForExistence(timeout: 5) {
            paste.tap()
        }
        let field = app.descendants(matching: .any)["gateway-pairing-link"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(link)
        app.buttons["连接 Gateway"].tap()
        for _ in 0 ..< 25 {
            let status = try await request(base, token, "/api/device-pairing/setups/\(id)")
            if let pending = status["request"] as? [String: Any],
               let requestId = pending["requestId"] as? String, let revision = pending["revision"] as? Int
            {
                _ = try await request(base, token, "/api/device-pairing/requests/\(requestId)/decision",
                                      body: ["decision": "approve", "expectedRevision": revision])
                XCTAssertTrue(app.buttons["chat-header-sidebar"].waitForExistence(timeout: 25))
                return
            }
            try await Task.sleep(for: .seconds(1))
        }
        XCTFail("The iOS app did not request pairing from the isolated Gateway")
    }

    private func request(_ base: String, _ token: String, _ path: String,
                         body: [String: Any]? = nil) async throws -> [String: Any]
    {
        var request = try URLRequest(url: XCTUnwrap(URL(string: base + path)))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertTrue((200 ..< 300).contains((response as? HTTPURLResponse)?.statusCode ?? 0))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
