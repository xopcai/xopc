import XCTest

@MainActor
final class LiveExecutionUITests: XCTestCase {
    private struct ExecutionRetryCopy {
        let newChat: String
        let more: String
        let messageDetail: String
        let execution: String
        let unavailable: String
        let retry: String
        let empty: String
        let screenshotSuffix: String

        static let chinese = ExecutionRetryCopy(
            newChat: "新对话", more: "更多", messageDetail: "消息详情", execution: "执行过程",
            unavailable: "暂时无法读取执行过程", retry: "重试", empty: "暂无执行步骤", screenshotSuffix: "zh"
        )
        static let english = ExecutionRetryCopy(
            newChat: "New Chat", more: "More", messageDetail: "Message Details", execution: "Execution",
            unavailable: "Execution Steps Unavailable", retry: "Retry", empty: "No Execution Steps", screenshotSuffix: "en"
        )
    }

    private enum CleanupError: Error {
        case unexpectedSessionCount(Int)
        case invalidResponse
        case httpStatus(Int)
        case deleteFailed
    }

    private var app: XCUIApplication!
    private var token = ""
    private var marker: String?

    override func setUp() async throws {
        continueAfterFailure = false
        guard let value = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"], !value.isEmpty else {
            throw XCTSkip("A Gateway token is required for temporary conversation cleanup")
        }
        token = value
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_PROXY_URL"]
            ?? "http://127.0.0.1:18790"
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = value
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 10))
    }

    func testLiveExecutionOpensAndSettles() async throws {
        let marker = "iOS-live-execution-\(UUID().uuidString.prefix(8))"
        self.marker = marker
        app.buttons["新对话"].tap()
        let composer = app.descendants(matching: .any)["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText(
            "\(marker) Search official SwiftUI, Swift Testing and AVAudioEngine docs separately. Summarize briefly."
        )
        app.buttons["发送"].tap()

        let activity = app.buttons["assistant-execution-activity"]
        XCTAssertTrue(activity.waitForExistence(timeout: 15), "A running reply needs an execution entry")
        let deadline = Date().addingTimeInterval(15)
        while !activity.isEnabled, Date() < deadline {
            try await Task.sleep(for: .milliseconds(200))
        }
        XCTAssertTrue(activity.isEnabled, "Execution detail should become actionable when the run starts")
        activity.tap()
        capture("live-execution-after-tap")
        guard app.navigationBars["执行过程"].waitForExistence(timeout: 5) else {
            XCTFail("The execution sheet did not open")
            return
        }
        XCTAssertTrue(
            app.staticTexts["执行中"].waitForExistence(timeout: 8)
                || app.staticTexts["助手正在执行，步骤出现后会自动更新"].exists
        )
        capture("live-execution-open")

        let tool = app.buttons.matching(NSPredicate(
            format: "label CONTAINS %@ OR label CONTAINS %@",
            "打开网页",
            "搜索网页"
        )).firstMatch
        guard tool.waitForExistence(timeout: 60) else {
            XCTFail("Search steps should appear while the run progresses")
            return
        }
        tool.tap()
        capture("live-execution-step")
        XCTAssertTrue(app.staticTexts["已完成"].waitForExistence(timeout: 100))
        capture("live-execution-finished")
        app.buttons["完成"].tap()
    }

    func testQuickComposerStartsAndSendsConversation() {
        let marker = "iOS-quick-dock-\(UUID().uuidString.prefix(8))"
        self.marker = marker
        app.buttons["home-tab-conversations"].tap()
        let quickInput = app.descendants(matching: .any)["home-quick-composer"]
        XCTAssertTrue(quickInput.waitForExistence(timeout: 5))
        quickInput.tap()
        quickInput.typeText(marker)
        app.buttons["发送快捷消息"].tap()
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[marker].waitForExistence(timeout: 12))
        XCTAssertTrue(app.buttons["添加附件或引用"].waitForExistence(timeout: 5))
        capture("quick-dock-sent")
    }

    func testCompletedExecutionDetailRecoversAfterGatewayFailure() async throws {
        try await runExecutionRetryJourney(copy: .chinese)
    }

    func testEnglishExecutionDetailRecoversAfterGatewayFailure() async throws {
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "english"
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 10))
        try await runExecutionRetryJourney(copy: .english)
    }

    private func runExecutionRetryJourney(copy: ExecutionRetryCopy) async throws {
        guard ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_PROXY_URL"] != nil else {
            throw XCTSkip("A one-shot execution-detail fault proxy is required")
        }
        let marker = "iOS-execution-retry-\(UUID().uuidString.prefix(8))"
        self.marker = marker
        app.buttons[copy.newChat].tap()
        let composer = app.descendants(matching: .any)["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("\(marker) Reply with exactly: retry-ready")
        let sendButton = app.buttons["assistant-chat-send"]
        XCTAssertTrue(sendButton.waitForExistence(timeout: 5))
        sendButton.tap()
        XCTAssertTrue(app.staticTexts["retry-ready"].waitForExistence(timeout: 60))

        let moreButtons = app.buttons.matching(identifier: copy.more)
        XCTAssertGreaterThan(moreButtons.count, 0)
        let more = moreButtons.element(boundBy: moreButtons.count - 1)
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        let detail = app.buttons.matching(NSPredicate(format: "label == %@", copy.messageDetail)).firstMatch
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        detail.tap()
        XCTAssertTrue(app.navigationBars[copy.messageDetail].waitForExistence(timeout: 5))
        app.buttons[copy.execution].tap()
        XCTAssertTrue(app.navigationBars[copy.execution].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[copy.unavailable].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons[copy.retry].exists)
        capture("execution-detail-failure-\(copy.screenshotSuffix)")

        try await releaseExecutionProxy()
        app.buttons[copy.retry].tap()
        XCTAssertTrue(app.staticTexts[copy.empty].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts[copy.unavailable].exists)
        capture("execution-detail-recovered-\(copy.screenshotSuffix)")
    }

    override func tearDown() async throws {
        defer { app = nil }
        guard let marker else { return }
        let matches = try await matchingSessions(marker: marker)
        guard matches.count == 1, let id = matches.first else {
            throw CleanupError.unexpectedSessionCount(matches.count)
        }
        let run = try await request(path: "/api/sessions/\(id)/run")
        if let payload = run["payload"] as? [String: Any],
           payload["active"] as? Bool == true,
           let runID = payload["runId"] as? String
        {
            _ = try await request(path: "/api/agent/abort", method: "POST", body: ["runId": runID])
        }
        let deleted = try await request(path: "/api/sessions/\(id)", method: "DELETE")
        guard deleted["deleted"] as? Bool == true else { throw CleanupError.deleteFailed }
        let remaining = try await matchingSessions(marker: marker)
        guard remaining.isEmpty else { throw CleanupError.deleteFailed }
    }

    private func matchingSessions(marker: String) async throws -> [String] {
        let query = marker.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? marker
        let page = try await request(path: "/api/sessions?search=\(query)&limit=100")
        var matches: [String] = []
        for item in page["items"] as? [[String: Any]] ?? [] {
            guard let id = item["key"] as? String else { continue }
            let history = try await request(path: "/api/sessions/\(id)/history?limit=20")
            let session = history["session"] as? [String: Any]
            let messages = session?["messages"] as? [[String: Any]] ?? []
            if messages.contains(where: { message in
                message["role"] as? String == "user" && (message["content"] as? String)?.hasPrefix(marker) == true
            }) {
                matches.append(id)
            }
        }
        return matches
    }

    private func request(path: String, method: String = "GET", body: [String: String]? = nil) async throws -> [String: Any] {
        guard let url = URL(string: "http://127.0.0.1:18790\(path)") else { throw CleanupError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else { throw CleanupError.httpStatus(status) }
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CleanupError.invalidResponse
        }
        return result
    }

    private func releaseExecutionProxy() async throws {
        guard let rawURL = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_PROXY_URL"],
              let url = URL(string: rawURL)?.appending(path: "__release-execution")
        else { throw CleanupError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 204 else { throw CleanupError.invalidResponse }
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
