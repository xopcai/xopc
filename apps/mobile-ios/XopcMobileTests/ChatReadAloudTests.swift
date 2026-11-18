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
        #expect(chunks.allSatisfy { !$0.isEmpty && $0.utf16.count <= 420 })
        #expect(chunks.first?.utf16.count ?? 0 <= 160)
        #expect(chunks.joined().contains("the guide"))
        #expect(!chunks.joined().contains("secret code"))
        #expect(!chunks.joined().contains("https://"))
    }

    @Test func detectsSpeechLanguage() {
        #expect(ChatSpeechText.language(for: "中文内容", fallback: Locale(identifier: "en-US")) == "zh-CN")
        #expect(ChatSpeechText.language(for: "Hello world", fallback: Locale(identifier: "zh-CN")) == "en-US")
    }

    @Test func groupsShortSentencesAndSplitsAtNaturalPauses() {
        let short = "Results. The rate is 3.14. Next sentence.\nA final line."
        let first = "Summary\n" + String(repeating: "Some more context ", count: 7) + "ends here."
        let second = "This is the next sentence. It can be synthesized in parallel."
        #expect(ChatSpeechText.chunks(from: short) == [short])
        #expect(ChatSpeechText.chunks(from: first + " " + second) == [first, second])
        let emoji = String(repeating: "🙂你", count: 500)
        #expect(ChatSpeechText.chunks(from: emoji).joined() == emoji)
    }

    @MainActor
    @Test func prefetchesTheNextChunkBeforeTheFirstCompletes() async throws {
        let first = String(repeating: "A", count: 139) + "."
        let second = String(repeating: "B", count: 35) + "."
        var requests = [String]()
        let reader = ChatReadAloud { _, text, _ in
            requests.append(text)
            if text == first {
                try await Task.sleep(for: .seconds(5))
            }
            return silentWAV(seconds: 0.2)
        }
        defer { reader.stop() }

        reader.toggle(id: "reply", text: first + " " + second, locale: Locale(identifier: "en-US"),
                      gateway: GatewayClient(configuration: .local))
        try await waitUntil { requests.count == 2 }
        #expect(requests == [first, second])
        #expect(reader.state == .loading)
    }

    @MainActor
    @Test func resumesTheSavedPositionAndReadsNewRepliesInOrder() async throws {
        let configuration = GatewayConfiguration.local
        let original = ChatSpeechScope(configuration: configuration, conversationID: "original", transcriptID: "a")
        let other = ChatSpeechScope(configuration: configuration, conversationID: "other", transcriptID: "b")
        let owner = UUID()
        let locale = Locale(identifier: "en-US")
        let first = ChatSpeechReply(id: "first", text: "First reply")
        let second = ChatSpeechReply(id: "second", text: "Second reply")
        let third = ChatSpeechReply(id: "third", text: "Third reply")
        var requests = [String]()
        let reader = ChatReadAloud { _, text, _ in
            requests.append(text)
            return silentWAV(seconds: text == first.text ? 2 : 0.2)
        }
        defer { reader.stop() }

        reader.show(ChatSpeechObservation(scope: original, replies: [first, second]), owner: owner, locale: locale)
        reader.toggle(id: first.id, text: first.text, locale: locale,
                      gateway: GatewayClient(configuration: configuration), conversationID: original.conversationID)
        try await waitUntil { reader.state == .playing }
        reader.seek(to: 1)
        reader.show(ChatSpeechObservation(scope: other, replies: []), owner: owner, locale: locale)
        #expect(reader.state == .idle)
        #expect(requests == [first.text])

        reader.show(ChatSpeechObservation(scope: original, replies: [first, second, third]), owner: owner, locale: locale)
        try await waitUntil { reader.state == .playing }
        #expect(reader.sourceID == first.id)
        #expect(reader.position >= 1)
        try await waitUntil { reader.state == .waiting }
        #expect(requests == [first.text, first.text, second.text, third.text])
    }

    @MainActor
    private func waitUntil(_ completed: () -> Bool) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(5))
        while !completed(), clock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        try #require(completed())
    }

    private func silentWAV(seconds: Double) -> Data {
        let size = Int(seconds * 8000) * 2
        var data = Data()
        func appendUInt(_ value: UInt32, bytes: Int = 4) {
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0.prefix(bytes)) }
        }
        data.append(contentsOf: "RIFF".utf8)
        appendUInt(UInt32(36 + size))
        data.append(contentsOf: "WAVEfmt ".utf8)
        appendUInt(16)
        appendUInt(1, bytes: 2)
        appendUInt(1, bytes: 2)
        appendUInt(8000)
        appendUInt(16000)
        appendUInt(2, bytes: 2)
        appendUInt(16, bytes: 2)
        data.append(contentsOf: "data".utf8)
        appendUInt(UInt32(size))
        data.append(Data(count: size))
        return data
    }
}
