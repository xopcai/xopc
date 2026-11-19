// swiftlint:disable file_length
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
// swiftlint:disable:next type_body_length
final class GeneratedMusicPlayback {
    static let shared = GeneratedMusicPlayback()

    enum Phase: Equatable { case loading, playing, paused, ended, failed }

    private(set) var track: GeneratedMusicTrack?
    private(set) var phase: Phase = .paused
    private(set) var duration: Double = 0
    private(set) var position: Double = 0
    private(set) var previewTrack: GeneratedMusicTrack?
    var expanded = false {
        didSet {
            if !expanded {
                previewTrack = nil
                previewDownloader = nil
                previewStream = nil
            }
        }
    }

    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var load: Task<Void, Never>?
    @ObservationIgnored private var updates: Task<Void, Never>?
    @ObservationIgnored private var previewDownloader: (() async throws -> URL)?
    @ObservationIgnored private var previewStream: (() async throws -> URL)?
    @ObservationIgnored private var stream: (() async throws -> URL)?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private var downloader: (() async throws -> URL)?
    @ObservationIgnored private var playWhenReady = true
    @ObservationIgnored private var remoteTargets: [(MPRemoteCommand, Any)] = []

    private init() {}

    func play(_ track: GeneratedMusicTrack, streaming: @escaping () async throws -> URL,
              downloading: @escaping () async throws -> URL) {
        if self.track?.key == track.key {
            toggle(); return
        }
        clear()
        self.track = track
        stream = streaming
        downloader = downloading
        duration = track.duration ?? 0
        prepare()
    }

    func openPreview(_ track: GeneratedMusicTrack, streaming: @escaping () async throws -> URL,
                     downloading: @escaping () async throws -> URL) {
        previewTrack = track
        previewStream = streaming
        previewDownloader = downloading
        expanded = true
    }

    func playPreview() {
        guard let previewTrack, let previewStream, let previewDownloader else { return }
        play(previewTrack, streaming: previewStream, downloading: previewDownloader)
    }

    func downloadPreview() async throws -> URL {
        guard let download = previewDownloader ?? downloader else { throw GatewayClientError.invalidResponse }
        return try await download()
    }

    func toggle() {
        switch phase {
        case .loading: playWhenReady.toggle()
        case .playing: pause()
        case .paused, .ended: resume()
        case .failed: prepare()
        }
    }

    func pause() {
        playWhenReady = false
        guard phase == .playing else { return }
        player?.pause()
        updates?.cancel()
        if let player {
            position = currentPosition(player)
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
        player.seek(to: CMTime(seconds: position, preferredTimescale: 600))
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
            position = currentPosition(player)
        }
        savePosition()
    }

    func validateScope(_ configuration: GatewayConfiguration) {
        if let previewTrack, configuration.token.isEmpty ||
            previewTrack.configurationScope != ComposerDraftStore.accountScope(configuration)
        {
            expanded = false
        }
        if let track, configuration.token.isEmpty ||
            track.configurationScope != ComposerDraftStore.accountScope(configuration)
        {
            stop()
        }
    }

