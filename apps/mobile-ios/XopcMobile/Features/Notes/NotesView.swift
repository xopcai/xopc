import SwiftUI

struct NotesView: View {
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void

    @State private var notes: [NoteSummary] = []
    @State private var search = ""
    @State private var status = ""
    @State private var isLoading = false
    @State private var error: String?
    @State private var presentedSheet: NotesSheet?
    @State private var pendingCreation: NotesSheet?
    @State private var matchedFiles: [FileResource] = []
    @State private var fileSearchError: String?
    @State private var isSearchingFiles = false
    @State private var notesLoadRevision = 0
    @State private var fileSearchRevision = 0
    @State private var pendingVoiceNote: PendingVoiceNote?
    @State private var pendingVoiceNoteLoadFailed = false

    var body: some View {
        List {
            notesSearchField
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            if pendingVoiceNote != nil || pendingVoiceNoteLoadFailed {
                Button {
                    presentedSheet = .voice
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(pendingVoiceTitle).font(.headline)
                            Text(pendingVoiceDetail)
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "waveform")
                    }
                }
                .accessibilityHint("打开本地待上传录音")
            }
            statusPicker
            if (isLoading || isSearchingFiles), notes.isEmpty, matchedFiles.isEmpty {
                loadingRows
            } else if notes.isEmpty, matchedFiles.isEmpty {
                ContentUnavailableView(
                    emptyTitle,
                    systemImage: "note.text",
                    description: Text("新建一条文字笔记，或调整筛选条件。")
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(notes) { note in
                    Button {
                        presentedSheet = .detail(note.id)
                    } label: {
                        NoteRow(note: note)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("note-row-\(note.id)")
                }
            }
            if isSearchingFiles {
                ProgressView("正在搜索文件…")
                    .listRowSeparator(.hidden)
            }
            if let fileSearchError {
                HStack {
                    Text(fileSearchError).foregroundStyle(.secondary)
                    Spacer()
                    Button("重试") { Task { await loadMatchingFiles() } }
                }
            }
            if !matchedFiles.isEmpty {
                Section("文件") {
                    ForEach(matchedFiles) { file in
                        NavigationLink {
                            FileDestinationView(configuration: configuration, file: file)
                        } label: {
                            Label(file.name, systemImage: file.kind == "directory" ? "folder" : "doc.text")
                        }
                        .accessibilityIdentifier("note-file-result-\(file.id)")
                    }
                }
            }
        }
        .navigationTitle("笔记")
        .refreshable { await load() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("新建笔记", systemImage: "plus") { presentedSheet = .choice }
            }
        }
        .sheet(item: $presentedSheet, onDismiss: {
            if let pendingCreation {
                self.pendingCreation = nil
                presentedSheet = pendingCreation
            } else {
                Task {
                    await load()
                    await refreshPendingVoiceNote()
                }
            }
        }) { sheet in
            switch sheet {
            case .choice:
                VStack(alignment: .leading, spacing: 12) {
                    Text("新建笔记").font(.title2.bold())
                    Button {
                        pendingCreation = .create
                        presentedSheet = nil
                    } label: {
                        Label("文字笔记", systemImage: "square.and.pencil")
                            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                    }
                    .accessibilityIdentifier("notes-create-text")
                    Button {
                        pendingCreation = .voice
                        presentedSheet = nil
                    } label: {
                        Label("语音笔记", systemImage: "waveform")
                            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                    }
                    .accessibilityIdentifier("notes-create-voice")
                }
                .buttonStyle(.bordered)
                .padding(20)
                .presentationDetents([.height(250)])
                .presentationDragIndicator(.visible)
            case .create:
                NoteEditorView(configuration: configuration)
            case let .detail(id):
                NavigationStack {
                    NoteDetailView(
                        configuration: configuration,
                        noteID: id,
                        onOpenConversation: onOpenConversation,
                        showsCloseButton: true
                    )
                }
            case .voice:
                VoiceNoteFlowView(
                    configuration: configuration,
                    onOpenConversation: onOpenConversation
                )
            }
        }
        .task {
            await load()
            await refreshPendingVoiceNote()
        }
        .onChange(of: status) { Task { await load() } }
        .onChange(of: search) {
            fileSearchRevision += 1
            isSearchingFiles = false
            matchedFiles = []
            fileSearchError = nil
        }
        .alert("无法读取笔记", isPresented: errorBinding) {
            Button("重试") { Task { await load() } }
            Button("取消", role: .cancel) {}
        } message: { Text(error ?? "未知错误") }
    }

    private var notesSearchField: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField("搜索笔记", text: $search)
                    .textFieldStyle(.plain)
                    .submitLabel(.search)
                    .onSubmit { Task { await load(); await loadMatchingFiles() } }
                    .accessibilityIdentifier("notes-search-field")
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 48)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
            NavigationLink {
                FileLibraryView(configuration: configuration)
            } label: {
                Image(systemName: "folder")
                    .frame(width: 48, height: 48)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
            }
            .accessibilityLabel("文件")
            .accessibilityIdentifier("notes-files-button")
        }
    }

    private var statusPicker: some View {
        Picker("状态", selection: $status) {
            Text("全部").tag("")
            Text("收件箱").tag("inbox")
            Text("已处理").tag("processed")
            Text("已归档").tag("archived")
        }
        .pickerStyle(.segmented)
        .listRowSeparator(.hidden)
    }

    private var emptyTitle: LocalizedStringResource {
        search.isEmpty ? "暂无笔记" : "没有匹配的笔记"
    }

    private var pendingVoiceTitle: LocalizedStringKey {
        if pendingVoiceNoteLoadFailed {
            return "检查本地录音"
        }
        return pendingVoiceNote?.noteID == nil ? "继续保存语音笔记" : "继续处理语音笔记"
    }

    private var pendingVoiceDetail: LocalizedStringKey {
        if pendingVoiceNoteLoadFailed {
            return "本地录音状态暂不可读，点此重试。"
        }
        return pendingVoiceNote?.noteID == nil
            ? "录音已保存在此设备，点此重试上传。"
            : "录音仍保存在此设备，点此继续上传或确认保存。"
    }

    private var loadingRows: some View {
        ForEach(0 ..< 4, id: \.self) { _ in
            VStack(alignment: .leading, spacing: 8) {
                Text("笔记标题占位").font(.headline)
                Text("正在读取笔记内容摘要").font(.subheadline)
            }
            .redacted(reason: .placeholder)
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { error != nil }, set: {
            if !$0 {
                error = nil
            }
        })
    }

    @MainActor
    private func load() async {
        notesLoadRevision += 1
        let revision = notesLoadRevision
        let query = search
        let selectedStatus = status
        isLoading = true
        defer { if revision == notesLoadRevision { isLoading = false } }
        do {
            let loaded = try await GatewayClient(configuration: configuration)
                .fetchNotes(search: query, status: selectedStatus).items
            guard revision == notesLoadRevision else { return }
            notes = loaded
            error = nil
        } catch is CancellationError {
        } catch {
            guard revision == notesLoadRevision else { return }
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func loadMatchingFiles() async {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            matchedFiles = []
            fileSearchError = nil
            return
        }
        fileSearchRevision += 1
        let revision = fileSearchRevision
        isSearchingFiles = true
        defer { if revision == fileSearchRevision { isSearchingFiles = false } }
        do {
            let files = try await GatewayClient(configuration: configuration).searchFiles(query: query)
            guard revision == fileSearchRevision,
                  search.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            matchedFiles = files
            fileSearchError = nil
        } catch is CancellationError {
        } catch {
            guard revision == fileSearchRevision,
                  search.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            fileSearchError = error.localizedDescription
        }
    }

    @MainActor
    private func refreshPendingVoiceNote() async {
        do {
            pendingVoiceNote = try await PendingVoiceNoteStore(gatewayURL: configuration.baseURL).load()
            pendingVoiceNoteLoadFailed = false
        } catch {
            pendingVoiceNoteLoadFailed = true
        }
    }
}

private enum NotesSheet: Identifiable {
    case choice
    case create
    case voice
    case detail(String)

    var id: String {
        switch self {
        case .choice: "choice"
        case .create: "create"
        case .voice: "voice"
        case let .detail(id): "detail-\(id)"
        }
    }
}

struct NoteRow: View {
    let note: NoteSummary

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Image(systemName: note.kind == "voice" ? "waveform" : "note.text")
                    .foregroundStyle(.blue)
                    .accessibilityHidden(true)
                Text(note.displayTitle)
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            if let snippet = note.snippet, !snippet.isEmpty {
                Text(snippet)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 2) { noteMetadata }
                } else {
                    HStack(spacing: 8) { noteMetadata }
                }
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
            if let tags = note.tags, !tags.isEmpty {
                Text(tags.prefix(3).map { "#\($0)" }.joined(separator: "  "))
                    .font(.caption)
                    .foregroundStyle(.blue)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var noteMetadata: some View {
        Text(note.updatedAt.millisecondsDate, format: .dateTime.month().day().hour().minute())
        Text(note.status.noteStatusLabel)
        if let duration = note.voiceDurationSec {
            Text(duration, format: .number.precision(.fractionLength(0))) + Text(" 秒")
        }
    }
}
