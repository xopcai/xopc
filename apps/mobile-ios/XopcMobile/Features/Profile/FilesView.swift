import SwiftUI

struct FileDestinationView: View {
    let configuration: GatewayConfiguration
    let file: FileResource

    var body: some View {
        if file.kind == "directory" {
            FileFolderView(configuration: configuration, spaceID: file.spaceId,
                           path: file.relativePath, title: file.name, writable: false)
        } else {
            FilePreviewView(configuration: configuration, file: file)
        }
    }
}

struct FilesView: View {
    let configuration: GatewayConfiguration
    var initialSpace: FileSpace?

    @State private var spaces: [FileSpace] = []
    @State private var items: [FileResource] = []
    @State private var search = ""
    @State private var loadedQuery: String?
    @State private var isLoading = true
    @State private var loadRevision = 0
    @State private var error: String?

    private var query: String {
        search.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        let matches = loadedQuery == query ? items : []
        List {
            if initialSpace == nil, query.isEmpty, !spaces.isEmpty {
                Section("文件空间") {
                    ForEach(spaces) { space in
                        NavigationLink {
                            FileFolderView(configuration: configuration, spaceID: space.id, path: "",
                                           title: space.title, writable: space.writable)
                        } label: {
                            Label(space.title, systemImage: "folder")
                        }
                        .accessibilityIdentifier("file-space-\(space.id)")
                    }
                }
            }
            Section(query.isEmpty && initialSpace == nil ? "最近文件" : "") {
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                    Button("重试") { Task { await load(query) } }
                }
                if matches.isEmpty, isLoading || loadedQuery != query, error == nil {
                    ProgressListSkeleton()
                } else if matches.isEmpty, error == nil {
                    ContentUnavailableView(query.isEmpty ? "暂无文件" : "没有匹配文件", systemImage: "folder")
                        .listRowBackground(Color.clear)
                }
                ForEach(matches) { item in
                    NavigationLink {
                        if item.kind == "directory" {
                            FileFolderView(configuration: configuration, spaceID: item.spaceId, path: item.relativePath,
                                           title: item.name, writable: isWritable(item))
                        } else {
                            FilePreviewView(configuration: configuration, file: item)
                        }
                    } label: {
                        FileRow(file: item)
                    }
                }
            }
        }
        .mobilePageTitle(Text(verbatim: initialSpace?.title ?? AppLocalization.string("文件", locale: AppLocalization.selectedLocale)))
        .toolbar {
            if let initialSpace, initialSpace.writable {
                FileUploadButton(configuration: configuration, spaceID: initialSpace.id, directory: "") {
                    await load(query)
                }
            }
        }
        .searchable(text: $search, prompt: "搜索文件")
        .refreshable { await load(query) }
        .task(id: configuration) {
            if initialSpace == nil,
               let available = try? await GatewayClient(configuration: configuration).fetchFileSpaces(),
               !Task.isCancelled
            {
                spaces = available
            }
        }
        .task(id: query) {
            let request = query
            error = nil
            if !request.isEmpty {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
            await load(request)
        }
    }

    private func isWritable(_ file: FileResource) -> Bool {
        if initialSpace?.id == file.spaceId {
            return initialSpace?.writable == true
        }
        return spaces.first { $0.id == file.spaceId }?.writable == true
    }

    @MainActor private func load(_ request: String) async {
        guard request == query else { return }
        loadRevision += 1
        let revision = loadRevision
        isLoading = true
        defer {
            if revision == loadRevision {
                isLoading = false
            }
        }
        let client = GatewayClient(configuration: configuration)
        do {
            let results: [FileResource] = if !request.isEmpty {
                try await client.searchFiles(query: request, spaceID: initialSpace?.id)
            } else if let initialSpace {
                try await client.fetchFiles(spaceID: initialSpace.id)
            } else {
                try await client.fetchRecentFiles()
            }
            guard !Task.isCancelled, revision == loadRevision, request == query else { return }
            items = results
            loadedQuery = request
            error = nil
        } catch {
            guard !Task.isCancelled, revision == loadRevision, request == query else { return }
            self.error = error.localizedDescription
        }
    }
}

struct FileFolderView: View {
    let configuration: GatewayConfiguration
    let spaceID: String
    let path: String
    let title: String
    let writable: Bool

    @State private var items: [FileResource] = []
    @State private var error: String?
    @State private var isLoading = true

