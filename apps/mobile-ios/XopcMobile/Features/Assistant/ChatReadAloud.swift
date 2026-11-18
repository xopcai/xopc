import AVFAudio
import MediaPlayer
import SwiftUI

enum ChatSpeechText {
    private static let firstChunkLimit = 160
    private static let chunkLimit = 420
    private static let breaks = [
        #"[。！？!?]+["'”’」』）)]*|\.+["'”’」』）)]*(?=\s)|\n+"#,
        #"[，、；：]|[,;:](?=\s)"#,
        #"\s"#
    ].compactMap { try? NSRegularExpression(pattern: $0) }

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

        var chunks: [String] = []
        var rest = text as NSString
        var limit = firstChunkLimit
        while rest.length > limit {
            let window = rest.substring(to: limit + 1)
            let range = NSRange(location: 0, length: window.utf16.count)
            var end = breaks.lazy.compactMap { pattern in
                pattern.matches(in: window, range: range).last {
                    (limit / 2 ... limit).contains($0.range.upperBound)
                }?.range.upperBound
            }.first ?? limit
            if (0xD800 ... 0xDBFF).contains(rest.character(at: end - 1)) {
                end -= 1
            }
            chunks.append(rest.substring(to: end).trimmingCharacters(in: .whitespacesAndNewlines))
            rest = rest.substring(from: end).trimmingCharacters(in: .whitespacesAndNewlines) as NSString
            limit = chunkLimit
        }
        if rest.length > 0 {
            chunks.append(rest as String)
        }
        return chunks
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

struct ChatSpeechScope: Hashable {
    let configuration: GatewayConfiguration
    let conversationID: String
    let transcriptID: String?
}

struct ChatSpeechReply: Equatable {
    let id: String
    let text: String
}

struct ChatSpeechObservation: Equatable {
    let scope: ChatSpeechScope
    let replies: [ChatSpeechReply]
}

// swiftlint:disable:next type_body_length
@MainActor @Observable final class ChatReadAloud: NSObject, AVAudioPlayerDelegate {
    static let shared = ChatReadAloud()

    enum State { case idle, loading, playing, paused, waiting, failed }

    private struct Position {
        var chunk = 0
        var offset: TimeInterval = 0
        var autoplay = true
    }

    private final class Reading {
        var queue: [ChatSpeechReply]
        var seen: Set<String>
        var position = Position()

        init(queue: [ChatSpeechReply], seen: Set<String>) {
            self.queue = queue
            self.seen = seen
        }
    }

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
    @ObservationIgnored private var readings: [ChatSpeechScope: Reading] = [:]
    @ObservationIgnored private var activeScope: ChatSpeechScope?
    private(set) var owner: UUID?
    @ObservationIgnored private var replies: [ChatSpeechReply] = []
    @ObservationIgnored private var fallbackLocale = Locale(identifier: "en-US")
    @ObservationIgnored private var playbackPosition = Position()
    @ObservationIgnored private let synthesize: @MainActor (GatewayClient, String, String) async throws -> Data

    init(synthesize: @escaping @MainActor (GatewayClient, String, String) async throws -> Data = {
        try await $0.synthesizeSpeech(text: $1, language: $2)
    }) {
        self.synthesize = synthesize
        super.init()
    }

    func show(_ observation: ChatSpeechObservation?, owner: UUID, locale: Locale) {
        guard let observation else { leave(owner: owner); return }
        let scope = observation.scope
        if activeScope != scope {
            if let previousOwner = self.owner {
                leave(owner: previousOwner)
            }
            readings = readings.filter { key, _ in
                key.configuration == scope.configuration && (key.conversationID != scope.conversationID || key == scope)
            }
            activeScope = scope
        }
        self.owner = owner
        replies = observation.replies
        fallbackLocale = locale
        guard let reading = readings[scope] else { return }
        let anchor = replies.lastIndex { reading.seen.contains($0.id) }.map { $0 + 1 } ?? 0
        for reply in replies.dropFirst(anchor) where reading.seen.insert(reply.id).inserted {
            reading.queue.append(reply)
        }
        if state == .idle || state == .waiting {
            playNext()
        }
    }

