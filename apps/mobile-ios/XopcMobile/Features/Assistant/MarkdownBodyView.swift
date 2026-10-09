import SwiftUI

struct MarkdownBodyView: View {
    let parts: [MarkdownPart]
    let configuration: GatewayConfiguration
    let conversationID: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(parts) { part in
                MarkdownPartView(block: part.block, configuration: configuration, conversationID: conversationID)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
}

private struct MarkdownPartView: View {
    let block: MarkdownBlock
    let configuration: GatewayConfiguration
    let conversationID: String?

    var body: some View {
        switch block {
        case let .paragraph(text):
            inline(text).mobileTextStyle(.body)
        case let .heading(level, text):
            inline(text)
                .mobileTextStyle(headingStyle(level))
                .padding(.top, level <= 2 ? 8 : 3)
                .accessibilityAddTraits(.isHeader)
        case let .bullet(level, text):
            (Text("• ") + inline(text))
                .mobileTextStyle(.body)
                .padding(.leading, CGFloat(min(max(level, 0), 3)) * 12)
                .fixedSize(horizontal: false, vertical: true)
        case let .numbered(number, level, text):
            (Text("\(number). ") + inline(text))
                .mobileTextStyle(.body)
                .padding(.leading, CGFloat(min(max(level, 0), 3)) * 12)
                .fixedSize(horizontal: false, vertical: true)
        case let .quote(text):
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.blue.opacity(0.45))
                    .frame(width: 3)
                inline(text)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .fixedSize(horizontal: false, vertical: true)
        case let .code(text):
            ScrollView(.horizontal) {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
            .background(Color.secondary.opacity(0.09), in: .rect(cornerRadius: 10))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("markdown-code")
        case let .image(alt, source):
            MarkdownImageView(alt: alt, source: source, configuration: configuration, conversationID: conversationID)
        case let .table(rows, alignments):
            ScrollView(.horizontal) {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { rowIndex, row in
                        HStack(alignment: .top, spacing: 0) {
                            ForEach(Array(row.cells.enumerated()), id: \.element.id) { columnIndex, cell in
                                inline(cell.text)
                                    .fontWeight(row.isHeader ? .semibold : .regular)
                                    .frame(width: 168, alignment: frameAlignment(alignments[columnIndex]))
                                    .padding(10)
                            }
                        }
                        .background(row.isHeader ? Color.secondary.opacity(0.12) : Color.secondary.opacity(0.06))
                        .clipShape(.rect(cornerRadius: 6))
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("markdown-table-row-\(rowIndex)")
                    }
                }
            }
            .accessibilityIdentifier("markdown-table")
        case .divider:
            Divider().padding(.vertical, 4)
        }
    }

    private func inline(_ text: String) -> Text {
        Text(.init(text))
    }

    private func headingStyle(_ level: Int) -> MobileTextStyle {
        switch level {
        case 1: .heading
        case 2: .heading2
        case 3: .sectionTitle
        default: .rowTitle
        }
    }

    private func frameAlignment(_ alignment: MarkdownTableAlignment) -> Alignment {
        switch alignment {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }
}
