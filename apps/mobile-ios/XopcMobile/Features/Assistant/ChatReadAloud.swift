import AVFAudio
import SwiftUI

enum ChatSpeechText {
    static func chunks(from markdown: String) -> [String] {
        let patterns = [
            "(?s)```.*?```|~~~.*?~~~",
            "xopc-product-delivery:\\S+",
            "!\\[([^]]*)\\]\\([^)]*\\)",
            "\\[([^]]+)\\]\\([^)]*\\)",
            "https?://\\S+",
            "(?m)^#{1,6}\\s+|^\\s*[-*+]\\s+|^\\s*\\d+[.)]\\s+",
            "[|`*_~>]"
        ]
        var text = markdown
        for (index, pattern) in patterns.enumerated() {
            text = text.replacingOccurrences(
                of: pattern,
                with: index == 2 || index == 3 ? "$1" : " ",
                options: .regularExpression
            )
        }
        text = text.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "[\\t ]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return [] }

        var chunks: [String] = []
        var current = ""
        for sentence in sentences(in: text) {
            var remaining = sentence
            while !remaining.isEmpty {
                let piece = String(remaining.prefix(240))
                remaining.removeFirst(piece.count)
                if current.count + piece.count > 240 {
                    chunks.append(current)
                    current = ""
                }
                current += piece
            }
        }
        if !current.isEmpty {
            chunks.append(current)
        }
        return chunks
    }

    private static func sentences(in text: String) -> [String] {
        var sentences: [String] = []
        var sentence = ""
        for character in text {
            sentence.append(character)
            if "。！？!?.\n".contains(character) {
                sentences.append(sentence.trimmingCharacters(in: .whitespacesAndNewlines))
                sentence = ""
            }
        }
        if !sentence.isEmpty {
            sentences.append(sentence.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return sentences
    }

    static func language(for text: String, fallback: Locale) -> String {
        let han = text.unicodeScalars.filter { (0x3400 ... 0x9FFF).contains($0.value) }.count
        let latin = text.unicodeScalars.filter { (0x41 ... 0x5A).contains($0.value) || (0x61 ... 0x7A).contains($0.value) }.count
        if han == 0, latin == 0 {
            return fallback.language.languageCode?.identifier == "zh" ? "zh-CN" : "en-US"
        }
        return han * 2 >= latin ? "zh-CN" : "en-US"
    }
}

@MainActor @Observable final class ChatReadAloud: NSObject, AVAudioPlayerDelegate {
    enum State { case idle, loading, playing, paused, failed }

    private(set) var state: State = .idle
    private(set) var sourceID: String?
    private(set) var errorMessage: String?
    private(set) var chunkIndex = 0
    private(set) var chunkCount = 0
    private var chunks: [String] = []
    private var language = "en-US"
    private var player: AVAudioPlayer?
    private var fetchTask: Task<Void, Never>?
    private var generation = 0
    private var activeGateway: GatewayClient?
    private var isAudioSessionActive = false

    func toggle(id: String, text: String, locale: Locale, gateway: GatewayClient) {
        if sourceID == id {
            switch state {
            case .playing:
                player?.pause()
                state = .paused
                return
            case .paused:
                player?.play()
                state = .playing
                return
            case .loading:
                stop()
                return
            case .idle, .failed: break
            }
        }
        stop()
        chunks = ChatSpeechText.chunks(from: text)
        guard !chunks.isEmpty else { return }
        sourceID = id
        chunkIndex = 0
        chunkCount = chunks.count
        language = ChatSpeechText.language(for: text, fallback: locale)
        activeGateway = gateway
        let current = generation
        fetchTask = Task { await loadChunk(gateway: gateway, generation: current) }
    }

    func stop() {
        generation += 1
        fetchTask?.cancel()
        fetchTask = nil
        player?.stop()
        player = nil
        if isAudioSessionActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            isAudioSessionActive = false
        }
        sourceID = nil
        state = .idle
        errorMessage = nil
        chunks = []
        chunkIndex = 0
        chunkCount = 0
        activeGateway = nil
    }

    private func loadChunk(gateway: GatewayClient, generation: Int) async {
        guard generation == self.generation, chunkIndex < chunks.count else { return }
        state = .loading
        do {
            let data = try await gateway.synthesizeSpeech(text: chunks[chunkIndex], language: language)
            guard generation == self.generation, !Task.isCancelled else { return }
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            isAudioSessionActive = true
            let player = try AVAudioPlayer(data: data)
            player.delegate = self
            player.prepareToPlay()
            guard player.play() else { throw GatewayClientError.invalidResponse }
            self.player = player
            state = .playing
        } catch {
            guard generation == self.generation, !Task.isCancelled else { return }
            state = .failed
            errorMessage = error.localizedDescription
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let playerID = ObjectIdentifier(player)
        Task { @MainActor in
            guard self.player.map(ObjectIdentifier.init) == playerID else { return }
            self.player = nil
            if flag, self.chunkIndex + 1 < self.chunks.count {
                self.chunkIndex += 1
                let current = self.generation
                if let gateway = self.activeGateway {
                    self.fetchTask = Task { await self.loadChunk(gateway: gateway, generation: current) }
                }
            } else {
                self.stop()
            }
        }
    }
}
