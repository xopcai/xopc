import SwiftUI

struct StreamingMarkdownText: View {
    let source: String
    let streaming: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var prefix = AttributedString()
    @State private var suffix = AttributedString()
    @State private var rendered = ""
    @State private var renderedCount = 0
    @State private var tailAlpha = 1.0

    var body: some View {
        Text("\(Text(prefix))\(Text(suffix).foregroundStyle(.primary.opacity(tailAlpha)))")
            .task(id: source) {
                let text = source
                let parse = Task.detached(priority: .userInitiated) {
                    let parsed = (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                        ?? AttributedString(text)
                    let plain = String(parsed.characters)
                    return (parsed, plain, plain.count, text.utf16.count <= 8192)
                }
                let (parsed, next, count, bounded) = await withTaskCancellationHandler { await parse.value } onCancel: { parse.cancel() }
                guard !Task.isCancelled else { return }
                let added = count - renderedCount
                let fade = bounded && streaming && !reduceMotion && scenePhase == .active && !rendered.isEmpty &&
                    next.hasPrefix(rendered) && (1...256).contains(added)
                if fade {
                    let split = parsed.characters.index(parsed.startIndex, offsetBy: renderedCount)
                    prefix = AttributedString(parsed[..<split]); suffix = AttributedString(parsed[split...])
                } else { prefix = parsed; suffix = AttributedString() }
                rendered = next
                renderedCount = count
                tailAlpha = fade ? 0.45 : 1
                if fade { withAnimation(.easeOut(duration: 0.18)) { tailAlpha = 1 } }
            }
            .onChange(of: streaming) { if !streaming { tailAlpha = 1 } }
            .onChange(of: reduceMotion) { if reduceMotion { tailAlpha = 1 } }
            .onChange(of: scenePhase) { if scenePhase != .active { tailAlpha = 1 } }
    }
}
