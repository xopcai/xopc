import AVKit
import QuickLook
import SwiftUI

struct LibraryVersion: Decodable, Identifiable, Sendable {
    let id: String
    let ordinal: Int
    let fileName: String
    let mimeType: String
    let sizeBytes: Int
    let createdAt: Double
    let indexStatus: String
    let music: LibraryMusic?

    var safeName: String {
        let name = fileName.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "\\", with: "_")
        return name.isEmpty || name == "." || name == ".." ? "attachment" : name
    }

    func contentPath(_ itemID: String) -> String {
        "/api/spaces/items/\(itemID)/versions/\(id)/content"
    }
}

struct LibraryMusic: Decodable, Sendable {
    let id: String
    let conversationId: String
    let lyrics: String?
    let durationMs: Double?
}

struct LibraryOrigin: Decodable, Sendable {
    let kind: String
    let versionId: String?
    let conversationId: String
    let projectId: String?
    let taskId: String?
    let automationRunId: String?
    let label: String?
    let available: Bool
}

private struct LibraryHit: Decodable, Sendable {
    let text: String
}

private struct LibraryItem: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let kind: String
    let favorite: Bool
    let trashedAt: Double?
    let updatedAt: Double
    let revision: Int
    let currentVersion: LibraryVersion
    let origin: LibraryOrigin?
    let hit: LibraryHit?
    let versions: [LibraryVersion]?
    let origins: [LibraryOrigin]?
}

private struct LibraryPage: Decodable, Sendable {
    let items: [LibraryItem]
    let nextCursor: String?
}

private enum LibraryScope: String, CaseIterable {
    case all, favorites, trash

    var title: LocalizedStringResource {
        switch self {
        case .all: "library_scope_all"
        case .favorites: "library_scope_favorites"
        case .trash: "library_scope_trash"
        }
    }
}

private struct LibraryMutation: Encodable {
    let revision: Int
    var title: String?
    var favorite: Bool?
}

private struct LibraryMutationResult: Decodable {
    let ok: Bool?
}

struct SpaceLibraryView: View {
    let configuration: GatewayConfiguration
    let onOpenSource: (LibraryOrigin) -> Void
    let onUseInChat: (MessageAttachment, LibraryOrigin?) async throws -> Void
    @Environment(\.locale) private var locale
    @Environment(\.mobileTheme) private var theme
    @State private var scope: LibraryScope = .all
    @State private var query = ""
    @State private var kind = ""
    @State private var items: [LibraryItem] = []
    @State private var selectedItem: LibraryItem?
    @State private var cursor: String?
    @State private var loading = true
    @State private var failed = false
    @State private var refresh = 0
    @State private var undo: (id: String, revision: Int)?
    @State private var undoFailed = false

    private let kinds = ["document", "spreadsheet", "presentation", "image", "audio", "video", "archive", "file"]
    private var client: GatewayClient { GatewayClient(configuration: configuration) }
    private var filters: [String] { [scope.rawValue, String(query.prefix(160)).trimmingCharacters(in: .whitespacesAndNewlines), kind] }
    private func label(_ zh: String, _ en: String) -> String { locale.identifier.hasPrefix("zh") ? zh : en }

