import SwiftUI
import UniformTypeIdentifiers

// swiftlint:disable:next type_body_length
struct NoteDetailView: View {
    let configuration: GatewayConfiguration
    let noteID: String
    let onOpenConversation: (String, String, String) -> Void
    var showsCloseButton = false

    @Environment(\.dismiss) private var dismiss
    @Environment(\.mobileTheme) private var mobileTheme
    @State private var note: NoteDetail?
    @State private var isLoading = true
    @State private var error: String?
    @State private var editingNote: NoteDetail?
    @State private var editingLocalDraft = false
    @State private var confirmsDelete = false
    @State private var discussion: DiscussionDetail?
    @State private var isRetryingDiscussion = false
    @State private var hasLocalRecording = false
    @State private var isImportingFile = false
    @State private var isUploadingFile = false
    @State private var readingParts: [MarkdownPart] = []
    @State private var readingToolsOpen = false
    @State private var readingTarget: UUID?

    var body: some View {
        Group {
            if isLoading {
                MobileListSkeleton(rows: 4)
                    .padding(.horizontal, 20).padding(.top, 12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            } else if let note {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            noteHeader(note)
                            if let original = originalRecording(in: note) {
                                NoteAttachmentsSection(
                                    configuration: configuration, noteID: note.id,
                                    attachments: [original], showsHeading: false
                                )
                            }
                            if let discussion {
                                DiscussionProcessingSection(
                                    detail: discussion,
                                    isRetrying: isRetryingDiscussion,
                                    retryUsesLocalAudio: hasLocalRecording && discussion.discussion.failureStage == "audio_upload",
                                    onRetry: {
                                        Task {
                                            if hasLocalRecording, discussion.discussion.failureStage == "audio_upload" {
                                                await retryLocalRecording()
                                            } else {
                                                await retryDiscussion()
                                            }
                                        }
                                    }
                                )
                            }
                            if !note.markdown.isEmpty || note.kind != "voice" {
                                Group {
                                    if note.markdown.isEmpty {
                                        Text("暂无正文").foregroundStyle(mobileTheme.secondary)
                                    } else {
                                        MarkdownBodyView(parts: readingParts, configuration: configuration, conversationID: nil,
                                                         highlightedPart: readingTarget)
                                            .environment(\.chatTextSelectionEnabled, true)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                            }
                            let attachments = remainingAttachments(in: note)
                            if !attachments.isEmpty {
                                NoteAttachmentsSection(configuration: configuration, noteID: note.id, attachments: attachments)
                            }
                        }
                        .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 24)
                    }
                    .onChange(of: readingTarget) { _, target in
                        guard let target else { return }
                        proxy.scrollTo(target, anchor: .top)
                    }
                }
            } else {
                ContentUnavailableView {
                    Label("无法打开笔记", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error ?? AppLocalization.string("笔记不存在", locale: AppLocalization.selectedLocale))
                } actions: {
                    if NoteEditorView.hasLocalDraft(configuration: configuration, noteID: noteID) {
                        Button("继续编辑本地草稿") { editingLocalDraft = true }
                    }
                    Button("重试") { Task { await load() } }
                }
            }
        }
        .background(mobileTheme.canvas)
        .mobilePageTitle(Text("笔记"))
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let note {
                HStack(spacing: 6) {
                    if note.kind != "voice" {
                        Button { Task { await openConversation(note) } } label: {
                            Label("继续对话", systemImage: "bubble.left")
                                .padding(.horizontal, 14).frame(minHeight: 44)
                                .foregroundStyle(mobileTheme.foreground).contentShape(.capsule)
                        }
                        .accessibilityIdentifier("note-detail-chat")
                    }
                    Button { editingNote = note } label: {
                        Label("编辑笔记", systemImage: "square.and.pencil")
                            .padding(.horizontal, 16).frame(minHeight: 44)
                            .foregroundStyle(mobileTheme.action)
                            .background(mobileTheme.active, in: .capsule)
                    }
                    .accessibilityIdentifier(note.kind == "voice" ? "voice-note-edit" : "note-detail-edit")
                }
                .buttonStyle(.plain).font(.subheadline.weight(.semibold)).padding(5)
                .background(mobileTheme.panel, in: .capsule)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: note.kind == "voice" ? .trailing : .center)
            }
        }
        .toolbar {
            if showsCloseButton {
                ToolbarItem(placement: .topBarLeading) {
                    MobileHeaderIconButton("关闭", systemImage: "xmark") { dismiss() }
                }
                .mobileTransparentToolbarItem()
            }
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 8) {
                    if !readingParts.isEmpty {
                        MobileHeaderIconButton("在笔记中查找", systemImage: "magnifyingglass") {
                            readingTarget = nil
                            readingToolsOpen = true
                        }
                        .accessibilityIdentifier("note-reading-tools")
                    }
                    if let note {
                        Menu {
                            Button("添加附件", systemImage: "paperclip") { isImportingFile = true }
                                .disabled(isUploadingFile)
                            Button("继续对话", systemImage: "bubble.left") { Task { await openConversation(note) } }
                            noteStateActions(note)
                        } label: {
                            MobileHeaderIconLabel(systemImage: "ellipsis.circle")
                        }
                        .accessibilityLabel("更多")
                    }
                }
            }
            .mobileTransparentToolbarItem()
        }
        .task(id: note?.markdown) {
            guard let markdown = note?.markdown else { return }
            let previous = readingParts
            let parts = await Task.detached(priority: .userInitiated) {
                MarkdownPart.project(MarkdownBlock.parse(markdown), previous: previous)
            }.value
            if !Task.isCancelled {
                readingParts = parts
            }
        }
        .sheet(isPresented: $readingToolsOpen) {
            NoteReadingTools(parts: readingParts) { target in
                readingTarget = target
                readingToolsOpen = false
            }
            .mobileSheetPreset(.medium)
        }
        .sheet(isPresented: $editingLocalDraft, onDismiss: { Task { await load() } }) {
            NoteEditorView(configuration: configuration, draftNoteID: noteID)
                .mobileSheetPreset(.large)
        }
        .sheet(item: $editingNote, onDismiss: { Task { await load() } }) { note in
            NoteEditorView(configuration: configuration, existing: note)
                .mobileSheetPreset(.large)
        }
        .fileImporter(isPresented: $isImportingFile, allowedContentTypes: [.item]) { result in
            Task { await uploadFile(result) }
        }
        .alert("操作失败", isPresented: Binding(get: { note != nil && error != nil }, set: {
            if !$0 {
                error = nil
            }
        })) {
            Button("刷新") { Task { await load(); await monitorDiscussion() } }
            Button("好", role: .cancel) {}
        } message: { Text(error ?? AppLocalization.string("未知错误", locale: AppLocalization.selectedLocale)) }
        .confirmationDialog("删除这条笔记？", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("删除", role: .destructive) { Task { await remove() } }
            Button("取消", role: .cancel) {}
        } message: { Text("删除后将无法在移动端恢复。") }
        .task(id: noteID) { await load(); await monitorDiscussion() }
    }

    private func noteHeader(_ note: NoteDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if isDefaultVoiceNoteTitle(note.title, kind: note.kind) {
                Text("语音记录").font(.title.bold())
            } else if let title = note.title, !title.isEmpty {
                Text(verbatim: title).font(.title.bold())
            } else {
                Text("未命名笔记").font(.title.bold())
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { noteMetadata(note) }
                VStack(alignment: .leading, spacing: 4) { noteMetadata(note) }
            }
            .mobileTextStyle(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func noteMetadata(_ note: NoteDetail) -> some View {
        Text(note.updatedAt.millisecondsDate, format: .dateTime.year().month().day().hour().minute())
        Text(note.status.noteStatusLabel)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(mobileTheme.panel, in: .rect(cornerRadius: 6))
        if note.pinned == true {
            Label("已置顶", systemImage: "pin.fill").foregroundStyle(.tint)
        }
    }

    @ViewBuilder
    private func noteStateActions(_ note: NoteDetail) -> some View {
        Button {
            Task { await mutate(note, pinned: note.pinned != true) }
        } label: {
            Label {
                Text(note.pinned == true ? LocalizedStringResource("取消置顶") : "置顶")
            } icon: {
                Image(systemName: "pin")
            }
        }
        Button {
            Task { await mutate(note, status: note.status == "archived" ? "inbox" : "archived") }
        } label: {
            Label {
                Text(note.status == "archived" ? LocalizedStringResource("移回收件箱") : "归档")
            } icon: {
                Image(systemName: note.status == "archived" ? "tray.and.arrow.up" : "archivebox")
            }
        }
        Button("删除", systemImage: "trash", role: .destructive) { confirmsDelete = true }
    }

    private func originalRecording(in note: NoteDetail) -> NoteAttachment? {
        guard note.kind == "voice" else { return nil }
        let audio = note.attachments?.filter { $0.mimeType.hasPrefix("audio/") } ?? []
        if let originalID = discussion?.discussion.audioAttachmentId {
            return audio.first(where: { $0.id == originalID })
        }
        return audio.first
    }

    private func remainingAttachments(in note: NoteDetail) -> [NoteAttachment] {
        let originalID = originalRecording(in: note)?.id
        return (note.attachments ?? []).filter { attachment in
            guard attachment.id != originalID else { return false }
            guard note.kind == "voice", attachment.mimeType == "application/json" else { return true }
            let link = "xopc-attachment://notes/\(note.id)/\(attachment.id)"
            if note.markdown.contains(link) {
                return true
            }
            return !isRecordingManifest(attachment.fileName)
        }
    }

    private func isRecordingManifest(_ name: String) -> Bool {
        guard name.hasSuffix(".json"),
              let prefix = ["recording-events-", "recording-sources-"].first(where: { name.hasPrefix($0) })
        else { return false }
        return UUID(uuidString: String(name.dropFirst(prefix.count).dropLast(5))) != nil
    }

    @MainActor
    private func load() async {
        isLoading = note == nil
        defer { isLoading = false }
        do { note = try await GatewayClient(configuration: configuration).fetchNote(id: noteID); error = nil }
        catch { self.error = error.localizedDescription }
    }

    @MainActor
    private func openConversation(_ note: NoteDetail) async {
        do {
            let id = try await GatewayClient(configuration: configuration).openNoteConversation(id: note.id)
            dismiss()
            let locale = AppLocalization.selectedLocale
            let name = note.title ?? AppLocalization.string("笔记", locale: locale)
            let title = String(format: AppLocalization.string("讨论：%@", locale: locale), locale: locale, name)
            onOpenConversation(id, title, "main")
        } catch { self.error = error.localizedDescription }
    }

    @MainActor
    private func remove() async {
        guard let note else { return }
        do { try await GatewayClient(configuration: configuration).deleteNote(note); dismiss() }
        catch { self.error = error.localizedDescription }
    }

    @MainActor
    private func mutate(_ note: NoteDetail, status: String? = nil, pinned: Bool? = nil) async {
        do {
            self.note = try await GatewayClient(configuration: configuration)
                .updateNoteState(note, status: status, pinned: pinned)
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func monitorDiscussion() async {
        while !Task.isCancelled {
            do {
                let next = try await GatewayClient(configuration: configuration).fetchDiscussion(noteID: noteID)
                let store = PendingVoiceNoteStore(gatewayURL: configuration.baseURL)
                if next.discussion.audioAttachmentId != nil {
                    _ = try? await store.clearIfUploaded(noteID: noteID)
                }
                hasLocalRecording = await (try? store.load())?.noteID == noteID
                let shouldReloadNote = discussion?.discussion.audioAttachmentId != next.discussion.audioAttachmentId
                    || discussion?.discussion.status != next.discussion.status
                discussion = next
                if shouldReloadNote {
                    await load()
                }
                guard next.isProcessing else { return }
                try await Task.sleep(for: .seconds(3))
            } catch let clientError as GatewayClientError {
                if case .http(statusCode: 404, message: _) = clientError {
                    return
                }
                error = clientError.localizedDescription
                return
            } catch is CancellationError {
                return
            } catch {
                self.error = error.localizedDescription
                return
            }
        }
    }

    @MainActor
    private func retryDiscussion() async {
        guard let id = discussion?.discussion.id else { return }
        isRetryingDiscussion = true
        defer { isRetryingDiscussion = false }
        do {
            discussion = try await GatewayClient(configuration: configuration).retryDiscussion(id: id)
            await monitorDiscussion()
        } catch { self.error = error.localizedDescription }
    }

    @MainActor
    private func retryLocalRecording() async {
        let store = PendingVoiceNoteStore(gatewayURL: configuration.baseURL)
        isRetryingDiscussion = true
        defer { isRetryingDiscussion = false }
        do {
            guard let pending = try await store.load(), pending.noteID == noteID else {
                hasLocalRecording = false
                return
            }
            _ = try await VoiceNoteSubmission(
                store: store,
                gateway: GatewayClient(configuration: configuration)
            ).resume(pending)
            await monitorDiscussion()
        } catch { self.error = error.localizedDescription }
    }

    @MainActor
    private func uploadFile(_ result: Result<URL, Error>) async {
        guard let note else { return }
        isUploadingFile = true
        defer { isUploadingFile = false }
        do {
            let url = try result.get()
            let grantedAccess = url.startAccessingSecurityScopedResource()
            defer {
                if grantedAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            let data = try Data(contentsOf: url)
            guard data.count <= AttachmentPolicy.maximumBytes else { throw NoteUploadError.tooLarge }
            let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
            try await GatewayClient(configuration: configuration).uploadNoteAttachment(
                noteID: note.id,
                name: url.lastPathComponent,
                mimeType: mimeType,
                data: data
            )
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

enum NoteUploadError: LocalizedError {
    case tooLarge
    case tooMany

    var errorDescription: String? {
        switch self {
        case .tooLarge: AppLocalization.string("单个附件不能超过 32 MiB", locale: AppLocalization.selectedLocale)
        case .tooMany:
            String(format: AppLocalization.string("最多添加 %lld 个附件", locale: AppLocalization.selectedLocale), AttachmentPolicy.maximumCount)
        }
    }
}

extension String {
    var noteStatusLabel: String {
        let key = switch self {
        case "inbox": "收件箱"
        case "processed": "已处理"
        case "archived": "已归档"
        case "trashed": "已删除"
        default: self
        }
        return AppLocalization.string(key, locale: AppLocalization.selectedLocale)
    }
}

private struct NoteReadingTools: View {
    let parts: [MarkdownPart]
    let select: (UUID) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var entries: [NoteReadingEntry] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return parts.compactMap { part in
            switch part.block {
            case let .heading(level, text) where search.isEmpty:
                return NoteReadingEntry(id: part.id, text: text, level: level)
            default:
                guard !search.isEmpty, let text = searchableText(part.block),
                      let match = text.range(of: search, options: [.caseInsensitive, .diacriticInsensitive])
                else { return nil }
                let leading = text[..<match.lowerBound].suffix(48)
                let trailing = text[match.upperBound...].prefix(72)
                let snippet = (leading.count < text.distance(from: text.startIndex, to: match.lowerBound) ? "…" : "")
                    + leading + text[match] + trailing
                return NoteReadingEntry(id: part.id, text: String(snippet), level: 0)
            }
        }
    }

    var body: some View {
        NavigationStack {
            List(entries) { entry in
                Button {
                    select(entry.id)
                } label: {
                    Text(entry.text)
                        .lineLimit(3)
                        .padding(.leading, CGFloat(max(0, entry.level - 1) * 10))
                }
            }
            .overlay {
                if entries.isEmpty {
                    ContentUnavailableView(query.isEmpty ? "暂无标题" : "没有匹配内容", systemImage: "doc.text.magnifyingglass")
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索笔记正文")
            .navigationTitle(query.isEmpty ? "目录" : "查找结果")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
        }
    }

    private func searchableText(_ block: MarkdownBlock) -> String? {
        switch block {
        case let .heading(_, text), let .paragraph(text), let .bullet(_, text), let .numbered(_, _, text),
             let .quote(text), let .code(text), let .image(text, _): text
        case let .table(rows, _): rows.flatMap(\.cells).map(\.text).joined(separator: " ")
        case .math, .chart, .divider: nil
        }
    }
}

private struct NoteReadingEntry: Identifiable {
    let id: UUID
    let text: String
    let level: Int
}
