import ImageIO
import QuickLook
import SwiftUI

// swiftlint:disable:next type_body_length
struct AssistantComposer: View {
    let configuration: GatewayConfiguration
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var draft: String
    @Binding var attachments: [MessageAttachment]
    @Binding var references: [ContextReference]
    @Binding var showingPhotoPicker: Bool
    @Binding var showingFilePicker: Bool
    @Binding var showingCameraPicker: Bool
    @Binding var showingVoiceRecorder: Bool
    @Binding var showingReferencePicker: Bool
    @Binding var referenceKind: ContextReferenceKind
    @Binding var isActionPanelExpanded: Bool

    let attachmentError: String?
    let canReferenceFiles: Bool
    let canStartRealtimeVoice: Bool
    let isRunActive: Bool
    let onInputFocusChanged: (Bool) -> Void
    let onStop: () -> Void
    let onSend: () -> Void
    let onSteer: () -> Void
    let onNewConversation: () -> Void
    let onRealtimeVoice: (RealtimeVoiceMode) -> Void

    @FocusState private var isComposerFocused: Bool
    @State private var previewAttachment: MessageAttachment?
    @State private var previewFileURL: URL?
    @State private var previewFileDirectory: URL?
    @State private var previewFileError: String?
    @State private var palette: [ComposerPaletteItem] = []
    @State private var paletteError: String?

    private var paletteQuery: String? {
        guard draft.hasPrefix("/"), !draft.contains(where: \.isNewline) else { return nil }
        return String(draft.dropFirst())
    }

