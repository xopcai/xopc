import SwiftUI

struct ConfirmedAnswerView: View {
    let message: TimelineMessage
    let configuration: GatewayConfiguration
    let conversationID: String?
    let animate: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var displayed = ""
    @State private var completedMessageID: String?

    var body: some View {
        if message.revealAnswer, animate, !reduceMotion, completedMessageID != message.id {
            MarkdownBodyView(parts: [], configuration: configuration, conversationID: conversationID,
                             markdown: displayed.isEmpty ? String(message.text.prefix(12)) : displayed,
                             streaming: displayed != message.text)
                .task(id: message.text) {
                    let source = message.text
                    let count = source.count
                    let step = max(12, (count + 31) / 32)
                    var cursor = source.hasPrefix(displayed)
                        ? (source.index(source.startIndex, offsetBy: displayed.count, limitedBy: source.endIndex) ?? source.endIndex)
                        : source.startIndex
                    while cursor < source.endIndex {
                        guard !Task.isCancelled else { return }
                        cursor = source.index(cursor, offsetBy: step, limitedBy: source.endIndex) ?? source.endIndex
                        displayed = String(source[..<cursor])
                        if cursor < source.endIndex {
                            do { try await Task.sleep(for: .milliseconds(24)) } catch { return }
                        }
                    }
                    completedMessageID = message.id
                }
        } else {
            MarkdownBodyView(parts: message.markdownParts, configuration: configuration, conversationID: conversationID,
                             markdown: message.markdownParts.isEmpty ? message.text : nil)
                .onAppear {
                    if message.revealAnswer {
                        completedMessageID = message.id
                    }
                }
        }
    }
}
