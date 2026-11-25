import XCTest

@MainActor
final class ProjectComparisonUITests: XCTestCase {
    func testProjectComparisonThroughGateway() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        guard let base = environment["XOPC_COMPARISON_GATEWAY"],
              let token = environment["XOPC_COMPARISON_TOKEN"],
              let conversationId = environment["XOPC_COMPARISON_CONVERSATION"],
              let legacyConversationId = environment["XOPC_COMPARISON_LEGACY_CONVERSATION"]
        else { throw XCTSkip("Requires scripts/verify-project-comparison-chat.mts --keep-gateway") }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = base
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        app.launch()
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

        openComparison(app, conversationId: legacyConversationId)
        let legacyAtlas = app.buttons["Inspect Atlas"].firstMatch
        XCTAssertTrue(legacyAtlas.waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["active · at risk"].exists)
        legacyAtlas.tap()
        XCTAssertTrue(selected.waitForExistence(timeout: 15))
        capture(app, name: "iOS legacy comparison action")
    }

    private func openComparison(_ app: XCUIApplication, conversationId: String) {
        let sidebar = app.buttons["chat-header-sidebar"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 10))
        sidebar.tap()
        let row = app.buttons["chat-sidebar-session-\(conversationId)"]
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
