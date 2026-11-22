// swiftlint:disable file_length
import SwiftUI

enum WorkPage: String, CaseIterable {
    case progress, tasks, projects

    var title: LocalizedStringResource {
        switch self {
        case .progress: "进展"
        case .projects: "projects_tab"
        case .tasks: "任务"
        }
    }
}

struct WorkPagesView: View {
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void
    let onOpenLibrary: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var page: WorkPage

    init(configuration: GatewayConfiguration, initialPage: WorkPage = .progress,
         onOpenConversation: @escaping (String, String, String) -> Void, onOpenLibrary: @escaping () -> Void)
    {
        self.configuration = configuration
        self.onOpenConversation = onOpenConversation
        self.onOpenLibrary = onOpenLibrary
        _page = State(initialValue: initialPage)
    }

    var body: some View {
        TabView(selection: $page) {
            ProgressHubView(configuration: configuration, onOpenConversation: onOpenConversation, onSelectPage: selectPage,
                            onOpenLibrary: onOpenLibrary, isActive: page == .progress)
                .tag(WorkPage.progress)
            TasksView(configuration: configuration, isActive: page == .tasks)
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
    let onOpenLibrary: () -> Void
    let isActive: Bool

    @Environment(\.locale) private var locale
    @State private var home: HomeSnapshot?
    @State private var nextAutomation: AutomationNextRun?
    @State private var isLoading = true
    @State private var loadRevision = 0
    @State private var error: String?
    @State private var actionError: String?
    @State private var pendingAction: HomeAction?
    @State private var isPerformingAction = false

    var body: some View {
        let running = runningItems
        let scheduled = scheduledItems
        let delivered = deliveries
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if isLoading, home == nil {
                    ProgressListSkeleton()
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                    Button("重试") { Task { await load() } }.frame(minHeight: 44)
                }
                if let home, !home.needsUser.isEmpty {
                    HStack {
                        workSectionHeading("需要你处理")
                        Spacer()
                        Text("\(home.needsUser.count)")
                            .mobileTextStyle(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(home.needsUser) { item in homeRow(item, showsActions: true) }
                }
                if !delivered.isEmpty {
                    HStack {
                        workSectionHeading("已交付")
                        Spacer()
                        Button("查看资料库", action: onOpenLibrary).frame(minHeight: 44)
                            .accessibilityIdentifier("progress-open-library")
                    }
                    ForEach(delivered.prefix(5)) { item in
                        HomeDeliveryLink(item: item, configuration: configuration, onOpenConversation: onOpenConversation,
                                         progressCard: true)
                    }
                }
                if !running.isEmpty {
                    workSectionHeading("正在进行")
                    ForEach(running.prefix(5)) { item in homeRow(item, showsActions: false) }
                }
                if !scheduled.isEmpty || nextAutomation != nil {
                    HStack {
                        workSectionHeading("接下来")
                        Spacer()
                        NavigationLink("查看自动化") {
                            AutomationsView(configuration: configuration, onOpenConversation: onOpenConversation)
                        }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("progress-open-automations")
                    }
                    if !scheduled.isEmpty {
                        ForEach(scheduled.prefix(5)) { item in homeRow(item, showsActions: false) }
                    } else if let nextAutomation {
                        NavigationLink {
                            AutomationDetailView(configuration: configuration, automationID: nextAutomation.automationId,
                                                 onOpenConversation: onOpenConversation)
                        } label: {
                            compactRow(title: nextAutomation.name,
                                       subtitle: nextAutomation.runAtMs.millisecondsDate.formatted(date: .abbreviated, time: .shortened), symbol: "clock")
                        }.buttonStyle(.plain)
                    }
                }
                if !isLoading, error == nil, home?.needsUser.isEmpty == true, delivered.isEmpty,
                   running.isEmpty, scheduled.isEmpty, nextAutomation == nil
                {
                    ContentUnavailableView("暂无进展", systemImage: "checklist")
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
        }
        .refreshable { await load() }
        .task(id: isActive ? ProgressLoadScope(configuration: configuration, language: locale.identifier) : nil) {
            if isActive {
                await load()
            }
        }
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

    private var runningItems: [HomeItem] {
        home?.background.filter { $0.kind != "scheduled" } ?? []
    }

    private var scheduledItems: [HomeItem] {
        home?.background.filter { $0.kind == "scheduled" } ?? []
    }

    private var deliveries: [HomeDelivery] {
        home?.recentDeliveries?.filter { $0.destination != nil } ?? []
    }

    private func workSectionHeading(_ title: LocalizedStringKey) -> some View {
        Text(title).mobileTextStyle(.rowTitle).frame(minHeight: 44).accessibilityAddTraits(.isHeader)
    }

    private func workItemSubtitle(_ item: HomeItem) -> String {
        [item.statusLabel, item.summary].compactMap { value in
            guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
            return trimmed
        }.joined(separator: " · ")
    }

    private func attentionSummary(_ summary: String) -> String {
        if summary.contains("provider_setup_required") {
            return AppLocalization.string("请先完成模型服务配置后再继续。", locale: locale)
        }
        if summary.contains("run was still active"), summary.contains("automatic recovery") {
            return AppLocalization.string("执行已中断，已完成的操作会保留。", locale: locale)
        }
        return summary
    }

    @ViewBuilder
    private func homeRow(_ item: HomeItem, showsActions: Bool) -> some View {
        if !showsActions {
            let subtitle = workItemSubtitle(item)
            if let route = item.openAction?.href.flatMap({ HomeOpenRoute(href: $0) }) {
                if case let .chat(id) = route {
                    Button { onOpenConversation(id, item.title, "main") } label: {
                        compactRow(title: item.title, subtitle: subtitle, symbol: "clock")
                    }.buttonStyle(.plain)
                } else if let page = route.workPage {
                    Button { onSelectPage(page) } label: {
                        compactRow(title: item.title, subtitle: subtitle, symbol: "clock")
                    }.buttonStyle(.plain)
                } else {
                    NavigationLink { destination(for: route) } label: {
                        compactRow(title: item.title, subtitle: subtitle, symbol: "clock")
                    }.buttonStyle(.plain)
                }
            } else {
                compactRow(title: item.title, subtitle: subtitle, symbol: "clock", navigable: false)
            }
        } else {
            let secondary = item.secondaryActions ?? []
            let duplicateOpen = item.openAction?.href != nil && secondary.contains { $0.href == item.openAction?.href }
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Circle().fill(mobileTheme.onAttention).frame(width: 6, height: 6).accessibilityHidden(true)
                    Text("待处理").mobileTextStyle(.caption).foregroundStyle(mobileTheme.onAttention)
                }
                Text(item.title).mobileTextStyle(.rowTitle).fontWeight(.semibold).lineLimit(3)
                if !item.summary.isEmpty, item.summary != item.title {
                    Text(attentionSummary(item.summary)).mobileTextStyle(.footnote).foregroundStyle(.secondary).lineLimit(2)
                }
                if let recommendation = item.recommendation, !recommendation.isEmpty, !item.summary.contains("provider_setup_required") {
                    Text(recommendation).mobileTextStyle(.footnote).foregroundStyle(.secondary)
                }
                if let open = item.openAction, !duplicateOpen {
                    actionControl(open)
                }
                if let primary = item.primaryAction, primary.type != "open" {
                    actionControl(primary)
                }
                ForEach(secondary) { action in actionControl(action) }
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
    func compactRow(title: String, subtitle: String, symbol: String, navigable: Bool = true) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).frame(width: 24).foregroundStyle(.tint).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).mobileTextStyle(.secondary).fontWeight(.medium).lineLimit(2)
                if !subtitle.isEmpty {
                    Text(subtitle).mobileTextStyle(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if navigable {
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(.secondary)
            }
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
        loadRevision += 1
        let revision = loadRevision
        isLoading = true
        defer {
            if revision == loadRevision {
                isLoading = false
            }
        }
        let client = GatewayClient(configuration: configuration)
        async let homeRequest = client.fetchHome(locale: locale.identifier)
        async let automationRequest = client.fetchAutomationMetrics()
        do {
            let snapshot = try await homeRequest
            guard !Task.isCancelled, revision == loadRevision else { return }
            home = snapshot
            error = nil
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, revision == loadRevision else { return }
            self.error = error.localizedDescription
        }
        let metrics = try? await automationRequest
        guard !Task.isCancelled, revision == loadRevision else { return }
        if let metrics {
            nextAutomation = metrics.nextRun
        }
    }

    private struct ProgressLoadScope: Hashable {
        let configuration: GatewayConfiguration
        let language: String
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
        guard let url = Self.relativeComponents(href) else { return nil }
        let segments = url.path.split(separator: "/", omittingEmptySubsequences: false).dropFirst().map(String.init)
        guard (1 ... 2).contains(segments.count), !segments[0].isEmpty else { return nil }
        let rawID = segments.count == 2 ? segments[1] : nil
        if let rawID, !rawID.isEmpty, !ChatMessageLink.validResourceID(rawID) {
            return nil
        }
        let id = rawID?.isEmpty == true ? nil : rawID
        let query = Self.queryValues(url)
        switch segments[0] {
        case "tasks":
            if rawID != nil, id == nil {
                return nil
            }
            self = id.map(HomeOpenRoute.task) ?? .tasks
        case "projects":
            if rawID != nil, id == nil {
                return nil
            }
            self = id.map(HomeOpenRoute.project) ?? .projects
        case "automations":
            if let run = query["run"] {
                guard let validRun = Self.checkedID(run) else { return nil }
                self = .automationRun(validRun)
            } else if let auto = query["automation"] {
                guard let validAuto = Self.checkedID(auto) else { return nil }
                self = .automation(validAuto)
            } else {
                if rawID != nil, id == nil {
                    return nil
                }
                self = id.map(HomeOpenRoute.automation) ?? .automations
            }
        case "notes", "inbox":
            if let item = query["item"] {
                guard let validItem = Self.checkedID(item) else { return nil }
                self = .note(validItem)
            } else {
                if rawID != nil, id == nil {
                    return nil
                }
                self = id.map(HomeOpenRoute.note) ?? .notes
            }
        case "files" where id == nil && rawID == nil: self = .files
        case "chat":
            guard let id else { return nil }
            self = .chat(id)
        default: return nil
        }
    }

    private static func checkedID(_ candidate: String?) -> String? {
        guard let candidate else { return nil }
        return ChatMessageLink.validResourceID(candidate) ? candidate : nil
    }

    private static func relativeComponents(_ href: String) -> URLComponents? {
        guard href.hasPrefix("/"), !href.hasPrefix("//"), href.utf8.count <= 4096,
              !href.contains("\\"), href.rangeOfCharacter(from: .controlCharacters) == nil,
              let url = URLComponents(string: href), url.scheme == nil, url.host == nil,
              url.user == nil, url.password == nil, url.port == nil
        else { return nil }
        return url
    }

    private static func queryValues(_ url: URLComponents) -> [String: String] {
        (url.queryItems ?? []).reduce(into: [String: String]()) { result, item in
            if let value = item.value {
                result[item.name] = value
            }
        }
    }
}

private struct TasksView: View {
    @Environment(\.mobileTheme) private var theme
    let configuration: GatewayConfiguration
    let isActive: Bool

    @State private var items: [TaskListItem] = []
    @State private var filter = "all"
    @State private var searchText = ""
    @FocusState private var searchFocused: Bool
    @State private var loadedSearch: String?
    @State private var nextOffset: Int?
    @State private var isLoading = false
    @State private var loadRevision = 0
    @State private var error: String?
    @State private var creating = false
    @State private var createdTaskID: String?
    @State private var selectedTaskID: String?

    private var query: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        let visible = visibleItems
        List {
            SegmentedTabs(options: [
                SegmentOption(id: "all", title: "全部", accessibilityID: "tasks-filter-all"),
                SegmentOption(id: "open", title: "进行中", accessibilityID: "tasks-filter-open"),
                SegmentOption(id: "attention", title: "需处理", accessibilityID: "tasks-filter-attention"),
                SegmentOption(id: "closed", title: "已关闭", accessibilityID: "tasks-filter-closed")
            ], selected: filter, label: "筛选", swipeToSelect: true) { filter = $0 }
                .accessibilityIdentifier("tasks-filter-tabs")
                .listRowBackground(Color.clear)
            if visible.isEmpty, isLoading || loadedSearch != query, error == nil {
                ProgressListSkeleton()
            } else if visible.isEmpty, nextOffset == nil, error == nil {
                ContentUnavailableView(query.isEmpty ? "暂无任务" : "没有匹配的任务", systemImage: "checklist")
                    .listRowBackground(Color.clear)
            }
            ForEach(visible) { item in
                Button { selectedTaskID = item.id } label: {
                    ProgressRow(
                        title: item.task.title,
                        subtitle: item.presentation?.reason ?? item.task.contract?.objective ?? item.task.body,
                        state: taskPresentationLabel(item.displayStatus),
                        date: item.task.updatedAt.millisecondsDate,
                        symbol: "checklist"
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("task-\(item.id)")
            }
            if loadedSearch == query, let offset = nextOffset {
                Button("加载更多") { Task { await load(search: query, offset: offset) } }
                    .disabled(isLoading)
                    .accessibilityIdentifier("tasks-load-more")
                    .task(id: offset) {
                        guard isActive, nextOffset == offset, !isLoading else { return }
                        await load(search: query, offset: offset)
                    }
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                Button("重试") { Task { await load(search: query) } }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            PageSearchField("搜索任务", text: $searchText, focused: $searchFocused, accessibilityID: "tasks-search", autoFocus: false)
                .padding(.horizontal, 20).padding(.bottom, 8).background(theme.canvas)
        }
        .onChange(of: isActive) {
            if !isActive {
                searchFocused = false
            }
        }
        .refreshable { await load(search: query) }
        .task(id: isActive ? query : nil) {
            guard isActive, loadedSearch != query else { return }
            error = nil
            if !query.isEmpty {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
            await load(search: query)
        }
        .toolbar {
            if isActive {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("新建任务", systemImage: "plus") {
                        searchFocused = false
                        creating = true
                    }
                    .accessibilityIdentifier("tasks-create")
                }
            }
        }
        .sheet(isPresented: $creating, onDismiss: {
            guard let taskID = createdTaskID else { return }
            createdTaskID = nil
            selectedTaskID = taskID
            Task { await load(search: query) }
        }) {
            TaskEditorView(configuration: configuration) { createdTaskID = $0.id }
        }
        .navigationDestination(item: $selectedTaskID) { taskID in
            TaskConversationView(configuration: configuration, taskID: taskID)
        }
    }

    private var visibleItems: [TaskListItem] {
        guard loadedSearch == query else { return [] }
        return items.filter { item in
            switch filter {
            case "all": true
            case "closed": item.task.phase == "closed"
            case "attention": item.task.phase != "closed" && item.needsUserAttention
            default: item.task.phase != "closed"
            }
        }
    }

    @MainActor private func load(search: String, offset: Int = 0) async {
        guard search == query, offset == 0 || (!isLoading && nextOffset == offset) else { return }
        loadRevision += 1
        let revision = loadRevision
        isLoading = true
        defer {
            if revision == loadRevision {
                isLoading = false
            }
        }
        do {
            let page = try await GatewayClient(configuration: configuration).fetchTasks(search: search, offset: offset, limit: 40)
            guard !Task.isCancelled, revision == loadRevision, search == query else { return }
            var seen = Set(offset == 0 ? [] : items.map(\.id))
            let incoming = page.items.filter { seen.insert($0.id).inserted }
            items = offset == 0 ? incoming : items + incoming
            loadedSearch = search
            let next = offset + page.items.count
            nextOffset = !page.items.isEmpty && next < page.total ? next : nil
            error = nil
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled, revision == loadRevision, search == query else { return }
            self.error = error.localizedDescription
        }
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
    @State private var isLoading = true
    @State private var error: String?
    @State private var creating = false

    var body: some View {
        let visible = visibleItems
        return List {
            SegmentedTabs(options: [
                SegmentOption(id: "active", title: "活跃", accessibilityID: "projects-filter-active"),
                SegmentOption(id: "archived", title: "已归档", accessibilityID: "projects-filter-archived"),
                SegmentOption(id: "all", title: "全部", accessibilityID: "projects-filter-all")
            ], selected: filter, label: "筛选", swipeToSelect: true) { filter = $0 }
                .accessibilityIdentifier("projects-filter-tabs")
                .listRowBackground(Color.clear)
            if isLoading, items.isEmpty {
                ProgressListSkeleton()
            } else if visible.isEmpty {
                ContentUnavailableView(searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "暂无项目" : "没有匹配的项目", systemImage: "folder")
                    .listRowBackground(Color.clear)
            } else {
                ForEach(visible) { project in
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
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return items.filter { project in
            (filter == "all" || (filter == "archived") == (project.status == "archived")) &&
                (query.isEmpty || project.name.localizedCaseInsensitiveContains(query)
                    || project.description?.localizedCaseInsensitiveContains(query) == true
                    || project.brief?.localizedCaseInsensitiveContains(query) == true)
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
