import SwiftUI
import UniformTypeIdentifiers

struct NoteEditorView: View {
    let configuration: GatewayConfiguration
    let existing: NoteDetail?
    let projectID: String?
    let draftNoteID: String?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.locale) private var locale
    @State private var title: String
    @State private var markdown: String
    @State private var isSaving = false
    @State private var error: String?
    @State private var errorTitle = "保存失败"
    @State private var isImportingFile = false
    @State private var stagedAttachments: [StagedNoteAttachment] = []
    @State private var persistedNote: NoteDetail?
    @State private var confirmsDiscard = false
    @State private var restored = false
    @State private var textRecoveryFailed = false
    @State private var attachmentRecoveryFailed = false
    @State private var draftBaseRevision: Int?
    @State private var savedRemoteID: String?
    @State private var pendingCreate: NoteCreateAttempt?
    @State private var conflictingNote: NoteDetail?
    @State private var showsConflict = false
    @State private var shouldClearRecovery = false

    init(configuration: GatewayConfiguration, existing: NoteDetail? = nil, projectID: String? = nil,
         draftNoteID: String? = nil) {
        self.configuration = configuration
        self.existing = existing
        self.projectID = projectID
        self.draftNoteID = draftNoteID
        _title = State(initialValue: existing?.title ?? "")
        _markdown = State(initialValue: existing?.markdown ?? "")
        _draftBaseRevision = State(initialValue: existing?.remoteVersion)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                TextField("标题", text: $title)
                    .font(.title2.weight(.semibold))
                    .padding(.top, 16)
                if #available(iOS 18.0, *) {
                    MarkdownNoteInput(markdown: $markdown, configuration: configuration,
                                      autofocus: restored && existing == nil && draftNoteID == nil && markdown.isEmpty && title.isEmpty)
                } else {
                    TextEditor(text: $markdown)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityLabel("笔记正文")
                }
                if !stagedAttachments.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(stagedAttachments) { attachment in
                                Button {
                                    stagedAttachments.removeAll { $0.id == attachment.id }
                                } label: {
                                    Label(attachment.name, systemImage: "xmark.circle.fill")
                                        .lineLimit(1)
                                }
                                .buttonStyle(.bordered)
                                .accessibilityLabel(String(
                                    format: AppLocalization.string("移除附件：%@", locale: locale),
                                    locale: locale,
                                    attachment.name
                                ))
                            }
                        }
                    }
                    .accessibilityIdentifier("note-staged-attachments")
                }
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 720, maxHeight: .infinity)
            .frame(maxWidth: .infinity)
            .disabled(!restored || isSaving)
            .navigationTitle(existing == nil && draftNoteID == nil
                ? LocalizedStringResource("新建笔记")
                : LocalizedStringResource("编辑笔记"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        if hasUnsavedChanges {
                            confirmsDiscard = true
                        } else {
                            dismiss()
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if conflictingNote != nil {
                        Button("处理冲突") { showsConflict = true }
                    } else {
                        Text(statusLabel)
                            .mobileTextStyle(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HStack(spacing: 12) {
                    Button { isImportingFile = true } label: {
                        Text("添加附件").frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.bordered)
                    .disabled(!restored || isSaving || stagedAttachments.count >= AttachmentPolicy.maximumCount)
                    Button { Task { await save() } } label: {
                        Text("完成").frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!restored || isSaving || !canSave || conflictingNote != nil)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(.regularMaterial)
            }
            .overlay {
                if isSaving {
                    ProgressView("正在保存…").padding().background(.regularMaterial, in: .rect(cornerRadius: 14))
                }
            }
            .fileImporter(isPresented: $isImportingFile, allowedContentTypes: [.item]) { result in
                stageFile(result)
            }
            .alert(errorTitle, isPresented: errorBinding) { Button("好", role: .cancel) {} } message: { Text(error ?? "未知错误") }
            .confirmationDialog("放弃未完成的编辑？", isPresented: $confirmsDiscard) {
                Button("保留草稿并关闭") {
                    if saveRecovery() { dismiss() }
                }
                Button("放弃并关闭", role: .destructive) {
                    clearRecovery()
                    dismiss()
                }
                Button("继续编辑") { confirmsDiscard = false }
            } message: {
                Text(persistedNote == nil
                    ? LocalizedStringResource("未保存的编辑内容和附件会丢失。")
                    : LocalizedStringResource("未保存的编辑内容和待上传附件会丢失；已保存的笔记仍保留。"))
            }
        }
        .task { restoreRecovery() }
        .onChange(of: title) { _, _ in saveTextRecovery() }
        .onChange(of: markdown) { _, _ in saveTextRecovery() }
        .onChange(of: stagedAttachments.map(\.id)) { _, _ in saveAttachmentRecovery() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active && restored && !shouldClearRecovery {
                saveTextRecovery()
            }
        }
        .interactiveDismissDisabled(hasUnsavedChanges || isSaving)
        .confirmationDialog("笔记在其他设备上有更新", isPresented: $showsConflict, titleVisibility: .visible) {
            Button("使用我的草稿") { resolveConflict(keepDraft: true) }
            Button("使用同步版本", role: .destructive) { resolveConflict(keepDraft: false) }
            Button("稍后处理", role: .cancel) {}
        } message: {
            Text("本地草稿已保留。选定版本后可以继续编辑。")
        }
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isUnchanged: Bool {
        guard let saved = persistedNote ?? existing else { return false }
        return title == (saved.title ?? "") && markdown == saved.markdown && stagedAttachments.isEmpty
    }

    private var hasUnsavedChanges: Bool {
        if persistedNote != nil || existing != nil {
            return !isUnchanged
        }
        return !title.isEmpty || !markdown.isEmpty || !stagedAttachments.isEmpty
    }

    private var draftWriteFailed: Bool { textRecoveryFailed || attachmentRecoveryFailed }

    private var statusLabel: LocalizedStringKey {
        if let saved = persistedNote ?? existing,
           title == (saved.title ?? ""), markdown == saved.markdown,
           !stagedAttachments.isEmpty
        {
            return "附件待上传"
        }
        if draftWriteFailed { return "无法保存本地草稿" }
        if isUnchanged { return "已保存" }
        return hasUnsavedChanges ? "草稿已存本机" : "未保存"
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { error != nil }, set: {
            if !$0 {
                error = nil
            }
        })
    }

    private var recovery: NoteEditorRecoveryStore {
        NoteEditorRecoveryStore(configuration: configuration, noteID: existing?.id ?? draftNoteID, projectID: projectID)
    }

    static func hasLocalDraft(configuration: GatewayConfiguration, noteID: String) -> Bool {
        let store = NoteEditorRecoveryStore(configuration: configuration, noteID: noteID, projectID: nil)
        return (try? store.read(NoteEditorRecovery.self, file: "text")) != nil
    }

    private func restoreRecovery() {
        guard !restored else { return }
        defer { restored = true }
        do {
            if let draft = try recovery.read(NoteEditorRecovery.self, file: "text") {
                title = draft.title
                markdown = draft.markdown
                draftBaseRevision = draft.baseRevision
                savedRemoteID = draft.remoteID ?? draftNoteID
                pendingCreate = draft.pendingCreate
                if let existing, existing.remoteVersion != draft.baseRevision,
                   title != (existing.title ?? "") || markdown != existing.markdown {
                    conflictingNote = existing
                    showsConflict = true
                }
            }
            stagedAttachments = try recovery.read([StagedNoteAttachment].self, file: "attachments") ?? []
        } catch {
            textRecoveryFailed = true
            errorTitle = "无法读取本地草稿"
            self.error = error.localizedDescription
        }
    }

    private func saveTextRecovery() {
        guard restored, !shouldClearRecovery else { return }
        do {
            try recovery.write(NoteEditorRecovery(title: title, markdown: markdown, baseRevision: draftBaseRevision,
                                                  remoteID: savedRemoteID, pendingCreate: pendingCreate), file: "text")
            textRecoveryFailed = false
        } catch {
            textRecoveryFailed = true
        }
    }

    private func saveAttachmentRecovery() {
        guard restored, !shouldClearRecovery else { return }
        do {
            try recovery.write(stagedAttachments, file: "attachments")
            attachmentRecoveryFailed = false
        } catch {
            attachmentRecoveryFailed = true
        }
    }

    private func saveRecovery() -> Bool {
        saveTextRecovery()
        saveAttachmentRecovery()
        if draftWriteFailed {
            errorTitle = "无法保存本地草稿"
            error = AppLocalization.string("请重试", locale: locale)
        }
        return !draftWriteFailed
    }

    private func clearRecovery() {
        shouldClearRecovery = true
        try? recovery.remove()
    }

    private func resolveConflict(keepDraft: Bool) {
        guard let conflictingNote else { return }
        if !keepDraft {
            title = conflictingNote.title ?? ""
            markdown = conflictingNote.markdown
        }
        persistedNote = conflictingNote
        draftBaseRevision = conflictingNote.remoteVersion
        self.conflictingNote = nil
        saveTextRecovery()
    }

    @MainActor
    private func save() async {
        guard !isSaving, conflictingNote == nil else { return }
        isSaving = true
        defer { isSaving = false }
        let client = GatewayClient(configuration: configuration)
        let saved: NoteDetail
        var current = persistedNote ?? existing
        var alreadySaved = false
        do {
            if current == nil, let savedRemoteID {
                current = try await client.fetchNote(id: savedRemoteID)
            }
            if current == nil {
                let attempt = pendingCreate ?? NoteCreateAttempt(title: title, markdown: markdown)
                pendingCreate = attempt
                guard saveRecovery() else { return }
                let created = try await client.createNote(title: attempt.title, markdown: attempt.markdown,
                                                          projectID: projectID, idempotencyKey: attempt.key)
                current = created
                alreadySaved = title == attempt.title && markdown == attempt.markdown
                persistedNote = created
                savedRemoteID = created.id
                draftBaseRevision = created.remoteVersion
                pendingCreate = nil
                saveTextRecovery()
            }
            guard let current else { return }
            if alreadySaved || (title == (current.title ?? "") && markdown == current.markdown) {
                saved = current
            } else {
                guard current.remoteVersion == draftBaseRevision else {
                    conflictingNote = current
                    showsConflict = true
                    return
                }
                saved = try await client.updateNote(current, title: title, markdown: markdown)
            }
            persistedNote = saved
            title = saved.title ?? ""
            markdown = saved.markdown
            savedRemoteID = saved.id
            draftBaseRevision = saved.remoteVersion
            saveTextRecovery()
        } catch GatewayClientError.http(statusCode: 409, _) {
            if let id = current?.id, let latest = try? await client.fetchNote(id: id) {
                conflictingNote = latest
                showsConflict = true
            } else {
                errorTitle = "保存失败"
                self.error = AppLocalization.string("请重试", locale: locale)
            }
            return
        } catch {
            errorTitle = "保存失败"
            self.error = error.localizedDescription
            return
        }
        do {
            while !stagedAttachments.isEmpty {
                let attachment = stagedAttachments[0]
                try await client.uploadNoteAttachment(
                    noteID: saved.id,
                    name: attachment.name,
                    mimeType: attachment.mimeType,
                    data: attachment.data,
                    idempotencyKey: attachment.id
                )
                stagedAttachments.removeFirst()
                saveAttachmentRecovery()
            }
            clearRecovery()
            dismiss()
        } catch {
            errorTitle = "笔记已保存，附件待上传"
            self.error = FileUploadFailureMessage.resolve(error)
        }
    }

    @MainActor
    private func stageFile(_ result: Result<URL, Error>) {
        if case let .failure(error) = result {
            let nsError = error as NSError
            if nsError.domain == NSCocoaErrorDomain, nsError.code == NSUserCancelledError {
                return
            }
        }
        do {
            guard stagedAttachments.count < AttachmentPolicy.maximumCount else {
                throw NoteUploadError.tooMany
            }
            let url = try result.get()
            let grantedAccess = url.startAccessingSecurityScopedResource()
            defer {
                if grantedAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            if let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
               size > AttachmentPolicy.maximumBytes
            {
                throw NoteUploadError.tooLarge
            }
            let data = try Data(contentsOf: url)
            guard data.count <= AttachmentPolicy.maximumBytes else { throw NoteUploadError.tooLarge }
            stagedAttachments.append(StagedNoteAttachment(
                name: url.lastPathComponent,
                mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                data: data
            ))
        } catch {
            errorTitle = "附件无法添加"
            self.error = error.localizedDescription
        }
    }
}

private struct StagedNoteAttachment: Identifiable, Codable {
    var id = UUID()
    let name: String
    let mimeType: String
    let data: Data
}


private struct NoteCreateAttempt: Codable {
    let title: String
    let markdown: String
    var key = UUID()
}

private struct NoteEditorRecovery: Codable {
    let title: String
    let markdown: String
    let baseRevision: Int?
    let remoteID: String?
    let pendingCreate: NoteCreateAttempt?
}

private struct NoteEditorRecoveryStore {
    let configuration: GatewayConfiguration
    let noteID: String?
    let projectID: String?
    var baseDirectory: URL?

    private func directory() throws -> URL {
        let root = try baseDirectory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                               appropriateFor: nil, create: true)
        let scope = ComposerDraftStore.accountScope(configuration)
        let identity = noteID.map { "note:" + $0 } ?? projectID.map { "project:" + $0 } ?? "new"
        let key = ComposerDraftStore.accountScope(identity: scope + ":" + identity)
        return root.appendingPathComponent("note-editor-drafts", isDirectory: true)
            .appendingPathComponent(key, isDirectory: true)
    }

    func read<Value: Decodable>(_ type: Value.Type, file: String) throws -> Value? {
        let url = try directory().appendingPathComponent(file + ".json")
        do { return try JSONDecoder().decode(type, from: Data(contentsOf: url)) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
    }

    func write<Value: Encodable>(_ value: Value, file: String) throws {
        let directory = try directory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: directory.appendingPathComponent(file + ".json"),
                                              options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    func remove() throws {
        do { try FileManager.default.removeItem(at: directory()) }
        catch let error as CocoaError where error.code == .fileNoSuchFile {}
    }
}
