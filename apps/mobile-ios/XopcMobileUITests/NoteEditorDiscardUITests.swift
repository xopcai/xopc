import XCTest

@MainActor
final class NoteEditorDiscardUITests: XCTestCase {
    func testNoteEditorConfirmsDiscardOfUnsavedText() throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("A Gateway token is required for the connected UI test")
        }
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["XOPC_UI_TEST_LANGUAGE"] = "chinese"
        app.launchEnvironment["XOPC_E2E_GATEWAY_URL"] = "http://127.0.0.1:18790"
        app.launchEnvironment["XOPC_E2E_GATEWAY_TOKEN"] = token
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-progress"].waitForExistence(timeout: 10))
        app.buttons["home-tab-progress"].tap()
        app.buttons["项目"].tap()
        let project = app.cells.element(boundBy: 1)
        XCTAssertTrue(project.waitForExistence(timeout: 10))
        project.tap()
        app.segmentedControls.firstMatch.buttons["笔记"].tap()
        app.buttons["新建项目笔记"].tap()
        XCTAssertTrue(app.navigationBars["新建笔记"].waitForExistence(timeout: 5))
        let titleField = app.textFields["标题"]
        titleField.tap()
        titleField.typeText("Draft to discard")
        app.buttons["取消"].tap()
        XCTAssertTrue(app.buttons["继续编辑"].waitForExistence(timeout: 5))
        app.buttons["继续编辑"].tap()
        XCTAssertTrue(app.navigationBars["新建笔记"].exists)
        app.buttons["取消"].tap()
        app.buttons["放弃并关闭"].tap()
        XCTAssertTrue(app.navigationBars["新建笔记"].waitForNonExistence(timeout: 5))
    }
}
