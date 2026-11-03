import SwiftUI

struct ChatResultCapsuleLabel: View {
    let title: String
    let systemImage: String
    var status: String?
    var canOpen = true

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.subheadline)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
            if let status, !status.isEmpty {
                Text(verbatim: "· " + status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            if canOpen {
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 18))
        .contentShape(.rect(cornerRadius: 18))
        .accessibilityElement(children: .combine)
    }
}
