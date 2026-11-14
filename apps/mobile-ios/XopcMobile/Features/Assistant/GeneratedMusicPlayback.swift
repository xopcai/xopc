import AVFoundation
import MediaPlayer
import Observation
import SwiftUI

struct GeneratedMusicTrack: Equatable {
    let configurationScope: String
    let conversationID: String
    let id: String
    let title: String
    let source: String
    let lyrics: String?
    let duration: Double?
    var sourceAgentID: String? = nil

    var key: String { "\(configurationScope)/\(conversationID)/\(id)" }
}

@MainActor @Observable
final class GeneratedMusicPlayback {
    static let shared = GeneratedMusicPlayback()

    enum Phase: Equatable { case loading, playing, paused, ended, failed }

    private(set) var track: GeneratedMusicTrack?
    private(set) var phase: Phase = .paused
    private(set) var duration: Double = 0
    private(set) var position: Double = 0
    private(set) var localURL: URL?
    var expanded = false

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var load: Task<Void, Never>?
    @ObservationIgnored private var updates: Task<Void, Never>?
    @ObservationIgnored private var downloader: (() async throws -> URL)?
    @ObservationIgnored private var playWhenReady = true
    @ObservationIgnored private var remoteTargets: [(MPRemoteCommand, Any)] = []

    private init() {}

    func play(_ track: GeneratedMusicTrack, downloading: @escaping () async throws -> URL) {
        if self.track?.key == track.key { toggle(); return }
        clear()
        self.track = track
        downloader = downloading
        duration = track.duration ?? 0
        prepare()
    }

    func toggle() {
        switch phase {
        case .loading: playWhenReady.toggle()
        case .playing: pause()
        case .paused, .ended: resume()
        case .failed: if player != nil { resume() } else { prepare() }
        }
    }

    func pause() {
        playWhenReady = false
        guard phase == .playing else { return }
        player?.pause()
        updates?.cancel()
        if let player { position = player.currentTime }
        phase = .paused
        savePosition()
        publish()
    }

    func yieldAudioSession() {
        pause()
        removeMediaCommands()
    }

    func seek(_ seconds: Double) {
        guard seconds.isFinite, let player else { return }
        position = min(max(0, seconds), duration)
        player.currentTime = position
        if phase == .ended { phase = .paused }
        savePosition()
        publish()
    }

    func stop() {
        clear()
        expanded = false
    }

    func checkpoint() {
        guard let player else { return }
        if phase == .playing { position = player.currentTime }
        savePosition()
    }

    func validateScope(_ configuration: GatewayConfiguration) {
        if let track, configuration.token.isEmpty ||
            track.configurationScope != ComposerDraftStore.accountScope(configuration) { stop() }
    }

    private func prepare() {
        guard let track, let downloader else { return }
        load?.cancel()
        phase = .loading
        playWhenReady = true
        load = Task {
            do {
                let url = try await downloader()
                guard !Task.isCancelled, self.track?.key == track.key else {
                    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
                    return
                }
                localURL = url
                let audio = try AVAudioPlayer(contentsOf: url)
                audio.prepareToPlay()
                player = audio
                duration = audio.duration
                let saved = UserDefaults.standard.double(forKey: "music.position.\(track.key)")
                position = saved < duration ? saved : 0
                audio.currentTime = position
                phase = .paused
                if playWhenReady { resume() }
            } catch {
                if !Task.isCancelled, self.track?.key == track.key {
                    releaseFile()
                    phase = .failed
                    publish()
                }
            }
        }
    }

