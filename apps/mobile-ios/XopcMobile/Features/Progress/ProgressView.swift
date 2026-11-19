// swiftlint:disable file_length
import SwiftUI

enum WorkPage: String, CaseIterable {
    case progress, tasks, projects

    var title: LocalizedStringResource {
        switch self {
        case .progress: "进展"
        case .projects: "项目"
        case .tasks: "任务"
        }
    }
}

struct WorkPagesView: View {
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var page: WorkPage

    init(configuration: GatewayConfiguration, initialPage: WorkPage = .progress,
         onOpenConversation: @escaping (String, String, String) -> Void)
    {
        self.configuration = configuration
        self.onOpenConversation = onOpenConversation
        _page = State(initialValue: initialPage)
    }

    var body: some View {
        TabView(selection: $page) {
            ProgressHubView(configuration: configuration, onOpenConversation: onOpenConversation, onSelectPage: selectPage)
                .tag(WorkPage.progress)
            TasksView(configuration: configuration)
                .tag(WorkPage.tasks)
            ProjectsView(configuration: configuration, onOpenConversation: onOpenConversation, isActive: page == .projects)
                .tag(WorkPage.projects)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .accessibilityIdentifier("work-page-pager")
        .mobilePageTitle(Text(page.title)) {
            MobilePageTitleMenu(options: WorkPage.allCases.map {
                SegmentOption(id: $0, title: $0.title, accessibilityID: "work-page-\($0.rawValue)")
            }, selected: page, identifier: "work-page-menu", onSelect: selectPage)
        }
    }

    private func selectPage(_ selection: WorkPage) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.23)) { page = selection }
    }
}

private struct ProgressHubView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void
    let onSelectPage: (WorkPage) -> Void

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
                    .padding(16).background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(16)))
                    if isLoading, home == nil {
                        ProgressListSkeleton()
                    }
                    if let home, !home.needsUser.isEmpty {
                        Text("需要你处理").mobileTextStyle(.rowTitle).padding(.top, 12).id("progress-section-needs-user")
                        ForEach(home.needsUser) { item in homeRow(item, showsActions: true) }
                    }
                    if !deliveries.isEmpty {
                        Text("已交付").mobileTextStyle(.rowTitle).padding(.top, 12)
                        ForEach(deliveries.prefix(5)) { item in
                            HomeDeliveryLink(item: item, configuration: configuration, onOpenConversation: onOpenConversation,
                                             progressCard: true)
                        }
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
                        Text("历史").mobileTextStyle(.rowTitle).padding(.top, 12)
                        ForEach(recentClosed.prefix(2)) { item in
                            NavigationLink {
                                TaskConversationView(configuration: configuration, taskID: item.id)
                            } label: {
                                compactRow(title: item.task.title, subtitle: item.task.resolution ?? "", symbol: "checkmark.circle")
                            }.buttonStyle(.plain)
                        }
                    }
                    Text("常用工作").mobileTextStyle(.rowTitle).padding(.top, 12)
                    HStack(spacing: 12) {
                        Button {
                            onSelectPage(.tasks)
                        } label: { toolRow("任务", symbol: "checkmark.circle") }
                        Button {
                            onSelectPage(.projects)
                        } label: { toolRow("项目", symbol: "folder") }
                    }.buttonStyle(.plain)
                    NavigationLink {
                        AutomationsView(configuration: configuration, onOpenConversation: onOpenConversation)
                    } label: { toolRow("自动化", symbol: "clock") }.buttonStyle(.plain)
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                        Button("重试") { Task { await load() } }.frame(minHeight: 44)
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
            }
        }
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

    private var deliveries: [HomeDelivery] {
        home?.recentDeliveries?.filter { $0.destination != nil } ?? []
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
                } else if let page = route.workPage {
                    Button { onSelectPage(page) } label: {
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
                HStack(spacing: 6) {
                    Circle().fill(mobileTheme.onAttention).frame(width: 6, height: 6).accessibilityHidden(true)
                    Text("待处理").mobileTextStyle(.caption).foregroundStyle(mobileTheme.onAttention)
                }
                Text(item.title).mobileTextStyle(.rowTitle).fontWeight(.semibold).lineLimit(3)
                Text(item.summary).mobileTextStyle(.footnote).foregroundStyle(.secondary).lineLimit(2)
                if let recommendation = item.recommendation, !recommendation.isEmpty {
                    Text(recommendation).mobileTextStyle(.footnote).foregroundStyle(.secondary)
                }
                if let open = item.openAction {
                    actionControl(open)
                }
                if let primary = item.primaryAction, primary.type != "open" {
                    actionControl(primary)
                }
                ForEach(item.secondaryActions ?? []) { action in actionControl(action) }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(mobileTheme.attention, in: .rect(cornerRadius: mobileTheme.corner(16)))
                .accessibilityIdentifier("progress-item-\(item.id)")
        }
    }

    @ViewBuilder
    private func actionControl(_ action: HomeAction) -> some View {
        if let page = action.route?.workPage {
            Button(action.label) { onSelectPage(page) }.buttonStyle(.bordered)
        } else if let route = action.route {
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
        case let .task(id):
            TaskConversationView(configuration: configuration, taskID: id)
        case let .project(id):
            ProjectDetailView(configuration: configuration, projectID: id,
                              onOpenConversation: onOpenConversation)
        case .automations:
            AutomationsView(configuration: configuration, onOpenConversation: onOpenConversation)
        case let .automation(id):
            AutomationDetailView(configuration: configuration, automationID: id,
                                 onOpenConversation: onOpenConversation)
        case let .automationRun(id):
            AutomationRunDetailView(configuration: configuration, runID: id, initialRun: nil,
                                    onOpenConversation: onOpenConversation)
        case .notes:
            NotesView(configuration: configuration, onOpenConversation: onOpenConversation)
        case let .note(id):
            NoteDetailView(configuration: configuration, noteID: id, onOpenConversation: onOpenConversation)
        case .files:
            FilesView(configuration: configuration)
        case .chat, .tasks, .projects:
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
                .background(mobileTheme.action.opacity(0.10), in: .circle).accessibilityHidden(true)
            Text(title).mobileTextStyle(.body).frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(.secondary)
        }.padding(.horizontal, 14).frame(minHeight: 64)
            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(14)))
            .foregroundStyle(.primary)
            .contentShape(.hoverEffect, .rect(cornerRadius: mobileTheme.corner(14)))
            .hoverEffect(.highlight)
    }

    func compactRow(title: String, subtitle: String, symbol: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).frame(width: 24).foregroundStyle(.tint).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).mobileTextStyle(.secondary).fontWeight(.medium).lineLimit(2)
                Text(subtitle).mobileTextStyle(.caption).foregroundStyle(.secondary).lineLimit(2)
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(.secondary)
        }.padding(14).frame(minHeight: 64)
            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(14)))
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

