import AVFAudio
import Observation
import SwiftUI

struct MessageBubble: View {
    let message: TimelineMessage
    let configuration: GatewayConfiguration
    let conversationID: String?
    let assistantState: AssistantState?
    let readAloud: ChatReadAloud
    let canReadAloud: Bool
    let previewEligible: Bool
    @Environment(\.locale) private var locale
    @State private var isActionsPresented = false
    @State private var isDetailPresented = false
    @State private var isSavingNote = false
    @State private var isSaveFeedbackPresented = false
    @State private var saveFeedback = ""

    var body: some View {
        if !message.text.isEmpty || !message.references.isEmpty || !message.attachments.isEmpty {
            messageContent
        }
    }

    private var messageContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            messageText
            references
            attachments
            if message.role == "assistant", !message.text.isEmpty {
                HStack(spacing: 2) {
                    Button("复制", systemImage: "doc.on.doc") {
                        UIPasteboard.general.string = message.text
                    }
                    .frame(width: 40, height: 40)
                    .contentShape(.rect)
                    .accessibilityIdentifier("chat-copy-\(message.id)")
                    Button("保存到笔记", systemImage: "bookmark") {
                        Task { await saveAsNote() }
                    }
                    .disabled(isSavingNote)
                    .frame(width: 40, height: 40)
                    .contentShape(.rect)
                    .accessibilityIdentifier("chat-save-note-\(message.id)")
                    if !ChatSpeechText.chunks(from: message.text).isEmpty {
                        Button {
                            readAloud.toggle(id: message.id, text: message.text, locale: locale, gateway: GatewayClient(configuration: configuration))
                        } label: {
                            Label {
                                Text(readAloud.sourceID == message.id && readAloud.state == .playing
                                    ? LocalizedStringResource("暂停朗读")
                                    : LocalizedStringResource("朗读"))
                            } icon: {
                                Image(systemName: "speaker.wave.2")
                            }
                        }
                        .frame(width: 40, height: 40)
                        .contentShape(.rect)
                        .accessibilityIdentifier("chat-read-aloud-\(message.id)")
                        .disabled(!canReadAloud)
                    }
                    Button("更多", systemImage: "ellipsis") {
                        isActionsPresented = true
                    }
                    .frame(width: 40, height: 40)
                    .contentShape(.rect)
                    .accessibilityHint("查看消息详情和执行过程")
                }
                .labelStyle(.iconOnly)
                .frame(maxWidth: .infinity, alignment: .leading)
                .font(.caption.weight(.medium))
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(message.role == "user" ? Color.blue.opacity(0.12) : Color.secondary.opacity(0.1))
        .clipShape(.rect(cornerRadius: 18))
        .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
        .opacity(message.isPending ? 0.65 : 1)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $isDetailPresented) {
            MessageDetailView(
                message: message,
                configuration: configuration,
                conversationID: conversationID,
                assistantState: assistantState
            )
        }
        .confirmationDialog("消息操作", isPresented: $isActionsPresented, titleVisibility: .visible) {
            Button("消息详情", systemImage: "info.circle") { isDetailPresented = true }
            if !codeBlocks.isEmpty {
                Button("复制代码", systemImage: "chevron.left.forwardslash.chevron.right") {
                    UIPasteboard.general.string = codeBlocks
                }
            }
            Button("取消", role: .cancel) {}
        }
        .alert(saveFeedback, isPresented: $isSaveFeedbackPresented) {
            Button("好", role: .cancel) {}
        }
    }

    @ViewBuilder
    private var messageText: some View {
        if !message.text.isEmpty {
            if showsPreview {
                Button {
                    isDetailPresented = true
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(.init(String(message.text.prefix(1_500))))
                            .lineLimit(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("查看更多")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.blue)
                            .frame(minHeight: 44, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("chat-message-preview-\(message.id)")
                .accessibilityHint("打开完整消息")
            } else if message.role == "assistant", !message.markdownParts.isEmpty {
                MarkdownBodyView(parts: message.markdownParts, configuration: configuration, conversationID: conversationID)
            } else {
                Text(message.text)
                    .textSelection(.enabled)
            }
        }
    }

    private var showsPreview: Bool {
        guard message.role == "assistant", previewEligible, !message.isPending else { return false }
        var lines = 0
        for rawLine in message.text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let units = line.reduce(0.0) { $0 + ($1.isASCII ? 0.55 : 1) }
            lines += max(1, Int(ceil(units / 15)))
            if lines > 8 { return true }
        }
        return false
    }

    private var codeBlocks: String {
        MarkdownBlock.parse(message.text).compactMap { block in
            if case let .code(code) = block {
                return code
            }
            return nil
        }.joined(separator: "\n\n")
    }

    @ViewBuilder
    private var references: some View {
        if !message.references.isEmpty {
            VStack(spacing: 6) {
                ForEach(message.references) { reference in
                    Label(reference.title, systemImage: reference.kind.systemImage)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                        .background(.background, in: .rect(cornerRadius: 10))
                        .accessibilityLabel(referenceAccessibilityLabel(reference))
                }
            }
        }
    }

    @ViewBuilder
    private var attachments: some View {
        if !message.attachments.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                let images = message.attachments.filter(\.isImage)
                if !images.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(images) { attachment in
                                if let uri = attachment.uri {
                                    MarkdownImageView(
                                        alt: attachment.name ?? AppLocalization.string("图片", locale: locale),
                                        source: uri,
                                        configuration: configuration,
                                        conversationID: conversationID,
                                        compact: true
                                    )
                                } else {
                                    attachmentLabel(attachment, systemImage: "photo")
                                }
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                }
                ForEach(message.attachments.filter { !$0.isImage }) { attachment in
                    if attachment.isAudio, attachment.uri != nil, let conversationID {
                        ChatAudioAttachmentView(
                            attachment: attachment,
                            configuration: configuration,
                            conversationID: conversationID
                        )
                    } else {
                        attachmentLabel(attachment, systemImage: "doc")
                    }
                }
            }
        }
    }

    private func attachmentLabel(_ attachment: HistoryAttachment, systemImage: String) -> some View {
        Label(attachment.name ?? AppLocalization.string("附件", locale: locale), systemImage: systemImage)
            .font(.caption)
            .lineLimit(1)
            .padding(.horizontal, 9)
            .frame(minHeight: 44)
            .background(Color.secondary.opacity(0.1), in: .capsule)
    }

    private func referenceAccessibilityLabel(_ reference: ContextReference) -> String {
        let format = AppLocalization.string("引用%@：%@", locale: locale)
        return String(
            format: format,
            locale: locale,
            AppLocalization.resolve(reference.kind.title, locale: locale),
            reference.title
        )
    }

    @MainActor
    private func saveAsNote() async {
        guard !isSavingNote else { return }
        isSavingNote = true
        defer { isSavingNote = false }
        do {
            _ = try await GatewayClient(configuration: configuration).saveMessageAsNote(message.text)
            saveFeedback = String(localized: "已保存到笔记")
        } catch {
            saveFeedback = String(format: String(localized: "保存失败：%@"), error.localizedDescription)
        }
        isSaveFeedbackPresented = true
    }
}

