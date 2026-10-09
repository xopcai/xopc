import SwiftUI

struct ProgressHubView: View {
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void
    let onStartProjectConversation: (ProjectRecord) -> Void
    var bottomInset: CGFloat = 0

    @Environment(\.locale) private var locale
    @State private var home: HomeSnapshot?
    @State private var tasks: [TaskListItem] = []
    @State private var nextAutomation: AutomationNextRun?
    @State private var isLoading = true
    @State private var error: String?
    @State private var actionError: String?
    @State private var pendingAction: HomeAction?
    @State private var isPerformingAction = false

    var body: some View {
        ScrollViewReader { scroller in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 0) {
                        summaryButton(count: pendingCount, title: "待处理") {
                            withAnimation { scroller.scrollTo("progress-section-needs-user", anchor: .top) }
                        }
                        Divider().frame(height: 32)
                        summaryButton(count: activeCount, title: "进行中") {
                            withAnimation { scroller.scrollTo("progress-section-running", anchor: .top) }
                        }
                    }
                    .padding(16).background(Color.blue.opacity(0.09), in: .rect(cornerRadius: 20))
                    if isLoading, home == nil {
                        ProgressListSkeleton()
                    }
                    if let home, !home.needsUser.isEmpty {
                        Text("需要你处理").mobileTextStyle(.rowTitle).padding(.top, 12).id("progress-section-needs-user")
                        ForEach(home.needsUser) { item in homeRow(item, showsActions: true) }
                    }
                    if !runningItems.isEmpty {
                        Text("正在进行").mobileTextStyle(.rowTitle).padding(.top, 12).id("progress-section-running")
                        ForEach(runningItems.prefix(5)) { item in homeRow(item, showsActions: false) }
                    }
                    if !scheduledItems.isEmpty {
                        Text("接下来").mobileTextStyle(.rowTitle).padding(.top, 12)
                        ForEach(scheduledItems.prefix(5)) { item in homeRow(item, showsActions: false) }
                    } else if let nextAutomation {
                        Text("接下来").mobileTextStyle(.rowTitle).padding(.top, 12)
                        NavigationLink {
                            AutomationDetailView(configuration: configuration, automationID: nextAutomation.automationId,
                                                 onOpenConversation: onOpenConversation)
                        } label: {
                            compactRow(title: nextAutomation.name,
                                       subtitle: nextAutomation.runAtMs.millisecondsDate.formatted(date: .abbreviated, time: .shortened), symbol: "clock")
                        }.buttonStyle(.plain)
                    }
                    if !recentClosed.isEmpty {
                        Text("最近完成").mobileTextStyle(.rowTitle).padding(.top, 12)
                        ForEach(recentClosed.prefix(2)) { item in
                            NavigationLink {
                                TaskDetailView(configuration: configuration, taskID: item.id, onOpenConversation: onOpenConversation)
                            } label: {
                                compactRow(title: item.task.title, subtitle: item.task.resolution ?? "已完成", symbol: "checkmark.circle")
                            }.buttonStyle(.plain)
                        }
                    }
                    Text("常用工作").mobileTextStyle(.rowTitle).padding(.top, 12)
                    HStack(spacing: 12) {
                        NavigationLink {
                            TasksView(configuration: configuration, onOpenConversation: onOpenConversation).navigationTitle("任务")
                        } label: { toolRow("任务", symbol: "checkmark.circle") }
                        NavigationLink {
                            ProjectsView(configuration: configuration, onOpenConversation: onOpenConversation,
                                         onStartProjectConversation: onStartProjectConversation).navigationTitle("项目")
                        } label: { toolRow("项目", symbol: "folder") }
                    }.buttonStyle(.plain)
                    NavigationLink {
                        AutomationsView(configuration: configuration, onOpenConversation: onOpenConversation).navigationTitle("自动化")
                    } label: { toolRow("自动化", symbol: "clock") }.buttonStyle(.plain)
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                        Button("重试") { Task { await load() } }.frame(minHeight: 44)
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
            }
            .contentMargins(.bottom, bottomInset, for: .scrollContent)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    TasksView(configuration: configuration, onOpenConversation: onOpenConversation).navigationTitle("全部工作")
                } label: { Image(systemName: "square.grid.2x2").frame(width: 44, height: 44) }
                    .accessibilityLabel("全部工作")
            }
        }
        .navigationTitle("进展")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: configuration) { await load() }
        .onChange(of: locale.identifier) { Task { await load() } }
        .confirmationDialog(pendingAction?.label
            ?? AppLocalization.string("确认操作", locale: locale), isPresented: Binding(
                get: { pendingAction != nil },
                set: {
                    if !$0 {
                        pendingAction = nil
                    }
                }
            )) {
                Button("确认") {
                    guard let action = pendingAction else { return }
                    pendingAction = nil
                    Task { await perform(action) }
                }
                Button("取消", role: .cancel) { pendingAction = nil }
        } message: {
            Text("此操作会更新 Gateway 中的工作状态。")
        }
        .alert("操作未完成", isPresented: Binding(
            get: { actionError != nil },
            set: {
                if !$0 {
                    actionError = nil
                }
            }
        )) { Button("好", role: .cancel) { actionError = nil } }
        message: { Text(actionError ?? "未知错误") }
    }

    private var pendingCount: Int {
        home?.needsUser.count ?? 0
    }

    private var activeCount: Int {
        runningItems.count
    }

    private var runningItems: [HomeItem] {
        home?.background.filter { $0.kind != "scheduled" } ?? []
    }

    private var scheduledItems: [HomeItem] {
        home?.background.filter { $0.kind == "scheduled" } ?? []
    }

    private var recentClosed: [TaskListItem] {
        tasks.filter { $0.task.phase == "closed" }
            .sorted { $0.task.updatedAt > $1.task.updatedAt }
    }

    @ViewBuilder
    private func homeRow(_ item: HomeItem, showsActions: Bool) -> some View {
        if !showsActions {
            if let route = item.openAction?.href.flatMap({ HomeOpenRoute(href: $0) }) {
                if case let .chat(id) = route {
                    Button { onOpenConversation(id, item.title, "main") } label: {
                        compactRow(title: item.title, subtitle: item.summary, symbol: "clock")
                    }.buttonStyle(.plain)
                } else {
                    NavigationLink { destination(for: route) } label: {
                        compactRow(title: item.title, subtitle: item.summary, symbol: "clock")
                    }.buttonStyle(.plain)
                }
            } else {
                compactRow(title: item.title, subtitle: item.summary, symbol: "clock")
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    Circle().fill(.orange).frame(width: 6, height: 6).padding(.top, 7)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.title).mobileTextStyle(.rowTitle).fontWeight(.semibold).lineLimit(3)
                        Text(item.summary).mobileTextStyle(.footnote).foregroundStyle(.secondary).lineLimit(2)
                        if let recommendation = item.recommendation, !recommendation.isEmpty {
                            Text(recommendation).mobileTextStyle(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                if let open = item.openAction {
                    actionControl(open)
                }
                if let primary = item.primaryAction, primary.type != "open" {
                    actionControl(primary)
                }
                ForEach(item.secondaryActions ?? []) { action in actionControl(action) }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 18))
                .accessibilityIdentifier("progress-item-\(item.id)")
        }
    }

    @ViewBuilder
    private func actionControl(_ action: HomeAction) -> some View {
        if action.type == "open", let route = action.href.flatMap({ HomeOpenRoute(href: $0) }) {
            switch route {
            case let .chat(id):
                Button(action.label) { onOpenConversation(id, "会话", "main") }
                    .buttonStyle(.bordered)
            default:
                NavigationLink(action.label) { destination(for: route) }
                    .buttonStyle(.bordered)
            }
        } else if action.command != nil {
            Button(action.label) { pendingAction = action }
                .buttonStyle(.bordered)
                .disabled(isPerformingAction)
        } else {
            Button(action.label) { actionError = "此入口尚未在 iOS 支持。" }
                .buttonStyle(.bordered)
        }
    }

    @ViewBuilder
    private func destination(for route: HomeOpenRoute) -> some View {
        switch route {
        case .tasks:
            TasksView(configuration: configuration, onOpenConversation: onOpenConversation).navigationTitle("任务")
        case let .task(id):
            TaskDetailView(configuration: configuration, taskID: id, onOpenConversation: onOpenConversation)
        case .projects:
            ProjectsView(configuration: configuration, onOpenConversation: onOpenConversation,
                         onStartProjectConversation: onStartProjectConversation).navigationTitle("项目")
        case let .project(id):
            ProjectDetailView(configuration: configuration, projectID: id,
                              onOpenConversation: onOpenConversation,
                              onStartProjectConversation: onStartProjectConversation)
        case .automations:
            AutomationsView(configuration: configuration, onOpenConversation: onOpenConversation).navigationTitle("自动化")
        case let .automation(id):
            AutomationDetailView(configuration: configuration, automationID: id,
                                 onOpenConversation: onOpenConversation)
        case .notes:
            NotesView(configuration: configuration, onOpenConversation: onOpenConversation)
        case let .note(id):
            NoteDetailView(configuration: configuration, noteID: id, onOpenConversation: onOpenConversation)
        case .files:
            FilesView(configuration: configuration)
        case .chat:
            EmptyView()
        }
    }
}

