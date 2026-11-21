import SwiftUI

@available(iOS 18.0, *)
struct MarkdownNoteInput: View {
    @Binding var markdown: String
    let configuration: GatewayConfiguration
    var autofocus = false
    @State private var showsPreview = false
    @State private var selection: TextSelection?
    @State private var undoStack: [String] = []
    @State private var redoStack: [String] = []
    @State private var skipsHistoryChange = false
    @FocusState private var isEditing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if showsPreview {
                ScrollView {
                    MarkdownBodyView(parts: [], configuration: configuration, conversationID: nil, markdown: markdown)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .accessibilityIdentifier("note-markdown-preview")
            } else {
                textEditor
            }
            ScrollView(.horizontal) {
                HStack(spacing: 12) {
                    Button(showsPreview ? "编辑" : "预览", systemImage: showsPreview ? "pencil" : "eye") {
                        isEditing = false
                        showsPreview.toggle()
                    }
                    if !showsPreview {
                        formattingControls
                    }
                }
                .buttonStyle(.bordered)
            }
            .accessibilityLabel("笔记格式")
            .accessibilityIdentifier("note-markdown-toolbar")
        }
        .task(id: autofocus) {
            if autofocus, !showsPreview {
                isEditing = true
            }
        }
        .onChange(of: markdown) { oldValue, newValue in
            if skipsHistoryChange {
                skipsHistoryChange = false
            } else if oldValue != newValue {
                undoStack.append(oldValue)
                if undoStack.count > 30 {
                    undoStack.removeFirst()
                }
                redoStack.removeAll()
            }
        }
    }

    @ViewBuilder private var formattingControls: some View {
        Button("撤销", systemImage: "arrow.uturn.backward", action: undo)
            .disabled(undoStack.isEmpty)
        Button("重做", systemImage: "arrow.uturn.forward", action: redo)
            .disabled(redoStack.isEmpty)
        Button("粗体", systemImage: "bold") { wrapSelection(with: "**", placeholder: "粗体") }
        Button("斜体", systemImage: "italic") { wrapSelection(with: "*", placeholder: "斜体") }
        Button("一级标题") { prefixLine("# ") }
        Button("二级标题") { prefixLine("## ") }
        Button("三级标题") { prefixLine("### ") }
        Button("列表", systemImage: "list.bullet") { prefixLine("- ") }
        Button("编号列表", systemImage: "list.number") { prefixLine("1. ") }
        Button("核对清单", systemImage: "checklist") { prefixLine("- [ ] ") }
        Button("引用", systemImage: "quote.opening") { prefixLine("> ") }
    }

    private var textEditor: some View {
        ZStack(alignment: .topLeading) {
            if markdown.isEmpty, !isEditing {
                Text("开始记录…")
                    .foregroundStyle(.tertiary)
                    .padding(.top, 8)
                    .padding(.leading, 5)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $markdown, selection: $selection)
                .focused($isEditing)
                .scrollContentBackground(.hidden)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel("笔记正文")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(markdown)
        skipsHistoryChange = true
        selection = nil
        markdown = previous
    }

    private func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(markdown)
        skipsHistoryChange = true
        selection = nil
        markdown = next
    }

    private var selectedRange: Range<String.Index> {
        if case let .selection(range) = selection?.indices,
           range.lowerBound >= markdown.startIndex, range.upperBound <= markdown.endIndex
        {
            return range
        }
        return markdown.endIndex ..< markdown.endIndex
    }

    private func wrapSelection(with marker: String, placeholder: String) {
        let range = selectedRange
        let startOffset = markdown.distance(from: markdown.startIndex, to: range.lowerBound) + marker.count
        let content = range.isEmpty ? placeholder : String(markdown[range])
        let replacement = marker + content + marker
        markdown.replaceSubrange(range, with: replacement)
        let start = markdown.index(markdown.startIndex, offsetBy: startOffset)
        selection = TextSelection(range: start ..< markdown.index(start, offsetBy: content.count))
    }

    private func prefixLine(_ prefix: String) {
        let range = selectedRange
        let lowerOffset = markdown.distance(from: markdown.startIndex, to: range.lowerBound)
        let upperOffset = markdown.distance(from: markdown.startIndex, to: range.upperBound)
        let lineStart = markdown[..<range.lowerBound].lastIndex(of: "\n")
            .map { markdown.index(after: $0) } ?? markdown.startIndex
        let lineEnd = markdown[range.lowerBound...].firstIndex(of: "\n") ?? markdown.endIndex
        let line = String(markdown[lineStart ..< lineEnd])
        let marker = line.range(of: #"^(?:#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )"#,
                                options: .regularExpression)
        let markerLength = marker.map { line[$0].count } ?? 0
        let replacement = marker.map { line[$0] == prefix ? "" : prefix } ?? prefix
        let startOffset = markdown.distance(from: markdown.startIndex, to: lineStart)
        let markerEnd = markdown.index(lineStart, offsetBy: markerLength)
        markdown.replaceSubrange(lineStart ..< markerEnd, with: replacement)
        let delta = replacement.count - markerLength
        let start = markdown.index(markdown.startIndex, offsetBy: max(startOffset + replacement.count, lowerOffset + delta))
        let end = markdown.index(markdown.startIndex, offsetBy: max(startOffset + replacement.count, upperOffset + delta))
        selection = start == end ? TextSelection(insertionPoint: start) : TextSelection(range: start ..< end)
    }
}