private struct ChatAudioAttachmentView: View {
    let attachment: HistoryAttachment
    let configuration: GatewayConfiguration
    let conversationID: String

    @State private var playback = ChatAudioPlayback()

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                guard let uri = attachment.uri else { return }
                playback.toggle(uri: uri, conversationID: conversationID, configuration: configuration)
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: playback.isPlaying ? "stop.circle.fill" : "speaker.wave.2.fill")
                        .font(.title3)
                    Image(systemName: "waveform")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let duration = attachment.duration, duration > 0 {
                        Text("\(Int(duration.rounded(.up)))″")
                            .font(.caption.monospacedDigit())
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 48)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(playback.isLoading)
            .accessibilityLabel(playback.isPlaying ? "停止播放语音" : "播放语音")
            .accessibilityIdentifier("chat-audio-\(attachment.id)")
            if playback.isLoading {
                ProgressView("正在加载语音…").font(.caption)
            }
            if let error = playback.errorMessage {
                Text(error).font(.caption).foregroundStyle(.red)
                Button("重试") {
                    guard let uri = attachment.uri else { return }
                    playback.retry(uri: uri, conversationID: conversationID, configuration: configuration)
                }
                .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 10)
        .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
        .onDisappear { playback.stop() }
    }
}

@MainActor
@Observable
private final class ChatAudioPlayback: NSObject, AVAudioPlayerDelegate {
    private(set) var isLoading = false
    private(set) var isPlaying = false
    private(set) var errorMessage: String?
    private var player: AVAudioPlayer?
    private var fetchTask: Task<Void, Never>?
    private var generation = 0
    private var ownsAudioSession = false

    func toggle(uri: String, conversationID: String, configuration: GatewayConfiguration) {
        if isPlaying {
            stop()
            return
        }
        if let player {
            do {
                try AVAudioSession.sharedInstance().setActive(true)
                ownsAudioSession = true
                guard player.play() else { throw ChatImageError.invalidResponse }
                isPlaying = true
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
            return
        }
        retry(uri: uri, conversationID: conversationID, configuration: configuration)
    }

    func retry(uri: String, conversationID: String, configuration: GatewayConfiguration) {
        stop()
        isLoading = true
        let current = generation
        fetchTask = Task {
            do {
                let data = try await ChatAudioLoader(configuration: configuration)
                    .load(uri: uri, conversationID: conversationID)
                guard current == generation, !Task.isCancelled else { return }
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                ownsAudioSession = true
                let player = try AVAudioPlayer(data: data)
                player.delegate = self
                player.prepareToPlay()
                guard player.play() else { throw ChatImageError.invalidResponse }
                self.player = player
                isPlaying = true
                errorMessage = nil
            } catch is CancellationError {
            } catch {
                guard current == generation else { return }
                errorMessage = error.localizedDescription
            }
            if current == generation {
                isLoading = false
            }
        }
    }

    func stop() {
        generation += 1
        fetchTask?.cancel()
        fetchTask = nil
        player?.stop()
        player = nil
        isLoading = false
        isPlaying = false
        if ownsAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            ownsAudioSession = false
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully _: Bool) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor in
            guard self.player.map(ObjectIdentifier.init) == identity else { return }
            self.stop()
        }
    }
}
