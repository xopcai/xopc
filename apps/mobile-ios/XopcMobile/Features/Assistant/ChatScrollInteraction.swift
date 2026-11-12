import SwiftUI

struct ChatScrollInteraction: ViewModifier {
    let onStart: () -> Void
    let onEnd: () -> Void
    let onDirectionChange: (Bool) -> Void
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
            }.onScrollPhaseChange { previous, phase in
                if phase == .tracking || phase == .interacting {
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
