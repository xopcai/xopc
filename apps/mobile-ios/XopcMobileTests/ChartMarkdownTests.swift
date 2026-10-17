import SwiftUI
import WebKit
import XCTest
@testable import XopcMobile

@MainActor
final class ChartMarkdownTests: XCTestCase {
    func testFenceClosureAndLanguageArePreserved() {
        XCTAssertEqual(MarkdownBlock.parse("````chart\n{}\n```"), [.chart(source: "{}\n```", closed: false)])
        XCTAssertEqual(MarkdownBlock.parse("~~~chart\n{}\n~~~~"), [.chart(source: "{}", closed: true)])
        XCTAssertEqual(MarkdownBlock.parse("```chart\n{}\n```text"), [.chart(source: "{}\n```text", closed: false)])
        XCTAssertEqual(MarkdownBlock.parse("```json\n{}\n```"), [.code("{}")])
    }

    func testUtf8LimitAndBudget() {
        XCTAssertTrue(ChartSourcePolicy.allows(String(repeating: "a", count: 102_400)))
        XCTAssertFalse(ChartSourcePolicy.allows(String(repeating: "中", count: 40000)))
        let budget = ChartWebBudget()
        let first = UUID(), second = UUID(), third = UUID()
        budget.request(first); budget.request(second); budget.request(third)
        XCTAssertEqual(budget.active.count, 2)
        XCTAssertFalse(budget.active.contains(third))
        budget.request(third, priority: true)
        XCTAssertEqual(budget.active.count, 2)
        XCTAssertTrue(budget.active.contains(third))
        budget.release(third)
        XCTAssertTrue(budget.active.contains(first))
        XCTAssertTrue(budget.active.contains(second))
        budget.release(first)
        budget.release(second); budget.release(third)
        XCTAssertTrue(budget.active.isEmpty)
    }

    func testLocalWebKitRendersLineAndBarWithNullsAndNegatives() async throws {
        for type in ["line", "bar"] {
            let source = """
            {"version":1,"type":"\(type)","title":"离线图表","summary":"包含缺失值和负数", "dataKind":"example",
            "xAxis":{"label":"月份","values":["一月","二月","三月"]},"yAxis":{"label":"金额","unit":"元"},
            "series":[{"name":"甲","values":[1,null,-2]},{"name":"乙","values":[-3,0,2]}]}
            """
            let controller = UIHostingController(rootView: ChartMarkdownView(source: source, closed: true).environment(\.scenePhase, .active))
            let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: 375, height: 700)
            window.rootViewController = controller; window.makeKeyAndVisible()
            defer { window.isHidden = true; window.rootViewController = nil }
            func findWeb(_ view: UIView) -> WKWebView? {
                if let web = view as? WKWebView {
                    return web
                }
                return view.subviews.lazy.compactMap(findWeb).first
            }
            var page: WKWebView?
            var rows = 0
            for _ in 0 ..< 100 {
                try await Task.sleep(for: .milliseconds(100))
                page = findWeb(controller.view)
                if let page, let value = try? await page.evaluateJavaScript("document.querySelectorAll('tr').length") {
                    rows = value as? Int ?? 0
                    if rows == 4 {
                        break
                    }
                }
            }
            XCTAssertEqual(rows, 4, "Expected real bundled ECharts rendering in WebKit for \(type)")
            let web = try XCTUnwrap(page)
            let cells = try await web.evaluateJavaScript("document.getElementById('table').textContent") as? String
            XCTAssertTrue(cells?.contains("—") == true)
            XCTAssertTrue(cells?.contains("-3") == true)
            let canvases = try await web.evaluateJavaScript("document.querySelectorAll('canvas').length") as? Int
            XCTAssertGreaterThan(canvases ?? 0, 0)
        }
    }
}