private extension ProgressHubView {
    func summaryButton(count: Int, title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text("\(count)").mobileTextStyle(.heading).fontWeight(.semibold)
                Text(title).mobileTextStyle(.footnote)
            }.frame(maxWidth: .infinity, minHeight: 52)
        }.buttonStyle(.plain).disabled(home == nil)
    }

    func toolRow(_ title: LocalizedStringKey, symbol: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 18)).frame(width: 34, height: 34)
                .background(Color.blue.opacity(0.08), in: .circle).accessibilityHidden(true)
            Text(title).mobileTextStyle(.body).frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(.secondary)
        }.padding(.horizontal, 14).frame(minHeight: 64)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
            .foregroundStyle(.primary)
    }

    func compactRow(title: String, subtitle: String, symbol: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).frame(width: 24).foregroundStyle(.blue).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).mobileTextStyle(.secondary).fontWeight(.medium).lineLimit(2)
                Text(subtitle).mobileTextStyle(.caption).foregroundStyle(.secondary).lineLimit(2)
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(.secondary)
        }.padding(14).frame(minHeight: 64)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
            .foregroundStyle(.primary)
    }

    @MainActor func perform(_ action: HomeAction) async {
        guard !isPerformingAction else { return }
        isPerformingAction = true
        defer { isPerformingAction = false }
        do {
            try await GatewayClient(configuration: configuration).performHomeAction(action)
            await load()
        } catch { actionError = error.localizedDescription }
    }

    @MainActor func load() async {
        isLoading = true
        defer { isLoading = false }
        let client = GatewayClient(configuration: configuration)
        async let homeRequest = client.fetchHome(locale: locale.identifier)
        async let taskRequest = client.fetchTasks()
        async let automationRequest = client.fetchAutomationMetrics()
        do {
            home = try await homeRequest
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
        if let taskPage = try? await taskRequest {
            tasks = taskPage.items
        }
        if let metrics = try? await automationRequest {
            nextAutomation = metrics.nextRun
        }
    }
}

