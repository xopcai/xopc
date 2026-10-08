// swiftlint:disable file_length
import SwiftUI

struct ConversationContextView: View {
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection?
    let summary: ConversationContextSummary?
    let isLoading: Bool
    let errorMessage: String?
    let pendingReferences: [ContextReference]
    let onAddReference: (ContextReference) -> Void
    let onStartScopedConversation: (ProjectRecord?, String?) -> Void
    let onDirectoryChanged: () -> Void
    let onRetry: () -> Void
    @Environment(\.locale) private var locale
    @State private var draftProject: ProjectRecord?
    @State private var draftProjectError: String?
    @State private var showingReferencePicker = false

    var body: some View {
        List {
            if conversation?.isDraft != false {
                Text("这里显示当前会话的关联与待发送引用；选择新的项目或执行模式会新建会话。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                workSection(nil)
                environmentSection(nil)
                sourcesSection(nil)
                if let draftProjectError {
                    Section {
                        Text(draftProjectError).foregroundStyle(.secondary)
                        Button("重试") { Task { await loadDraftProject() } }
                    }
                }
            } else if isLoading, summary == nil {
                ProgressView("正在读取上下文…")
                    .frame(maxWidth: .infinity)
            } else if let errorMessage, summary == nil {
                ContentUnavailableView {
                    Label("无法读取上下文", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("重试", action: onRetry)
                }
            } else if let summary {
                workSection(summary)
                environmentSection(summary)
                sourcesSection(summary)
                availabilitySection(summary)
            } else {
                ContentUnavailableView(
                    "上下文尚未就绪",
                    systemImage: "scope",
                    description: Text("关闭后重试，或刷新当前对话。")
                )
            }
        }
        .navigationTitle("当前上下文")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: conversation?.id) { await loadDraftProject() }
        .sheet(isPresented: $showingReferencePicker) {
            ReferencePickerView(
                gateway: GatewayClient(configuration: configuration),
                selectedReferences: pendingReferences,
                initialKind: .note,
                conversationID: conversation?.isDraft == false ? conversation?.id : nil,
                onSelect: onAddReference
            )
        }
    }

    private func workSection(_ summary: ConversationContextSummary?) -> some View {
        Section("当前工作") {
            NavigationLink {
                environmentSettings(summary)
            } label: {
                ContextRow(
                    icon: "folder",
                    title: projectTitle(in: summary),
                    detail: summary?.work.task?.title
                )
            }
            if let task = summary?.work.task {
                ContextRow(icon: "checkmark.circle", title: task.title, detail: task.phase)
            }
            if let count = summary?.work.delegatedTaskCount, count > 0 {
                LabeledContent("派出任务", value: "\(count) 项")
            }
        }
    }

    @ViewBuilder
    private func environmentSection(_ summary: ConversationContextSummary?) -> some View {
        if let environment = summary?.environment {
            Section("执行环境") {
                NavigationLink {
                    environmentSettings(summary)
                } label: {
                    ContextRow(
                        icon: environment.kind == "managed_worktree" ? "arrow.triangle.branch" : "desktopcomputer",
                        title: environment.kind == "managed_worktree" ? "Worktree" : "Local",
                        detail: environment.rootPath
                    )
                }
                if let branch = environment.branch {
                    LabeledContent("分支", value: branch)
                }
                if !environment.available {
                    Label("当前环境不可用", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
        } else if conversation?.isDraft != false {
            Section("执行环境") {
                NavigationLink {
                    environmentSettings(nil)
                } label: {
                    ContextRow(
                        icon: conversation?.executionMode == "managed_worktree"
                            ? "arrow.triangle.branch" : "desktopcomputer",
                        title: conversation?.executionMode == "managed_worktree" ? "Worktree" : "Local",
                        detail: draftProject?.workspaceRoot
                    )
                }
                Text("发送第一条消息后显示实际运行目录。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func sourcesSection(_ summary: ConversationContextSummary?) -> some View {
        Section("关联来源") {
            if displayedSources.isEmpty {
                Text("当前没有关联来源或待发送引用")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(displayedSources) { source in
                    ContextRow(
                        icon: source.icon,
                        title: source.title,
                        detail: source.detail
                    )
                }
                if summary?.sourcesHasMore == true {
                    Text("还有更多来源")
                        .foregroundStyle(.secondary)
                }
            }
            Button("添加单次引用", systemImage: "plus") { showingReferencePicker = true }
                .disabled(pendingReferences.count >= 5)
        }
    }

    @ViewBuilder
    private func availabilitySection(_ summary: ConversationContextSummary) -> some View {
        if !summary.unavailableSections.isEmpty {
            Section("部分信息不可用") {
                ForEach(summary.unavailableSections, id: \.self) { section in
                    Text(unavailableLabel(section))
                }
                Button("重试", action: onRetry)
            }
        }
    }

    private func environmentSettings(_ summary: ConversationContextSummary?) -> some View {
        SessionEnvironmentSettingsView(
            configuration: configuration,
            conversation: conversation,
            summary: summary,
            onStartScopedConversation: onStartScopedConversation,
            onDirectoryChanged: onDirectoryChanged
        )
    }

    private func projectTitle(in summary: ConversationContextSummary?) -> String {
        if let title = summary?.work.project?.title ?? draftProject?.name {
            return title
        }
        if conversation?.projectId != nil {
            return draftProjectError == nil ? "正在读取项目…" : "项目暂无法查看"
        }
        return AppLocalization.string("未关联项目", locale: locale)
    }

    private var displayedSources: [ContextDisplaySource] {
        let pendingIDs = Set(pendingReferences.map(\.id))
        var seen = Set<String>()
        var items: [ContextDisplaySource] = []
        for source in summary?.sources ?? [] {
            let key = "\(source.kind ?? "note"):\(source.id)"
            guard seen.insert(key).inserted else { continue }
            let relation = source.origins?.contains(where: { $0.kind == "session" }) == true
                ? "会话关联" : source.origins?.contains(where: { $0.kind == "task" }) == true
                ? "任务关联" : "最近引用"
            let detail = pendingIDs.contains(key) ? "\(relation) · 待发送" : relation
            items.append(ContextDisplaySource(
                id: key,
                title: source.unavailable == true ? "来源不可用" : source.title ?? "未命名来源",
                detail: source.unavailable == true ? "来源不可用" : detail,
                icon: source.kind == "note" ? "note.text" : source.kind == "task" ? "checkmark.circle" : "doc"
            ))
        }
        for reference in pendingReferences where seen.insert(reference.id).inserted {
            items.append(ContextDisplaySource(
                id: reference.id,
                title: reference.title,
                detail: "待发送",
                icon: reference.kind.systemImage
            ))
        }
        return items
    }

    private func unavailableLabel(_ section: String) -> String {
        switch section {
        case "work": "当前工作暂无法查看"
        case "sources": "关联来源暂无法查看"
        case "environment": "执行环境暂无法查看"
        default: "部分信息暂无法查看"
        }
    }

    @MainActor private func loadDraftProject() async {
        draftProject = nil
        draftProjectError = nil
        guard conversation?.isDraft != false, let projectID = conversation?.projectId else { return }
        do {
            let project = try await GatewayClient(configuration: configuration).fetchProject(id: projectID)
            guard !Task.isCancelled, conversation?.projectId == projectID else { return }
            draftProject = project
        } catch is CancellationError {
        } catch {
            guard conversation?.projectId == projectID else { return }
            draftProjectError = error.localizedDescription
        }
    }
}

private struct ContextDisplaySource: Identifiable {
    let id: String
    let title: String
    let detail: String
    let icon: String
}

private struct ContextRow: View {
    let icon: String
    let title: String
    let detail: String?

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        } icon: {
            Image(systemName: icon)
                .foregroundStyle(.blue)
        }
    }
}

#Preview {
    NavigationStack {
        ConversationContextView(
            configuration: .local,
            conversation: nil,
            summary: nil,
            isLoading: false,
            errorMessage: nil,
            pendingReferences: [],
            onAddReference: { _ in },
            onStartScopedConversation: { _, _ in },
            onDirectoryChanged: {},
            onRetry: {}
        )
    }
}

struct SessionEnvironmentSettingsView: View {
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection?
    let summary: ConversationContextSummary?
    let onStartScopedConversation: (ProjectRecord?, String?) -> Void
    let onDirectoryChanged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var projects: [ProjectRecord] = []
    @State private var agentConfiguration: SessionAgentConfiguration?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showingDirectoryPicker = false

    var body: some View {
        List {
            Section(conversation?.isDraft != false ? "待创建会话" : "当前会话") {
                LabeledContent("项目", value: currentProjectName)
                if conversation?.isDraft == true, let mode = conversation?.executionMode {
                    LabeledContent("执行模式", value: mode == "managed_worktree" ? "Worktree" : "Local")
                } else if let environment = summary?.environment {
                    LabeledContent("执行模式", value: environment.kind == "managed_worktree" ? "Worktree" : "Local")
                    LabeledContent("工作目录", value: environment.rootPath)
                } else if let path = agentConfiguration?.effectiveWorkspacePath, !path.isEmpty {
                    LabeledContent("工作目录", value: path)
                }
            }

            Section {
                Button("不关联项目") { selectScope(nil, nil) }
                ForEach(projects.filter { $0.status != "archived" }) { project in
                    NavigationLink {
                        ProjectEnvironmentChoiceView(configuration: configuration, project: project) { mode in
                            selectScope(project, mode)
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(project.name)
                            if let root = project.workspaceRoot, !root.isEmpty {
                                Text(root).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                }
            } header: {
                Text("新会话的项目范围")
            } footer: {
                Text("更改项目或执行模式会新建对话，当前对话保持不变。")
            }

            if let conversation, !conversation.isDraft,
               summary?.work.project == nil, summary?.work.task == nil,
               agentConfiguration?.workingDirectoryLocked == false
            {
                Section("当前会话的工作目录") {
                    Button("更改工作目录", systemImage: "folder") {
                        showingDirectoryPicker = true
                    }
                }
            }

            if isLoading, projects.isEmpty {
                Section { ProgressView("正在读取环境…") }
            }
            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                    Button("重试") { Task { await load() } }
                }
            }
        }
        .navigationTitle("执行环境与范围")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingDirectoryPicker) {
            if let conversation {
                HostDirectoryPickerView(
                    configuration: configuration,
                    conversationID: conversation.id,
                    initialPath: agentConfiguration?.effectiveWorkspacePath ?? ""
                ) {
                    onDirectoryChanged()
                    Task { await load() }
                }
            }
        }
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        let gateway = GatewayClient(configuration: configuration)
        do {
            projects = try await gateway.fetchProjects().items
            if let conversation, !conversation.isDraft {
                agentConfiguration = try await gateway.fetchAgentConfiguration(conversationID: conversation.id)
            }
            errorMessage = nil
        } catch is CancellationError {
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func selectScope(_ project: ProjectRecord?, _ mode: String?) {
        if project?.id == conversation?.projectId,
           mode == nil || mode == conversation?.executionMode
        {
            dismiss()
            return
        }
        onStartScopedConversation(project, mode)
    }

    private var currentProjectName: String {
        if let title = summary?.work.project?.title
            ?? projects.first(where: { $0.id == conversation?.projectId })?.name
        {
            return title
        }
        if conversation?.projectId != nil {
            return errorMessage == nil ? "正在读取项目…" : "项目暂无法查看"
        }
        return "未关联项目"
    }
}

private struct ProjectEnvironmentChoiceView: View {
    let configuration: GatewayConfiguration
    let project: ProjectRecord
    let onSelect: (String?) -> Void

    @State private var options: ProjectEnvironmentOptions?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                Button("使用项目默认环境") { onSelect(nil) }
                if project.workspaceRoot != nil {
                    Button("Local") { onSelect("local_checkout") }
                        .disabled(options?.localAvailable != true)
                    Button("Worktree") { onSelect("managed_worktree") }
                        .disabled(options == nil || options?.worktreeUnavailableReason != nil)
                }
            } footer: {
                Text("选择后会用此项目与执行模式开始新对话。")
            }
            if isLoading {
                ProgressView("正在检查可用环境…")
            }
            if let reason = options?.worktreeUnavailableReason {
                Text("Worktree 暂不可用：\(reason)").foregroundStyle(.secondary)
            }
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
                Button("重试") { Task { await load() } }
            }
        }
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @MainActor private func load() async {
        guard project.workspaceRoot != nil else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            options = try await GatewayClient(configuration: configuration)
                .fetchProjectEnvironmentOptions(projectID: project.id)
            errorMessage = nil
        } catch is CancellationError {
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct HostDirectoryPickerView: View {
    let configuration: GatewayConfiguration
    let conversationID: String
    let initialPath: String
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var directories: HostDirectories?
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let directories {
                    Section("当前目录") {
                        Text(directories.currentPath).textSelection(.enabled)
                        if let parent = directories.parentPath {
                            Button("上一级", systemImage: "arrow.up") { Task { await browse(parent) } }
                        }
                    }
                    Section("文件夹") {
                        ForEach(directories.entries.filter(\.isDirectory)) { entry in
                            Button(entry.name, systemImage: "folder") {
                                Task { await browse(entry.absolutePath) }
                            }
                        }
                    }
                }
                if isLoading {
                    ProgressView("正在读取文件夹…")
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                    Button("重试") { Task { await browse(directories?.currentPath ?? initialPath) } }
                }
            }
            .navigationTitle("选择工作目录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("使用此目录") { Task { await save() } }
                        .disabled(directories?.currentPath.isEmpty != false || isSaving)
                }
            }
            .task { await browse(initialPath) }
        }
    }

    @MainActor private func browse(_ path: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            directories = try await GatewayClient(configuration: configuration).listHostDirectories(path: path)
            errorMessage = nil
        } catch is CancellationError {
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor private func save() async {
        guard let path = directories?.currentPath, !path.isEmpty, !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await GatewayClient(configuration: configuration)
                .setSessionWorkingDirectory(conversationID: conversationID, path: path)
            onSaved()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