    private func resume() {
        if phase == .loading { playWhenReady = true; return }
        guard let player else {
            if phase == .failed { prepare() }
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            if phase == .ended { player.currentTime = 0; position = 0 }
            guard player.play() else { throw GatewayClientError.invalidResponse }
            phase = .playing
            installMediaCommands()
            publish()
            updates?.cancel()
            updates = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                    guard let self, self.phase == .playing, let audio = self.player else { return }
                    if !audio.isPlaying {
                        self.phase = .ended
                        self.position = self.duration
                        self.savePosition()
                        self.publish()
                        return
                    }
                    self.position = audio.currentTime
                }
            }
        } catch {
            phase = .failed
            publish()
        }
    }

    private func clear() {
        if let player, phase != .ended { position = player.currentTime; savePosition() }
        let wasPlaying = phase == .playing
        load?.cancel()
        updates?.cancel()
        player?.stop()
        player = nil
        releaseFile()
        track = nil
        downloader = nil
        duration = 0
        position = 0
        phase = .paused
        removeMediaCommands()
        if wasPlaying { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    private func releaseFile() {
        if let localURL { try? FileManager.default.removeItem(at: localURL.deletingLastPathComponent()) }
        localURL = nil
    }

    private func savePosition() {
        guard let track else { return }
        UserDefaults.standard.set(phase == .ended ? 0 : position, forKey: "music.position.\(track.key)")
    }

    private func installMediaCommands() {
        guard remoteTargets.isEmpty else { return }
        let commands = MPRemoteCommandCenter.shared()
        register(commands.playCommand) { _ in
            Task { @MainActor in Self.shared.resume() }
            return .success
        }
        register(commands.pauseCommand) { _ in
            Task { @MainActor in Self.shared.pause() }
            return .success
        }
        register(commands.togglePlayPauseCommand) { _ in
            Task { @MainActor in Self.shared.toggle() }
            return .success
        }
        register(commands.changePlaybackPositionCommand) { event in
            guard let seconds = (event as? MPChangePlaybackPositionCommandEvent)?.positionTime else { return .commandFailed }
            Task { @MainActor in Self.shared.seek(seconds) }
            return .success
        }
        register(commands.stopCommand) { _ in
            Task { @MainActor in Self.shared.stop() }
            return .success
        }
    }

    private func register(_ command: MPRemoteCommand, handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
        command.isEnabled = true
        remoteTargets.append((command, command.addTarget(handler: handler)))
    }

    private func removeMediaCommands() {
        guard !remoteTargets.isEmpty else { return }
        for (command, token) in remoteTargets { command.removeTarget(token) }
        remoteTargets.removeAll()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func publish() {
        guard let track, !remoteTargets.isEmpty else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.source,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: phase == .playing ? 1 : 0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue
        ]
    }
}

struct GeneratedMusicDock: View {
    let playback: GeneratedMusicPlayback

    var body: some View {
        if let track = playback.track {
            HStack(spacing: 8) {
                Button { playback.expanded = true } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(track.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(track.source).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    } icon: { Image(systemName: "music.note") }
                    .padding(.leading, 10)
                    .frame(minHeight: 48)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("music-open-player")
                GeneratedMusicPlayButton(playback: playback, identifier: "music-mini-play-toggle")
                Button("停止播放", systemImage: "xmark", action: playback.stop).labelStyle(.iconOnly)
                    .frame(width: 44, height: 44)
            }
            .padding(.horizontal, 6)
            .background(.regularMaterial, in: .rect(cornerRadius: 18))
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("music-mini-player")
            .accessibilityHidden(playback.expanded)
        }
    }
}

struct GeneratedMusicPlayButton: View {
    let playback: GeneratedMusicPlayback
    var identifier = "music-play-toggle"

    var body: some View {
        if playback.phase == .loading {
            ProgressView().frame(width: 44, height: 44)
        } else {
            Button(playback.phase == .playing ? "暂停" : "播放",
                   systemImage: playback.phase == .playing ? "pause.fill" : "play.fill", action: playback.toggle)
                .labelStyle(.iconOnly).frame(width: 44, height: 44)
                .accessibilityIdentifier(identifier)
        }
    }
}

struct GeneratedMusicPlayer: View {
    let playback: GeneratedMusicPlayback
    let onSource: (GeneratedMusicTrack) -> Void

    var body: some View {
        if let track = playback.track {
            NavigationStack {
                ScrollView {
                    VStack(spacing: 16) {
                        Image(systemName: "music.note").font(.system(size: 55, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 138)
                            .foregroundStyle(.tint)
                            .background(Color.accentColor.opacity(0.11), in: .rect(cornerRadius: 24))
                            .accessibilityHidden(true)
                        Text(track.title).font(.title2.bold()).multilineTextAlignment(.center)
                        Text(track.source).foregroundStyle(.secondary)
                        Slider(value: Binding(get: { playback.position }, set: { value in playback.seek(value) }),
                               in: 0 ... max(1, playback.duration))
                            .disabled(playback.duration == 0).accessibilityLabel("播放进度")
                        HStack {
                            Text(time(playback.position)).accessibilityIdentifier("music-elapsed")
                            Spacer()
                            Text(time(playback.duration))
                        }
                        .font(.caption.monospacedDigit())
                        GeneratedMusicPlayButton(playback: playback)
                        if playback.phase == .failed {
                            Text("无法播放音乐").foregroundStyle(.secondary)
                        }
                        HStack {
                            Button("返回来源对话", systemImage: "bubble.left") { onSource(track) }
                            if let url = playback.localURL {
                                ShareLink(item: url) { Label("导出音频", systemImage: "square.and.arrow.up") }
                            }
                        }
                        .buttonStyle(.bordered)
                        if let lyrics = track.lyrics, !lyrics.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("歌词").font(.headline)
                                Text(lyrics).textSelection(.enabled)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(20)
                }
                .navigationTitle("正在播放").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("关闭", systemImage: "xmark") { playback.expanded = false }.labelStyle(.iconOnly)
                    }
                }
            }
        }
    }

    private func time(_ seconds: Double) -> String {
        let value = Int(max(0, seconds))
        return String(format: "%d:%02d", value / 60, value % 60)
    }
}
