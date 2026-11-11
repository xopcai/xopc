import SwiftUI

// swiftlint:disable:next type_body_length
struct NotesView: View {
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void
    var bottomInset: CGFloat = 0

    @State private var notes: [NoteSummary] = []
    @Environment(\.locale) private var locale
    @State private var section = LibrarySection.all
    @State private var search = ""
    @State private var recentFiles: [FileResource] = []
    @State private var deliveries: [HomeDelivery] = []
    @State private var deliveryError: String?
    @State private var deliveriesLoading = true
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
        VStack(spacing: 0) {
            notesSearchField
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 8)
            Picker("资料类型", selection: $section) {
                ForEach(LibrarySection.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("library-category")
            .padding(.horizontal, 20)
            List {
                if section.showsNotes && (pendingVoiceNote != nil || pendingVoiceNoteLoadFailed) {
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
                if section == .all && !isLoading && !isSearchingFiles && !deliveriesLoading
                    && error == nil && fileSearchError == nil && deliveryError == nil && notes.isEmpty
                    && visibleFiles.isEmpty && visibleDeliveries.isEmpty && pendingVoiceNote == nil {
                    ContentUnavailableView("没有匹配的资料", systemImage: "folder")
                }
                if section == .notes { statusPicker }
                if section.showsNotes {
                    if isLoading, notes.isEmpty {
                        loadingRows
                    } else if notes.isEmpty, section == .notes {
                        ContentUnavailableView(emptyTitle, systemImage: "note.text")
                            .listRowBackground(Color.clear)
                    } else if !notes.isEmpty {
                        Section("笔记") {
                            ForEach(section == .all && search.isEmpty ? Array(notes.prefix(3)) : notes) { note in
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
                }
                if section.showsFiles && (section == .files || !visibleFiles.isEmpty || isSearchingFiles || fileSearchError != nil) {
                    fileSection
                }
                if section.showsDeliveries && (section == .deliveries || !visibleDeliveries.isEmpty || deliveriesLoading || deliveryError != nil) {
                    deliverySection
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 0, for: .scrollContent)
            .contentMargins(.bottom, bottomInset, for: .scrollContent)
            .refreshable { await refreshLibrary() }
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("资料")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
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
        .task(id: configuration) {
            await refreshPendingVoiceNote()
            await loadDeliveries()
        }
        .task(id: LibrarySearch(query: search, status: status, configuration: configuration)) {
            if !search.isEmpty {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
            async let notes: Void = load()
            async let files: Void = loadMatchingFiles()
            _ = await (notes, files)
        }
        .onChange(of: section) {
            if section != .notes { status = "" }
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
                TextField("搜索资料", text: $search)
                    .textFieldStyle(.plain)
                    .submitLabel(.search)
                    .onSubmit { Task { await searchLibrary() } }
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

    private var visibleFiles: [FileResource] {
        guard search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return matchedFiles }
        return Array(recentFiles.prefix(section == .all ? 3 : 50))
    }

    private var fileSection: some View {
        Section("文件") {
            if isSearchingFiles { ProgressListSkeleton() }
            if let fileSearchError {
                Text(fileSearchError).foregroundStyle(.secondary)
                Button("重试") { Task { await loadMatchingFiles() } }
            }
            ForEach(visibleFiles) { file in
                NavigationLink {
                    FileDestinationView(configuration: configuration, file: file)
                } label: {
                    Label(file.name, systemImage: file.kind == "directory" ? "folder" : "doc.text")
                }
                .accessibilityIdentifier("note-file-result-\(file.id)")
            }
            if section == .files {
                NavigationLink("浏览文件空间") { FileLibraryView(configuration: configuration) }
            }
        }
    }

    private var deliverySection: some View {
        Section("近期成果") {
            if deliveriesLoading && deliveries.isEmpty { ProgressListSkeleton() }
            if let deliveryError {
                Text(deliveryError).foregroundStyle(.secondary)
                Button("重试") { Task { await loadDeliveries() } }
            }
            ForEach(visibleDeliveries.prefix(section == .all && search.isEmpty ? 3 : deliveries.count)) { item in
                HomeDeliveryLink(item: item, configuration: configuration, onOpenConversation: onOpenConversation)
            }
            if section == .deliveries && visibleDeliveries.isEmpty && !deliveriesLoading && deliveryError == nil {
                Text("没有匹配的近期成果").foregroundStyle(.secondary)
            }
        }
    }

    private var visibleDeliveries: [HomeDelivery] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return deliveries.filter {
            $0.destination != nil && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query)
                || $0.summary.localizedCaseInsensitiveContains(query))
        }
    }

    private func searchLibrary() async {
        async let notes: Void = load()
        async let files: Void = loadMatchingFiles()
        _ = await (notes, files)
    }

    private func refreshLibrary() async {
        async let search: Void = searchLibrary()
        async let deliveries: Void = loadDeliveries()
        await refreshPendingVoiceNote()
        _ = await (search, deliveries)
    }

    @MainActor private func loadDeliveries() async {
        deliveriesLoading = true
        defer { deliveriesLoading = false }
        do {
            let home = try await GatewayClient(configuration: configuration).fetchHome(locale: locale.identifier)
            try Task.checkCancellation()
            deliveries = home.recentDeliveries ?? []
            deliveryError = nil
        } catch is CancellationError {
        } catch {
            deliveryError = error.localizedDescription
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
        isLoading = true
        defer {
            if revision == notesLoadRevision {
                isLoading = false
            }
        }
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
        matchedFiles = []
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        fileSearchRevision += 1
        let revision = fileSearchRevision
        isSearchingFiles = true
        defer {
            if revision == fileSearchRevision {
                isSearchingFiles = false
            }
        }
        do {
            let client = GatewayClient(configuration: configuration)
            let files = try await query.isEmpty ? client.fetchRecentFiles() : client.searchFiles(query: query)
            guard revision == fileSearchRevision,
                  search.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            if query.isEmpty { recentFiles = files } else { matchedFiles = files }
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
                    .fixedSize(horizontal: false, vertical: true)
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
            if let tags = note.tags, !tags.isEmpty {
                Text(tags.prefix(3).map { "#\($0)" }.joined(separator: "  "))
                    .mobileTextStyle(.caption)
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

private enum LibrarySection: String, CaseIterable, Identifiable {
    case all, notes, files, deliveries

    var id: Self { self }
    var showsNotes: Bool { self == .all || self == .notes }
    var showsFiles: Bool { self == .all || self == .files }
    var showsDeliveries: Bool { self == .all || self == .deliveries }

    var title: LocalizedStringKey {
        switch self {
        case .all: "全部"
        case .notes: "笔记"
        case .files: "文件"
        case .deliveries: "成果"
        }
    }
}

private struct LibrarySearch: Equatable {
    let query: String
    let status: String
    let configuration: GatewayConfiguration
}
