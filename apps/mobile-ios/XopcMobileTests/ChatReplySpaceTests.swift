import Foundation
import Testing
import SwiftUI
import UIKit
import XCTest
@testable import XopcMobile

struct ChatReplySpaceTests {
    @Test func reservesOnlyForFollowersAndConsumesBeforeScrolling() {
        var space = ChatReplySpace()
        space.begin(anchorID: "user", availableHeight: 600, following: false)
        #expect(space.anchorID == nil)
        #expect(space.remaining == 0)
        space.begin(anchorID: "user", availableHeight: 600, following: true)
        #expect(space.remaining == 60)
        space.consume(replyHeight: 20, availableHeight: 600, following: true)
        #expect(space.remaining == 40)
        space.consume(replyHeight: 240, availableHeight: 240, following: false)
        #expect(space.remaining == 40)
        space.consume(replyHeight: 20, availableHeight: 300, following: true)
        #expect(space.remaining == 10)
        space.consume(replyHeight: 40, availableHeight: 600, following: true)
        #expect(space.remaining == 10)
        space.consume(replyHeight: 240, availableHeight: 600, following: true)
        #expect(space.remaining == 0)
    }

    @Test func nextSendRenewsSpaceAndConversationResetClearsIt() {
        var space = ChatReplySpace()
        space.begin(anchorID: "first", availableHeight: 600, following: true)
        space.consume(replyHeight: 20, availableHeight: 600, following: true)
        space.reanchor("confirmed-first")
        #expect(space.anchorID == "confirmed-first")
        #expect(space.remaining == 40)
        space.begin(anchorID: "second", availableHeight: 450, following: true)
        #expect(space.anchorID == "second")
        #expect(space.remaining == 45)
        space.begin(anchorID: "large", availableHeight: 1600, following: true)
        #expect(space.remaining == 64)
        space.begin(anchorID: "keyboard", availableHeight: 200, following: true)
        #expect(space.remaining == 20)
        space = ChatReplySpace()
        #expect(space.remaining == 0)
        #expect(space.anchorID == nil)
    }
}

@MainActor
final class ChatKeyboardLayoutTests: XCTestCase {
    func testWorkKeyboardDoesNotReverseTailFollowing() async throws { try await verifyKeyboard(scene: .work) }
    func testLifeKeyboardDoesNotReverseTailFollowing() async throws { try await verifyKeyboard(scene: .life) }

    private func verifyKeyboard(scene mode: AssistantScene) async throws {
        let configuration = GatewayConfiguration(baseURL: URL(string: "http://127.0.0.1:18791/keyboard")!, token: "synthetic-keyboard-fixture")
        do { _ = try await GatewayClient(configuration: configuration).fetchAgents() }
        catch { throw XCTSkip("Start apps/mobile-ios/scripts/parity-fixture.py for the native keyboard test") }
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        let controller = UIHostingController(rootView: KeyboardChatFixture(configuration: configuration, scene: mode)
            .environment(\.scenePhase, .active))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.endEditing(true); window.isHidden = true; previous?.makeKeyAndVisible() }
        var scroll: UIScrollView?
        var editor: UIView?
        for _ in 0 ..< 100 {
            let views = descendants(controller.view)
            scroll = views.compactMap { $0 as? UIScrollView }.filter { $0.contentSize.height > $0.bounds.height + 500 }
                .max { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }
            editor = views.first { ($0 as? UITextView)?.isEditable == true || $0 is UITextField }
            if let scroll, editor != nil, scroll.contentOffset.y > 100 { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        let timeline = try XCTUnwrap(scroll)
        let input = try XCTUnwrap(editor)
        try await Task.sleep(for: .milliseconds(2_000))
        let initialEndGap = timeline.contentSize.height + timeline.adjustedContentInset.bottom - timeline.bounds.maxY
        let recorder = KeyboardFrameRecorder(scroll: timeline)
        recorder.start()
        XCTAssertTrue(input.becomeFirstResponder())
        try await Task.sleep(for: .milliseconds(1_200))
        let opening = recorder.frames

        let image = XCTAttachment(image: UIGraphicsImageRenderer(bounds: controller.view.bounds).image { _ in
            controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true)
        })
        image.name = "Chat with keyboard open"; image.lifetime = .keepAlways; add(image)
        recorder.frames = []
        window.endEditing(true)
        try await Task.sleep(for: .milliseconds(1_200))
        recorder.stop()
        let closing = recorder.frames
        let trace = XCTAttachment(string: "opening=\(opening)\nclosing=\(closing)")
        trace.name = "Native keyboard scroll frames"; trace.lifetime = .keepAlways; add(trace)
        XCTAssertLessThanOrEqual(initialEndGap, 24)
        XCTAssertEqual(opening.last?.endGap ?? 999, initialEndGap, accuracy: 4)
        XCTAssertGreaterThan(opening.count, 5)
        XCTAssertGreaterThan(closing.count, 5)
        XCTAssertGreaterThan((opening.last?.offset ?? 0) - (opening.first?.offset ?? 0), 100, "The software keyboard must resize chat: \(opening.prefix(8)) ... \(opening.suffix(3))")
        XCTAssertLessThanOrEqual(rebound(opening, increasing: true), 8, "Open frames: \(opening)")
        XCTAssertLessThanOrEqual(rebound(closing, increasing: false), 8, "Close frames: \(closing)")
        XCTAssertEqual(closing.last?.endGap ?? 999, initialEndGap, accuracy: 4)
    }

