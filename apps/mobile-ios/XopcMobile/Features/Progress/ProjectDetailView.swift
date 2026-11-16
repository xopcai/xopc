import SwiftUI

// swiftlint:disable:next type_body_length
struct ProjectDetailView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let projectID: String
    let onOpenConversation: (String, String, String) -> Void
    var onProjectUpdated: (ProjectRecord) -> Void = { _ in }

    @Environment(\.locale) private var locale
    @State private var project: ProjectRecord?
    @State private var sessions: [ConversationSummary] = []
    @State private var deliveries: [HomeDelivery] = []
    @State private var tasks: [TaskListItem] = []
    @State private var notes: [NoteSummary] = []
    @State private var automations: [AutomationRecord] = []
    @State private var selection = ProjectSection.overview
    @State private var isLoading = true
    @State private var error: String?
    @State private var creationSheet: ProjectCreationSheet?
    @State private var managingProject = false
    @State private var setupPrompt: String?
    @State private var projectChat: ConversationSelection?
    @State private var localChats: [ConversationSelection] = []

    var body: some View {
        Group {
            if let project {
                List {
                    if selection == .overview {
                        Section {
                            VStack(alignment: .leading, spacing: 14) {
                                Text(project.name)
                                    .mobileTextStyle(.detailTitle)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityAddTraits(.isHeader)
                                HStack {
                                    Text(LocalizedStringKey("project_status_" + project.status))
                                        .font(.subheadline.weight(.medium))
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(mobileTheme.action.opacity(0.10), in: .capsule)
                                    Spacer()
                                    if let health = project.health, health != "unknown" {
                                        Text(health).mobileTextStyle(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                Text(project.brief ?? project.description
                                    ?? AppLocalization.string("暂无项目说明", locale: AppLocalization.selectedLocale))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.vertical, 8)
                        }
                    }
                    if selection == .overview && !deliveries.isEmpty {
                        Section("近期成果") {
                            ForEach(deliveries.prefix(5)) { item in
                                HomeDeliveryLink(item: item, configuration: configuration,
                                                 onOpenConversation: onOpenConversation)
                            }
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
        .mobilePageTitle(Text("项目详情")) {
            MobilePageTitleMenu(options: ProjectSection.allCases.map {
                SegmentOption(id: $0, title: $0.title, accessibilityID: "project-tab-\($0.rawValue)")
            }, selected: selection, identifier: "project-tabs") { selection = $0 }
        }
        .task { await load() }
        .sheet(item: $creationSheet, onDismiss: { Task { await load() } }) { sheet in
            switch sheet {
            case .task: ProjectTaskEditorView(configuration: configuration, projectID: projectID)
            case .note: NoteEditorView(configuration: configuration, projectID: projectID)
            }
        }
        .toolbar {
            if let project {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("添加到项目", systemImage: "plus") {
                        Button("新建项目对话", systemImage: "bubble.left") { startProjectChat(project) }
                        Button("新建项目任务", systemImage: "checklist") { creationSheet = .task }
                        Button("新建项目笔记", systemImage: "note.text") { creationSheet = .note }
                        Button("新建项目自动化", systemImage: "clock") { setupPrompt = "" }
                        Button("项目设置", systemImage: "gearshape") { managingProject = true }
                    }
                    .accessibilityIdentifier("project-add")
                }
            }
        }
        .sheet(isPresented: $managingProject) {
            if let project {
                ProjectManageView(configuration: configuration, project: project) {
                    self.project = $0
                    onProjectUpdated($0)
                }
            }
        }
        .modifier(AutomationSetupPresentation(configuration: configuration, scope: .project(projectID),
                                              prompt: $setupPrompt, onClosed: { Task { await load() } }))
        .navigationDestination(item: $projectChat) { chat in
            ScopedAssistantChat(configuration: configuration, selection: chat,
                                heading: chat.isDraft ? "新建项目对话" : LocalizedStringKey(chat.title),
                                onMaterialized: { _ in removeLocalChat(chat.id) })
        }
        .onChange(of: projectChat) { _, chat in
            if chat == nil {
                Task { await load() }
            }
        }
        .alert("项目内容未完整载入", isPresented: errorBinding) {
            Button("重试") { Task { await load() } }
            Button("取消", role: .cancel) {}
        } message: { Text(error ?? "未知错误") }
    }

    private func projectSessions(_ project: ProjectRecord) -> some View {
        Section {
            Button {
                startProjectChat(project)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "plus.bubble")
                        .accessibilityHidden(true)
                    Text("新建项目对话")
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                }
                .frame(minHeight: 48)
            }
            ForEach(visible(localChats)) { draft in
                Button("对话草稿", systemImage: "doc.text") { projectChat = draft }
                    .accessibilityIdentifier("project-draft-\(draft.id)")
                    .swipeActions {
                        Button("删除", role: .destructive) { removeLocalChat(draft.id) }
                    }
            }
            if sessions.isEmpty, localChats.isEmpty {
                Text("暂无项目对话").foregroundStyle(.secondary)
            } else {
                ForEach(visible(sessions)) { session in
                    Button { projectChat = ConversationSelection(summary: session) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "bubble.left")
                                .foregroundStyle(.tint)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(session.displayName)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text("\(session.messageCount) 条消息")
                                    .mobileTextStyle(.caption)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 8)
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
                        TaskDetailView(configuration: configuration, taskID: item.task.id)
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
                AutomationExamples(scope: .project(projectID)) { setupPrompt = $0 }
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
        } header: {
            sectionHeader("自动化", count: automations.count, actionTitle: "新建项目自动化") { setupPrompt = "" }
        }
    }

    private func sectionHeader(_ title: LocalizedStringKey, count: Int, create: ProjectCreationSheet? = nil,
                               actionTitle: LocalizedStringKey? = nil, action: (() -> Void)? = nil) -> some View
    {
        HStack {
            Text(title)
            Spacer()
            Text(count, format: .number)
            if let create {
                Button(create.actionTitle, systemImage: "plus.circle.fill") { creationSheet = create }
                    .labelStyle(.iconOnly).mobileTextStyle(.sectionTitle)
            } else if let actionTitle, let action {
                Button(actionTitle, systemImage: "plus.circle.fill", action: action)
                    .labelStyle(.iconOnly).mobileTextStyle(.sectionTitle)
            }
        }
        .mobileTextStyle(.rowTitle)
    }

    private func startProjectChat(_ project: ProjectRecord) {
        let draft = ConversationSelection.projectDraft(project: project)
        do {
            let next = [draft] + localChats
            try ComposerDraftStore().saveProjectDrafts(next, configuration, projectID: projectID)
            localChats = next
            projectChat = draft
        } catch { self.error = error.localizedDescription }
    }

    private func removeLocalChat(_ id: String) {
        let next = localChats.filter { $0.id != id }
        do {
            try ComposerDraftStore().saveProjectDrafts(next, configuration, projectID: projectID)
            localChats = next
        } catch { self.error = error.localizedDescription }
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
            localChats = try ComposerDraftStore().readProjectDrafts(configuration, projectID: projectID)
        } catch { self.error = error.localizedDescription }
        async let home = try? GatewayClient(configuration: configuration).fetchHome(locale: locale.identifier)
        do {
            async let projectRequest = GatewayClient(configuration: configuration).fetchProject(id: projectID)
            async let sessionsRequest = GatewayClient(configuration: configuration).fetchProjectSessions(id: projectID)
            async let tasksRequest = GatewayClient(configuration: configuration).fetchTasks(projectID: projectID)
            async let notesRequest = GatewayClient(configuration: configuration).fetchNotes(projectID: projectID)
            async let automationsRequest = GatewayClient(configuration: configuration).fetchAutomations(projectID: projectID)
            let result = try await (projectRequest, sessionsRequest, tasksRequest, notesRequest, automationsRequest)
            project = result.0
            sessions = result.1
            let materialized = Set(sessions.map(\.id))
            if localChats.contains(where: { materialized.contains($0.id) }) {
                localChats.removeAll { materialized.contains($0.id) }
                try ComposerDraftStore().saveProjectDrafts(localChats, configuration, projectID: projectID)
            }
            tasks = result.2.items
            notes = result.3.items
            automations = result.4
            error = nil
            if let home = await home {
                deliveries = (home.recentDeliveries ?? []).filter { $0.projectId == projectID && $0.destination != nil }
            }
        } catch { self.error = error.localizedDescription }
    }
}

private enum ProjectCreationSheet: String, Identifiable {
    case task
    case note

    var id: String {
        rawValue
    }

    var actionTitle: LocalizedStringKey {
        switch self {
        case .task: "新建项目任务"
        case .note: "新建项目笔记"
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
