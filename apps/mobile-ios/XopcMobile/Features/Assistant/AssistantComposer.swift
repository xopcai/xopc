// swiftlint:disable file_length
import ImageIO
import QuickLook
import SwiftUI

// swiftlint:disable:next type_body_length
struct AssistantComposer: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    var focusAllowed = true
    var connectionReady = true
    var personalName: String?
    var suggestion: NextTurnSuggestion?
    var onAcceptSuggestion: (NextTurnSuggestion) -> Void = { _ in }
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var draft: String
    @Binding var attachments: [MessageAttachment]
    @Binding var references: [ContextReference]
    @Binding var showingPhotoPicker: Bool
    @Binding var showingFilePicker: Bool
    @Binding var showingCameraPicker: Bool
    @Binding var voiceMode: Bool
    @Binding var showingReferencePicker: Bool
    @Binding var referenceKind: ContextReferenceKind
    @Binding var isActionPanelExpanded: Bool

    @Binding var attachmentError: String?
    let canReferenceFiles: Bool
    let onSwitchAgent: (() -> Void)?
    var showsVoiceCallInPanel = false
    var canStartVoiceCall = false
    var onStartVoiceCall: (() -> Void)?
    let isRunActive: Bool
    let onInputFocusChanged: (Bool) -> Void
    let onStop: () -> Void
    let onSend: () -> Void
    let onVoiceStart: () -> Void
    let onVoiceAttachment: (MessageAttachment) -> Void

    @FocusState.Binding var isComposerFocused: Bool
    @State private var previewAttachment: MessageAttachment?
    @State private var previewFileURL: URL?
    @State private var previewFileDirectory: URL?
    @State private var previewFileError: String?
    @State private var palette: [ComposerPaletteItem] = []
    @State private var paletteError: String?

    @State private var caretOffset: Int?
    @State private var caretRequest: ComposerCaretRequest?
    @State private var paletteSource: ComposerPaletteSource?
    @State private var dismissedDraft: String?

    private var paletteToken: ComposerPaletteToken? {
        guard isComposerFocused, draft != dismissedDraft else { return nil }
        return ComposerPaletteToken.atCaret(in: draft, utf16Offset: caretOffset)
    }

    private var activePaletteSource: ComposerPaletteSource? {
        guard paletteToken != nil else { return nil }
        return ComposerPaletteSource(configuration: configuration, language: locale.identifier)
    }

    private var paletteMatches: [ComposerPaletteItem] {
        guard let token = paletteToken, paletteSource == activePaletteSource else { return [] }
        let allowsCommands = token.range.lowerBound == draft.startIndex
        return Array(
            palette.compactMap { item -> (ComposerPaletteItem, Int)? in
                guard allowsCommands || item.id.hasPrefix("skill:"),
                      let score = item.rank(for: token.query) else { return nil }
                return (item, score)
            }
            .sorted { $0.1 < $1.1 }
            .prefix(12)
            .map(\.0)
        )
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
                TransientComposerFeedback(message: attachmentError) { self.attachmentError = nil }
                    .accessibilityLabel(AppLocalization.resolve("附件错误：\(attachmentError)", locale: locale))
            }
            if paletteToken != nil, !isActionPanelExpanded {
                paletteSuggestions
            }
            controls
            if isActionPanelExpanded {
                AssistantActionPanel(
                    canReferenceFiles: canReferenceFiles,
                    canSwitchAgent: onSwitchAgent != nil,
                    showsVoiceCall: showsVoiceCallInPanel,
                    canStartVoiceCall: canStartVoiceCall,
                    onSelect: selectAction
                )
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .onChange(of: focusAllowed) {
            if !focusAllowed {
                isComposerFocused = false; isActionPanelExpanded = false
            }
        }
        .onChange(of: isComposerFocused) {
            onInputFocusChanged(isComposerFocused || voiceMode)
            if isComposerFocused {
                isActionPanelExpanded = false
            }
        }
        .onChange(of: voiceMode) { onInputFocusChanged(isComposerFocused || voiceMode) }
        .task(id: activePaletteSource) {
            guard let source = activePaletteSource, paletteSource != source else { return }
            await loadPalette(source)
        }
        .sheet(item: $previewAttachment) { attachment in
            NavigationStack {
                ComposerAttachmentImage(attachment: attachment, maxPointSize: 900)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(mobileTheme.panel)
                    .navigationTitle(attachment.name)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("关闭", systemImage: "xmark") { previewAttachment = nil }
                        }
                    }
            }
            .mobileSheetPreset(.large)
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
                            applyPaletteItem(item)
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
            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(14)))
        }
    }

    private func applyPaletteItem(_ item: ComposerPaletteItem) {
        guard let token = paletteToken else { return }
        let offset = draft[..<token.range.lowerBound].utf16.count + item.token.utf16.count
        draft.replaceSubrange(token.range, with: item.token)
        dismissedDraft = item.token.hasSuffix(" ") ? nil : draft
        caretOffset = offset
        caretRequest = ComposerCaretRequest(offset: offset)
        isActionPanelExpanded = false
        isComposerFocused = true
    }

    @MainActor private func loadPalette(_ source: ComposerPaletteSource) async {
        paletteError = nil
        do {
            let rows = try await GatewayClient(configuration: source.configuration)
                .fetchComposerPalette(language: source.language)
            guard !Task.isCancelled, activePaletteSource == source else { return }
            palette = rows
            paletteSource = source
        } catch is CancellationError {
        } catch {
            if !Task.isCancelled, activePaletteSource == source {
                paletteError = error.localizedDescription
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 8) {
            Button {
                isComposerFocused = false
                isActionPanelExpanded = false
                voiceMode.toggle()
            } label: {
                Image(systemName: voiceMode ? "keyboard" : "mic")
                    .font(.title3).frame(width: 44, height: 44)
            }
            .accessibilityLabel(voiceMode ? "键盘输入" : "语音输入")
            if voiceMode {
                HoldToSpeakBar(configuration: configuration, onStart: onVoiceStart, onAttachment: onVoiceAttachment,
                               onText: { text in
                                   draft += draft.isEmpty ? text : "\n" + text
                                   voiceMode = false
                                   Task { @MainActor in
                                       await Task.yield()
                                       if focusAllowed, !voiceMode {
                                           isComposerFocused = true
                                       }
                                   }
                               },
                               onError: { attachmentError = $0.isEmpty ? nil : $0 })
            } else {
                messageField
            }

            if isRunActive {
                Button(action: onStop) {
                    Image(systemName: "stop.fill")
                        .font(.callout)
                        .frame(width: 40, height: 44)
                }
                .foregroundStyle(mobileTheme.danger)
                .accessibilityLabel("停止")
            }

            Button {
                isComposerFocused = false
                withAnimation(panelAnimation) {
                    isActionPanelExpanded.toggle()
                }
            } label: {
                Image(systemName: isActionPanelExpanded ? "xmark.circle" : "plus.circle")
                    .font(.title2)
                    .frame(width: 40, height: 44)
            }
            .accessibilityLabel(AppLocalization.string(
                isActionPanelExpanded ? "关闭添加面板" : "添加附件或引用",
                locale: locale
            ))

            if hasPayload {
                Button(action: onSend) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title)
                        .frame(width: 40, height: 44)
                }
                .disabled(!sendEnabled)
                .accessibilityLabel(AppLocalization.string("发送", locale: locale))
                .accessibilityIdentifier("assistant-chat-send")
            }
        }
        .foregroundStyle(mobileTheme.action)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(24)))
    }

    private var messageField: some View {
        ZStack(alignment: .leading) {
            composerInput
                .foregroundStyle(.primary)
                .lineLimit(1 ... 3)
                .submitLabel(.send)
                .onSubmit {
                    if sendEnabled {
                        onSend()
                    }
                }
                .accessibilityIdentifier("assistant-chat-composer")
            if let suggestion {
                Button {
                    onAcceptSuggestion(suggestion)
                } label: {
                    HStack(spacing: 4) {
                        Text(suggestion.prompt).lineLimit(1)
                        Image(systemName: "arrow.turn.down.right").font(.caption)
                    }
                    .foregroundStyle(.secondary)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(format: AppLocalization.string("填入建议：%@", locale: locale), suggestion.prompt))
                .accessibilityIdentifier("assistant-next-turn-suggestion")
                .padding(.trailing, 24)
            }
        }
    }

    @ViewBuilder private var composerInput: some View {
        let prompt: Text? = suggestion == nil ? nil : Text("")
        if #available(iOS 18, *) {
            ComposerCaretField(placeholder: placeholder, prompt: prompt, draft: $draft, caretOffset: $caretOffset,
                               request: caretRequest, focused: $isComposerFocused)
        } else {
            TextField(placeholder, text: $draft, prompt: prompt, axis: .vertical)
                .focused($isComposerFocused)
        }
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
                                    .font(.footnote.weight(.semibold))
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
                        .clipShape(.rect(cornerRadius: mobileTheme.corner(12)))
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
                    .background(mobileTheme.action.opacity(0.10), in: .capsule)
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private var sendEnabled: Bool {
        hasPayload && connectionReady
    }

    private func selectAction(_ action: AssistantAction) {
        withAnimation(panelAnimation) {
            isActionPanelExpanded = false
        }
        switch action {
        case .photo: showingPhotoPicker = true
        case .camera: showingCameraPicker = true
        case .localFile: showingFilePicker = true
        case .voice: voiceMode = true
        case .switchAgent: onSwitchAgent?()
        case .voiceCall: onStartVoiceCall?()
        case .noteReference, .taskReference, .fileReference:
            referenceKind = action.referenceKind ?? .note
            showingReferencePicker = true
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

    private var placeholder: String {
        if let personalName {
            return String(format: AppLocalization.string("问问 %@", locale: locale), personalName)
        }
        return AppLocalization.string("给助手发送消息", locale: locale)
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

private struct ComposerPaletteSource: Equatable {
    let configuration: GatewayConfiguration
    let language: String
}

private struct ComposerCaretRequest: Equatable {
    let id = UUID()
    let offset: Int
}

@available(iOS 18, *)
private struct ComposerCaretField: View {
    let placeholder: String
    let prompt: Text?
    @Binding var draft: String
    @Binding var caretOffset: Int?
    let request: ComposerCaretRequest?
    @FocusState.Binding var focused: Bool
    @State private var selection: TextSelection?

    var body: some View {
        TextField(placeholder, text: $draft, selection: $selection, prompt: prompt, axis: .vertical)
            .focused($focused)
            .onChange(of: draft) {
                if draft.isEmpty {
                    caretOffset = nil
                }
            }
            .onChange(of: selection) {
                guard let selection, case let .selection(range) = selection.indices,
                      range.isEmpty,
                      range.upperBound <= draft.endIndex,
                      range.upperBound.samePosition(in: draft.unicodeScalars) != nil
                else {
                    caretOffset = nil
                    return
                }
                caretOffset = range.upperBound.utf16Offset(in: draft)
            }
            .onChange(of: request) {
                guard let request else { return }
                let clamped = min(max(0, request.offset), draft.utf16.count)
                let utf16Index = draft.utf16.index(draft.utf16.startIndex, offsetBy: clamped)
                let index = utf16Index.samePosition(in: draft) ?? draft.endIndex
                selection = .init(insertionPoint: index)
            }
    }
}
