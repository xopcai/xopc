import SwiftUI

struct ChatResultCapsuleLabel: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let title: String
    let systemImage: String
    var status: String?
    var canOpen = true
    var loading = false
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.headline)
                .foregroundStyle(mobileTheme.action)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                titleLabel
                statusLabel
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)
            if loading {
                ProgressView().controlSize(.small).frame(width: 13, height: 13)
            } else if canOpen {
                Image(systemName: "chevron.right")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .frame(maxWidth: 320, alignment: .leading)
        .background(mobileTheme.card, in: .rect(cornerRadius: mobileTheme.corner(18)))
        .contentShape(.rect(cornerRadius: mobileTheme.corner(18)))
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
            Text(verbatim: status)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