    func leave(owner: UUID) {
        guard self.owner == owner else { return }
        if let activeScope, let reading = readings[activeScope], !reading.queue.isEmpty {
            reading.position = Position(chunk: chunkIndex, offset: player?.currentTime ?? playbackPosition.offset,
                                        autoplay: state == .playing || (state == .loading && playbackPosition.autoplay))
        }
        self.owner = nil
        activeScope = nil
        replies = []
        stopOutput()
    }

    func toggle(id: String, text: String, locale: Locale, gateway: GatewayClient, conversationID: String? = nil) {
        if let scope = activeScope, conversationID != nil, scope.conversationID != conversationID {
            return
        }
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
            case .idle, .waiting, .failed: break
            }
        }
        if let scope = activeScope, scope.conversationID == conversationID {
            let next = replies.firstIndex { $0.id == id }.map { Array(replies.dropFirst($0 + 1)) } ?? []
            readings[scope] = Reading(queue: [ChatSpeechReply(id: id, text: text)] + next,
                                      seen: Set(replies.map(\.id)).union([id]))
            fallbackLocale = locale
            playNext()
        } else {
            start(id: id, text: text, locale: locale, gateway: gateway)
        }
    }

    private func playNext() {
        guard let scope = activeScope, let reading = readings[scope] else { stopOutput(); return }
        while let reply = reading.queue.first {
            if start(id: reply.id, text: reply.text, locale: fallbackLocale,
                     gateway: GatewayClient(configuration: scope.configuration), at: reading.position)
            {
                return
            }
            reading.queue.removeFirst()
            reading.position = Position()
        }
        stopOutput()
        state = .waiting
    }

    @discardableResult
    private func start(id: String, text: String, locale: Locale, gateway: GatewayClient,
                       at saved: Position = Position()) -> Bool
    {
        stopOutput()
        chunks = ChatSpeechText.chunks(from: text)
        guard !chunks.isEmpty else { return false }
        sourceID = id
        chunkIndex = min(saved.chunk, chunks.count - 1)
        chunkCount = chunks.count
        playbackPosition = saved
        language = ChatSpeechText.language(for: text, fallback: locale)
        activeGateway = gateway
        state = .loading
        let current = generation
        fetchTask = Task { await loadChunk(gateway: gateway, generation: current) }
        return true
    }

    func stop() {
        if let activeScope {
            readings.removeValue(forKey: activeScope)
        }
        stopOutput()
    }

    private func stopOutput() {
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
        for (command, target) in remoteTargets {
            command.removeTarget(target)
        }
        remoteTargets.removeAll()
        if hadRemoteCommands {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        }
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

    // swiftlint:disable:next cyclomatic_complexity function_body_length
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
                    data = try await synthesize(gateway, chunks[chunkIndex], language)
                }
                guard generation == self.generation, !Task.isCancelled else { return }
                self.prefetchTask = nil
                prefetchIndex = -1
            } else {
                prefetchNext(gateway: gateway, generation: generation)
                data = try await synthesize(gateway, chunks[chunkIndex], language)
            }
            guard generation == self.generation, !Task.isCancelled else { return }
            prefetchNext(gateway: gateway, generation: generation)
            if !isAudioSessionActive {
                GeneratedMusicPlayback.shared.yieldAudioSession()
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                isAudioSessionActive = true
            }
            let player = try AVAudioPlayer(data: data)
            player.delegate = self
            player.prepareToPlay()
            player.currentTime = min(playbackPosition.offset, max(0, player.duration - 0.001))
            if playbackPosition.autoplay, !player.play() {
                throw GatewayClientError.invalidResponse
            }
            self.player = player
            position = player.currentTime
            duration = player.duration
            state = playbackPosition.autoplay ? .playing : .paused
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
        } catch {
            guard generation == self.generation, !Task.isCancelled else { return }
            let message = error.localizedDescription
            stopOutput()
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
        let synthesize = synthesize
        prefetchTask = Task { try await synthesize(gateway, text, language) }
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
                self.playbackPosition = Position(chunk: self.chunkIndex)
                let current = self.generation
                if let gateway = self.activeGateway {
                    self.fetchTask = Task { await self.loadChunk(gateway: gateway, generation: current) }
                }
            } else if flag, let scope = self.activeScope, let reading = self.readings[scope],
                      reading.queue.first?.id == self.sourceID
            {
                reading.queue.removeFirst()
                reading.position = Position()
                self.playNext()
            } else {
                self.stop()
            }
        }
    }
}
