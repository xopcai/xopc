import SwiftUI

struct MessageBubble: View {
    let message: TimelineMessage
    let configuration: GatewayConfiguration
    let conversationID: String?
    let assistantState: AssistantState?
    let readAloud: ChatReadAloud
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
            if message.role == "assistant", !message.markdownParts.isEmpty {
                MarkdownBodyView(parts: message.markdownParts, configuration: configuration, conversationID: conversationID)
            } else {
                Text(message.text)
                    .textSelection(.enabled)
            }
        }
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
                ForEach(message.attachments) { attachment in
                    Label(
                        attachment.name ?? AppLocalization.string("附件", locale: locale),
                        systemImage: attachment.mimeType?.hasPrefix("image/") == true ? "photo" : "doc"
                    )
                    .font(.caption)
                    .lineLimit(1)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .background(Color.secondary.opacity(0.1), in: .capsule)
                }
            }
        }
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
