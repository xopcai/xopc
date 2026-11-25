import AVFAudio
import SwiftUI

struct NoteAudioPlayerView: View {
    let configuration: GatewayConfiguration
    let noteID: String
    let attachment: NoteAttachment
    var showsFileName = true

    @Environment(\.mobileTheme) private var mobileTheme
    @State private var player: AVAudioPlayer?
    @State private var isPlaying = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var loadTask: Task<Void, Never>?

    var body: some View {
        Button(action: togglePlayback) {
            HStack(spacing: 10) {
                Group {
                    if isLoading {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.tint)
                    }
                }
                .frame(width: 36, height: 36)
                .background(Color.accentColor.opacity(0.14), in: .circle)
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 4) {
                    Text(isPlaying ? LocalizedStringResource("暂停播放") : "播放录音")
                        .mobileTextStyle(.rowTitle)
                    if let errorMessage {
                        Text(errorMessage).font(.caption).foregroundStyle(mobileTheme.danger)
                    } else if showsFileName {
                        Text(displayFileName).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if let duration = attachment.duration {
                    Text(voiceNoteTime(duration)).font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            .foregroundStyle(mobileTheme.foreground)
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .background(mobileTheme.panel, in: .rect(cornerRadius: 14))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .accessibilityLabel(isPlaying ? Text("暂停播放") : Text("播放录音"))
        .accessibilityIdentifier("voice-note-playback-\(attachment.id)")
        .task(id: isPlaying) {
            guard isPlaying, let player else { return }
            while player.isPlaying {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
            if !Task.isCancelled {
                isPlaying = false
            }
        }
        .onDisappear {
            loadTask?.cancel()
            player?.pause()
            isPlaying = false
        }
    }

    private var displayFileName: String {
        let fallback = AppLocalization.string("语音记录", locale: AppLocalization.selectedLocale)
        if attachment.fileName == "语音消息.wav" {
            return fallback
        }
        let name = URL(fileURLWithPath: attachment.fileName).deletingPathExtension().lastPathComponent
        return name.isEmpty ? fallback : name
    }

    private func togglePlayback() {
        if let player {
            if player.isPlaying {
                player.pause()
                isPlaying = false
            } else {
                start(player)
            }
        } else {
            loadTask = Task { await loadAndPlay() }
        }
    }

    private func start(_ player: AVAudioPlayer) {
        GeneratedMusicPlayback.shared.yieldAudioSession()
        isPlaying = player.play()
        errorMessage = isPlaying ? nil : AppLocalization.string("无法播放录音", locale: AppLocalization.selectedLocale)
    }

    @MainActor
    private func loadAndPlay() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let data = try await GatewayClient(configuration: configuration).fetchNoteAttachment(
                noteID: noteID, attachmentID: attachment.id
            )
            try Task.checkCancellation()
            let player = try AVAudioPlayer(data: data)
            player.prepareToPlay()
            self.player = player
            start(player)
        } catch {
            if !Task.isCancelled {
                errorMessage = error.localizedDescription
            }
        }
    }
}

func voiceNoteTime(_ duration: Double) -> String {
    let seconds = duration.isFinite && duration >= 0 && duration < Double(Int64.max) ? Int64(duration) : 0
    return String(format: "%02lld:%02lld", seconds / 60, seconds % 60)
}

func isDefaultVoiceNoteTitle(_ title: String?, kind: String) -> Bool {
    kind == "voice" && (title?.wholeMatch(of: /Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/) != nil)
}
