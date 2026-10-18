import SwiftUI

struct MarkdownBodyView: View {
    let parts: [MarkdownPart]
    let configuration: GatewayConfiguration
    let conversationID: String?
    var markdown: String?
    var streaming = false
    @Environment(\.chatTextSelectionEnabled) private var textSelectable
    @State private var projectedParts: [MarkdownPart] = []

    var body: some View {
        let displayedParts = markdown == nil || projectedParts.isEmpty ? parts : projectedParts
        let mathEnabled = displayedParts.reduce(0) { $0 + MathMarkdownSyntax.candidateCount($1.block) } <= 256
        VStack(alignment: .leading, spacing: 10) {
            ForEach(displayedParts) { part in
                MarkdownPartView(block: part.block, configuration: configuration, conversationID: conversationID,
                                 streaming: streaming && part.id == projectedParts.last?.id, mathEnabled: mathEnabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .chatTextSelection(textSelectable)
        .task(id: markdown) {
            guard let markdown else { return }
            let previous = projectedParts
            let supplied = parts
            let parse = Task.detached(priority: .userInitiated) {
                MarkdownPart.project(supplied.isEmpty ? MarkdownBlock.parse(markdown) : supplied.map(\.block), previous: previous)
            }
            let projection = await withTaskCancellationHandler { await parse.value } onCancel: { parse.cancel() }
            guard !Task.isCancelled else { return }
            projectedParts = projection
        }
    }
}

private struct MarkdownPartView: View {
    @Environment(\.chatTextSelectionEnabled) private var textSelectable
    let block: MarkdownBlock
    let configuration: GatewayConfiguration
    let conversationID: String?
    let streaming: Bool
    let mathEnabled: Bool
    @State private var expanded = false

    var body: some View {
        switch block {
        case let .paragraph(text):
            inline(text).mobileTextStyle(.body)
        case let .heading(level, text):
            inline(text, fontSize: headingStyle(level).size)
                .mobileTextStyle(headingStyle(level))
                .padding(.top, level <= 2 ? 8 : 3)
                .accessibilityAddTraits(.isHeader)
        case let .bullet(level, text):
            HStack(alignment: .firstTextBaseline, spacing: 4) { Text("•"); inline(text).frame(maxWidth: .infinity, alignment: .leading) }
                .mobileTextStyle(.body)
                .padding(.leading, CGFloat(min(max(level, 0), 3)) * 12)
                .fixedSize(horizontal: false, vertical: true)
        case let .numbered(number, level, text):
            HStack(alignment: .firstTextBaseline, spacing: 4) { Text("\(number)."); inline(text).frame(maxWidth: .infinity, alignment: .leading) }
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
        case let .math(source):
            MathMarkdownView(markdown: source, streaming: streaming, display: true, enabled: mathEnabled)
        case let .chart(source, closed):
            ChartMarkdownView(source: source, closed: closed)
        case let .code(text):
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Spacer()
                    Button("复制代码") { UIPasteboard.general.string = text }
                }
                ScrollView(.horizontal) {
                    Text(expanded ? text : codePreview(text))
                        .font(.system(.footnote, design: .monospaced))
                        .chatTextSelection(textSelectable)
                        .padding(12)
                }
                .background(Color.secondary.opacity(0.09), in: .rect(cornerRadius: 10))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("markdown-code")
                if codePreview(text) != text {
                    Button(expanded ? "收起" : "查看更多") { expanded.toggle() }.frame(minHeight: 44)
                }
            }
        case let .image(alt, source):
            MarkdownImageView(alt: alt, source: source, configuration: configuration, conversationID: conversationID)
        case let .table(rows, alignments):
            VStack(alignment: .leading, spacing: 4) {
                ScrollView(.horizontal) {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array((expanded ? rows : Array(rows.prefix(40))).enumerated()), id: \.element.id) { rowIndex, row in
                            HStack(alignment: .top, spacing: 0) {
                                ForEach(Array(row.cells.enumerated()), id: \.element.id) { columnIndex, cell in
                                    inline(cell.text)
                                        .fontWeight(row.isHeader ? .semibold : .regular)
                                        .multilineTextAlignment(textAlignment(columnIndex < alignments.count ? alignments[columnIndex] : .leading))
                                        .frame(width: 168, alignment: frameAlignment(columnIndex < alignments.count ? alignments[columnIndex] : .leading))
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
                if rows.count > 40 {
                    Button(expanded ? "收起" : "查看更多") { expanded.toggle() }.frame(minHeight: 44)
                }
            }
        case .divider:
            Divider().padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private func inline(_ text: String, fontSize: Double = 16) -> some View {
        if MathMarkdownSyntax.mayContainMath(text) {
            MathMarkdownView(markdown: text, streaming: streaming, fontSize: fontSize, enabled: mathEnabled)
        } else {
            StreamingMarkdownText(source: text, streaming: streaming)
        }
    }

    private func codePreview(_ source: String) -> String {
        var cursor = source.startIndex
        for line in 0 ..< 40 {
            guard let end = source[cursor...].firstIndex(of: "\n") else { return source }
            if line == 39 {
                return String(source[..<end])
            }
            cursor = source.index(after: end)
        }
        return source
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

    private func textAlignment(_ alignment: MarkdownTableAlignment) -> TextAlignment {
        switch alignment {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }
}

extension EnvironmentValues {
    @Entry var chatTextSelectionEnabled: Bool = true
}

extension View {
    @ViewBuilder
    func chatTextSelection(_ enabled: Bool) -> some View {
        if enabled {
            textSelection(.enabled)
        } else {
            textSelection(.disabled)
        }
    }
}
