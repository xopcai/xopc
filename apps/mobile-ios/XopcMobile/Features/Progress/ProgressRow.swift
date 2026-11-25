import SwiftUI

struct ProgressRow: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let title: String
    let subtitle: String?
    let state: String
    let date: Date
    let symbol: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).mobileTextStyle(.sectionTitle).foregroundStyle(mobileTheme.action).frame(width: 28)
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .mobileTextStyle(.rowTitle)
                    .foregroundStyle(mobileTheme.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .mobileTextStyle(.secondary)
                        .foregroundStyle(mobileTheme.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack { Text(LocalizedStringKey(state)); Text(date, format: .dateTime.month().day().hour().minute()) }
                    .mobileTextStyle(.caption).foregroundStyle(mobileTheme.secondary.opacity(0.8))
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

struct ProgressListSkeleton: View {
    var body: some View {
        MobileListSkeleton(rows: 4)
    }
}
