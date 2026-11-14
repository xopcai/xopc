import AVFoundation
import SwiftUI

struct HoldToSpeakBar: View {
    let configuration: GatewayConfiguration
    let onStart: () -> Void
    let onAttachment: (MessageAttachment) -> Void
    let onText: (String) -> Void
    let onError: (String) -> Void
    @Environment(\.locale) private var locale
    @Environment(\.scenePhase) private var scenePhase
    @State private var recorder = VoiceRecorder()
    @State private var held = false
    @State private var destination = VoiceReleaseAction.send
    @State private var pending: Task<Void, Never>?
    @State private var converting = false
    @State private var retryAudio: RecordedAudio?

    var body: some View {
        Group {
            if let retryAudio {
                HStack(spacing: 6) {
                    Button("重试") { transcribe(retryAudio) }
                    Button("取消") { self.retryAudio = nil; onError("") }
                }
                .disabled(converting)
            } else {
                Text(hint)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(destination == .cancel ? Color.red : Color.primary)
                    .lineLimit(1).minimumScaleFactor(0.65)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(.rect)
                    .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                        .onChanged { drag in
                            if !held { begin() }
                            destination = VoiceReleaseAction.resolve(drag.translation, current: destination)
                        }
                        .onEnded { drag in finish(VoiceReleaseAction.resolve(drag.translation, current: destination)) })
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { if held { finish(.send) } else { begin() } }
                    .accessibilityIdentifier("chat-hold-to-speak")
            }
        }
        .onChange(of: scenePhase) { if scenePhase != .active { reset() } }
        .onDisappear { reset() }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in
            recorder.handleAudioInterruption(notification)
            if recorder.hasRecoverableInterruption { finish(.cancel) }
        }
    }

    private var hint: LocalizedStringKey {
        if converting { return "正在转为文字…" }
        if !held { return "按住说话" }
        switch destination {
        case .send: return "松开发送"
        case .text: return "松开转文字"
        case .cancel: return "松开取消"
        }
    }

    private func begin() {
        guard !held, !converting else { return }
        held = true
        onStart()
        pending?.cancel()
        pending = Task {
            await recorder.start()
            if held, let error = recorder.errorMessage { onError(error) }
        }
    }

    private func finish(_ action: VoiceReleaseAction) {
        guard held else { return }
        held = false
        destination = .send
        pending?.cancel()
        guard action != .cancel, recorder.isRecording else { recorder.cancel(); return }
        let audio = recorder.finishRecording()
        recorder.cancel()
        guard let audio, audio.duration >= 0.35 else { return }
        if action == .text { transcribe(audio) }
        else {
            onAttachment(MessageAttachment(type: "audio", name: audio.fileName, mimeType: audio.mimeType,
                                           size: audio.data.count, data: audio.data.base64EncodedString()))
        }
    }

    private func transcribe(_ audio: RecordedAudio) {
        converting = true
        retryAudio = nil
        pending = Task {
            defer { converting = false }
            do {
                let text = try await GatewayClient(configuration: configuration)
                    .transcribeVoice(audio, language: locale.language.languageCode?.identifier)
                try Task.checkCancellation()
                onText(text)
            } catch is CancellationError {} catch {
                if !Task.isCancelled {
                    retryAudio = audio
                    onError(error.localizedDescription)
                }
            }
        }
    }

    private func reset() {
        held = false
        destination = .send
        pending?.cancel()
        recorder.cancel()
    }
}

enum VoiceReleaseAction {
    case send, cancel, text

    static func resolve(_ movement: CGSize, current: Self = .send) -> Self {
        if current == .cancel, movement.height < -52, movement.width < -24 { return .cancel }
        if current == .text, movement.height < -52, movement.width > 24 { return .text }
        if movement.height < -72, movement.width < -40 { return .cancel }
        if movement.height < -72, movement.width > 40 { return .text }
        return .send
    }
}