enum HomeOpenRoute: Equatable {
    case tasks, task(String), projects, project(String), automations, automation(String)
    case notes, note(String), files, chat(String)

    // swiftlint:disable:next cyclomatic_complexity
    init?(href: String) {
        guard href.hasPrefix("/"), !href.hasPrefix("//"),
              let url = URLComponents(string: href), url.scheme == nil, url.host == nil
        else { return nil }
        let segments = url.path.split(separator: "/").map(String.init)
        guard (1 ... 2).contains(segments.count) else { return nil }
        let id = segments.count == 2 ? segments[1] : nil
        let query = (url.queryItems ?? []).reduce(into: [String: String]()) { result, item in
            if let value = item.value {
                result[item.name] = value
            }
        }
        switch segments[0] {
        case "tasks": self = id.map(HomeOpenRoute.task) ?? .tasks
        case "projects": self = id.map(HomeOpenRoute.project) ?? .projects
        case "automations":
            guard query["run"] == nil else { return nil }
            self = (id ?? query["automation"]).map(HomeOpenRoute.automation) ?? .automations
        case "notes", "inbox": self = (id ?? query["item"]).map(HomeOpenRoute.note) ?? .notes
        case "files" where id == nil: self = .files
        case "chat":
            guard let id else { return nil }
            self = .chat(id)
        default: return nil
        }
    }
}

