import SwiftUI

struct AssistantActivityView: View {
    let label: String
    let items: [ExecutionActivityItem]
    let runID: String?
    let onOpen: () -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 8) {
                ProgressView()
                Text(label)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                if !items.isEmpty || runID != nil {
                    Text("步骤 \(items.count)")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(items.isEmpty && runID == nil)
        .accessibilityLabel(label)
        .accessibilityHint(items.isEmpty && runID == nil ? "" : AppLocalization.string("查看执行步骤", locale: locale))
        .accessibilityIdentifier("assistant-execution-activity")
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
        .presentationDetents([.medium, .large])
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
