import Observation
import SwiftUI

struct ChatScrollInteraction: ViewModifier {
    let onStart: () -> Void
    let onEnd: () -> Void
    let onDirectionChange: (Bool) -> Void
    let onBottomChange: (Bool) -> Void
    @State private var previousDragTranslation = CGSize.zero

    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.onScrollGeometryChange(for: ScrollGeometry.self) { $0 } action: { old, new in
                guard old.contentSize == new.contentSize, old.containerSize == new.containerSize,
                      old.contentInsets == new.contentInsets else { return }
                let previous = max(-old.contentInsets.top, old.contentOffset.y)
                let current = max(-new.contentInsets.top, new.contentOffset.y)
                if current != previous {
                    onDirectionChange(current > previous)
                }
            }.onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentSize.height + geometry.contentInsets.bottom
                    - geometry.containerSize.height - geometry.contentOffset.y <= 24
            } action: { _, atBottom in
                onBottomChange(atBottom)
            }.onScrollPhaseChange { previous, phase in
                if phase == .interacting {
                    onStart()
                }
                if phase == .idle, previous != .animating {
                    onEnd()
                }
            }
        } else {
            content.simultaneousGesture(DragGesture().onChanged { value in
                onStart()
                let verticalDelta = value.translation.height - previousDragTranslation.height
                let horizontalDelta = value.translation.width - previousDragTranslation.width
                previousDragTranslation = value.translation
                if abs(verticalDelta) > 1, abs(verticalDelta) > abs(horizontalDelta) {
                    onDirectionChange(verticalDelta < 0)
                }
            }.onEnded { _ in
                previousDragTranslation = .zero
                onEnd()
            })
        }
    }
}

@MainActor
@Observable
final class ChatTimelineScrollCommands {
    struct BottomRequest: Equatable {
        let id = UUID()
        let jumpID: UUID?
    }

    var bottomRequest: BottomRequest?

    func scrollToBottom(jumpID: UUID? = nil) {
        bottomRequest = BottomRequest(jumpID: jumpID)
    }
}

struct ChatTimelineAlignment: ViewModifier {
    let commands: ChatTimelineScrollCommands
    let onJumpCompleted: (UUID) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.modifier(EdgePositionedChatTimeline(commands: commands, onJumpCompleted: onJumpCompleted))
        } else {
            content.defaultScrollAnchor(.top)
        }
    }
}

@available(iOS 18, *)
private struct EdgePositionedChatTimeline: ViewModifier {
    let commands: ChatTimelineScrollCommands
    let onJumpCompleted: (UUID) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var position = ScrollPosition()

    func body(content: Content) -> some View {
        content
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.top, for: .alignment)
            .scrollPosition($position)
            .onChange(of: commands.bottomRequest) { _, request in
                guard let request else { return }
                withAnimation(request.jumpID != nil && !reduceMotion ? .easeInOut(duration: 0.3) : nil) {
                    position.scrollTo(edge: .bottom)
                } completion: {
                    if let id = request.jumpID {
                        onJumpCompleted(id)
                    }
                }
            }
    }
}
