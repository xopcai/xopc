import Foundation
import Testing
@testable import XopcMobile

struct ChatReadAloudTests {
    @Test func stripsNonSpeakableMarkdownAndBoundsChunks() {
        let source = """
        # Heading
        Read [the guide](https://example.com) now. ![chart](chart.png)
        ```swift
        print("secret code")
        ```
        \(String(repeating: "中文内容", count: 100))
        """

        let chunks = ChatSpeechText.chunks(from: source)

        #expect(!chunks.isEmpty)
        #expect(chunks.allSatisfy { !$0.isEmpty && $0.count <= 240 })
        #expect(chunks.joined().contains("the guide"))
        #expect(!chunks.joined().contains("secret code"))
        #expect(!chunks.joined().contains("https://"))
    }

    @Test func detectsSpeechLanguage() {
        #expect(ChatSpeechText.language(for: "中文内容", fallback: Locale(identifier: "en-US")) == "zh-CN")
        #expect(ChatSpeechText.language(for: "Hello world", fallback: Locale(identifier: "zh-CN")) == "en-US")
    }
}