    private func prepare() {
        guard let track, let stream else { return }
        load?.cancel()
        releasePlayer()
        phase = .loading
        playWhenReady = true
        load = Task {
            do {
                let url = try await stream()
                try Task.checkCancellation()
                let item = AVPlayerItem(url: url)
                let audio = AVPlayer(playerItem: item)
                player = audio
                let center = NotificationCenter.default
                observers.append(center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification,
                                                     object: item, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated {
                        self?.finish()
                    }
                })
                observers.append(center.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification,
                                                     object: item, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated {
                        self?.fail()
                    }
                })
                // Readiness includes remote metadata, which may require a request near the end of the file.
                while item.status == .unknown {
                    try await Task.sleep(for: .milliseconds(100))
                }
                guard item.status == .readyToPlay else { throw GatewayClientError.invalidResponse }
                let seconds = item.duration.seconds
                if seconds.isFinite, seconds > 0 { duration = seconds }
                let saved = UserDefaults.standard.double(forKey: "music.position.\(track.key)")
                position = saved < duration ? saved : 0
                if position > 0 {
                    await audio.seek(to: CMTime(seconds: position, preferredTimescale: 600))
                }
                try Task.checkCancellation()
                phase = .paused
                if playWhenReady { resume() }
            } catch {
                if !Task.isCancelled { fail() }
            }
        }
    }

    private func resume() {
        if phase == .loading {
            playWhenReady = true; return
        }
        if phase == .failed {
            prepare(); return
        }
        guard let player else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            if phase == .ended {
                player.seek(to: .zero)
                position = 0
            }
            player.play()
            phase = .playing
            installMediaCommands()
            publish()
            updates?.cancel()
            updates = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                    guard let self, phase == .playing, let audio = self.player else { return }
                    if audio.currentItem?.status == .failed {
                        fail()
                        return
                    }
                    if let seconds = audio.currentItem?.duration.seconds, seconds.isFinite, seconds > 0 {
                        duration = seconds
                    }
                    position = currentPosition(audio)
                }
            }
        } catch {
            fail()
        }
    }

    private func currentPosition(_ player: AVPlayer) -> Double {
        let seconds = player.currentTime().seconds
        return seconds.isFinite ? seconds : position
    }

    private func finish() {
        updates?.cancel()
        phase = .ended
        position = duration
        savePosition()
        publish()
    }

    private func fail() {
        savePosition()
        releasePlayer()
        phase = .failed
        publish()
    }

    private func clear() {
        if let player, phase != .ended, phase != .loading {
            position = currentPosition(player); savePosition()
        }
        let wasPlaying = phase == .playing
        load?.cancel()
        releasePlayer()
        track = nil
        stream = nil
        downloader = nil
        duration = 0
        position = 0
        phase = .paused
        removeMediaCommands()
        if wasPlaying {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func releasePlayer() {
        updates?.cancel()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
        player?.pause()
        player = nil
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
    @Environment(\.mobileTheme) private var theme
    let playback: GeneratedMusicPlayback
    let onSource: (GeneratedMusicTrack) -> Void
    @State private var share: FileShareItem?
    @State private var downloadError = false
    @State private var downloading = false

    var body: some View {
        if let track = playback.previewTrack ?? playback.track {
            let current = playback.track?.key == track.key
            MobilePreview(title: track.title, closeID: "music-player-close", onClose: { playback.expanded = false }) {
                Button("导出音频", systemImage: "square.and.arrow.up") { download(track.key) }
                    .disabled(downloading)
                if !track.conversationID.isEmpty {
                    Button("返回来源对话", systemImage: "bubble.left") { onSource(track) }
                        .accessibilityIdentifier("music-return-source")
                }
                if current {
                    Button("停止播放", systemImage: "stop", role: .destructive, action: playback.stop)
                }
            } content: {
                MusicPreviewContent(playback: playback, track: track, onPlay: playback.playPreview)
                if downloadError {
                    Text("无法导出音频，请重试").font(.footnote).foregroundStyle(theme.secondary)
                }
            }
            .sheet(item: $share) { item in
                FileShareSheet(url: item.url).onDisappear {
                    try? FileManager.default.removeItem(at: item.url.deletingLastPathComponent())
                }
            }
        }
    }

    private func download(_ key: String) {
        downloading = true
        downloadError = false
        Task {
            defer { downloading = false }
            do {
                let url = try await playback.downloadPreview()
                if playback.expanded, (playback.previewTrack ?? playback.track)?.key == key {
                    share = FileShareItem(url: url)
                } else {
                    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
                }
            } catch {
                downloadError = true
            }
        }
    }
}

private struct TimedLyric {
    let seconds: Double
    let text: String

    static func parse(_ lyrics: String) -> [Self] {
        var lines: [Self] = []
        for line in lyrics.split(whereSeparator: \.isNewline) {
            let value = line.trimmingCharacters(in: .whitespaces)
            if value.isEmpty {
                continue
            }
            guard value.first == "[", let end = value.firstIndex(of: "]") else { return [] }
            let parts = value[value.index(after: value.startIndex) ..< end].split(separator: ":")
            guard parts.count == 2, let minutes = Int(parts[0]), minutes >= 0,
                  let seconds = Double(parts[1]), seconds >= 0, seconds < 60 else { return [] }
            let text = value[value.index(after: end)...].trimmingCharacters(in: .whitespaces)
            lines.append(Self(seconds: Double(minutes) * 60 + seconds, text: text))
        }
        return lines.sorted { $0.seconds < $1.seconds }
    }
}

struct MusicPreviewContent: View {
    @Environment(\.mobileTheme) private var theme
    let playback: GeneratedMusicPlayback
    let track: GeneratedMusicTrack
    var onPlay: (() -> Void)?
    @State private var showLyrics = false

    private var isCurrent: Bool {
        playback.track?.key == track.key
    }

    var body: some View {
        let lyrics = track.lyrics?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        VStack(spacing: 8) {
            Group {
                if showLyrics, !lyrics.isEmpty {
                    ScrollView {
                        lyricContent(lyrics)
                            .frame(maxWidth: 480, alignment: .leading).padding(24)
                    }
                } else {
                    ViewThatFits(in: .vertical) {
                        GeneratedMusicCover().frame(width: 232, height: 232)
                        GeneratedMusicCover().frame(width: 128, height: 128)
                        Spacer(minLength: 0)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier("music-player-content")

            VStack(spacing: 4) {
                if isCurrent, playback.phase == .failed {
                    Text("无法播放音乐").font(.footnote).foregroundStyle(theme.secondary)
                }
                if !lyrics.isEmpty {
                    Button(showLyrics ? "收起歌词" : "歌词", systemImage: "quote.bubble") { showLyrics.toggle() }
                        .font(.footnote.weight(.medium)).frame(minHeight: 44)
                        .accessibilityIdentifier("music-lyrics")
                }
                GeneratedMusicTimeline(playback: playback, track: track, onPlay: onPlay)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 24).padding(.bottom, 12)
            .frame(maxWidth: 480)
        }
        .onChange(of: track.key) { showLyrics = false }
    }

    @ViewBuilder private func lyricContent(_ lyrics: String) -> some View {
        let lines = TimedLyric.parse(lyrics)
        if lines.isEmpty {
            Text(verbatim: lyrics).font(.title3.weight(.semibold)).lineSpacing(10)
                .textSelection(.enabled).accessibilityIdentifier("music-lyrics-text")
        } else {
            let active = isCurrent ? lines.lastIndex { $0.seconds <= playback.position } : nil
            VStack(alignment: .leading, spacing: 16) {
                ForEach(lines.indices, id: \.self) { index in
                    Button(lines[index].text) { playback.seek(lines[index].seconds) }
                        .buttonStyle(.plain).disabled(!isCurrent || playback.phase == .loading || playback.phase == .failed)
                        .foregroundStyle(active == index ? theme.action : theme.foreground)
                }
            }
            .font(.title3.weight(.semibold))
            .accessibilityIdentifier("music-lyrics-text")
        }
    }
}

private struct GeneratedMusicCover: View {
    @Environment(\.mobileTheme) private var mobileTheme

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let shape = RoundedRectangle(cornerRadius: mobileTheme.corner(width < 80 ? 12 : 24))
            ZStack {
                shape.fill(mobileTheme.card)
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

    let track: GeneratedMusicTrack
    var onPlay: (() -> Void)?

    private var current: Bool {
        playback.track?.key == track.key
    }

    private var position: Double {
        current ? playback.position : 0
    }

    private var duration: Double {
        current ? playback.duration : track.duration ?? 0
    }

    private var canSeek: Bool {
        current && duration > 0 && playback.phase != .failed && playback.phase != .loading
    }

    var body: some View {
        VStack(spacing: 4) {
            Slider(value: Binding(get: { position }, set: { playback.seek($0) }),
                   in: 0 ... max(1, duration))
                .tint(mobileTheme.action).disabled(!canSeek)
                .accessibilityLabel("播放进度").accessibilityIdentifier("music-progress")
            HStack {
                Text(time(position)).accessibilityIdentifier("music-elapsed")
                Spacer()
                Text(duration > 0 ? time(duration) : "–:–")
            }
            .font(.caption.monospacedDigit()).foregroundStyle(mobileTheme.secondary)
            HStack(spacing: 32) {
                skipButton(-15)
                if current {
                    GeneratedMusicPlayButton(playback: playback, prominent: true)
                } else if let onPlay {
                    Button("播放", systemImage: "play.fill", action: onPlay)
                        .labelStyle(.iconOnly).font(.system(size: 24, weight: .semibold))
                        .frame(width: 64, height: 64)
                        .foregroundStyle(mobileTheme.onAction).background(mobileTheme.action, in: .circle)
                        .accessibilityIdentifier("music-play-toggle")
                }
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
