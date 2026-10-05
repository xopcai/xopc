import AVFAudio
import SwiftUI

struct NoteAudioPlayerView: View {
    let configuration: GatewayConfiguration
    let noteID: String
    let attachment: NoteAttachment

    @State private var player: AVAudioPlayer?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: togglePlayback) {
                Label(player?.isPlaying == true ? "暂停播放" : "播放录音", systemImage: player?.isPlaying == true ? "pause.circle.fill" : "play.circle.fill")
            }
            .disabled(isLoading)
            HStack(spacing: 8) {
                Text(displayFileName)
                if let duration = attachment.duration {
                    Text(duration, format: .number.precision(.fractionLength(0))) + Text(" 秒")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if let errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.red)
            }
        }
    }

    private var displayFileName: String {
        guard attachment.fileName == "语音消息.wav" else { return attachment.fileName }
        return AppLocalization.string("语音消息.wav", locale: AppLocalization.selectedLocale)
    }

    private func togglePlayback() {
        if player?.isPlaying == true {
            player?.pause()
            return
        }
        if let player {
            player.play()
            return
        }
        Task { await loadAndPlay() }
    }

    @MainActor
    private func loadAndPlay() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let data = try await GatewayClient(configuration: configuration).fetchNoteAttachment(
                noteID: noteID,
                attachmentID: attachment.id
            )
            let player = try AVAudioPlayer(data: data)
            player.prepareToPlay()
            player.play()
            self.player = player
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
