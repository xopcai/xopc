import SwiftUI

struct ProjectDetailView: View {
    let configuration: GatewayConfiguration
    let projectID: String
    let onOpenConversation: (String, String, String) -> Void
    let onStartProjectConversation: (ProjectRecord) -> Void

    @State private var project: ProjectRecord?
    @State private var sessions: [ConversationSummary] = []
    @State private var tasks: [TaskListItem] = []
    @State private var notes: [NoteSummary] = []
    @State private var automations: [AutomationRecord] = []
    @State private var selection = ProjectSection.overview
    @State private var isLoading = true
    @State private var error: String?
    @State private var creationSheet: ProjectCreationSheet?

    var body: some View {
        Group {
            if let project {
                List {
                    Section {
                        Picker("项目分区", selection: $selection) {
                            ForEach(ProjectSection.allCases) { section in
                                Text(section.title).tag(section)
                            }
                        }
                        .pickerStyle(.segmented)
                        .listRowInsets(EdgeInsets())
                    }
                    if selection == .overview {
                        Section {
                            VStack(alignment: .leading, spacing: 14) {
                                HStack {
                                    Text(LocalizedStringKey(project.status))
                                        .font(.subheadline.weight(.medium))
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(Color.blue.opacity(0.1), in: .capsule)
                                    Spacer()
                                    if let health = project.health, health != "unknown" {
                                        Text(health).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                Text(project.brief ?? project.description
                                    ?? AppLocalization.string("暂无项目说明", locale: AppLocalization.selectedLocale))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.vertical, 8)
                        }
                    }
                    if selection == .overview || selection == .conversations {
                        projectSessions(project)
                    }
                    if selection == .overview || selection == .tasks {
                        projectTasks
                    }
                    if selection == .overview || selection == .notes {
                        projectNotes
                    }
                    if selection == .overview || selection == .automations {
                        projectAutomations
                    }
                    if isLoading {
                        Section { ProgressView("正在刷新项目…") }
                    }
                }
                .refreshable { await load() }
            } else if let error {
                ContentUnavailableView("无法读取项目", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView("正在读取项目…")
            }
        }
        .navigationTitle(project?.name ?? AppLocalization.string("项目详情", locale: AppLocalization.selectedLocale))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $creationSheet, onDismiss: { Task { await load() } }) { sheet in
            switch sheet {
            case .task: ProjectTaskEditorView(configuration: configuration, projectID: projectID)
            case .note: NoteEditorView(configuration: configuration, projectID: projectID)
            case .automation: AutomationEditorView(configuration: configuration, projectID: projectID)
            }
        }
        .alert("项目内容未完整载入", isPresented: errorBinding) {
            Button("重试") { Task { await load() } }
            Button("取消", role: .cancel) {}
        } message: { Text(error ?? "未知错误") }
    }

    private func projectSessions(_ project: ProjectRecord) -> some View {
        Section {
            Button("新建项目对话", systemImage: "plus.bubble") { onStartProjectConversation(project) }
            if sessions.isEmpty {
                Text("暂无项目对话").foregroundStyle(.secondary)
            } else {
                ForEach(visible(sessions)) { session in
                    Button { onOpenConversation(session.id, session.displayName, session.agentId) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(session.displayName, systemImage: "bubble.left")
                            Text("\(session.messageCount) 条消息").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } header: { sectionHeader("对话", count: sessions.count) }
    }

    private var projectTasks: some View {
        Section {
            if tasks.isEmpty {
                Text("暂无任务").foregroundStyle(.secondary)
            } else {
                ForEach(visible(tasks)) { item in
                    NavigationLink {
                        TaskDetailView(configuration: configuration, taskID: item.task.id, onOpenConversation: onOpenConversation)
                    } label: {
                        ProgressRow(title: item.task.title, subtitle: item.task.contract?.objective ?? item.task.body,
                                    state: item.operationalState, date: item.task.updatedAt.millisecondsDate, symbol: "checklist")
                    }
                }
            }
        } header: { sectionHeader("任务", count: tasks.count, create: .task) }
    }

    private var projectNotes: some View {
        Section {
            if notes.isEmpty {
                Text("暂无笔记").foregroundStyle(.secondary)
            } else {
                ForEach(visible(notes)) { note in
                    NavigationLink {
                        NoteDetailView(configuration: configuration, noteID: note.id, onOpenConversation: onOpenConversation)
                    } label: { NoteRow(note: note) }
                }
            }
        } header: { sectionHeader("笔记", count: notes.count, create: .note) }
    }

    private var projectAutomations: some View {
        Section {
            if automations.isEmpty {
                Text("暂无自动化").foregroundStyle(.secondary)
            } else {
                ForEach(visible(automations)) { automation in
                    NavigationLink {
                        AutomationDetailView(configuration: configuration, automationID: automation.id,
                                             onOpenConversation: onOpenConversation)
                    } label: {
                        ProgressRow(title: automation.name, subtitle: automation.description,
                                    state: AppLocalization.resolve(automation.enabled ? "已启用" : "已暂停"),
                                    date: automation.updatedAtMs.millisecondsDate,
                                    symbol: "clock.arrow.trianglehead.counterclockwise.rotate.90")
                    }
                }
            }
        } header: { sectionHeader("自动化", count: automations.count, create: .automation) }
    }

    private func sectionHeader(_ title: LocalizedStringKey, count: Int, create: ProjectCreationSheet? = nil) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(count, format: .number)
            if let create {
                Button { creationSheet = create } label: { Image(systemName: "plus.circle.fill") }
                    .font(.title3)
                    .accessibilityLabel(create.actionTitle)
            }
        }
        .font(.headline)
    }

    private func visible<T>(_ items: [T]) -> [T] {
        selection == .overview ? Array(items.prefix(3)) : items
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { error != nil && project != nil }, set: {
            if !$0 {
                error = nil
            }
        })
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let projectRequest = GatewayClient(configuration: configuration).fetchProject(id: projectID)
            async let sessionsRequest = GatewayClient(configuration: configuration).fetchProjectSessions(id: projectID)
            async let tasksRequest = GatewayClient(configuration: configuration).fetchTasks(projectID: projectID)
            async let notesRequest = GatewayClient(configuration: configuration).fetchNotes(projectID: projectID)
            async let automationsRequest = GatewayClient(configuration: configuration).fetchAutomations(projectID: projectID)
            let result = try await (projectRequest, sessionsRequest, tasksRequest, notesRequest, automationsRequest)
            project = result.0
            sessions = result.1
            tasks = result.2.items
            notes = result.3.items
            automations = result.4
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

private enum ProjectCreationSheet: String, Identifiable {
    case task
    case note
    case automation

    var id: String {
        rawValue
    }

    var actionTitle: LocalizedStringKey {
        switch self {
        case .task: "新建项目任务"
        case .note: "新建项目笔记"
        case .automation: "新建项目自动化"
        }
    }
}

private enum ProjectSection: String, CaseIterable, Identifiable {
    case overview
    case conversations
    case tasks
    case notes
    case automations

    var id: String {
        rawValue
    }

    var title: LocalizedStringResource {
        switch self {
        case .overview: "概览"
        case .conversations: "对话"
        case .tasks: "任务"
        case .notes: "笔记"
        case .automations: "自动化"
        }
    }
}
