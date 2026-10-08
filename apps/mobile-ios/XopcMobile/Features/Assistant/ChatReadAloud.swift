import AVFAudio
import MediaPlayer
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
    private(set) var position: TimeInterval = 0
    private(set) var duration: TimeInterval = 0
    private var chunks: [String] = []
    private var language = "en-US"
    private var player: AVAudioPlayer?
    private var fetchTask: Task<Void, Never>?
    private var prefetchTask: Task<Data, Error>?
    private var prefetchIndex = -1
    private var generation = 0
    private var activeGateway: GatewayClient?
    private var isAudioSessionActive = false
    private var progressTimer: Timer?
    private var remoteTargets: [(MPRemoteCommand, Any)] = []

    func toggle(id: String, text: String, locale: Locale, gateway: GatewayClient) {
        if sourceID == id {
            switch state {
            case .playing:
                player?.pause()
                state = .paused
                updateNowPlaying()
                return
            case .paused:
                player?.play()
                state = .playing
                updateNowPlaying()
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
        prefetchTask?.cancel()
        prefetchTask = nil
        prefetchIndex = -1
        player?.stop()
        player = nil
        progressTimer?.invalidate()
        progressTimer = nil
        position = 0
        duration = 0
        let hadRemoteCommands = !remoteTargets.isEmpty
        for (command, target) in remoteTargets { command.removeTarget(target) }
        remoteTargets.removeAll()
        if hadRemoteCommands { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil }
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
            let data: Data
            if prefetchIndex == chunkIndex, let prefetchTask {
                do {
                    data = try await prefetchTask.value
                } catch {
                    guard generation == self.generation, !Task.isCancelled else { return }
                    data = try await gateway.synthesizeSpeech(text: chunks[chunkIndex], language: language)
                }
                self.prefetchTask = nil
                prefetchIndex = -1
            } else {
                data = try await gateway.synthesizeSpeech(text: chunks[chunkIndex], language: language)
            }
            guard generation == self.generation, !Task.isCancelled else { return }
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            isAudioSessionActive = true
            let player = try AVAudioPlayer(data: data)
            player.delegate = self
            player.prepareToPlay()
            guard player.play() else { throw GatewayClientError.invalidResponse }
            self.player = player
            position = 0
            duration = player.duration
            state = .playing
            installRemoteCommands()
            updateNowPlaying()
            progressTimer?.invalidate()
            progressTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let player = self.player else { return }
                    self.position = player.currentTime
                    self.updateNowPlaying()
                }
            }
            prefetchNext(gateway: gateway, generation: generation)
        } catch {
            guard generation == self.generation, !Task.isCancelled else { return }
            let message = error.localizedDescription
            stop()
            state = .failed
            errorMessage = message
        }
    }

    private func prefetchNext(gateway: GatewayClient, generation: Int) {
        let next = chunkIndex + 1
        guard generation == self.generation, next < chunks.count, prefetchIndex != next else { return }
        prefetchTask?.cancel()
        prefetchIndex = next
        let text = chunks[next]
        let language = language
        prefetchTask = Task { try await gateway.synthesizeSpeech(text: text, language: language) }
    }

    func seek(to value: TimeInterval) {
        guard let player else { return }
        player.currentTime = min(max(0, value), player.duration)
        position = player.currentTime
        updateNowPlaying()
    }

    private func installRemoteCommands() {
        guard remoteTargets.isEmpty else { return }
        let center = MPRemoteCommandCenter.shared()
        let play = center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, self.state == .paused else { return }
                self.player?.play()
                self.state = .playing
                self.updateNowPlaying()
            }
            return .success
        }
        let pause = center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, self.state == .playing else { return }
                self.player?.pause()
                self.state = .paused
                self.updateNowPlaying()
            }
            return .success
        }
        let stop = center.stopCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.stop() }
            return .success
        }
        let seek = center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in self?.seek(to: position) }
            return .success
        }
        remoteTargets = [(center.playCommand, play), (center.pauseCommand, pause),
                         (center.stopCommand, stop), (center.changePlaybackPositionCommand, seek)]
    }

    private func updateNowPlaying() {
        guard player != nil else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: "xopc",
            MPMediaItemPropertyArtist: AppLocalization.resolve("朗读"),
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: state == .playing ? 1 : 0
        ]
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let playerID = ObjectIdentifier(player)
        Task { @MainActor in
            guard self.player.map(ObjectIdentifier.init) == playerID else { return }
            self.progressTimer?.invalidate()
            self.progressTimer = nil
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
