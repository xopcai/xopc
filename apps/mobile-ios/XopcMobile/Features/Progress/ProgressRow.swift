import SwiftUI

struct ProgressRow: View {
    let title: String
    let subtitle: String?
    let state: String
    let date: Date
    let symbol: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).font(.title3).foregroundStyle(.blue).frame(width: 28)
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack { Text(LocalizedStringKey(state)); Text(date, format: .dateTime.month().day().hour().minute()) }
                    .font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

struct ProgressListSkeleton: View {
    var body: some View {
        ForEach(0 ..< 4, id: \.self) { _ in
            VStack(alignment: .leading) { Text("内容标题").font(.headline); Text("正在读取进展信息") }
                .redacted(reason: .placeholder)
        }
    }
}
