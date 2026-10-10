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
    let onReuseUserText: (String) -> Void
    @Environment(\.locale) private var locale
    @ScaledMetric(relativeTo: .body) private var previewHeight: CGFloat = 160
    @State private var isActionsPresented = false
    @State private var isDetailPresented = false
    @State private var isExecutionPresented = false
    @State private var isSavingNote = false
    @State private var isSaveFeedbackPresented = false
    @State private var saveFeedback = ""

    var body: some View {
        if !message.text.isEmpty || !message.references.isEmpty || !message.attachments.isEmpty
            || !message.resultLinks.isEmpty || !message.unavailableOutputs.isEmpty
        {
            messageContent
        }
    }

    private var messageContent: some View {
        VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 2) {
            VStack(alignment: .leading, spacing: 8) {
                messageText
                references
                attachments
                ForEach(message.resultLinks) { result in
                    Link(destination: result.url) { Label(result.title, systemImage: "arrow.up.right.square") }
                        .frame(minHeight: 44)
                }
                ForEach(message.unavailableOutputs, id: \.self) { title in
                    Label(title, systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: message.role == "assistant" ? .infinity : nil, alignment: .leading)
            .padding(.horizontal, message.role == "assistant" ? 12 : isUserAudioBubble ? 4 : 14)
            .padding(.vertical, isUserAudioBubble ? 0 : 10)
            .background(message.role == "user" ? Color.blue.opacity(0.12) : Color.secondary.opacity(0.1))
            .clipShape(.rect(cornerRadius: 18))
            if message.role == "assistant", !message.text.isEmpty {
                assistantActions
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
        .contextMenu {
            if message.role == "user", !message.text.isEmpty {
                Button("复制", systemImage: "doc.plaintext") { UIPasteboard.general.string = message.text }
                    .accessibilityIdentifier("chat-user-copy-\(message.id)")
                if message.attachments.isEmpty, message.references.isEmpty {
                    Button("再次编辑", systemImage: "pencil") { onReuseUserText(message.text) }
                        .accessibilityIdentifier("chat-user-reuse-\(message.id)")
                }
            }
        }
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
        .sheet(isPresented: $isExecutionPresented) {
            if let conversationID {
                NavigationStack {
                    ExecutionProcessView(configuration: configuration, conversationID: conversationID,
                                         turnID: message.turnId ?? message.id, assistantState: assistantState)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("完成") { isExecutionPresented = false }
                            }
                        }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .presentationDetents([.fraction(0.92)])
                .presentationDragIndicator(.hidden)
                .presentationContentInteraction(.scrolls)
            }
        }
        .confirmationDialog("消息操作", isPresented: $isActionsPresented, titleVisibility: .visible) {
            Button("消息详情", systemImage: "info.circle") { isDetailPresented = true }
            if conversationID != nil {
                Button("执行过程", systemImage: "list.bullet.rectangle") { isExecutionPresented = true }
            }
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

    private var isUserAudioBubble: Bool {
        message.role == "user" && message.text.isEmpty && message.attachments.contains(where: \.isAudio)
    }

    private var assistantActions: some View {
        HStack(spacing: 2) {
            Button("复制", systemImage: "doc.plaintext") {
                UIPasteboard.general.string = message.text
            }
            .frame(width: 44, height: 44)
            .contentShape(.rect)
            .accessibilityIdentifier("chat-copy-\(message.id)")
            Button("保存到笔记", systemImage: "bookmark") {
                Task { await saveAsNote() }
            }
            .disabled(isSavingNote)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
            .accessibilityIdentifier("chat-save-note-\(message.id)")
            if !message.attachments.contains(where: \.isAudio) && !ChatSpeechText.chunks(from: message.text).isEmpty {
                Button {
                    readAloud.toggle(id: message.id, text: message.text, locale: locale, gateway: GatewayClient(configuration: configuration))
                } label: {
                    Label {
                        Text(readAloud.sourceID == message.id && readAloud.state == .playing
                            ? LocalizedStringResource("暂停朗读")
                            : readAloud.sourceID == message.id && readAloud.state == .paused
                                ? LocalizedStringResource("继续朗读") : LocalizedStringResource("朗读"))
                    } icon: {
                        if readAloud.sourceID == message.id && readAloud.state == .loading {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: readAloud.sourceID == message.id && readAloud.state == .playing
                                ? "pause" : "speaker.wave.2")
                        }
                    }
                }
                .frame(width: 44, height: 44)
                .contentShape(.rect)
                .accessibilityIdentifier("chat-read-aloud-\(message.id)")
                .disabled(!canReadAloud || (readAloud.sourceID == message.id && readAloud.state == .loading))
            }
            Button("更多", systemImage: "ellipsis.circle") {
                isActionsPresented = true
            }
            .frame(width: 44, height: 44)
            .contentShape(.rect)
            .accessibilityHint("查看消息详情和执行过程")
            .accessibilityIdentifier("chat-more-\(message.id)")
        }
        .labelStyle(.iconOnly)
        .frame(maxWidth: .infinity, alignment: .leading)
        .font(.system(size: 18))
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private var messageText: some View {
        if !message.text.isEmpty {
            if showsPreview {
                Button {
                    isDetailPresented = true
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        MarkdownBodyView(parts: Array(message.markdownParts.prefix(8)),
                                         configuration: configuration, conversationID: conversationID)
                            .frame(height: previewHeight, alignment: .top)
                            .clipped()
                            .mask {
                                VStack(spacing: 0) {
                                    Color.black
                                    LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                                        .frame(height: 20)
                                }
                            }
                            .allowsHitTesting(false)
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
            } else if message.role == "user" {
                Text(verbatim: message.text).accessibilityIdentifier("chat-user-text-\(message.id)")
            } else {
                Text(verbatim: message.text).textSelection(.enabled)
            }
        }
    }

    private var showsPreview: Bool {
        guard message.role == "assistant", previewEligible, !message.isPending else { return false }
        var lines = 0
        for rawLine in message.text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                continue
            }
            let units = line.reduce(0.0) { $0 + ($1.isASCII ? 0.55 : 1) }
            lines += max(1, Int(ceil(units / 15)))
            if lines > 8 {
                return true
            }
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
}

private extension MessageBubble {
    @ViewBuilder
    var attachments: some View {
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
                                        compact: true,
                                        gallery: images
                                    )
                                } else {
                                    ChatAttachmentPreview(
                                        attachment: attachment,
                                        configuration: configuration,
                                        conversationID: conversationID
                                    )
                                }
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                }
                ForEach(message.attachments.filter { !$0.isImage }) { attachment in
                    if attachment.isAudio, let conversationID,
                       attachment.uri != nil || attachment.workspaceRelativePath != nil
                    {
                        ChatAudioAttachmentView(
                            attachment: attachment,
                            configuration: configuration,
                            conversationID: conversationID, compact: message.role == "user"
                        )
                    } else {
                        ChatAttachmentPreview(
                            attachment: attachment,
                            configuration: configuration,
                            conversationID: conversationID
                        )
                    }
                }
            }
        }
    }

    func referenceAccessibilityLabel(_ reference: ContextReference) -> String {
        let format = AppLocalization.string("引用%@：%@", locale: locale)
        return String(
            format: format,
            locale: locale,
            AppLocalization.resolve(reference.kind.title, locale: locale),
            reference.title
        )
    }

    @MainActor
    func saveAsNote() async {
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

struct ChatAudioAttachmentView: View {
    let attachment: HistoryAttachment
    let configuration: GatewayConfiguration
    let conversationID: String
    var compact = false

    @State private var playback = ChatAudioPlayback()

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                playback.toggle(attachment: attachment, conversationID: conversationID, configuration: configuration)
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
                .frame(width: compact ? 104 : nil)
                .frame(maxWidth: compact ? nil : .infinity, minHeight: 48)
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
                    playback.retry(attachment: attachment, conversationID: conversationID, configuration: configuration)
                }
                .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 10)
        .background(Color.secondary.opacity(compact ? 0 : 0.08), in: .rect(cornerRadius: 12))
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

    func toggle(attachment: HistoryAttachment, conversationID: String, configuration: GatewayConfiguration) {
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
        retry(attachment: attachment, conversationID: conversationID, configuration: configuration)
    }

    func retry(attachment: HistoryAttachment, conversationID: String, configuration: GatewayConfiguration) {
        stop()
        isLoading = true
        let current = generation
        fetchTask = Task {
            do {
                let data = try await ChatAttachmentLoader(configuration: configuration)
                    .load(attachment, conversationID: conversationID)
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
