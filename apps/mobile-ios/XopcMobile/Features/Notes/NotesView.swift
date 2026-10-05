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
    @State private var pendingVoiceNote: PendingVoiceNote?
    @State private var pendingVoiceNoteLoadFailed = false

    var body: some View {
        List {
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
            if isLoading, notes.isEmpty {
                loadingRows
            } else if notes.isEmpty {
                ContentUnavailableView(
                    search.isEmpty ? "暂无笔记" : "没有匹配的笔记",
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
        }
        .navigationTitle("笔记")
        .searchable(text: $search, prompt: "搜索笔记")
        .onSubmit(of: .search) { Task { await load() } }
        .refreshable { await load() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("新建笔记", systemImage: "plus") {
                    Button("文字笔记", systemImage: "square.and.pencil") { presentedSheet = .create }
                    Button("语音笔记", systemImage: "waveform") { presentedSheet = .voice }
                }
            }
        }
        .sheet(item: $presentedSheet, onDismiss: {
            Task {
                await load()
                await refreshPendingVoiceNote()
            }
        }) { sheet in
            switch sheet {
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
        .alert("无法读取笔记", isPresented: errorBinding) {
            Button("重试") { Task { await load() } }
            Button("取消", role: .cancel) {}
        } message: { Text(error ?? "未知错误") }
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
        isLoading = true
        defer { isLoading = false }
        do {
            notes = try await GatewayClient(configuration: configuration)
                .fetchNotes(search: search, status: status).items
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
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
    case create
    case voice
    case detail(String)

    var id: String {
        switch self {
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
                Label(note.displayTitle, systemImage: note.kind == "voice" ? "waveform" : "note.text")
                    .font(.headline)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            if let snippet = note.snippet, !snippet.isEmpty {
                Text(snippet).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
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
                    .font(.caption).foregroundStyle(.blue).lineLimit(1)
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