extension HomeDelivery {
    var destination: HomeOpenRoute? {
        let route = HomeOpenRoute(href: href)
        switch route {
        case .task, .automationRun: return route
        default: return nil
        }
    }
}

struct HomeDeliveryLink: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let item: HomeDelivery
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void
    var progressCard = false

    var body: some View {
        if let route = item.destination {
            NavigationLink {
                switch route {
                case let .task(id):
                    TaskConversationView(configuration: configuration, taskID: id)
                case let .automationRun(id):
                    AutomationRunDetailView(configuration: configuration, runID: id, initialRun: nil,
                                            onOpenConversation: onOpenConversation)
                default:
                    EmptyView()
                }
            } label: {
                if progressCard {
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.circle").font(.system(size: 18))
                            .frame(width: 36, height: 36)
                            .background(.primary.opacity(0.06), in: .rect(cornerRadius: mobileTheme.corner(9)))
                            .foregroundStyle(.secondary).accessibilityHidden(true)
                        deliveryLabel.frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                    .padding(16)
                    .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(16)))
                    .foregroundStyle(.primary)
                } else {
                    deliveryLabel
                }
            }
            .accessibilityIdentifier("delivery-\(item.id)")
        }
    }

    private var deliveryLabel: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.title).mobileTextStyle(.rowTitle).lineLimit(2)
            if !item.summary.isEmpty {
                Text(item.summary).mobileTextStyle(.secondary).foregroundStyle(.secondary).lineLimit(2)
            }
        }
    }
}

enum HomeOpenRoute: Equatable {
    case tasks, task(String), projects, project(String), automations, automation(String), automationRun(String)
    case notes, note(String), files, chat(String)

    var workPage: WorkPage? {
        switch self {
        case .tasks: .tasks
        case .projects: .projects
        default: nil
        }
    }

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
            if let run = query["run"], !run.isEmpty {
                self = .automationRun(run)
            } else {
                self = (id ?? query["automation"]).map(HomeOpenRoute.automation) ?? .automations
            }
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

