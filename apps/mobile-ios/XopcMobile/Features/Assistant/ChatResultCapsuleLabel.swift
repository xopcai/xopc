import SwiftUI

struct ChatResultCapsuleLabel: View {
    let title: String
    let systemImage: String
    var status: String?
    var canOpen = true

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 18))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    titleLabel
                    statusLabel
                }
                .fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 2) {
                    titleLabel
                    statusLabel
                }
            }
            .layoutPriority(1)
            if canOpen {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13))
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

    private var titleLabel: some View {
        Text(verbatim: title)
            .font(.subheadline)
            .foregroundStyle(.primary)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var statusLabel: some View {
        if let status, !status.isEmpty {
            Text(verbatim: "· " + status)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

}
