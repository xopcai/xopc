import SwiftUI

struct TransientComposerFeedback: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("关闭", systemImage: "xmark", action: onDismiss)
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityIdentifier("composer-feedback-dismiss")
        }
        .accessibilityElement(children: .contain)
        .task(id: message) {
            do { try await Task.sleep(for: .seconds(6)) }
            catch { return }
            guard !Task.isCancelled else { return }
            onDismiss()
        }
    }
}
