import SwiftUI
import UniformTypeIdentifiers

struct NoteEditorView: View {
    let configuration: GatewayConfiguration
    let existing: NoteDetail?
    let projectID: String?

    @Environment(\.dismiss) private var dismiss
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

    init(configuration: GatewayConfiguration, existing: NoteDetail? = nil, projectID: String? = nil) {
        self.configuration = configuration
        self.existing = existing
        self.projectID = projectID
        _title = State(initialValue: existing?.title ?? "")
        _markdown = State(initialValue: existing?.markdown ?? "")
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                TextField("标题", text: $title)
                    .font(.title2.weight(.semibold))
                    .padding(.top, 16)
                if #available(iOS 18.0, *) {
                    MarkdownNoteInput(markdown: $markdown)
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
            .navigationTitle(existing == nil ? "新建笔记" : "编辑笔记")
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
                    Text(statusLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HStack(spacing: 12) {
                    Button { isImportingFile = true } label: {
                        Text("添加附件").frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isSaving || stagedAttachments.count >= AttachmentPolicy.maximumCount)
                    Button { Task { await save() } } label: {
                        Text("完成").frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSaving || !canSave)
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
                Button("放弃并关闭", role: .destructive) { dismiss() }
                Button("继续编辑") { confirmsDiscard = false }
            } message: {
                Text(persistedNote == nil ? "未保存的编辑内容和附件会丢失。" : "未保存的编辑内容和待上传附件会丢失；已保存的笔记仍保留。")
            }
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

    private var statusLabel: LocalizedStringKey {
        if let saved = persistedNote ?? existing,
           title == (saved.title ?? ""), markdown == saved.markdown,
           !stagedAttachments.isEmpty
        {
            return "附件待上传"
        }
        return isUnchanged ? "已保存" : "未保存"
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { error != nil }, set: {
            if !$0 {
                error = nil
            }
        })
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let client = GatewayClient(configuration: configuration)
        let saved: NoteDetail
        do {
            if let current = persistedNote ?? existing {
                saved = if title == (current.title ?? ""), markdown == current.markdown {
                    current
                } else {
                    try await client.updateNote(current, title: title, markdown: markdown)
                }
            } else {
                saved = try await client.createNote(title: title, markdown: markdown, projectID: projectID)
            }
            persistedNote = saved
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
                    data: attachment.data
                )
                stagedAttachments.removeFirst()
            }
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

private struct StagedNoteAttachment: Identifiable {
    let id = UUID()
    let name: String
    let mimeType: String
    let data: Data
}
