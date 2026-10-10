import SwiftUI

struct ChatScrollInteraction: ViewModifier {
    let onStart: () -> Void
    let onEnd: () -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.onScrollPhaseChange { previous, phase in
                if phase == .tracking || phase == .interacting {
                    onStart()
                }
                if phase == .idle, previous != .animating {
                    onEnd()
                }
            }
        } else {
            content.simultaneousGesture(DragGesture().onChanged { _ in
                onStart()
            }.onEnded { _ in
                onEnd()
            })
        }
    }
}
