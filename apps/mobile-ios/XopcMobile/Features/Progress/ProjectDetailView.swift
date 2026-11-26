import SwiftUI

// swiftlint:disable:next type_body_length
struct ProjectDetailView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let projectID: String
    let onOpenConversation: (String, String, String) -> Void
    let onProjectUpdated: (ProjectRecord) -> Void

    @Environment(\.locale) private var locale
    @State private var project: ProjectRecord?
    @State private var sessions: [ConversationSummary] = []
    @State private var attention: [HomeItem] = []
    @State private var deliveries: [HomeDelivery] = []
    @State private var tasks: [TaskListItem] = []
    @State private var notes: [NoteSummary] = []
    @State private var automations: [AutomationRecord] = []
    @State private var externalAgents: [AgentSummary] = []
    @AppStorage private var selection: ProjectSection
    @State private var isLoading = true
    @State private var loadRevision = 0
    @State private var error: String?
    @State private var projectLoadError: String?
    @State private var creationSheet: ProjectCreationSheet?
    @State private var managingProject = false
    @State private var setupPrompt: String?
    @State private var projectChat: ConversationSelection?
    @State private var localChats: [ConversationSelection] = []

    init(configuration: GatewayConfiguration, projectID: String,
         onOpenConversation: @escaping (String, String, String) -> Void,
         onProjectUpdated: @escaping (ProjectRecord) -> Void = { _ in })
    {
        self.configuration = configuration
        self.projectID = projectID
        self.onOpenConversation = onOpenConversation
        self.onProjectUpdated = onProjectUpdated
        _selection = AppStorage(wrappedValue: .overview, "navigation.project.\(projectID)")
    }

    var body: some View {
        Group {
            if let project {
                TabView(selection: $selection) {
                    ForEach(ProjectSection.allCases, id: \.self) { section in
                        projectPage(project, section: section).tag(section)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .accessibilityIdentifier("project-pager")
            } else if let projectLoadError {
                ContentUnavailableView {
                    Label("无法读取项目", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(projectLoadError)
                } actions: {
                    Button("重试") { Task { await load() } }
                }
            } else {
                ProgressView("正在读取项目…")
            }
        }
        .mobilePageTitle(Text("项目详情")) {
            MobilePageTitleMenu(options: ProjectSection.allCases.map {
                SegmentOption(id: $0, title: $0.title, accessibilityID: "project-tab-\($0.rawValue)")
            }, selected: selection, identifier: "project-tabs") { selection = $0 }
        }
        .task(id: configuration) { await load() }
        .sheet(item: $creationSheet, onDismiss: { Task { await load() } }) { sheet in
            Group {
                switch sheet {
                case .task: TaskEditorView(configuration: configuration, initialProjectID: projectID)
                case .note: NoteEditorView(configuration: configuration, projectID: projectID)
                }
            }
            .mobileSheetPreset(.large)
        }
        .toolbar {
            if let project {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("添加到项目", systemImage: "plus") {
                        Button("新建项目对话", systemImage: "bubble.left") { startProjectChat(project) }
                        if project.workspaceRoot?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
                           !externalAgents.isEmpty
                        {
                            ForEach(externalAgents) { agent in
                                Button("用 \(agent.localizedName(locale)) 对话", systemImage: "terminal") {
                                    startProjectChat(project, agentId: agent.id)
                                }
                            }
                        }
                        Button("新建项目任务", systemImage: "checklist") { creationSheet = .task }
                        Button("新建项目笔记", systemImage: "note.text") { creationSheet = .note }
                        Button("新建项目自动化", systemImage: "clock") { setupPrompt = "" }
                        Button { managingProject = true } label: { Label("项目设置", systemImage: "folder") }
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
            if let project {
                ProjectAssistantChat(configuration: configuration, project: project, selection: chat,
                                     onSaveDraft: saveLocalChat, onMaterialized: removeLocalChat)
            }
        }
        .onChange(of: projectChat) { _, chat in
            if chat == nil {
                Task { await load() }
            }
        }
    }

    private func projectPage(_ project: ProjectRecord, section: ProjectSection) -> some View {
        List {
            if let error {
                Section {
                    Text(error).foregroundStyle(.secondary)
                    Button("重试") { Task { await load() } }
                }
            }
            if section == .overview {
                projectOverviewSection(project)
            }
            if section == .overview, !attention.isEmpty {
                Section("需要你处理") {
                    ForEach(attention) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title).mobileTextStyle(.rowTitle).lineLimit(2)
                            if !item.summary.isEmpty {
                                Text(item.summary).mobileTextStyle(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                }
            }
            if section == .overview || section == .notes, !deliveries.isEmpty {
                Section("近期成果") {
                    ForEach(deliveries.prefix(5)) { item in
                        HomeDeliveryLink(item: item, configuration: configuration,
                                         onOpenConversation: onOpenConversation)
                    }
                }
            }
            if section == .overview || section == .conversations {
                projectSessions(project)
            }
            if section == .overview || section == .tasks {
                projectTasks
            }
            if section == .overview || section == .notes {
                projectNotes
            }
            if section == .overview || section == .automations {
                projectAutomations
            }
            if isLoading {
                Section { ProgressView("正在刷新项目…") }
            }
        }
        .refreshable { await load() }
    }

    private func projectOverviewSection(_ project: ProjectRecord) -> some View {
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
                    .contextMenu {
                        Button("删除", systemImage: "trash", role: .destructive) { removeLocalChat(draft) }
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
        let shown = selection == .overview ? Array(tasks.filter { $0.task.phase != "closed" }.prefix(3)) : tasks
        return Section {
            if shown.isEmpty {
                Text("暂无任务").foregroundStyle(.secondary)
            } else {
                ForEach(shown) { item in
                    NavigationLink {
                        TaskConversationView(configuration: configuration, taskID: item.task.id)
                    } label: {
                        ProgressRow(title: item.task.title, subtitle: item.presentation?.reason ?? item.task.contract?.objective ?? item.task.body,
                                    state: taskPresentationLabel(item.displayStatus), date: item.task.updatedAt.millisecondsDate, symbol: "checklist")
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

    private func startProjectChat(_ project: ProjectRecord, agentId: String? = nil) {
        do {
            let draft = ConversationSelection.projectDraft(project: project, agentId: agentId)
            try saveLocalChat(draft)
            projectChat = draft
        } catch { self.error = error.localizedDescription }
    }

    private func saveLocalChat(_ draft: ConversationSelection) throws {
        guard let draftProjectID = draft.projectId else { return }
        let store = ComposerDraftStore()
        let current = draftProjectID == projectID ? localChats : try store.readProjectDrafts(configuration, projectID: draftProjectID)
        let next = [draft] + current
        try store.saveProjectDrafts(next, configuration, projectID: draftProjectID)
        if draftProjectID == projectID {
            localChats = next
        }
    }

    private func removeLocalChat(_ draft: ConversationSelection) {
        guard let draftProjectID = draft.projectId else { return }
        do {
            let store = ComposerDraftStore()
            let current = draftProjectID == projectID ? localChats : try store.readProjectDrafts(configuration, projectID: draftProjectID)
            let next = current.filter { $0.id != draft.id }
            try store.saveProjectDrafts(next, configuration, projectID: draftProjectID)
            if draftProjectID == projectID {
                localChats = next
            }
        } catch { self.error = error.localizedDescription }
    }

    private func visible<T>(_ items: [T]) -> [T] {
        selection == .overview ? Array(items.prefix(3)) : items
    }

    @MainActor private func load() async {
        loadRevision += 1
        let revision = loadRevision
        isLoading = true
        error = nil
        projectLoadError = nil
        defer {
            if revision == loadRevision {
                isLoading = false
            }
        }
        do {
            localChats = try ComposerDraftStore().readProjectDrafts(configuration, projectID: projectID)
        } catch { self.error = error.localizedDescription }

        let client = GatewayClient(configuration: configuration)
        let id = projectID
        let language = locale.identifier
        await withTaskGroup(of: ProjectLoadResult.self) { group in
            group.addTask {
                do { return try await .project(client.fetchProject(id: id)) }
                catch { return .projectFailed(error.localizedDescription) }
            }
            group.addTask {
                do { return try await .sessions(client.fetchProjectSessions(id: id)) }
                catch { return .failed(error.localizedDescription) }
            }
            group.addTask {
                do { return try await .tasks(client.fetchTasks(projectID: id).items) }
                catch { return .failed(error.localizedDescription) }
            }
            group.addTask {
                do { return try await .notes(client.fetchNotes(projectID: id).items) }
                catch { return .failed(error.localizedDescription) }
            }
            group.addTask {
                do { return try await .automations(client.fetchAutomations(projectID: id)) }
                catch { return .failed(error.localizedDescription) }
            }
            group.addTask {
                let home = try? await client.fetchHome(locale: language)
                return .homeSnapshot(attention: home?.needsUser, deliveries: home?.recentDeliveries)
            }
            group.addTask {
                let agents = (try? await client.fetchAgents().agents) ?? []
                return .externalAgents(agents.filter(\.isExternalRuntime))
            }
            for await result in group {
                guard !Task.isCancelled, revision == loadRevision else {
                    group.cancelAll()
                    return
                }
                apply(result)
            }
        }
    }

    private func apply(_ result: ProjectLoadResult) {
        switch result {
        case let .project(record): project = record
        case let .projectFailed(message):
            projectLoadError = message
            if project != nil {
                error = message
            }
        case let .sessions(rows):
            sessions = rows
            reconcileLocalDrafts(with: rows)
        case let .tasks(rows): tasks = rows
        case let .notes(rows): notes = rows
        case let .automations(rows): automations = rows
        case let .homeSnapshot(needsUser, rows):
            applyHomeSnapshot(needsUser, rows)
        case let .externalAgents(agents):
            externalAgents = agents
        case let .failed(message):
            error = error ?? message
        }
    }

    private func applyHomeSnapshot(_ needsUser: [HomeItem]?, _ rows: [HomeDelivery]?) {
        if let needsUser {
            attention = needsUser.filter { $0.projectId == projectID }
        }
        if let rows {
            deliveries = rows.filter { $0.projectId == projectID && $0.destination != nil }
        }
    }

    private func reconcileLocalDrafts(with rows: [ConversationSummary]) {
        let materialized = Set(rows.map(\.id))
        let unsent = localChats.filter { !materialized.contains($0.id) }
        guard unsent.count != localChats.count else { return }
        do {
            try ComposerDraftStore().saveProjectDrafts(unsent, configuration, projectID: projectID)
            localChats = unsent
        } catch { self.error = error.localizedDescription }
    }

    private enum ProjectLoadResult: Sendable {
        case project(ProjectRecord)
        case projectFailed(String)
        case sessions([ConversationSummary])
        case tasks([TaskListItem])
        case notes([NoteSummary])
        case automations([AutomationRecord])
        case homeSnapshot(attention: [HomeItem]?, deliveries: [HomeDelivery]?)
        case externalAgents([AgentSummary])
        case failed(String)
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