    private var paletteMatches: [ComposerPaletteItem] {
        guard let paletteQuery else { return [] }
        return Array(palette.filter { $0.matches(paletteQuery) }.prefix(8))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !references.isEmpty {
                referenceStrip
            }
            if !attachments.isEmpty {
                attachmentStrip
            }
            if let attachmentError {
                Text(attachmentError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityLabel(AppLocalization.resolve("附件错误：\(attachmentError)", locale: locale))
            }
            if isRunActive, hasPayload {
                activeRunActions
            }
            if paletteQuery != nil, !isActionPanelExpanded {
                paletteSuggestions
            }
            controls
            if isActionPanelExpanded {
                AssistantActionPanel(
                    canReferenceFiles: canReferenceFiles,
                    canStartRealtimeVoice: canStartRealtimeVoice,
                    onSelect: selectAction,
                    onRealtimeVoice: { mode in
                        isActionPanelExpanded = false
                        onRealtimeVoice(mode)
                    }
                )
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
        .onChange(of: isComposerFocused) {
            onInputFocusChanged(isComposerFocused)
            if isComposerFocused {
                isActionPanelExpanded = false
            }
        }
        .task(id: configuration) { await loadPalette() }
        .sheet(item: $previewAttachment) { attachment in
            NavigationStack {
                ComposerAttachmentImage(attachment: attachment, maxPointSize: 900)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .systemBackground))
                    .navigationTitle(attachment.name)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("关闭", systemImage: "xmark") { previewAttachment = nil }
                        }
                    }
            }
        }
        .quickLookPreview($previewFileURL)
        .onChange(of: previewFileURL) { _, value in
            if value == nil, let previewFileDirectory {
                try? FileManager.default.removeItem(at: previewFileDirectory)
                self.previewFileDirectory = nil
            }
        }
        .alert("无法预览文件", isPresented: Binding(
            get: { previewFileError != nil },
            set: {
                if !$0 {
                    previewFileError = nil
                }
            }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(previewFileError ?? "未知错误")
        }
    }

    @ViewBuilder private var paletteSuggestions: some View {
        if let paletteError {
            Text(paletteError).font(.caption).foregroundStyle(.secondary)
                .padding(.horizontal, 12)
        } else if !paletteMatches.isEmpty {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(paletteMatches) { item in
                        Button {
                            draft = item.token
                            isActionPanelExpanded = false
                            isComposerFocused = true
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.title).font(.subheadline.weight(.semibold))
                                Text(item.detail).font(.caption).foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("composer-palette-\(item.id)")
                    }
                }
            }
            .frame(maxHeight: 240)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
        }
    }

    @MainActor private func loadPalette() async {
        do {
            palette = try await GatewayClient(configuration: configuration)
                .fetchComposerPalette(language: locale.identifier)
            paletteError = nil
        } catch is CancellationError {
        } catch {
            paletteError = error.localizedDescription
        }
    }

    private var activeRunActions: some View {
        HStack(spacing: 8) {
            Text(LocalizedStringKey(
                canSteer ? "发送可加入待处理，也可立即引导当前回答" : "附件和引用会加入待处理消息"
            ))
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            if canSteer {
                Button("引导当前回答", action: onSteer)
                    .font(.caption.weight(.semibold))
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 8) {
            Button {
                isComposerFocused = false
                showingVoiceRecorder = true
            } label: {
                Image(systemName: "mic")
                    .font(.system(size: 22))
                    .frame(width: 40, height: 44)
            }
            .accessibilityLabel("语音输入")

            TextField(placeholder, text: $draft, axis: .vertical)
                .focused($isComposerFocused)
                .lineLimit(1 ... 3)
                .submitLabel(.send)
                .onSubmit {
                    if sendEnabled {
                        onSend()
                    }
                }
                .accessibilityIdentifier("assistant-chat-composer")

            if isRunActive {
                Button(action: onStop) {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 16))
                        .frame(width: 40, height: 44)
                }
                .foregroundStyle(.red)
                .accessibilityLabel("停止")
            }

            Button {
                isComposerFocused = false
                withAnimation(panelAnimation) {
                    isActionPanelExpanded.toggle()
                }
            } label: {
                Image(systemName: isActionPanelExpanded ? "xmark.circle" : "plus.circle")
                    .font(.system(size: 24))
                    .frame(width: 40, height: 44)
            }
            .accessibilityLabel(AppLocalization.string(
                isActionPanelExpanded ? "关闭添加面板" : "添加附件或引用",
                locale: locale
            ))

            if hasPayload {
                Button(action: onSend) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .frame(width: 40, height: 44)
                }
                .disabled(!sendEnabled)
                .accessibilityLabel(AppLocalization.string(isRunActive ? "加入待处理" : "发送", locale: locale))
                .accessibilityIdentifier("assistant-chat-send")
            }
        }
        .foregroundStyle(.blue)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Color(uiColor: .systemGray5), in: .rect(cornerRadius: 18))
    }

    private var attachmentStrip: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(attachments) { attachment in
                    if attachment.type == "image" {
                        ZStack(alignment: .topTrailing) {
                            Button {
                                previewAttachment = attachment
                            } label: {
                                ComposerAttachmentImage(attachment: attachment, maxPointSize: 96)
                                    .frame(width: 96, height: 96)
                                    .clipped()
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(String(
                                format: AppLocalization.string("预览图片：%@", locale: locale),
                                locale: locale,
                                attachment.name
                            ))
                            .accessibilityIdentifier("assistant-attachment-preview")

                            Button {
                                attachments.removeAll { $0.id == attachment.id }
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 28, height: 28)
                                    .background(.black.opacity(0.75), in: .circle)
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(String(
                                format: AppLocalization.string("移除 %@", locale: locale),
                                locale: locale,
                                attachment.name
                            ))
                            .accessibilityIdentifier("assistant-attachment-remove")
                        }
                        .frame(width: 96, height: 96)
                        .background(Color.secondary.opacity(0.12))
                        .clipShape(.rect(cornerRadius: 12))
                    } else {
                        HStack(spacing: 6) {
                            Image(systemName: "doc")
                            Button(attachment.name) { previewFile(attachment) }
                                .lineLimit(1)
                                .accessibilityIdentifier("assistant-file-preview")
                            Button {
                                attachments.removeAll { $0.id == attachment.id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(String(
                                format: AppLocalization.string("移除 %@", locale: locale),
                                locale: locale,
                                attachment.name
                            ))
                        }
                        .font(.caption)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(Color.secondary.opacity(0.12), in: .capsule)
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func previewFile(_ attachment: MessageAttachment) {
        guard let bytes = Data(base64Encoded: attachment.data), !bytes.isEmpty else {
            previewFileError = "文件内容无法读取"
            return
        }
        do {
            let directory = FileManager.default.temporaryDirectory
                .appending(path: "xopc-draft-preview-\(UUID().uuidString)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
            let name = URL(fileURLWithPath: attachment.name).lastPathComponent
            let fileURL = directory.appending(path: name.isEmpty ? "attachment" : name)
            do {
                try bytes.write(to: fileURL, options: .atomic)
            } catch {
                try? FileManager.default.removeItem(at: directory)
                throw error
            }
            previewFileDirectory = directory
            previewFileURL = fileURL
        } catch {
            previewFileError = error.localizedDescription
        }
    }

    private var referenceStrip: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(references) { reference in
                    HStack(spacing: 6) {
                        Image(systemName: reference.kind.systemImage)
                        Text(reference.title)
                            .lineLimit(1)
                        Button {
                            references.removeAll { $0.id == reference.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("移除引用 \(reference.title)")
                    }
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Color.blue.opacity(0.1), in: .capsule)
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private var sendEnabled: Bool {
        hasPayload
    }

    private func selectAction(_ action: AssistantAction) {
        withAnimation(panelAnimation) {
            isActionPanelExpanded = false
        }
        switch action {
        case .photo: showingPhotoPicker = true
        case .camera: showingCameraPicker = true
        case .localFile: showingFilePicker = true
        case .voice: showingVoiceRecorder = true
        case .noteReference, .taskReference, .fileReference:
            referenceKind = action.referenceKind ?? .note
            showingReferencePicker = true
        case .newConversation: onNewConversation()
        }
    }

    private var hasPayload: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !attachments.isEmpty
            || !references.isEmpty
    }

    private var panelAnimation: Animation? {
        reduceMotion ? nil : .easeInOut(duration: 0.2)
    }

    private var canSteer: Bool {
        attachments.isEmpty && references.isEmpty
    }

    private var placeholder: LocalizedStringKey {
        "给助手发送消息"
    }
}

private struct ComposerAttachmentImage: View {
    let attachment: MessageAttachment
    let maxPointSize: CGFloat

    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: maxPointSize <= 96 ? .fill : .fit)
            } else if failed {
                Image(systemName: "photo.badge.exclamationmark")
                    .foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .task(id: displayScale) {
            failed = false
            let encoded = attachment.data
            let maxPixel = Int(maxPointSize * displayScale)
            let thumbnail = await Task.detached(priority: .utility) {
                guard let data = Data(base64Encoded: encoded),
                      let source = CGImageSourceCreateWithData(
                          data as CFData,
                          [kCGImageSourceShouldCache: false] as CFDictionary
                      ) else { return nil as CGImage? }
                let options: [CFString: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: maxPixel,
                    kCGImageSourceShouldCacheImmediately: true
                ]
                return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
            }.value
            guard !Task.isCancelled else { return }
            image = thumbnail.map(UIImage.init(cgImage:))
            failed = thumbnail == nil
        }
    }
}
