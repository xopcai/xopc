import AVFAudio
import Observation

struct AssistantAudioObservation: Equatable {
    let conversationID: String?
    let streaming: Bool
    let enabled: Bool
    let attachment: HistoryAttachment?
    let key: String?
}

private struct PendingAssistantAudio {
    let attachment: HistoryAttachment
    let conversationID: String
    let configuration: GatewayConfiguration
}

@MainActor @Observable final class AssistantAudioAutoplay: NSObject, AVAudioPlayerDelegate {
    private var previous: AssistantAudioObservation?
    private var lastSeenKey: String?
    private var wasStreaming = false
    private var player: AVAudioPlayer?
    private var loadTask: Task<Void, Never>?
    private var pending: [PendingAssistantAudio] = []
    private var generation = 0
    private var ownsAudioSession = false

    func observe(_ current: AssistantAudioObservation, configuration: GatewayConfiguration) {
        guard let conversationID = current.conversationID else {
            previous = nil
            stop()
            return
        }
        if previous?.conversationID != conversationID {
            stop()
            lastSeenKey = current.streaming ? nil : current.key
            wasStreaming = current.streaming
            previous = current
            return
        }
        if !current.enabled {
            stop()
            lastSeenKey = current.streaming ? lastSeenKey : current.key
            wasStreaming = current.streaming
            previous = current
            return
        }
        let awaiting = wasStreaming || current.streaming
        let completed = awaiting && !current.streaming && current.key != nil && current.key != lastSeenKey
        if completed, let attachment = current.attachment {
            lastSeenKey = current.key
            wasStreaming = false
            if pending.count >= 8 {
                pending.removeFirst()
            }
            pending.append(PendingAssistantAudio(
                attachment: attachment,
                conversationID: conversationID,
                configuration: configuration
            ))
            playNext()
        } else {
            wasStreaming = awaiting
        }
        previous = current
    }

    func stop() {
        generation += 1
        loadTask?.cancel()
        loadTask = nil
        pending.removeAll()
        player?.stop()
        player = nil
        deactivateAudioSession()
    }

    private func playNext() {
        guard player == nil, loadTask == nil, !pending.isEmpty else { return }
        let next = pending.removeFirst()
        let current = generation
        loadTask = Task {
            defer {
                if current == generation {
                    loadTask = nil
                    if player == nil {
                        playNext()
                    }
                    if player == nil, pending.isEmpty {
                        deactivateAudioSession()
                    }
                }
            }
            do {
                let bytes = try await ChatAttachmentLoader(configuration: next.configuration)
                    .load(next.attachment, conversationID: next.conversationID)
                guard current == generation, !Task.isCancelled else { return }
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                ownsAudioSession = true
                let player = try AVAudioPlayer(data: bytes)
                player.delegate = self
                player.prepareToPlay()
                guard player.play() else { return }
                self.player = player
            } catch {
                // A failed audio attachment must not block later assistant audio.
            }
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully _: Bool) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor in
            guard self.player.map(ObjectIdentifier.init) == identity else { return }
            self.player = nil
            self.playNext()
            if self.player == nil, self.pending.isEmpty {
                self.deactivateAudioSession()
            }
        }
    }

    private func deactivateAudioSession() {
        guard ownsAudioSession else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        ownsAudioSession = false
    }
}
