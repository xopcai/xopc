import SwiftUI
import UniformTypeIdentifiers

// swiftlint:disable:next type_body_length
struct NoteDetailView: View {
    let configuration: GatewayConfiguration
    let noteID: String
    let onOpenConversation: (String, String, String) -> Void
    var showsCloseButton = false

    @Environment(\.dismiss) private var dismiss
    @State private var note: NoteDetail?
    @State private var isLoading = true
    @State private var error: String?
    @State private var editingNote: NoteDetail?
    @State private var confirmsDelete = false
    @State private var discussion: DiscussionDetail?
    @State private var isRetryingDiscussion = false
    @State private var hasLocalRecording = false
    @State private var isImportingFile = false
    @State private var isUploadingFile = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView("正在读取笔记…")
            } else if let note {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if let title = note.title, !title.isEmpty {
                            Text(verbatim: title).font(.title.bold())
                        } else {
                            Text("未命名笔记").font(.title.bold())
                        }
                        if note.pinned == true {
                            Label("已置顶", systemImage: "pin.fill")
                                .font(.caption)
                                .foregroundStyle(.blue)
                        }
                        HStack {
                            Label(note.status.noteStatusLabel, systemImage: "circle.fill")
                            Text(note.updatedAt.millisecondsDate, format: .dateTime.year().month().day().hour().minute())
                        }
                        .font(.caption).foregroundStyle(.secondary)
                        if !note.markdown.isEmpty || note.kind != "voice" {
                            Group {
                                if note.markdown.isEmpty {
                                    Text("暂无正文")
                                } else {
                                    Text(.init(note.markdown))
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
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
                        if let attachments = note.attachments, !attachments.isEmpty {
                            NoteAttachmentsSection(
                                configuration: configuration,
                                noteID: note.id,
                                attachments: attachments
                            )
                        }
                    }
                    .padding()
                }
            } else {
                ContentUnavailableView(
                    "无法打开笔记",
                    systemImage: "exclamationmark.triangle",
                    description: Text(error ?? AppLocalization.string("笔记不存在", locale: AppLocalization.selectedLocale))
                )
            }
        }
        .navigationTitle("笔记")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if showsCloseButton {
                ToolbarItem(placement: .topBarLeading) {
                    Button("关闭", systemImage: "xmark") { dismiss() }
                }
            }
            ToolbarItemGroup(placement: .bottomBar) {
                if let note {
                    Button("编辑", systemImage: "pencil") { editingNote = note }
                    Button("添加附件", systemImage: "paperclip") { isImportingFile = true }
                        .disabled(isUploadingFile)
                    Menu("更多", systemImage: "ellipsis.circle") {
                        Button {
                            Task { await mutate(note, pinned: note.pinned != true) }
                        } label: {
                            Label {
                                Text(note.pinned == true
                                    ? LocalizedStringResource("取消置顶")
                                    : LocalizedStringResource("置顶"))
                            } icon: {
                                Image(systemName: "pin")
                            }
                        }
                        Button {
                            Task {
                                await mutate(note, status: note.status == "archived" ? "inbox" : "archived")
                            }
                        } label: {
                            Label {
                                Text(note.status == "archived"
                                    ? LocalizedStringResource("移回收件箱")
                                    : LocalizedStringResource("归档"))
                            } icon: {
                                Image(systemName: note.status == "archived" ? "tray.and.arrow.up" : "archivebox")
                            }
                        }
                        Button("删除", systemImage: "trash", role: .destructive) { confirmsDelete = true }
                    }
                    Button("继续对话", systemImage: "bubble.left") { Task { await openConversation(note) } }
                }
            }
        }
        .sheet(item: $editingNote, onDismiss: { Task { await load() } }) { note in
            NoteEditorView(configuration: configuration, existing: note)
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
        .task(id: noteID) {
            await load()
            await monitorDiscussion()
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
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
