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
    var sourceAgentID: String?

    var key: String {
        "\(configurationScope)/\(conversationID)/\(id)"
    }
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
        if self.track?.key == track.key {
            toggle(); return
        }
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
        case .failed: if player != nil {
                resume()
            } else {
                prepare()
            }
        }
    }

    func pause() {
        playWhenReady = false
        guard phase == .playing else { return }
        player?.pause()
        updates?.cancel()
        if let player {
            position = player.currentTime
        }
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
        if phase == .ended {
            phase = .paused
        }
        savePosition()
        publish()
    }

    func stop() {
        clear()
        expanded = false
    }

    func checkpoint() {
        guard let player else { return }
        if phase == .playing {
            position = player.currentTime
        }
        savePosition()
    }

    func validateScope(_ configuration: GatewayConfiguration) {
        if let track, configuration.token.isEmpty ||
            track.configurationScope != ComposerDraftStore.accountScope(configuration)
        {
            stop()
        }
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
                if playWhenReady {
                    resume()
                }
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
        if phase == .loading {
            playWhenReady = true; return
        }
        guard let player else {
            if phase == .failed {
                prepare()
            }
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            if phase == .ended {
                player.currentTime = 0; position = 0
            }
            guard player.play() else { throw GatewayClientError.invalidResponse }
            phase = .playing
            installMediaCommands()
            publish()
            updates?.cancel()
            updates = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                    guard let self, phase == .playing, let audio = self.player else { return }
                    if !audio.isPlaying {
                        phase = .ended
                        position = duration
                        savePosition()
                        publish()
                        return
                    }
                    position = audio.currentTime
                }
            }
        } catch {
            phase = .failed
            publish()
        }
    }

    private func clear() {
        if let player, phase != .ended {
            position = player.currentTime; savePosition()
        }
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
        if wasPlaying {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func releaseFile() {
        if let localURL {
            try? FileManager.default.removeItem(at: localURL.deletingLastPathComponent())
        }
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
        for (command, token) in remoteTargets {
            command.removeTarget(token)
        }
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
    @Environment(\.mobileTheme) private var mobileTheme
    let playback: GeneratedMusicPlayback
    var sticky = false

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
            .background(.regularMaterial, in: .rect(cornerRadius: mobileTheme.corner(18)))
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(sticky ? "music-sticky-player" : "music-mini-player")
            .accessibilityHidden(playback.expanded)
        }
    }
}

struct GeneratedMusicPlayButton: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let playback: GeneratedMusicPlayback
    var identifier = "music-play-toggle"
    var prominent = false

    private var title: LocalizedStringKey {
        switch playback.phase {
        case .loading: "正在加载音乐"
        case .playing: "暂停"
        case .failed: "重试"
        default: "播放"
        }
    }

    private var icon: String {
        switch playback.phase {
        case .playing: "pause.fill"
        case .failed: "arrow.clockwise"
        default: "play.fill"
        }
    }

    var body: some View {
        Button(action: playback.toggle) {
            Group {
                if playback.phase == .loading {
                    ProgressView().tint(prominent ? mobileTheme.onAction : mobileTheme.action)
                } else {
                    Image(systemName: icon).font(.system(size: prominent ? 26 : 17, weight: .semibold))
                }
            }
            .foregroundStyle(prominent ? mobileTheme.onAction : mobileTheme.action)
            .frame(width: prominent ? 64 : 44, height: prominent ? 64 : 44)
            .background(prominent ? mobileTheme.action : Color.clear, in: .circle)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(playback.phase == .loading)
        .accessibilityLabel(Text(title))
        .accessibilityIdentifier(identifier)
    }
}

struct GeneratedMusicPlayer: View {
    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let playback: GeneratedMusicPlayback
    let onSource: (GeneratedMusicTrack) -> Void
    @State private var showLyrics = true

