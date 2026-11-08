import XCTest

/// Real native cards and production Gateway/tool execution; inference is controlled.
@MainActor final class ToolApprovalUITests: XCTestCase {
    private var app: XCUIApplication!
    private var gateway = ""
    private var lab = ""
    private var token = ""

    override func setUp() async throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        guard let gateway = environment["XOPC_APPROVAL_GATEWAY"],
              let lab = environment["XOPC_APPROVAL_LAB"],
              let token = environment["XOPC_APPROVAL_TOKEN"]
        else { throw XCTSkip("Requires scripts/verify-tool-approval-mobile.mts") }
        self.gateway = gateway; self.lab = lab; self.token = token
        app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launch()
        if !app.buttons["home-tab-conversations"].waitForExistence(timeout: 5) {
            let setup = try await request(lab, "/lab/pair", method: "POST")
            let link = try XCTUnwrap((setup["setup"] as? [String: Any])?["universalLink"] as? String)
            let paste = app.buttons["粘贴连接链接"]
            if paste.exists {
                paste.tap()
            }
            let field = app.descendants(matching: .any)["gateway-pairing-link"]
            XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText(link)
            app.buttons["连接 Gateway"].tap()
            XCTAssertTrue(app.buttons["home-tab-conversations"].waitForExistence(timeout: 35), "Real device pairing must complete before testing approvals")
        }
    }

    func testApproveExecutesOnce() async throws {
        try await verify("approve")
    }

    func testDenyDoesNotExecute() async throws {
        try await verify("deny")
    }

    func testTimeoutDoesNotExecute() async throws {
        try await verify("expire")
    }

    private func openConversation(_ phase: String) {
        let tab = app.buttons["home-tab-conversations"]
        XCTAssertTrue(tab.waitForExistence(timeout: 20)); tab.tap()
        let search = app.textFields["conversations-search-field"]
        XCTAssertTrue(search.waitForExistence(timeout: 10)); search.tap()
        if let value = search.value as? String, value != search.placeholderValue {
            search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        search.typeText("Approval ios_\(phase)")
        let conversation = app.staticTexts["Approval ios_\(phase)"].firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 15)); conversation.tap()
        XCTAssertTrue(app.descendants(matching: .any)["assistant-chat-composer"].waitForExistence(timeout: 10))
    }

    private func verify(_ phase: String) async throws {
        let key = "ios_\(phase)"
        _ = try await request(lab, "/lab/reset?phase=\(key)", method: "POST")
        openConversation(phase)
        let composer = app.descendants(matching: .any)["assistant-chat-composer"]
        composer.tap()
        if let value = composer.value as? String, value.contains("APPROVAL_MOBILE_") {
            composer.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        composer.typeText("APPROVAL_MOBILE_\(key): run the command.")
        app.buttons["assistant-chat-send"].tap()
        let approve = app.buttons["批准本次操作"]
        XCTAssertTrue(approve.waitForExistence(timeout: 30), "Actual tool request must show the native approval card")
        XCTAssertTrue(app.buttons["拒绝本次操作"].exists)
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "Approval must dismiss the composer keyboard")
        XCTAssertTrue(approve.isHittable, "Approval actions must be visible")
        XCTAssertTrue(app.staticTexts["需要你的批准"].firstMatch.isHittable, "Approval title must not be clipped above the viewport")
        try await Task.sleep(for: .seconds(1))
        let pending = try await state(key)
        XCTAssertEqual(pending["count"] as? Int, 0, "No execution before approval")
        capture("\(key)-pending")
        if phase == "expire" {
            try await verifyExpiry(key, phase: phase, approve: approve)
        } else {
            app.buttons[phase == "approve" ? "批准本次操作" : "拒绝本次操作"].tap()
            let deadline = Date().addingTimeInterval(35)
            var completed = false
            while Date() < deadline {
                let current = try await state(key)
                if phase == "approve" ? (current["count"] as? Int == 1) : ((current["wait"] as? [String: Any])?["approvalConsumedAt"] != nil) {
                    completed = true; break
                }
                try await Task.sleep(for: .milliseconds(250))
            }
            XCTAssertTrue(completed, "Decision must reach the real host execution gate")
        }
        try await Task.sleep(for: .seconds(1))
        let final = try await state(key)
        XCTAssertEqual(final["count"] as? Int, phase == "approve" ? 1 : 0)
        XCTAssertEqual((final["receipts"] as? [Any])?.count, phase == "approve" ? 1 : 0)
        capture("\(key)-completed")
    }

    private func verifyExpiry(_ key: String, phase: String, approve: XCUIElement) async throws {
        let expiredState = try await request(lab, "/lab/expire?phase=\(key)", method: "POST")
        let wait = try XCTUnwrap(expiredState["wait"] as? [String: Any])
        app.terminate(); app.launch(); openConversation(phase)
        let expiresAt = try XCTUnwrap(wait["expiresAt"] as? Double)
        while Date().timeIntervalSince1970 * 1000 <= expiresAt + 1000 {
            try await Task.sleep(for: .milliseconds(250))
        }
        let deadline = Date().addingTimeInterval(25)
        while approve.exists, approve.isEnabled, Date() < deadline {
            try await Task.sleep(for: .milliseconds(250))
        }
        XCTAssertTrue(!approve.exists || !approve.isEnabled, "An expired approval must not remain actionable")
        let id = try XCTUnwrap(wait["id"] as? String)
        var late = try URLRequest(url: XCTUnwrap(URL(string: gateway + "/api/clarifications/\(id)/responses")))
        late.httpMethod = "POST"; late.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        late.setValue("application/json", forHTTPHeaderField: "Content-Type")
        late.httpBody = try JSONSerialization.data(withJSONObject: ["action": "answer", "decision": "approve", "expectedVersion": wait["version"]!, "idempotencyKey": UUID().uuidString])
        let (_, response) = try await URLSession.shared.data(for: late)
        XCTAssertTrue([409, 410].contains((response as? HTTPURLResponse)?.statusCode ?? 0), "Server must also reject late approval")
    }

    private func state(_ phase: String) async throws -> [String: Any] {
        try await request(lab, "/lab/state?phase=\(phase)")
    }

    private func request(_ base: String, _ path: String, method: String = "GET") async throws -> [String: Any] {
        var request = try URLRequest(url: XCTUnwrap(URL(string: base + path)))
        request.httpMethod = method; request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func capture(_ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
