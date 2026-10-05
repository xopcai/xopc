import SwiftUI

@available(iOS 18.0, *)
struct MarkdownNoteInput: View {
    @Binding var markdown: String
    @State private var selection: TextSelection?
    @State private var undoStack: [String] = []
    @State private var redoStack: [String] = []
    @State private var skipsHistoryChange = false
    @FocusState private var isEditing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal) {
                HStack(spacing: 12) {
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
                }
                .buttonStyle(.bordered)
            }
            .accessibilityLabel("Markdown 格式")
            .accessibilityIdentifier("note-markdown-toolbar")
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
        let insertionOffset = markdown.distance(from: markdown.startIndex, to: range.upperBound) + prefix.count
        let lineStart = markdown[..<range.lowerBound].lastIndex(of: "\n")
            .map { markdown.index(after: $0) } ?? markdown.startIndex
        markdown.insert(contentsOf: prefix, at: lineStart)
        selection = TextSelection(insertionPoint: markdown.index(markdown.startIndex, offsetBy: insertionOffset))
    }
}