    var body: some View {
        if let track = playback.track {
            VStack(spacing: 4) {
                header
                trackHeader(track)
                Group {
                    if showLyrics, let lyrics = track.lyrics, hasLyrics(track) {
                        ScrollView {
                            Text(lyrics).font(.title3.weight(.semibold)).lineSpacing(10)
                                .textSelection(.enabled).accessibilityIdentifier("music-lyrics-text")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 24).padding(.vertical, 20)
                                .frame(maxWidth: 480).frame(maxWidth: .infinity)
                        }
                        .accessibilityIdentifier("music-player-content")
                    } else {
                        ViewThatFits(in: .vertical) {
                            GeneratedMusicCover().frame(width: 232, height: 232)
                            GeneratedMusicCover().frame(width: 128, height: 128)
                            Spacer(minLength: 0)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .id(track.key)
                VStack(alignment: .trailing, spacing: 4) {
                    if playback.phase == .failed {
                        Text("无法播放音乐").font(.footnote).foregroundStyle(mobileTheme.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    trackActions(track)
                    GeneratedMusicTimeline(playback: playback)
                }
                .padding(.horizontal, 24).padding(.bottom, 12)
                .frame(maxWidth: 480)
            }
            .padding(.top, 14)
            .foregroundStyle(mobileTheme.foreground)
            .onChange(of: track.key) { showLyrics = true }
            .presentationDetents([.fraction(0.88), .large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(mobileTheme.corner(28))
            .presentationBackground(mobileTheme.canvas)
        }
    }

    private var header: some View {
        HStack(spacing: 0) {
            Button("收起播放器", systemImage: "chevron.down") { playback.expanded = false }
                .labelStyle(.iconOnly).frame(width: 44, height: 44)
                .accessibilityIdentifier("music-minimize")
            Text("正在播放").font(.subheadline.weight(.medium)).foregroundStyle(mobileTheme.secondary)
                .frame(maxWidth: .infinity)
            Button("停止播放", systemImage: "xmark", action: playback.stop)
                .labelStyle(.iconOnly).frame(width: 44, height: 44)
                .accessibilityIdentifier("music-player-close")
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12).frame(maxWidth: 480)
    }

    private func trackHeader(_ track: GeneratedMusicTrack) -> some View {
        HStack(spacing: 12) {
            GeneratedMusicCover().frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 3) {
                Text(track.title).font(.headline).lineLimit(2).accessibilityAddTraits(.isHeader)
                Group {
                    if track.source.isEmpty { Text("音乐") } else { Text(track.source) }
                }
                .font(.footnote).foregroundStyle(mobileTheme.secondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button("返回来源对话", systemImage: "bubble.left") { onSource(track) }
                .labelStyle(.iconOnly).frame(width: 44, height: 44)
                .foregroundStyle(mobileTheme.secondary)
                .buttonStyle(.plain).accessibilityIdentifier("music-return-source")
        }
        .padding(.horizontal, 24).padding(.vertical, 4).frame(maxWidth: 480)
    }

    private func hasLyrics(_ track: GeneratedMusicTrack) -> Bool {
        track.lyrics?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private func trackActions(_ track: GeneratedMusicTrack) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            if let url = playback.localURL {
                ShareLink(item: url) { actionLabel("导出音频", icon: "square.and.arrow.up") }
            }
            if hasLyrics(track) {
                Button { showLyrics.toggle() } label: {
                    actionLabel(showLyrics ? "收起歌词" : "歌词", icon: "quote.bubble")
                }
                .accessibilityIdentifier("music-lyrics")
            }
        }
        .buttonStyle(.plain)
    }

    private func actionLabel(_ title: LocalizedStringKey, icon: String) -> some View {
        Label(title, systemImage: icon).font(.footnote.weight(.medium)).foregroundStyle(mobileTheme.action)
            .padding(.horizontal, 8).frame(minHeight: 44)
    }
}

private struct GeneratedMusicCover: View {
    @Environment(\.mobileTheme) private var mobileTheme

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let shape = RoundedRectangle(cornerRadius: mobileTheme.corner(width < 80 ? 12 : 24))
            ZStack {
                shape.fill(LinearGradient(colors: [mobileTheme.action.opacity(0.13), mobileTheme.card],
                                          startPoint: .topLeading, endPoint: .bottomTrailing))
                Circle().fill(mobileTheme.input.opacity(0.5)).frame(width: width * 0.74)
                Circle().fill(mobileTheme.bubble).frame(width: width * 0.56)
                Circle().fill(mobileTheme.canvas).frame(width: width * 0.39)
                Image(systemName: "music.note").font(.system(size: width * 0.2, weight: .semibold))
                    .foregroundStyle(mobileTheme.action)
            }
        }
        .accessibilityHidden(true)
    }
}

private struct GeneratedMusicTimeline: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let playback: GeneratedMusicPlayback

    private var canSeek: Bool { playback.duration > 0 && playback.phase != .failed && playback.phase != .loading }

    var body: some View {
        VStack(spacing: 4) {
            Slider(value: Binding(get: { playback.position }, set: { playback.seek($0) }),
                   in: 0 ... max(1, playback.duration))
                .tint(mobileTheme.action).disabled(!canSeek)
                .accessibilityLabel("播放进度").accessibilityIdentifier("music-progress")
            HStack {
                Text(time(playback.position)).accessibilityIdentifier("music-elapsed")
                Spacer()
                Text(playback.duration > 0 ? time(playback.duration) : "–:–")
            }
            .font(.caption.monospacedDigit()).foregroundStyle(mobileTheme.secondary)
            HStack(spacing: 32) {
                skipButton(-15)
                GeneratedMusicPlayButton(playback: playback, prominent: true)
                skipButton(15)
            }
            .padding(.top, 8)
        }
    }

    private func skipButton(_ delta: Double) -> some View {
        Button(delta < 0 ? "后退 15 秒" : "前进 15 秒", systemImage: delta < 0 ? "gobackward.15" : "goforward.15") {
            playback.seek(playback.position + delta)
        }
        .labelStyle(.iconOnly).font(.system(size: 21, weight: .medium)).frame(width: 48, height: 48)
        .background(mobileTheme.grouped, in: .circle)
        .buttonStyle(.plain).disabled(!canSeek)
        .foregroundStyle(canSeek ? mobileTheme.foreground : mobileTheme.secondary)
        .accessibilityIdentifier(delta < 0 ? "music-skip-back" : "music-skip-forward")
    }

    private func time(_ seconds: Double) -> String {
        let value = Int(max(0, seconds))
        return String(format: "%d:%02d", value / 60, value % 60)
    }
}
