import SwiftUI

struct FileLibraryView: View {
    let configuration: GatewayConfiguration

    @State private var spaces: [FileSpace] = []
    @State private var recentFiles: [FileResource] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        List {
            if isLoading, spaces.isEmpty {
                ProgressListSkeleton()
            } else if let error, spaces.isEmpty {
                ContentUnavailableView("无法读取文件空间", systemImage: "exclamationmark.triangle", description: Text(error))
                Button("重试") { Task { await load() } }
            } else if spaces.isEmpty, recentFiles.isEmpty {
                ContentUnavailableView("暂无文件空间", systemImage: "folder")
            } else {
                if !recentFiles.isEmpty {
                    Section("最近文件") {
                        ForEach(recentFiles) { file in
                            NavigationLink {
                                FileDestinationView(configuration: configuration, file: file)
                            } label: {
                                FileRow(file: file)
                            }
                        }
                    }
                }
                if !spaces.isEmpty {
                    Section("文件空间") {
                        ForEach(spaces) { space in
                            NavigationLink {
                                FilesView(configuration: configuration, initialSpace: space)
                            } label: {
                                Label(space.title, systemImage: "folder")
                            }
                            .accessibilityIdentifier("file-space-\(space.id)")
                        }
                    }
                }
            }
        }
        .navigationTitle("文件")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let client = GatewayClient(configuration: configuration)
            async let spacesRequest = client.fetchFileSpaces()
            async let recentRequest = client.fetchRecentFiles()
            spaces = try await spacesRequest
            recentFiles = await (try? recentRequest) ?? []
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

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
    let initialSpace: FileSpace?

    @State private var space: FileSpace?
    @State private var items: [FileResource] = []
    @State private var search = ""
    @State private var isLoading = false
    @State private var error: String?

    init(configuration: GatewayConfiguration, initialSpace: FileSpace? = nil) {
        self.configuration = configuration
        self.initialSpace = initialSpace
    }

    var body: some View {
        List {
            if isLoading, items.isEmpty {
                ForEach(0 ..< 5, id: \.self) { _ in Label("文件名称", systemImage: "doc").redacted(reason: .placeholder) }
            } else if let error, items.isEmpty {
                ContentUnavailableView("无法读取文件", systemImage: "exclamationmark.triangle", description: Text(error))
                    .listRowBackground(Color.clear)
                Button("重试") { Task { await load() } }
            } else if items.isEmpty {
                ContentUnavailableView(emptyTitle, systemImage: "folder", description: Text("可在 Gateway 工作区中添加文件。"))
                    .listRowBackground(Color.clear)
            } else {
                ForEach(items) { item in
                    NavigationLink {
                        if item.kind == "directory" {
                            FileFolderView(configuration: configuration, spaceID: item.spaceId, path: item.relativePath,
                                           title: item.name, writable: space?.writable == true)
                        } else {
                            FilePreviewView(configuration: configuration, file: item)
                        }
                    } label: {
                        FileRow(file: item)
                    }
                }
            }
        }
        .navigationTitle(space?.title ?? AppLocalization.string("文件", locale: AppLocalization.selectedLocale))
        .toolbar {
            Button("刷新", systemImage: "arrow.clockwise") { Task { await load() } }
                .disabled(isLoading)
            if let space, space.writable {
                FileUploadButton(configuration: configuration, spaceID: space.id, directory: "") {
                    await load()
                }
            }
        }
        .searchable(text: $search, prompt: "搜索文件")
        .onSubmit(of: .search) { Task { await load() } }
        .refreshable { await load() }
        .task { await load() }
        .alert("无法读取文件", isPresented: errorBinding) { Button("重试") { Task { await load() } }; Button("取消", role: .cancel) {} } message: { Text(error ?? "未知错误") }
    }

    private var emptyTitle: LocalizedStringResource {
        search.isEmpty ? "暂无文件" : "没有匹配文件"
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { error != nil }, set: {
            if !$0 {
                error = nil
            }
        })
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let client = GatewayClient(configuration: configuration)
            if search.isEmpty {
                let loadedSpace: FileSpace = if let initialSpace {
                    initialSpace
                } else {
                    try await client.fetchDefaultFileSpace()
                }
                space = loadedSpace
                items = try await client.fetchFiles(spaceID: loadedSpace.id)
            } else {
                items = try await client.searchFiles(query: search)
            }
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

private struct FileFolderView: View {
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
            if isLoading, items.isEmpty {
                ForEach(0 ..< 4, id: \.self) { _ in Label("文件名称", systemImage: "doc").redacted(reason: .placeholder) }
            } else if let error, items.isEmpty {
                ContentUnavailableView("无法读取文件夹", systemImage: "exclamationmark.triangle", description: Text(error))
                    .listRowBackground(Color.clear)
                Button("重试") { Task { await load() } }
            } else if items.isEmpty {
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
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button("刷新", systemImage: "arrow.clockwise") { Task { await load() } }
                .disabled(isLoading)
            if writable {
                FileUploadButton(configuration: configuration, spaceID: spaceID, directory: path) {
                    await load()
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
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
                .font(.caption).foregroundStyle(.secondary)
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
    let file: FileResource

    @State private var text: String?
    @State private var error: String?
    @State private var isEditing = false
    @State private var isLoading = false
    @State private var isDownloading = false
    @State private var shareItem: FileShareItem?
    @State private var downloadedURL: URL?
    @State private var downloadError: String?
    @State private var revision: String

    init(configuration: GatewayConfiguration, file: FileResource) {
        self.configuration = configuration
        self.file = file
        _revision = State(initialValue: file.revision)
    }

    var body: some View {
        Group {
            if let text {
                ScrollView {
                    Text(text).font(.body.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding()
                }
            } else if let error {
                ContentUnavailableView("无法预览", systemImage: "doc.badge.ellipsis", description: Text(error))
            } else if !isTextFile {
                ContentUnavailableView("暂不支持预览", systemImage: "doc", description: Text("移动端当前支持文本、Markdown 和 JSON 文件预览。"))
            } else {
                ProgressView("正在读取文件…")
            }
        }
        .navigationTitle(file.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button("刷新", systemImage: "arrow.clockwise") { Task { await load() } }
                .disabled(isLoading)
            Button("下载", systemImage: "arrow.down.to.line") { Task { await download() } }
                .disabled(isDownloading)
            if isTextFile, file.capabilities.contains("edit"), text != nil {
                Button("编辑", systemImage: "pencil") { isEditing = true }
            }
        }
        .sheet(isPresented: $isEditing) {
            if let text {
                FileEditorView(
                    configuration: configuration,
                    file: file,
                    revision: revision,
                    initialText: text,
                    onSaved: { content, resource in
                        self.text = content
                        revision = resource.revision
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
        .task { await load() }
    }

    private var isTextFile: Bool {
        file.mimeType.hasPrefix("text/") || file.mimeType == "application/json" || file.name.hasSuffix(".md")
    }

    @MainActor private func load() async {
        guard isTextFile else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            text = try await GatewayClient(configuration: configuration).fetchFileText(id: file.id)
            error = nil
        } catch is CancellationError {
        } catch {
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