    @State private var items: [TaskListItem] = []
    @State private var filter = "open"
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        List {
            SegmentedTabs(options: [
                SegmentOption(id: "open", title: "进行中", accessibilityID: "tasks-filter-open"),
                SegmentOption(id: "closed", title: "已关闭", accessibilityID: "tasks-filter-closed"),
                SegmentOption(id: "all", title: "全部", accessibilityID: "tasks-filter-all")
            ], selected: filter, label: "筛选") { filter = $0 }
                .accessibilityIdentifier("tasks-filter-tabs")
                .listRowBackground(Color.clear)
            if isLoading, items.isEmpty {
                ProgressListSkeleton()
            } else if visibleItems.isEmpty {
                ContentUnavailableView("暂无任务", systemImage: "checklist", description: Text("Gateway 中的任务会显示在这里。"))
                    .listRowBackground(Color.clear)
            } else {
                ForEach(visibleItems) { item in
                    NavigationLink {
                        TaskConversationView(configuration: configuration, taskID: item.task.id)
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

struct ProjectsView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void

    var isActive = true

    @State private var items: [ProjectRecord] = []
    @State private var filter = "active"
    @State private var searchText = ""
    @State private var searchOpen = false
    @FocusState private var isSearchFocused: Bool
    @State private var isLoading = false
    @State private var error: String?
    @State private var creating = false

    var body: some View {
        List {
            SegmentedTabs(options: [
                SegmentOption(id: "active", title: "活跃", accessibilityID: "projects-filter-active"),
                SegmentOption(id: "archived", title: "已归档", accessibilityID: "projects-filter-archived"),
                SegmentOption(id: "all", title: "全部", accessibilityID: "projects-filter-all")
            ], selected: filter, label: "筛选") { filter = $0 }
                .accessibilityIdentifier("projects-filter-tabs")
                .listRowBackground(Color.clear)
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
                            onProjectUpdated: { updated in
                                if let index = items.firstIndex(where: { $0.id == updated.id }) {
                                    items[index] = updated
                                }
                            }
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
        .safeAreaInset(edge: .top, spacing: 0) {
            if searchOpen {
                PageSearchField("搜索项目", text: $searchText, focused: $isSearchFocused,
                                accessibilityID: "projects-search")
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                    .background(mobileTheme.canvas)
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .toolbar {
            if isActive {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    PageSearchButton("搜索项目", isOpen: $searchOpen, query: $searchText,
                                     accessibilityID: "projects-open-search")
                    Button("新建项目", systemImage: "plus") { creating = true }
                        .accessibilityIdentifier("project-create")
                }
            }
        }
        .onChange(of: isActive) { _, active in
            if !active {
                isSearchFocused = false
            }
        }
        .sheet(isPresented: $creating) {
            ProjectManageView(configuration: configuration) { project in
                filter = "active"
                items.insert(project, at: 0)
            }
        }
        .alert("无法读取项目", isPresented: errorBinding) { Button("好", role: .cancel) {} } message: { Text(error ?? "未知错误") }
    }

    private var visibleItems: [ProjectRecord] {
        items.filter { project in
            (filter == "all" || (filter == "archived") == (project.status == "archived")) &&
                (searchText.isEmpty || project.name.localizedCaseInsensitiveContains(searchText)
                    || project.description?.localizedCaseInsensitiveContains(searchText) == true)
        }
        .sorted { lhs, rhs in
            if (lhs.pinnedAt != nil) != (rhs.pinnedAt != nil) {
                return lhs.pinnedAt != nil
            }
            return lhs.updatedAt == rhs.updatedAt ? lhs.id < rhs.id : lhs.updatedAt > rhs.updatedAt
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { error != nil }, set: {
            if !$0 {
                error = nil
            }
        })
    }

    @MainActor private func load() async {
        let scope = ComposerDraftStore.accountScope(configuration)
        let requestedAt = Date.now
        if items.isEmpty {
            items = MobileListCache.shared.read(.projects, scope: scope) ?? []
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await GatewayClient(configuration: configuration).fetchProjects().items
            try Task.checkCancellation()
            items = loaded
            MobileListCache.shared.write(loaded, to: .projects, scope: scope, requestedAt: requestedAt)
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}
