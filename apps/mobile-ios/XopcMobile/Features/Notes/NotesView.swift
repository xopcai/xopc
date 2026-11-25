import SwiftUI

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
    @State private var notesLoadRevision = 0
    @State private var loadedQuery: NotesSearch?
    @State private var pendingVoiceNote: PendingVoiceNote?
    @State private var pendingVoiceNoteLoadFailed = false

    private var currentQuery: NotesSearch {
        NotesSearch(query: search.trimmingCharacters(in: .whitespacesAndNewlines), status: status, configuration: configuration)
    }

    var body: some View {
        let matchingNotes = loadedQuery == currentQuery ? notes : []
        return VStack(spacing: 0) {
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
                statusPicker
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                if pendingVoiceNote != nil || pendingVoiceNoteLoadFailed {
                    recordingRecoveryRow
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                if matchingNotes.isEmpty, isLoading || loadedQuery != currentQuery && error == nil {
                    loadingRows
                } else if matchingNotes.isEmpty, error == nil {
                    ContentUnavailableView(emptyTitle, systemImage: "note.text")
                        .listRowBackground(Color.clear)
                }
                ForEach(matchingNotes) { note in
                    Button {
                        presentedSheet = .detail(note.id)
                    } label: {
                        NoteRow(note: note)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(note.kind == "voice" ? Color.clear : nil)
                    .listRowSeparator(note.kind == "voice" ? .hidden : .automatic)
                    .accessibilityIdentifier("note-row-\(note.id)")
                }
                if loadedQuery == currentQuery, nextOffset != nil {
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
        .safeAreaInset(edge: .bottom, spacing: 0) {
            NotesCaptureActions(onRecord: {
                isSearchFocused = false
                presentedSheet = .voice
            }, onCreate: {
                isSearchFocused = false
                presentedSheet = .create
            })
        }
        .mobilePageTitle(Text("笔记")) { Text("笔记").font(.headline) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                PageSearchButton("搜索笔记", isOpen: $searchOpen, query: $search,
                                 accessibilityID: "notes-open-search")
            }
        }
        .sheet(item: $presentedSheet, onDismiss: {
            Task {
                await load()
                await refreshPendingVoiceNote()
            }
        }) { sheet in
            Group {
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
            .mobileSheetPreset(.large)
        }
        .task(id: configuration) { await refreshPendingVoiceNote() }
        .task(id: currentQuery) {
            error = nil
            if !currentQuery.query.isEmpty {
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
    }

    private var emptyTitle: LocalizedStringResource {
        search.isEmpty ? "暂无笔记" : "没有匹配的笔记"
    }

    private var recordingRecoveryRow: some View {
        Button {
            isSearchFocused = false
            presentedSheet = .voice
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "mic.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 34, height: 34)
                    .background(Color.accentColor.opacity(0.14), in: .rect(cornerRadius: 9))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(pendingVoiceNoteLoadFailed ? LocalizedStringKey("检查本地录音") : "待恢复录音")
                        .mobileTextStyle(.rowTitle)
                    if let pendingVoiceNote, !pendingVoiceNoteLoadFailed {
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 6) { recoveryMetadata(pendingVoiceNote) }
                            VStack(alignment: .leading, spacing: 4) { recoveryMetadata(pendingVoiceNote) }
                        }
                        .mobileTextStyle(.secondary)
                        .foregroundStyle(mobileTheme.secondary)
                    } else {
                        Text("本地录音状态暂不可读，点此重试。")
                            .mobileTextStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .foregroundStyle(mobileTheme.foreground)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(mobileTheme.panel, in: .rect(cornerRadius: 14))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(pendingVoiceTitle)
        .accessibilityHint("打开本地待上传录音")
        .accessibilityIdentifier("notes-recover-voice")
    }

    @ViewBuilder
    private func recoveryMetadata(_ draft: PendingVoiceNote) -> some View {
        Text(draft.recordedAt.millisecondsDate, format: .dateTime.year().month().day().hour().minute())
        Text(voiceNoteTime(draft.duration)).monospacedDigit()
    }

    private var pendingVoiceTitle: LocalizedStringKey {
        if pendingVoiceNoteLoadFailed {
            return "检查本地录音"
        }
        return pendingVoiceNote?.noteID == nil ? "继续保存语音笔记" : "继续处理语音笔记"
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
        let request = currentQuery
        let scope = ComposerDraftStore.accountScope(configuration)
        let requestedAt = Date.now
        let unfiltered = request.query.isEmpty && request.status.isEmpty
        if unfiltered, notes.isEmpty || loadedQuery != request,
           let cached: [NoteSummary] = MobileListCache.shared.read(.notes, scope: scope)
        {
            loadedQuery = request
            notes = cached
            nextOffset = nil
        }
        isLoading = true
        defer {
            if revision == notesLoadRevision {
                isLoading = false
            }
        }
        do {
            let page = try await GatewayClient(configuration: configuration)
                .fetchNotes(search: request.query, status: request.status)
            guard revision == notesLoadRevision, currentQuery == request, !Task.isCancelled else { return }
            loadedQuery = request
            notes = page.items
            nextOffset = page.hasMore && !page.items.isEmpty ? page.items.count : nil
            if unfiltered {
                MobileListCache.shared.write(page.items, to: .notes, scope: scope, requestedAt: requestedAt)
            }
            error = nil
        } catch is CancellationError {
        } catch {
            guard revision == notesLoadRevision, currentQuery == request, !Task.isCancelled else { return }
            if loadedQuery != request {
                loadedQuery = request
                notes = []
                nextOffset = nil
            }
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func loadMore() async {
        let request = currentQuery
        guard loadedQuery == request, let offset = nextOffset, !isLoading, !isLoadingMore else { return }
        let revision = notesLoadRevision
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await GatewayClient(configuration: configuration)
                .fetchNotes(search: request.query, status: request.status, offset: offset)
            guard revision == notesLoadRevision, currentQuery == request, !Task.isCancelled else { return }
            let existing = Set(notes.map(\.id))
            notes.append(contentsOf: page.items.filter { !existing.contains($0.id) })
            nextOffset = page.hasMore && !page.items.isEmpty ? offset + page.items.count : nil
        } catch is CancellationError {
        } catch {
            guard revision == notesLoadRevision, currentQuery == request else { return }
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

private struct NotesCaptureActions: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let onRecord: () -> Void
    let onCreate: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onRecord) {
                Label("录音", systemImage: "mic")
                    .padding(.horizontal, 12)
                    .frame(minHeight: 46)
                    .contentShape(.capsule)
            }
            .accessibilityIdentifier("notes-create-voice")
            Button(action: onCreate) {
                Label("新建笔记", systemImage: "square.and.pencil")
                    .padding(.horizontal, 14)
                    .frame(minHeight: 46)
                    .foregroundStyle(mobileTheme.action)
                    .background(mobileTheme.action.opacity(0.12), in: .capsule)
            }
            .accessibilityIdentifier("notes-create-text")
        }
        .buttonStyle(.plain)
        .font(.subheadline.weight(.semibold))
        .padding(5)
        .background(.regularMaterial, in: .capsule)
        .overlay {
            Capsule().strokeBorder(.primary.opacity(0.08)).allowsHitTesting(false)
        }
        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notes-capture-actions")
    }
}

struct NoteRow: View {
    let note: NoteSummary

    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Image(systemName: note.pinned == true ? "pin" : note.kind == "voice" ? "waveform" : "note.text")
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                Text(isDefaultVoiceNoteTitle(note.title, kind: note.kind)
                    ? AppLocalization.string("语音记录", locale: AppLocalization.selectedLocale)
                    : note.displayTitle)
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
            .foregroundStyle(note.kind == "voice" ? mobileTheme.secondary : Color.secondary)
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
        .padding(note.kind == "voice" ? 12 : 0)
        .background(note.kind == "voice" ? mobileTheme.panel : Color.clear, in: .rect(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var noteMetadata: some View {
        Text(note.updatedAt.millisecondsDate, format: .dateTime.month().day().hour().minute())
        Text(note.status.noteStatusLabel)
        if let duration = note.voiceDurationSec {
            Text(voiceNoteTime(duration)).monospacedDigit()
        }
    }
}

private struct NotesSearch: Equatable {
    let query: String
    let status: String
    let configuration: GatewayConfiguration
}
