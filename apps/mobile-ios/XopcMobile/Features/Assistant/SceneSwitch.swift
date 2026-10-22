import SwiftUI
import UIKit
import WebKit

enum AssistantScene: String, CaseIterable {
    case life
    case work
}

struct AssistantSceneSwitch: View {
    let scene: AssistantScene
    let opening: Bool
    let onSelect: (AssistantScene) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.locale) private var locale

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule()
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
                .frame(width: 64, height: 36)
                .offset(x: scene == .life ? 4 : 68)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.26), value: scene)
            HStack(spacing: 0) {
                ForEach(AssistantScene.allCases, id: \.self) { item in
                    Button {
                        onSelect(item)
                    } label: {
                        Text(verbatim: locale.language.languageCode?.identifier == "zh"
                            ? (item == .life ? "生活" : "工作") : (item == .life ? "Life" : "Work"))
                            .font(.system(size: 14, weight: scene == item ? .medium : .regular))
                            .foregroundStyle(scene == item ? .primary : .secondary)
                            .frame(width: 64, height: 44)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(item == .life && opening)
                    .accessibilityAddTraits(scene == item ? .isSelected : [])
                    .accessibilityIdentifier("home-mode-\(item.rawValue)")
                }
            }
            .padding(.horizontal, 4)
        }
        .frame(width: 136, height: 44)
        .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
    }
}

struct ChatSceneSwipe: ViewModifier {
    let scene: AssistantScene?
    let enabled: Bool
    let topInset: CGFloat
    let bottomInset: CGFloat
    let onSelect: (AssistantScene) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drag: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .offset(x: reduceMotion ? 0 : drag)
            .overlay {
                SceneSwipeSurface(scene: scene, enabled: enabled, topInset: topInset, bottomInset: bottomInset) { distance, ended in
                    if ended {
                        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.26)) { drag = 0 }
                        if abs(distance) >= 64, let scene, (distance > 0) == (scene == .work) {
                            onSelect(scene == .work ? .life : .work)
                        }
                    } else {
                        drag = max(-48, min(48, distance * 0.22))
                    }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .onChange(of: scene) { drag = 0 }
    }
}

/// UIKit provides directional arbitration with nested ScrollViews and WebKit content.
private struct SceneSwipeSurface: UIViewRepresentable {
    let scene: AssistantScene?
    let enabled: Bool
    let topInset: CGFloat
    let bottomInset: CGFloat
    let onDrag: (CGFloat, Bool) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> Surface {
        let surface = Surface()
        surface.isUserInteractionEnabled = false
        surface.onWindowChange = { [weak coordinator = context.coordinator] surface in coordinator?.attach(surface) }
        return surface
    }

    func updateUIView(_: Surface, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleUIView(_: Surface, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Surface: UIView {
        var onWindowChange: ((Surface) -> Void)?
        override func didMoveToWindow() {
            super.didMoveToWindow(); onWindowChange?(self)
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: SceneSwipeSurface
        weak var surface: Surface?
        private var startingScene: AssistantScene?
        private lazy var pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan))
        init(_ parent: SceneSwipeSurface) {
            self.parent = parent
        }

        func attach(_ surface: Surface) {
            detach()
            self.surface = surface
            pan.maximumNumberOfTouches = 1
            pan.cancelsTouchesInView = false
            pan.delegate = self
            surface.window?.addGestureRecognizer(pan)
        }

        func detach() {
            pan.view?.removeGestureRecognizer(pan)
        }

        func gestureRecognizerShouldBegin(_: UIGestureRecognizer) -> Bool {
            guard parent.enabled, let scene = parent.scene, let surface, let window = surface.window,
                  window.rootViewController?.presentedViewController == nil else { return false }
            let translation = pan.translation(in: surface)
            let velocity = pan.velocity(in: surface)
            let location = pan.location(in: surface)
            let start = CGPoint(x: location.x - translation.x, y: location.y - translation.y)
            guard start.x >= 24, start.x <= surface.bounds.width - 24,
                  start.y >= parent.topInset, start.y <= surface.bounds.height - parent.bottomInset,
                  abs(velocity.x) > abs(velocity.y) * 1.5,
                  (velocity.x > 0) == (scene == .work) else { return false }
            var target = window.hitTest(pan.location(in: window), with: nil)
            while let view = target {
                if view is WKWebView || view is UITextView || view is UITextField || view is UIControl {
                    return false
                }
                if let scroll = view as? UIScrollView,
                   scroll.contentSize.width + scroll.adjustedContentInset.left + scroll.adjustedContentInset.right > scroll.bounds.width + 1
                {
                    return false
                }
                target = view.superview
            }
            startingScene = scene
            return true
        }

        func gestureRecognizer(_: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool
        {
            otherGestureRecognizer is UIPanGestureRecognizer
        }

        @objc private func handlePan() {
            let distance = pan.translation(in: surface)
            switch pan.state {
            case .began, .changed:
                parent.onDrag(distance.x, false)
            case .ended:
                let valid = parent.enabled && parent.scene == startingScene && abs(distance.x) > abs(distance.y) * 1.5
                parent.onDrag(valid ? distance.x : 0, true)
            case .cancelled, .failed:
                parent.onDrag(0, true)
            default: break
            }
        }
    }
}
