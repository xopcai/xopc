import SwiftUI

struct AssistantActivityView: View {
    let narration: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var appearedAt = Date()

    var body: some View {
        TimelineView(.periodic(from: appearedAt, by: 1)) { context in
            let elapsed = context.date.timeIntervalSince(appearedAt)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    ForEach(0 ..< 3, id: \.self) { index in
                        WaitingReplyDot(index: index, animate: !reduceMotion && scenePhase == .active)
                    }
                }
                .padding(.horizontal, 12)
                .frame(width: 72, height: 44)
                .background(Color.secondary.opacity(0.1), in: .capsule)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("助手正在处理")
                if elapsed >= 10, let narration, !narration.isEmpty {
                    Text(verbatim: narration).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityIdentifier("assistant-waiting")
    }
}

private struct WaitingReplyDot: View {
    let index: Int
    let animate: Bool
    @State private var lifted = false

    var body: some View {
        Circle().fill(.secondary)
            .frame(width: 7, height: 7)
            .opacity(animate && lifted ? 0.85 : 0.4)
            .scaleEffect(animate && lifted ? 1.08 : 0.92)
            .offset(y: animate && lifted ? -3 : 0)
            .animation(animate ? .easeInOut(duration: 0.6).repeatForever(autoreverses: true)
                .delay(Double(index) * 0.15) : nil, value: lifted)
            .onChange(of: animate, initial: true) { lifted = animate }
            .accessibilityHidden(true)
    }
}

struct ExecutionActivityPresentation: Identifiable {
    let id = UUID()
    let conversationID: String?
    let runID: String?
    let items: [ExecutionActivityItem]
}

struct AssistantExecutionSheet: View {
    let presentation: ExecutionActivityPresentation
    let configuration: GatewayConfiguration
    let assistantState: AssistantState
    let onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if let conversationID = presentation.conversationID, let runID = presentation.runID {
                    ExecutionProcessView(
                        configuration: configuration,
                        conversationID: conversationID,
                        turnID: runID,
                        assistantState: assistantState
                    )
                } else {
                    List(presentation.items) { item in
                        Label {
                            Text(item.title)
                        } icon: {
                            Image(systemName: symbol(for: item.status))
                                .foregroundStyle(color(for: item.status))
                        }
                    }
                    .navigationTitle("执行步骤")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成", action: onDismiss)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .presentationDetents([.fraction(0.92)])
        .presentationDragIndicator(.hidden)
        .presentationContentInteraction(.scrolls)
    }

    private func symbol(for status: String) -> String {
        switch status {
        case "done": "checkmark.circle.fill"
        case "error": "xmark.circle.fill"
        default: "circle.dotted"
        }
    }

    private func color(for status: String) -> Color {
        switch status {
        case "done": .green
        case "error": .red
        default: .blue
        }
    }
}
