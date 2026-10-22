import XCTest

@MainActor
final class LifeWorkModesUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = "synthetic-scene-fixture"
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = "http://127.0.0.1:18791"
        app.launch()
        XCTAssertTrue(app.buttons["home-mode-life"].waitForExistence(timeout: 10))
    }

    func testLifeKeepsConversationOnlyAndPreservesBothDrafts() {
        let composer = app.descendants(matching: .any)["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("work-scene-draft")
        app.buttons["home-mode-life"].tap()
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.buttons["chat-header-search"].exists)
        XCTAssertTrue(app.buttons["assistant-options"].exists)
        XCTAssertFalse(app.buttons["chat-agent-avatar"].exists, "Life avatar must not offer Agent switching")
        capture("life-mode")
        composer.tap()
        composer.typeText("life-scene-draft")
        app.buttons["home-mode-work"].tap()
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 10))
        XCTAssertEqual(composer.value as? String, "work-scene-draft")
        capture("work-mode-restored")
        app.buttons["home-mode-life"].tap()
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForNonExistence(timeout: 10))
        XCTAssertEqual(composer.value as? String, "life-scene-draft")
    }

    func testReturningToWorkRestoresConversationList() {
        app.buttons["home-tab-conversations"].tap()
        let personal = app.buttons["conversations-personal-agent-entry"]
        XCTAssertTrue(personal.waitForExistence(timeout: 10))
        personal.tap()
        XCTAssertTrue(app.buttons["home-mode-work"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["home-tab-conversations"].waitForNonExistence(timeout: 5))
        app.buttons["home-mode-work"].tap()
        XCTAssertTrue(personal.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["home-tab-conversations"].exists)
    }

    func testChatSwipeSwitchesScenesAndIgnoresVerticalAndShortDrags() {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.42))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.42))
        start.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.3)))
        XCTAssertTrue(app.buttons["home-tab-assistant"].exists)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.42))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.42)))
        XCTAssertTrue(app.buttons["home-tab-assistant"].exists)
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForNonExistence(timeout: 10))
        end.press(forDuration: 0.05, thenDragTo: start)
        XCTAssertTrue(app.buttons["home-tab-assistant"].waitForExistence(timeout: 10))
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
