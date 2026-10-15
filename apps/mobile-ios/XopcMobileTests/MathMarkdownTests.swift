import SwiftUI
import WebKit
import XCTest
@testable import XopcMobile

@MainActor
final class MathMarkdownTests: XCTestCase {
    func testMathematicalContainersPreserveRawSource() {
        XCTAssertEqual(MathMarkdownSyntax.candidateCount(Array(repeating: #"\[x\]"#, count: 257).joined(separator: "\n\n")), 257)
        for source in ["> \\[\n> x^2\n> \\]", "- \\[\n  x^2\n  \\]"] {
            XCTAssertEqual(MarkdownBlock.parse(source), [.math(source)])
        }
        XCTAssertEqual(MarkdownBlock.parse("\\[x\\] after"), [.paragraph("\\[x\\] after")])
        XCTAssertEqual(MarkdownBlock.parse("> \\[\n> x\n\nOutside").last, .paragraph("Outside"))
        let commented = "\\[ % \\]\nx^2\n\\]"
        XCTAssertEqual(MarkdownBlock.parse(commented), [.math(commented)])
        for source in ["````math\nx^2\n````", "~~~math\nx^2\n~~~", "```math\nx^"] {
            XCTAssertEqual(MarkdownBlock.parse(source), [.math(source)])
        }
    }

    func testDisplayFormulaSurvivesBlankLinesAndCodeIsExcluded() {
        let source = "Before\n\n\\[\n\\begin{aligned}\na &= b \\\\\n\nc &= d\n\\end{aligned}\n\\]\n\nAfter"
        let blocks = MarkdownBlock.parse(source)
        XCTAssertEqual(blocks.count, 3)
        if case let .math(raw) = blocks[1] {
            XCTAssertTrue(raw.contains("\n\nc &= d"))
        } else {
            XCTFail("Expected a mathematical block")
        }
        let code = MarkdownBlock.parse("```ts\n\\[x\\]\n```")
        if case .code = code[0] {} else {
            XCTFail("Ordinary code must remain code")
        }
    }

    func testLocalRendererLoadsFontsAndTransitionsFromPendingToReady() async throws {
        let source = #"\[\mathcal{R}_{syn}(s_T;g)\triangleq\mathbb{I}\big[V_g(s_T)=\mathrm{True}\big]\]"#
        let controller = UIHostingController(rootView: MathMarkdownView(markdown: source, display: true))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 375, height: 600)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        func findWeb(_ view: UIView) -> WKWebView? {
            if let web = view as? WKWebView {
                return web
            }
            return view.subviews.lazy.compactMap(findWeb).first
        }
        var web: WKWebView?
        for _ in 0 ..< 50 {
            try await Task.sleep(for: .milliseconds(100))
            web = findWeb(controller.view)
            if let web, let count = try? await web.evaluateJavaScript("document.querySelectorAll('.katex').length"),
               (count as? Int) == 1
            {
                break
            }
        }
        let page = try XCTUnwrap(web)
        let ready = try await page.evaluateJavaScript("document.querySelectorAll('math').length")
        XCTAssertEqual(ready as? Int, 1)
        let fonts = try await page.callAsyncJavaScript("await document.fonts.load('16px KaTeX_Main'); return document.fonts.check('16px KaTeX_Main')", in: nil, contentWorld: .page)
        XCTAssertEqual(fonts as? Bool, true)
        let payload: [String: Any] = ["revision": 100, "markdown": #"\[x^"#, "streaming": true, "dark": false, "fontSize": 16]
        _ = try await page.callAsyncJavaScript("window.xopcMath.update(payload)", arguments: ["payload": payload], in: nil, contentWorld: .page)
        let pending = try await page.evaluateJavaScript("document.querySelectorAll('[data-xopc-math=pending]').length")
        XCTAssertEqual(pending as? Int, 1)
        let attachment = XCTAttachment(image: UIGraphicsImageRenderer(bounds: controller.view.bounds).image { _ in
            controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true)
        })
        attachment.name = "Local math rendering"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
