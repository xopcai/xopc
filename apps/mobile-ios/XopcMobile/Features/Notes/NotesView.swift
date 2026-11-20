// swiftlint:disable file_length
import SwiftUI

// swiftlint:disable:next type_body_length
struct NotesView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void

    @State private var notes: [NoteSummary] = []
    @State private var search = ""
    @State private var searchOpen = false
    @FocusState private var isSearchFocused: Bool
    @State private var status = ""
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var nextOffset: Int?
    @State private var error: String?
    @State private var presentedSheet: NotesSheet?
    @State private var pendingCreation: NotesSheet?
    @State private var notesLoadRevision = 0
    @State private var pendingVoiceNote: PendingVoiceNote?
    @State private var pendingVoiceNoteLoadFailed = false

    var body: some View {
        VStack(spacing: 0) {
            if searchOpen {
                PageSearchField("搜索笔记", text: $search, focused: $isSearchFocused,
                                accessibilityID: "notes-search-field")
                {
                    Task { await load() }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            List {
                if pendingVoiceNote != nil || pendingVoiceNoteLoadFailed {
                    Button {
                        presentedSheet = .voice
                    } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(pendingVoiceTitle).mobileTextStyle(.rowTitle)
                                Text(pendingVoiceDetail)
                                    .mobileTextStyle(.secondary).foregroundStyle(.secondary)
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
                } else if notes.isEmpty, error == nil {
                    ContentUnavailableView(emptyTitle, systemImage: "note.text")
                        .listRowBackground(Color.clear)
                }
                ForEach(notes) { note in
                    Button {
                        presentedSheet = .detail(note.id)
                    } label: {
                        NoteRow(note: note)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("note-row-\(note.id)")
                }
                if nextOffset != nil {
                    Button("加载更多") { Task { await loadMore() } }
                        .disabled(isLoading || isLoadingMore)
                        .accessibilityIdentifier("notes-load-more")
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 0, for: .scrollContent)
            .refreshable { await load(); await refreshPendingVoiceNote() }
        }
        .background(mobileTheme.canvas)
        .mobilePageTitle(Text("笔记")) { Text("笔记").font(.headline) }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                PageSearchButton("搜索笔记", isOpen: $searchOpen, query: $search,
                                 accessibilityID: "notes-open-search")
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
                    Text("新建笔记").mobileTextStyle(.detailTitle)
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
        .task(id: configuration) { await refreshPendingVoiceNote() }
        .task(id: NotesSearch(query: search, status: status, configuration: configuration)) {
            if !search.isEmpty {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
            await load()
        }
        .alert("无法读取笔记", isPresented: errorBinding) {
            Button("重试") { Task { await load() } }
            Button("取消", role: .cancel) {}
        } message: { Text(error ?? "未知错误") }
    }

    private var statusPicker: some View {
        SegmentedTabs(options: [
            SegmentOption(id: "", title: "全部", accessibilityID: "library-status-all"),
            SegmentOption(id: "inbox", title: "收件箱", accessibilityID: "library-status-inbox"),
            SegmentOption(id: "processed", title: "已处理", accessibilityID: "library-status-processed"),
            SegmentOption(id: "archived", title: "已归档", accessibilityID: "library-status-archived")
        ], selected: status, label: "状态") { status = $0 }
            .accessibilityIdentifier("library-status-tabs")
            .listRowBackground(Color.clear)
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
                Text("笔记标题占位").mobileTextStyle(.rowTitle)
                Text("正在读取笔记内容摘要").mobileTextStyle(.secondary)
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
        let scope = ComposerDraftStore.accountScope(configuration)
        let requestedAt = Date.now
        let unfiltered = query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && selectedStatus.isEmpty
        if unfiltered, notes.isEmpty, let cached: [NoteSummary] = MobileListCache.shared.read(.notes, scope: scope) {
            notes = cached
        }
        isLoading = true
        defer {
            if revision == notesLoadRevision {
                isLoading = false
            }
        }
        do {
            let page = try await GatewayClient(configuration: configuration)
                .fetchNotes(search: query, status: selectedStatus)
            guard revision == notesLoadRevision, !Task.isCancelled else { return }
            notes = page.items
            nextOffset = page.hasMore && !page.items.isEmpty ? page.items.count : nil
            if unfiltered {
                MobileListCache.shared.write(page.items, to: .notes, scope: scope, requestedAt: requestedAt)
            }
            error = nil
        } catch is CancellationError {
        } catch {
            guard revision == notesLoadRevision else { return }
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func loadMore() async {
        guard let offset = nextOffset, !isLoading, !isLoadingMore else { return }
        let revision = notesLoadRevision
        let query = search
        let selectedStatus = status
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await GatewayClient(configuration: configuration)
                .fetchNotes(search: query, status: selectedStatus, offset: offset)
            guard revision == notesLoadRevision, search == query, status == selectedStatus, !Task.isCancelled else { return }
            let existing = Set(notes.map(\.id))
            notes.append(contentsOf: page.items.filter { !existing.contains($0.id) })
            nextOffset = page.hasMore && !page.items.isEmpty ? offset + page.items.count : nil
        } catch is CancellationError {
        } catch {
            guard revision == notesLoadRevision, search == query, status == selectedStatus else { return }
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
                Image(systemName: note.pinned == true ? "pin" : note.kind == "voice" ? "waveform" : "note.text")
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                Text(note.displayTitle)
                    .mobileTextStyle(.rowTitle)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            if let snippet = note.snippet, !snippet.isEmpty {
                Text(snippet)
                    .mobileTextStyle(.secondary)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 2) { noteMetadata }
                } else {
                    HStack(spacing: 8) { noteMetadata }
                }
            }
            .mobileTextStyle(.caption)
            .foregroundStyle(.tertiary)
            if let projects = note.projects, !projects.isEmpty {
                Text(projects.map(\.name).joined(separator: " · "))
                    .mobileTextStyle(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if let tags = note.tags, !tags.isEmpty {
                Text(tags.prefix(3).map { "#\($0)" }.joined(separator: "  "))
                    .mobileTextStyle(.caption)
                    .foregroundStyle(.tint)
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

private struct NotesSearch: Equatable {
    let query: String
    let status: String
    let configuration: GatewayConfiguration
}