    var body: some View {
        List {
            if let error, items.isEmpty {
                ContentUnavailableView("无法读取文件夹", systemImage: "exclamationmark.triangle", description: Text(error))
                    .listRowBackground(Color.clear)
                Button("重试") { Task { await load() } }
            } else if !isLoading, items.isEmpty {
                ContentUnavailableView("空文件夹", systemImage: "folder", description: Text("这个文件夹中没有内容。"))
                    .listRowBackground(Color.clear)
            } else {
                ForEach(items) { item in
                    NavigationLink {
                        if item.kind == "directory" {
                            FileFolderView(configuration: configuration, spaceID: spaceID, path: item.relativePath,
                                           title: item.name, writable: writable)
                        } else {
                            FilePreviewView(configuration: configuration, file: item)
                        }
                    } label: { FileRow(file: item) }
                }
            }
        }
        .overlay {
            if isLoading, items.isEmpty {
                ProgressView()
            }
        }
        .mobilePageTitle(Text(verbatim: title))
        .toolbar {
            if writable {
                FileUploadButton(configuration: configuration, spaceID: spaceID, directory: path) {
                    await load()
                }
            }
        }
        .refreshable { await load() }
        .task(id: configuration) { await load() }
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            items = try await GatewayClient(configuration: configuration).fetchFiles(spaceID: spaceID, path: path)
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct FileRow: View {
    let file: FileResource

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text(file.name).lineLimit(1)
                HStack {
                    Text(file.kind == "directory"
                        ? AppLocalization.string("文件夹", locale: AppLocalization.selectedLocale)
                        : ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file))
                    Text(file.modifiedAt.millisecondsDate, format: .dateTime.month().day())
                }
                .mobileTextStyle(.caption).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: file.kind == "directory" ? "folder.fill" : file.mimeType.hasPrefix("image/") ? "photo" : "doc.text")
                .foregroundStyle(file.kind == "directory" ? .blue : .secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

struct FilePreviewView: View {
    let configuration: GatewayConfiguration

    @State private var file: FileResource
    @State private var text: String?
    @State private var error: String?
    @State private var isEditing = false
    @State private var isLoading = false
    @State private var isDownloading = false
    @State private var shareItem: FileShareItem?
    @State private var downloadedURL: URL?
    @State private var downloadError: String?

    init(configuration: GatewayConfiguration, file: FileResource) {
        self.configuration = configuration
        _file = State(initialValue: file)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView("正在读取文件…")
            } else if let error {
                ContentUnavailableView {
                    Label("无法预览", systemImage: "doc.badge.ellipsis")
                } description: {
                    Text(error)
                } actions: {
                    Button("重试") { Task { await load() } }
                }
            } else if let text {
                ScrollView {
                    Text(text).font(.body.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding()
                }
            } else if !Self.isTextFile(file) {
                ContentUnavailableView("暂不支持预览", systemImage: "doc", description: Text("移动端当前支持文本、Markdown 和 JSON 文件预览。"))
            } else {
                ProgressView("正在读取文件…")
            }
        }
        .mobilePageTitle(Text(verbatim: file.name))
        .toolbar {
            Button("下载", systemImage: "arrow.down.to.line") { Task { await download() } }
                .disabled(isDownloading)
            if !isLoading, error == nil, file.capabilities.contains("edit"), text != nil {
                Button("编辑", systemImage: "pencil") { isEditing = true }
            }
        }
        .sheet(isPresented: $isEditing) {
            if let text {
                FileEditorView(
                    configuration: configuration,
                    file: file,
                    revision: file.revision,
                    initialText: text,
                    onSaved: { content, resource in
                        self.text = content
                        file = resource
                    }
                )
            }
        }
        .sheet(item: $shareItem, onDismiss: {
            if let directory = downloadedURL?.deletingLastPathComponent(),
               directory.lastPathComponent.hasPrefix("xopc-file-")
            {
                try? FileManager.default.removeItem(at: directory)
            }
            downloadedURL = nil
        }) { item in
            FileShareSheet(url: item.url)
        }
        .alert("无法下载文件", isPresented: Binding(get: { downloadError != nil }, set: {
            if !$0 {
                downloadError = nil
            }
        })) { Button("好", role: .cancel) {} } message: { Text(downloadError ?? "未知错误") }
        .task(id: configuration) { await load() }
    }

    private static func isTextFile(_ file: FileResource) -> Bool {
        file.mimeType.hasPrefix("text/") || file.mimeType == "application/json" || file.name.hasSuffix(".md")
    }

    @MainActor private func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let gateway = GatewayClient(configuration: configuration)
            let resource = try await gateway.fetchFile(id: file.id)
            let content = Self.isTextFile(resource) ? try await gateway.fetchFileText(resource) : nil
            try Task.checkCancellation()
            file = resource
            text = content
            error = nil
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }

    @MainActor private func download() async {
        isDownloading = true
        defer { isDownloading = false }
        do {
            guard file.size <= FileTransferLimit.downloadBytes else { throw FileTransferError.tooLargeForDownload }
            let url = try await GatewayClient(configuration: configuration).downloadFile(file)
            downloadedURL = url
            shareItem = FileShareItem(url: url)
        } catch {
            downloadError = error.localizedDescription
        }
    }
}

private struct FileEditorView: View {
    let configuration: GatewayConfiguration
    let file: FileResource
    let revision: String
    let onSaved: (String, FileResource) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var content: String
    @State private var isSaving = false
    @State private var error: String?

    init(
        configuration: GatewayConfiguration,
        file: FileResource,
        revision: String,
        initialText: String,
        onSaved: @escaping (String, FileResource) -> Void
    ) {
        self.configuration = configuration
        self.file = file
        self.revision = revision
        self.onSaved = onSaved
        _content = State(initialValue: initialText)
    }

    var body: some View {
        NavigationStack {
            TextEditor(text: $content)
                .font(.body.monospaced())
                .padding(.horizontal)
                .navigationTitle("编辑文件")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") { Task { await save() } }.disabled(isSaving)
                    }
                }
                .overlay {
                    if isSaving {
                        ProgressView("正在保存…")
                    }
                }
                .alert("保存失败", isPresented: errorBinding) {
                    Button("好", role: .cancel) {}
                } message: {
                    Text(error ?? "未知错误")
                }
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
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let resource = try await GatewayClient(configuration: configuration)
                .updateFileText(id: file.id, content: content, revision: revision)
            onSaved(content, resource)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