    var body: some View {
        List {
            Section {
                if loading, items.isEmpty {
                    ForEach(0 ..< 5, id: \.self) { _ in
                        Label("────────────────", systemImage: "doc").redacted(reason: .placeholder)
                    }
                } else if failed {
                    Button(label("加载失败，重试", "Could not load. Retry")) { refresh += 1 }
                } else if items.isEmpty {
                    Text(emptyMessage).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                        .padding(.vertical, 22)
                }
                ForEach(items) { item in
                    Button {
                        selectedItem = item
                    } label: {
                        row(item)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("space-item-\(item.id)")
                    .listRowBackground(theme.card)
                }
                if let cursor {
                    Button(label("加载更多", "Load more")) { Task { await load(filters, after: cursor) } }
                        .disabled(loading)
                }
            } header: {
                HStack {
                    Text(label("名称", "Name"))
                    Spacer()
                    Text(label("更新日期", "Updated"))
                }
                .textCase(nil)
            }
        }
        .sheet(item: $selectedItem) { item in
            SpaceLibraryDetail(configuration: configuration, item: item, searchHit: item.hit, onOpenSource: onOpenSource,
                               onUseInChat: onUseInChat, onChange: { refresh += 1 }, onTrash: {
                                   undo = (item.id, $0)
                                   undoFailed = false
                               })
        }
        .scrollContentBackground(.hidden)
        .background(theme.canvas)
        .safeAreaInset(edge: .top, spacing: 0) {
            SegmentedTabs(options: LibraryScope.allCases.map {
                SegmentOption(id: $0, title: $0.title, accessibilityID: "library-scope-\($0.rawValue)")
            }, selected: scope, label: "library_scope_label") { selection in
                scope = selection
            }
            .padding(.horizontal, 16).padding(.bottom, 8)
            .background(.bar)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let undo {
                HStack {
                    Text(undoFailed ? label("操作未完成，请重试", "Could not complete the action. Try again.")
                        : label("已移到回收站", "Moved to Trash"))
                    Spacer()
                    Button(label("撤销", "Undo")) {
                        self.undo = nil
                        Task {
                            do {
                                let _: LibraryMutationResult = try await client.request(
                                    path: "/api/spaces/items/\(undo.id)/restore", method: "POST",
                                    body: client.encoder.encode(LibraryMutation(revision: undo.revision)))
                                refresh += 1
                            } catch {
                                self.undo = undo
                                undoFailed = true
                            }
                        }
                    }
                }
                .font(.footnote).padding().background(.bar)
            }
        }
        .mobilePageTitle(Text(verbatim: label("资料库", "Library")))
        .searchable(text: $query, prompt: Text(verbatim: label("搜索资料", "Search files")))
        .toolbar {
            Menu {
                Picker(label("资料类型", "File type"), selection: $kind) {
                    Text(label("全部类型", "All types")).tag("")
                    ForEach(kinds, id: \.self) { type in Text(typeName(type)).tag(type) }
                }
            } label: { Label(label("资料类型", "File type"), systemImage: "line.3.horizontal.decrease.circle") }
        }
        .onChange(of: scope) { query = ""; kind = ""; undo = nil }
        .refreshable { await load(filters) }
        .task(id: filters + [String(refresh), ComposerDraftStore.accountScope(configuration)]) {
            let request = filters
            let cache = ComposerDraftStore.accountScope(configuration) + ":space:" + request.joined(separator: "\u{1F}")
            let snapshot: LibraryPage? = MobileListCache.shared.read(.spaceLibrary, scope: cache)
            items = snapshot?.items ?? []
            cursor = snapshot?.nextCursor
            failed = false
            loading = true
            if !request[1].isEmpty {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
            await load(request, cache: cache)
        }
    }

    private var emptyMessage: String {
        if !query.isEmpty { return label("没有匹配的资料", "No matching results") }
        switch scope {
        case .all: return label("暂无资料", "No results yet")
        case .favorites: return label("暂无收藏", "No favorites")
        case .trash: return label("回收站为空", "Trash is empty")
        }
    }

    private func typeName(_ type: String) -> String {
        ["document": label("文档", "Documents"), "spreadsheet": label("表格", "Spreadsheets"),
         "presentation": label("演示", "Slides"), "image": label("图片", "Images"), "audio": label("音频", "Audio"),
         "video": label("视频", "Video"), "archive": label("压缩包", "Archives")][type] ?? label("文件", "Files")
    }

    private func row(_ item: LibraryItem) -> some View {
        let symbol = ["image": "photo", "audio": "music.note", "video": "film", "spreadsheet": "tablecells",
                      "presentation": "rectangle.on.rectangle", "archive": "archivebox"][item.kind] ?? "doc"
        let ext = (item.currentVersion.fileName as NSString).pathExtension.uppercased()
        let metadata = [ext, item.origin.map(originLabel) ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        return HStack(spacing: 12) {
            Image(systemName: symbol).frame(width: 36).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: item.title).lineLimit(1)
                if !metadata.isEmpty { Text(verbatim: metadata).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                if let hit = item.hit { Text(verbatim: hit.text).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer(minLength: 8)
            Text(Date(timeIntervalSince1970: item.updatedAt / 1000), format: .dateTime.month().day())
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func originLabel(_ origin: LibraryOrigin) -> String {
        origin.label ?? (origin.kind == "task" ? label("任务", "Task")
            : origin.kind == "automation" ? label("定时任务", "Automation") : label("对话", "Chat"))
    }

    @MainActor private func load(_ filters: [String], after pageCursor: String? = nil, cache: String? = nil) async {
        loading = true
        var parameters = [URLQueryItem(name: "view", value: filters[0]), URLQueryItem(name: "q", value: filters[1])]
        if !filters[2].isEmpty { parameters.append(URLQueryItem(name: "kind", value: filters[2])) }
        if let pageCursor { parameters.append(URLQueryItem(name: "cursor", value: pageCursor)) }
        do {
            let page: LibraryPage = try await client.request(path: "/api/spaces/items", queryItems: parameters)
            guard !Task.isCancelled, filters == self.filters else { return }
            if pageCursor == nil {
                items = page.items
                if let cache { MobileListCache.shared.write(page, to: .spaceLibrary, scope: cache, requestedAt: .now) }
            } else {
                let known = Set(items.map(\.id))
                items.append(contentsOf: page.items.filter { !known.contains($0.id) })
            }
            cursor = page.nextCursor
            failed = false
        } catch {
            guard !Task.isCancelled, filters == self.filters else { return }
            failed = true
        }
        loading = false
    }
}

private struct SpaceLibraryDetail: View {
    let configuration: GatewayConfiguration
    @State var item: LibraryItem
    let searchHit: LibraryHit?
    let onOpenSource: (LibraryOrigin) -> Void
    let onUseInChat: (MessageAttachment, LibraryOrigin?) async throws -> Void
    let onChange: () -> Void
    let onTrash: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @Environment(\.mobileTheme) private var theme
    @State private var versionID: String?
    @State private var preview: URL?
    @State private var share: FileShareItem?
    @State private var text: String?
    @State private var previewFailed = false
    @State private var detailLoaded = false
    @State private var busy = false
    @State private var error: String?
    @State private var editing = false
    @State private var newTitle = ""
    @State private var purging = false

    private var client: GatewayClient { GatewayClient(configuration: configuration) }
    private var path: String { "/api/spaces/items/\(item.id)" }
    private var version: LibraryVersion { item.versions?.first { $0.id == versionID } ?? item.currentVersion }
    private var source: LibraryOrigin? {
        item.origins?.first { $0.available && $0.versionId == version.id }
            ?? item.origins?.first { $0.available && $0.versionId == nil }
            ?? item.origin.flatMap { $0.available && ($0.versionId == nil || $0.versionId == version.id) ? $0 : nil }
    }
    private func label(_ zh: String, _ en: String) -> String { locale.identifier.hasPrefix("zh") ? zh : en }

    var body: some View {
        MobilePreview(title: item.title, onClose: { dismiss() }) {
            if item.trashedAt == nil {
                Button(label("下载", "Download"), systemImage: "arrow.down.to.line") { download() }
                Button(item.favorite ? label("取消收藏", "Remove favorite") : label("收藏", "Favorite"),
                       systemImage: item.favorite ? "star.fill" : "star") {
                    mutate("patch", favorite: !item.favorite)
                }
                .accessibilityIdentifier("preview-favorite")
                Button(label("重命名", "Rename"), systemImage: "pencil") { newTitle = item.title; editing = true }
                Button(label("移到回收站", "Move to Trash"), systemImage: "trash", role: .destructive) { mutate("trash") }
            } else {
                Button(label("恢复", "Restore")) { mutate("restore") }
                Button(label("永久删除", "Delete permanently"), role: .destructive) { purging = true }
            }
            if let versions = item.versions, versions.count > 1 {
                Section(label("版本", "Version")) {
                    ForEach(versions) { entry in
                        Button {
                            versionID = entry.id
                        } label: {
                            Label(entry.id == item.currentVersion.id ? label("最新版", "Latest") + " · v\(entry.ordinal)"
                                  : "v\(entry.ordinal) · " + Date(timeIntervalSince1970: entry.createdAt / 1000)
                                    .formatted(.dateTime.month().day()),
                                  systemImage: entry.id == version.id ? "checkmark" : "clock")
                        }
                        .accessibilityIdentifier("preview-version-\(entry.ordinal)")
                    }
                }
            }
        } content: {
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 8) {
                if version.id == item.currentVersion.id, let hit = searchHit {
                    Text(verbatim: hit.text).font(.caption).lineLimit(2).foregroundStyle(theme.secondary)
                }
                if item.trashedAt == nil {
                    HStack {
                        if let source { Button(label("查看来源", "Open source")) { dismiss(); onOpenSource(source) } }
                        Spacer()
                        Button(label("在对话中使用", "Use in chat")) { useInChat() }
                            .disabled(version.sizeBytes > AttachmentPolicy.maximumChatBytes)
                    }
                    .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                }
                if let error { Text(verbatim: error).font(.footnote).foregroundStyle(theme.secondary) }
            }
            .disabled(busy).padding(.horizontal, 20)
        }
        .alert(label("重命名", "Rename"), isPresented: $editing) {
            TextField(label("资料名称", "Result name"), text: $newTitle)
            Button(label("保存", "Save")) {
                let name = String(newTitle.trimmingCharacters(in: .whitespacesAndNewlines).prefix(240))
                if !name.isEmpty { mutate("patch", title: name) }
            }
            Button(label("取消", "Cancel"), role: .cancel) {}
        }
        .alert(label("永久删除「\(item.title)」？", "Delete “\(item.title)” permanently?"), isPresented: $purging) {
            Button(label("删除", "Delete"), role: .destructive) { mutate("purge") }
            Button(label("取消", "Cancel"), role: .cancel) {}
        }
        .task {
            defer { if !Task.isCancelled { detailLoaded = true } }
            do {
                let detail: LibraryItem = try await client.request(path: path)
                try Task.checkCancellation()
                item = detail
            } catch is CancellationError {
            } catch { self.error = label("资料暂不可用", "Result unavailable") }
        }
        .task(id: version.id) { await loadPreview(version) }
        .sheet(item: $share, onDismiss: {
            if let url = shareURL { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
            shareURL = nil
        }) { FileShareSheet(url: $0.url) }
        .onDisappear { clearPreview() }
    }

    @State private var shareURL: URL?

    @ViewBuilder private var content: some View {
        if version.mimeType.hasPrefix("audio/") && !detailLoaded {
            ProgressView()
        } else if version.mimeType.hasPrefix("audio/") {
            let selectedVersion = version
            let track = GeneratedMusicTrack(configurationScope: ComposerDraftStore.accountScope(configuration),
                                            conversationID: selectedVersion.music?.conversationId ?? "",
                                            id: selectedVersion.music?.id ?? selectedVersion.id, title: item.title,
                                            source: source?.label ?? "", lyrics: selectedVersion.music?.lyrics,
                                            duration: selectedVersion.music?.durationMs.map { $0 / 1000 })
            MusicPreviewContent(playback: .shared, track: track) {
                GeneratedMusicPlayback.shared.play(track) { try await fetchFile(selectedVersion) }
            }
        } else if let text {
            PreviewText(text: text, html: version.mimeType.hasPrefix("text/html") || version.fileName.hasSuffix(".html"),
                        markdown: version.mimeType == "text/markdown" || version.fileName.hasSuffix(".md"),
                        configuration: configuration, conversationID: source?.conversationId)
        } else if let preview {
            if version.mimeType.hasPrefix("video/") {
                PreviewVideo(url: preview)
            } else {
                SpaceQuickLook(url: preview)
            }
        } else if previewFailed {
            ContentUnavailableView(label("资料暂不可读，可下载查看", "Preview unavailable. Download to view."), systemImage: "doc")
        } else {
            ProgressView()
        }
    }

    @MainActor private func loadPreview(_ version: LibraryVersion) async {
        clearPreview()
        previewFailed = false
        guard !version.mimeType.hasPrefix("audio/") else { return }
        do {
            if version.mimeType.hasPrefix("text/") || version.fileName.hasSuffix(".html") {
                guard version.sizeBytes <= 2 * 1024 * 1024 else { previewFailed = true; return }
                let bytes = try await client.requestData(path: version.contentPath(item.id))
                try Task.checkCancellation()
                text = String(decoding: bytes, as: UTF8.self)
                return
            }
            let url = try await fetchFile(version)
            guard !Task.isCancelled else {
                try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
                return
            }
            preview = url
        } catch is CancellationError {
        } catch { if !Task.isCancelled { previewFailed = true } }
    }

    private func clearPreview() {
        text = nil
        if let preview { try? FileManager.default.removeItem(at: preview.deletingLastPathComponent()) }
        preview = nil
    }

    private func fetchFile(_ version: LibraryVersion) async throws -> URL {
        try await client.downloadGeneratedMedia(path: version.contentPath(item.id), fileName: version.safeName)
    }

    private func download() {
        let version = version
        run {
            let url = try await fetchFile(version)
            shareURL = url
            share = FileShareItem(url: url)
        }
    }

    private func useInChat() {
        let version = version
        let source = source
        run {
            let bytes = try await client.requestData(path: version.contentPath(item.id))
            try AttachmentPolicy.validateChat(size: bytes.count, current: [])
            try await onUseInChat(MessageAttachment(id: UUID(), type: version.mimeType.hasPrefix("image/") ? "image" : "file",
                                                   name: version.safeName, mimeType: version.mimeType, size: bytes.count,
                                                   data: bytes.base64EncodedString()), source)
            dismiss()
        }
    }

    private func mutate(_ action: String, title: String? = nil, favorite: Bool? = nil) {
        run {
            let body = try client.encoder.encode(LibraryMutation(revision: item.revision, title: title, favorite: favorite))
            if action == "patch" {
                item = try await client.request(path: path, method: "PATCH", body: body)
                onChange()
            } else {
                let _: LibraryMutationResult = try await client.request(
                    path: action == "trash" ? path : path + "/" + action, method: action == "trash" ? "DELETE" : "POST", body: body)
                if action == "trash" { onTrash(item.revision + 1) }
                onChange()
                dismiss()
            }
        }
    }

    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        error = nil
        Task { @MainActor in
            defer { busy = false }
            do { try await operation() }
            catch {
                self.error = label("操作未完成，请重试", "Could not complete the action. Try again.")
                if let detail: LibraryItem = try? await client.request(path: path) { item = detail }
            }
        }
    }
}

struct SpaceQuickLook: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        if context.coordinator.url != url {
            context.coordinator.url = url
            controller.reloadData()
        }
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(_ url: URL) { self.url = url }
        func numberOfPreviewItems(in _: QLPreviewController) -> Int { 1 }
        func previewController(_: QLPreviewController, previewItemAt _: Int) -> any QLPreviewItem { url as NSURL }
    }
}
