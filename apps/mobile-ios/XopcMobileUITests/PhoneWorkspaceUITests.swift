import XCTest

/// Runs against the dedicated Settings-only Phone Use acceptance conversation.
@MainActor final class PhoneWorkspaceUITests: XCTestCase {
    func testLivePhoneWorkspaceAndSingleControlAction() throws {
        let app = try launchAcceptanceApp()
        XCTAssertTrue(app.buttons["home-tab-conversations"].waitForExistence(timeout: 15))
        app.buttons["home-tab-conversations"].tap()
        let search = app.textFields["conversations-search-field"]
        XCTAssertTrue(search.waitForExistence(timeout: 10)); search.tap(); search.typeText("鸿蒙 Phone Use 真机验证")
        let conversation = app.staticTexts["鸿蒙 Phone Use 真机验证 · 2026-10-25"].firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 15)); conversation.tap()
        let entry = app.buttons["chat-header-phone"]
        XCTAssertTrue(entry.waitForExistence(timeout: 20))
        let composer = app.textFields["assistant-chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap(); composer.typeText("xopc-local-unsent")
        entry.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "Opening the phone must dismiss the chat keyboard")
        let control = app.buttons["phone-control"]
        XCTAssertTrue(control.waitForExistence(timeout: 20))
        XCTAssertTrue(app.descendants(matching: .any)["phone-video-live"].waitForExistence(timeout: 25), "Live H.264 must render before acceptance")
        XCTAssertEqual(app.buttons.matching(identifier: "phone-control").count, 1)
        control.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier == %@ AND (label == %@ OR label == %@)", "phone-control", "完成，继续任务", "结束手动操作")).firstMatch.waitForExistence(timeout: 15))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "ios-phone-single-control-live"; screenshot.lifetime = .keepAlways; add(screenshot)
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier == %@ AND (label == %@ OR label == %@)", "phone-control", "完成，继续任务", "结束手动操作")).firstMatch.exists, "A cloud-phone swipe must not page to chat")
        app.buttons["phone-return"].tap()
        XCTAssertTrue(entry.waitForExistence(timeout: 5)); entry.tap()
        XCTAssertTrue(control.waitForExistence(timeout: 15))
        XCTAssertTrue(control.label == "继续任务" || control.label == "接管手机" || control.label == "手动操作")
        control.tap()
        XCTAssertTrue(app.descendants(matching: .any)["phone-video-live"].exists)
        app.buttons["phone-more"].tap()
        app.buttons["输入文字"].tap()
        let text = app.textFields["phone-text-input"]
        XCTAssertTrue(text.waitForExistence(timeout: 5)); text.tap(); text.typeText("xopc-local-draft")
        app.buttons["取消"].tap()
        XCTAssertFalse(text.exists)
        app.buttons["phone-more"].tap(); app.buttons["结束控制，保持暂停"].tap()
        XCTAssertTrue(control.waitForExistence(timeout: 15))
        app.buttons["phone-more"].tap(); app.buttons["停止任务"].tap()
        XCTAssertTrue(app.buttons["取消"].waitForExistence(timeout: 5)); app.buttons["取消"].tap()
        let rightStart = app.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5))
        rightStart.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
        XCTAssertTrue(entry.waitForExistence(timeout: 5))
        XCTAssertTrue(composer.exists)
        XCTAssertEqual(composer.value as? String, "xopc-local-unsent")
        composer.tap(); composer.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "xopc-local-unsent".count))
    }

    private func launchAcceptanceApp() throws -> XCUIApplication {
        continueAfterFailure = false
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("Requires a local acceptance Gateway and the dedicated test conversation")
        }
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = "http://127.0.0.1:18790"
        app.launch()
        return app
    }
}