private struct TasksView: View {
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void

    @State private var items: [TaskListItem] = []
    @State private var filter = "open"
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        List {
            Picker("筛选", selection: $filter) {
                Text("进行中").tag("open")
                Text("已关闭").tag("closed")
                Text("全部").tag("all")
            }
            .pickerStyle(.segmented)
            if isLoading, items.isEmpty {
                ProgressListSkeleton()
            } else if visibleItems.isEmpty {
                ContentUnavailableView("暂无任务", systemImage: "checklist", description: Text("Gateway 中的任务会显示在这里。"))
                    .listRowBackground(Color.clear)
            } else {
                ForEach(visibleItems) { item in
                    NavigationLink {
                        TaskDetailView(configuration: configuration, taskID: item.task.id, onOpenConversation: onOpenConversation)
                    } label: {
                        ProgressRow(
                            title: item.task.title,
                            subtitle: item.task.contract?.objective ?? item.task.body,
                            state: item.operationalState,
                            date: item.task.updatedAt.millisecondsDate,
                            symbol: "checklist"
                        )
                    }
                    .accessibilityIdentifier("task-\(item.task.id)")
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { WorkflowRunsView(configuration: configuration) } label: {
                    Image(systemName: "arrow.triangle.branch").frame(width: 44, height: 44)
                }.accessibilityLabel("工作流")
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .alert("无法读取任务", isPresented: errorBinding) {
            Button("重试") { Task { await load() } }
            Button("取消", role: .cancel) {}
        } message: { Text(error ?? "未知错误") }
    }

    private var visibleItems: [TaskListItem] {
        items.filter { filter == "all" || (filter == "closed") == ($0.task.phase == "closed") }
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
        isLoading = true
        defer { isLoading = false }
        do { items = try await GatewayClient(configuration: configuration).fetchTasks().items; error = nil }
        catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

private struct ProjectsView: View {
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void
    let onStartProjectConversation: (ProjectRecord) -> Void

    @State private var items: [ProjectRecord] = []
    @State private var filter = "active"
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        List {
            Picker("筛选", selection: $filter) {
                Text("活跃").tag("active")
                Text("已归档").tag("archived")
                Text("全部").tag("all")
            }
            .pickerStyle(.segmented)
            if isLoading, items.isEmpty {
                ProgressListSkeleton()
            } else if visibleItems.isEmpty {
                ContentUnavailableView("暂无项目", systemImage: "folder", description: Text("Gateway 中的项目会显示在这里。"))
                    .listRowBackground(Color.clear)
            } else {
                ForEach(visibleItems) { project in
                    NavigationLink {
                        ProjectDetailView(
                            configuration: configuration,
                            projectID: project.id,
                            onOpenConversation: onOpenConversation,
                            onStartProjectConversation: onStartProjectConversation
                        )
                    } label: {
                        ProgressRow(
                            title: project.name,
                            subtitle: project.brief ?? project.description,
                            state: "project_status_" + project.status,
                            date: project.updatedAt.millisecondsDate,
                            symbol: "folder"
                        )
                    }
                    .accessibilityIdentifier("project-\(project.id)")
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .alert("无法读取项目", isPresented: errorBinding) { Button("好", role: .cancel) {} } message: { Text(error ?? "未知错误") }
    }

    private var visibleItems: [ProjectRecord] {
        items.filter { filter == "all" || (filter == "archived") == ($0.status == "archived") }
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
        do { items = try await GatewayClient(configuration: configuration).fetchProjects().items; error = nil }
        catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}
