import SwiftUI

struct ConfirmedAnswerView: View {
    let message: TimelineMessage
    let configuration: GatewayConfiguration
    let conversationID: String?
    let animate: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var displayed = ""

    var body: some View {
        MarkdownBodyView(parts: [], configuration: configuration, conversationID: conversationID,
                         markdown: displayed, streaming: message.revealAnswer && animate)
            .task(id: message.text) {
                let source = message.text
                guard message.revealAnswer, animate, !reduceMotion else { displayed = source; return }
                let count = source.count
                let step = max(12, (count + 31) / 32)
                var end = 0
                while end < count {
                    guard !Task.isCancelled else { return }
                    end = min(count, end + step)
                    displayed = String(source.prefix(end))
                    do { try await Task.sleep(for: .milliseconds(24)) } catch { return }
                }
            }
    }
}