    private func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap(descendants) }
    private func rebound(_ frames: [KeyboardFrameRecorder.Frame], increasing: Bool) -> CGFloat {
        var furthest = frames.first?.offset ?? 0
        var result: CGFloat = 0
        for frame in frames {
            furthest = increasing ? max(furthest, frame.offset) : min(furthest, frame.offset)
            result = max(result, increasing ? furthest - frame.offset : frame.offset - furthest)
        }
        return result
    }
}

private struct KeyboardChatFixture: View {
    let configuration: GatewayConfiguration
    let scene: AssistantScene
    @State private var keyboardVisible = false
    @State private var call = RealtimeVoiceCall()
    var body: some View {
        NavigationStack {
            AssistantView(configuration: configuration, isActive: true, realtimeVoiceCall: call,
                conversation: .existing(id: "11111111-1111-4111-8111-111111111111", title: "Keyboard fixture", agentId: "main"),
                personalAgent: nil, quickChatHandoff: nil, onStartConversation: { _ in },
                onStartScopedConversation: { _, _, _ in }, onConversationUpdated: { _ in },
                onQuickChatHandled: { _ in }, onPersonalAgentUpdated: { _ in }, onOpenSettings: {},
                onInputFocusChanged: { _ in }, scene: scene) { composer, _ in
                VStack(spacing: 0) {
                    composer
                    if scene == .work, !keyboardVisible { Color.clear.frame(height: 66) }
                }.background(Color(uiColor: .systemBackground))
            }
        }
        .onGeometryChange(for: Bool.self) { $0.safeAreaInsets.bottom > 100 } action: { keyboardVisible = $0 }
    }
}

@MainActor
private final class KeyboardFrameRecorder: NSObject {
    struct Frame: CustomStringConvertible {
        let offset: CGFloat
        let endGap: CGFloat
        let height: CGFloat
        var description: String { "(offset:\(offset.rounded()), gap:\(endGap.rounded()), height:\(height.rounded()))" }
    }
    let scroll: UIScrollView
    var frames: [Frame] = []
    private var link: CADisplayLink?
    init(scroll: UIScrollView) { self.scroll = scroll }
    func start() {
        let link = CADisplayLink(target: self, selector: #selector(sample))
        link.add(to: .main, forMode: .common); self.link = link
        sample()
    }
    func stop() { link?.invalidate(); link = nil }
    @objc private func sample() {
        let bounds = scroll.layer.presentation()?.bounds ?? scroll.bounds
        frames.append(Frame(offset: bounds.minY, endGap: scroll.contentSize.height + scroll.adjustedContentInset.bottom - bounds.maxY,
            height: bounds.height))
    }
}
