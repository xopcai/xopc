import SwiftUI

// swiftlint:disable file_length

private enum ConversationHistoryMode: String, CaseIterable {
    case recent, projects, experts

    var title: LocalizedStringResource {
        switch self {
        case .recent: "最近"
        case .projects: "projects_tab"
        case .experts: "专家"
        }
    }
}

// swiftlint:disable:next type_body_length
struct ConversationsView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let onSelect: (ConversationSummary) -> Void
    let onStartNew: () -> Void
    let personalConversationID: String?
    let onOpenSettings: () -> Void
    var startSearching = false
    var onDelete: (String) -> Void = { _ in }

    private var visibleConversations: [ConversationSummary] {
        state.visibleConversations
    }

    @Environment(\.locale) private var locale

    @AppStorage("navigation.conversation-history") private var rememberedMode = ConversationHistoryMode.recent
    @State private var mode = ConversationHistoryMode.recent
    @State private var groupName: String?
    @State private var projects: [ProjectRecord] = []
    @State private var experts: [AgentSummary] = []
    @State private var catalogLoading = false
    @State private var catalogFailed = false

    private var browsingGroups: Bool {
        mode != .recent && groupName == nil
    }

    @State private var state = ConversationsState()
    @State private var searchOpen = false
    @FocusState private var isSearchFocused: Bool
    @State private var renameTarget: ConversationSummary?
    @State private var renameText = ""
    @State private var expandedConversations: Set<String> = []
    @State private var deleteTarget: ConversationSummary?

    var body: some View {
        VStack(spacing: 0) {
            if let groupName {
                Button { clearGroup() } label: {
                    Label(groupName, systemImage: "xmark.circle").lineLimit(1)
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.bottom, 8)
            }
            if searchOpen {
                PageSearchField(searchLabel, text: $state.searchText, focused: $isSearchFocused,
                                accessibilityID: "conversations-search-field")
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }

            TabView(selection: Binding(get: { mode }, set: { selectMode($0) })) {
                ForEach(ConversationHistoryMode.allCases, id: \.self) { page in
                    Group {
                        if page != .recent, page != mode || groupName == nil {
                            groupList(page)
                        } else if page == mode || state.scope == .recent {
                            conversationList(page)
                        } else {
                            ConversationLoadingSkeleton().frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }.tag(page)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .accessibilityIdentifier("sessions-mode-pager")
        }
        .background(mobileTheme.canvas)
        .mobilePageTitle(Text("对话")) {
            MobilePageTitleMenu(options: ConversationHistoryMode.allCases.map {
                SegmentOption(id: $0, title: $0.title, accessibilityID: "sessions-mode-\($0.rawValue)")
            }, selected: mode, identifier: "sessions-mode-menu", onSelect: selectMode)
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                PageSearchButton(searchLabel, isOpen: $searchOpen, query: $state.searchText,
                                 accessibilityID: "conversations-open-search")
                if mode == .recent {
                    Button("新建对话", systemImage: "plus", action: onStartNew)
                }
            }
        }
        .task {
            if startSearching {
                searchOpen = true
            } else {
                mode = rememberedMode
            }
        }
        .task(id: ConversationSearchKey(configuration: configuration, query: state.searchText,
                                        personalConversationID: personalConversationID,
                                        scope: state.scope, loadSessions: !browsingGroups))
        {
            guard !browsingGroups else { return }
            state.personalConversationID = personalConversationID
            state.cacheScope = ComposerDraftStore.accountScope(configuration)
            if !state.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                try? await Task.sleep(for: .milliseconds(300))
            }
            guard !Task.isCancelled else { return }
            await state.load(using: GatewayClient(configuration: configuration))
        }
        .task(id: mode) {
            if mode != .recent {
                await loadCatalog(mode)
            }
        }
        .alert("重命名对话", isPresented: renamePresented) {
            TextField("对话名称", text: $renameText)
            Button("取消", role: .cancel) { renameTarget = nil }
            Button("保存") { rename() }
                .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .alert("删除对话？", isPresented: deletePresented) {
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button("删除", role: .destructive) { deleteConversation() }
        } message: {
            Text("这会永久删除对话及其历史记录。")
        }
    }

    @ViewBuilder private func conversationList(_ page: ConversationHistoryMode) -> some View {
        if state.isAwaitingResults, visibleConversations.isEmpty {
            ConversationLoadingSkeleton()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage = state.errorMessage, state.conversations.isEmpty {
            ContentUnavailableView {
                Label("无法读取对话", systemImage: "network.slash")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("连接设置", action: onOpenSettings)
                Button("重试") { reload() }
            }
        } else if visibleConversations.isEmpty {
            if state.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ContentUnavailableView("暂无对话", systemImage: "bubble.left.and.bubble.right")
            } else {
                ContentUnavailableView.search(text: state.searchText)
            }
        } else {
            List {
                if state.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ForEach(ConversationDateSection.group(visibleConversations, locale: locale)) { section in
                        Section {
                            ForEach(section.conversations) { conversation in
                                conversationListRow(conversation, page: page)
                            }
                        } header: {
                            Text(section.title)
                        }
                    }
                } else {
                    ForEach(visibleConversations) { conversation in
                        conversationListRow(conversation, page: page)
                    }
                }
                conversationListFooter
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(mobileTheme.canvas)
            .refreshable {
                guard page == mode else { return }
                await state.load(using: GatewayClient(configuration: configuration))
            }
        }
    }

    @ViewBuilder private var conversationListFooter: some View {
        if state.isLoadingMore {
            ProgressView()
                .frame(maxWidth: .infinity)
                .listRowSeparator(.hidden)
        } else if state.errorMessage != nil, state.hasMore {
            Button("加载更多对话") {
                Task { await state.loadMore(using: GatewayClient(configuration: configuration)) }
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .listRowSeparator(.hidden)
        }
    }

    private func selectMode(_ next: ConversationHistoryMode) {
        guard next != mode else { return }
        let keepSearching = searchOpen
        clearGroup()
        searchOpen = keepSearching
        mode = next
        rememberedMode = next
    }

    private var searchLabel: LocalizedStringKey {
        if browsingGroups {
            return mode == .projects ? "搜索项目" : "搜索专家"
        }
        return "搜索对话"
    }

    private func clearGroup() {
        groupName = nil
        state.scope = .recent
        state.searchText = ""
        searchOpen = false
        isSearchFocused = false
        expandedConversations = []
    }

    private func choose(_ scope: ConversationHistoryScope, name: String) {
        state.searchText = ""
        searchOpen = false
        isSearchFocused = false
        expandedConversations = []
        state.scope = scope
        groupName = name
    }

    @ViewBuilder private func groupList(_ page: ConversationHistoryMode) -> some View {
        if page == mode, catalogLoading {
            ConversationLoadingSkeleton().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if page == mode, catalogFailed {
            ContentUnavailableView {
                Label("加载失败", systemImage: "exclamationmark.circle")
            } actions: {
                Button("重试") { Task { await loadCatalog(page) } }
            }
        } else {
            let query = page == mode ? state.searchText.trimmingCharacters(in: .whitespacesAndNewlines) : ""
            let unassigned = AppLocalization.string("未分配", locale: locale)
            let projectRows = projects.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }
            let expertRows = experts.filter { query.isEmpty || $0.displayName.localizedCaseInsensitiveContains(query) }
            let showUnassigned = query.isEmpty || unassigned.localizedCaseInsensitiveContains(query)
            if page == .projects ? (projectRows.isEmpty && !showUnassigned) : expertRows.isEmpty {
                if query.isEmpty {
                    ContentUnavailableView(page == .projects ? "暂无项目" : "暂无专家",
                                           systemImage: page == .projects ? "folder" : "person.2")
                } else {
                    ContentUnavailableView.search(text: query)
                }
            } else {
                List {
                    if page == .projects {
                        if showUnassigned {
                            Button { choose(.unassigned, name: unassigned) } label: {
                                Label(unassigned, systemImage: "tray")
                            }
                        }
                        ForEach(projectRows) { project in
                            Button { choose(.project(project.id), name: project.name) } label: {
                                Label(project.name, systemImage: "folder")
                            }
                        }
                    } else {
                        ForEach(expertRows) { expert in
                            Button { choose(.expert(expert.id), name: expert.displayName) } label: {
                                Label(expert.displayName, systemImage: "person")
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
    }

    private func loadCatalog(_ requestedMode: ConversationHistoryMode) async {
        catalogLoading = true
        catalogFailed = false
        let client = GatewayClient(configuration: configuration)
        do {
            if requestedMode == .projects {
                let page = try await client.fetchProjects()
                guard !Task.isCancelled, mode == requestedMode else { return }
                projects = page.items.filter { $0.status != "archived" }
            } else {
                let catalog = try await client.fetchAgents()
                guard !Task.isCancelled, mode == requestedMode else { return }
                experts = catalog.agents.filter {
                    $0.id != "main" && $0.id != "task-router" && $0.override?.purpose != "task_dispatcher"
                        && $0.id.range(of: "^personal-[a-f0-9]{12}$", options: [.regularExpression, .caseInsensitive]) == nil
                }
            }
        } catch {
            if !Task.isCancelled, mode == requestedMode {
                catalogFailed = true
            }
        }
        if mode == requestedMode {
            catalogLoading = false
        }
    }

    private func conversationButton(for conversation: ConversationSummary) -> some View {
        Button {
            onSelect(conversation)
        } label: {
            ConversationRow(conversation: conversation)
                .frame(maxWidth: .infinity, minHeight: 64)
                .contentShape(.hoverEffect, .rect(cornerRadius: mobileTheme.corner(16)))
                .hoverEffect(.highlight, isEnabled: state.operatingConversationID == nil)
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 4, trailing: 20))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .disabled(state.operatingConversationID != nil)
        .contextMenu {
            Button("重命名", systemImage: "pencil") {
                renameText = conversation.displayName
                renameTarget = conversation
            }
            Button { togglePin(conversation) } label: {
                Label {
                    Text(conversation.status == "pinned"
                        ? LocalizedStringResource("取消置顶")
                        : LocalizedStringResource("置顶"))
                } icon: {
                    Image(systemName: conversation.status == "pinned" ? "pin.slash" : "pin")
                }
            }
            Button("归档", systemImage: "archivebox") { archive(conversation) }
            Button("删除", systemImage: "trash", role: .destructive) { deleteTarget = conversation }
        }
    }

    private func conversationListRow(_ conversation: ConversationSummary, page: ConversationHistoryMode) -> some View {
        Group {
            HStack(spacing: 0) {
                if let group = state.childrenByConversationID[conversation.id], !group.items.isEmpty {
                    Button {
                        if !expandedConversations.insert(conversation.id).inserted {
                            expandedConversations.remove(conversation.id)
                        }
                    } label: {
                        Image(systemName: expandedConversations.contains(conversation.id) ? "chevron.down" : "chevron.right")
                            .font(.callout.weight(.medium))
                            .frame(width: 32, height: 44)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(AppLocalization.string(expandedConversations.contains(conversation.id) ? "收起子对话" : "展开子对话", locale: locale))
                    .accessibilityIdentifier("conversation-expand-\(conversation.id)")
                }
                conversationButton(for: conversation)
            }
            .padding(.horizontal, 16)
            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(16)))
            if expandedConversations.contains(conversation.id), let group = state.childrenByConversationID[conversation.id] {
                ForEach(group.items) { child in
                    NavigationLink {
                        TaskConversationView(configuration: configuration, taskID: child.taskId)
                    } label: {
                        HStack(spacing: 10) {
                            Circle().stroke(.secondary, lineWidth: 1.2).frame(width: 10, height: 10)
                            Text(child.title).mobileTextStyle(.secondary).lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(AppLocalization.string(child.phase == "closed" ? "已完成" : child.runStatus == "running" ? "进行中" : "待处理", locale: locale))
                                .mobileTextStyle(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 24).frame(minHeight: 52)
                        .background(mobileTheme.grouped, in: .rect(cornerRadius: mobileTheme.corner(16)))
                        .contentShape(.hoverEffect, .rect(cornerRadius: mobileTheme.corner(16)))
                        .hoverEffect(.highlight)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("conversation-child-\(child.id)")
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 4, trailing: 20))
        .listRowBackground(Color.clear).listRowSeparator(.hidden)
        .onAppear {
            guard page == mode, conversation.id == visibleConversations.last?.id else { return }
            Task { await state.loadMore(using: GatewayClient(configuration: configuration)) }
        }
    }
}

private extension ConversationsView {
    func reload() {
        Task {
            await state.load(using: GatewayClient(configuration: configuration))
        }
    }

    var renamePresented: Binding<Bool> {
        Binding(
            get: { renameTarget != nil },
            set: {
                if !$0 {
                    renameTarget = nil
                }
            }
        )
    }

    var deletePresented: Binding<Bool> {
        Binding(
            get: { deleteTarget != nil },
            set: {
                if !$0 {
                    deleteTarget = nil
                }
            }
        )
    }

    func rename() {
        guard let target = renameTarget else { return }
        renameTarget = nil
        Task {
            await state.rename(target, to: renameText, using: GatewayClient(configuration: configuration))
        }
    }

    func archive(_ conversation: ConversationSummary) {
        Task {
            await state.archive(conversation, using: GatewayClient(configuration: configuration))
        }
    }

    func togglePin(_ conversation: ConversationSummary) {
        Task {
            await state.togglePin(conversation, using: GatewayClient(configuration: configuration))
        }
    }

    func deleteConversation() {
        guard let target = deleteTarget else { return }
        deleteTarget = nil
        Task {
            if await state.delete(target, using: GatewayClient(configuration: configuration)) {
                onDelete(target.id)
            }
        }
    }
}

private struct ConversationSearchKey: Hashable {
    let configuration: GatewayConfiguration
    let query: String
    let personalConversationID: String?
    let scope: ConversationHistoryScope
    let loadSessions: Bool
}

struct ConversationDateSection: Identifiable {
    let id: Date
    let title: String
    let conversations: [ConversationSummary]

    static func group(
        _ conversations: [ConversationSummary],
        now: Date = .now,
        calendar: Calendar = .current,
        locale: Locale = .current,
        bundle: Bundle = .main
    ) -> [ConversationDateSection] {
        let standard = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let unknownDate = Date.distantPast
        var groups: [Date: [ConversationSummary]] = [:]
        for conversation in conversations {
            let date = fractional.date(from: conversation.updatedAt)
                ?? standard.date(from: conversation.updatedAt)
                ?? unknownDate
            groups[calendar.startOfDay(for: date), default: []].append(conversation)
        }
        return groups.keys.sorted(by: >).map { day in
            let title: String
            let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now))
            if day == calendar.startOfDay(for: now) {
                title = AppLocalization.string("今天", locale: locale, bundle: bundle)
            } else if day == yesterday {
                title = AppLocalization.string("昨天", locale: locale, bundle: bundle)
            } else if day == calendar.startOfDay(for: unknownDate) {
                title = AppLocalization.string("日期未知", locale: locale, bundle: bundle)
            } else {
                title = day.formatted(.dateTime.year().month().day().locale(locale))
            }
            return ConversationDateSection(id: day, title: title, conversations: groups[day] ?? [])
        }
    }
}

private struct ConversationRow: View {
    let conversation: ConversationSummary

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(conversation.displayName)
                    .mobileTextStyle(.rowTitle)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Text(conversation.updatedAtDate, style: .relative)
                .mobileTextStyle(.caption).foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.vertical, 6)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("打开对话")
    }
}

#Preview {
    NavigationStack {
        ConversationsView(configuration: .local, onSelect: { _ in }, onStartNew: {},
                          personalConversationID: nil, onOpenSettings: {})
    }
}

private extension ConversationSummary {
    var updatedAtDate: Date {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return parser.date(from: updatedAt) ?? ISO8601DateFormatter().date(from: updatedAt) ?? .now
    }
}

private struct ConversationLoadingSkeleton: View {
    var body: some View {
        VStack(spacing: 0) {
            MobileListSkeleton(rows: 5)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, MobileDesignTokens.pagePaddingX)
        .accessibilityLabel("正在读取对话")
    }
}

struct PageSearchButton: View {
    let title: LocalizedStringKey
    @Binding var isOpen: Bool
    @Binding var query: String
    let accessibilityID: String

    init(_ title: LocalizedStringKey, isOpen: Binding<Bool>, query: Binding<String>, accessibilityID: String) {
        self.title = title
        _isOpen = isOpen
        _query = query
        self.accessibilityID = accessibilityID
    }

    var body: some View {
        Button(isOpen ? "关闭" : title, systemImage: isOpen ? "xmark" : "magnifyingglass") {
            isOpen.toggle()
            if !isOpen {
                query = ""
            }
        }
        .accessibilityIdentifier(isOpen ? accessibilityID + "-close" : accessibilityID)
    }
}

struct PageSearchField: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let prompt: LocalizedStringKey
    @Binding var text: String
    @FocusState.Binding var focused: Bool
    let accessibilityID: String
    var autoFocus: Bool
    var onSubmit: () -> Void

    init(_ prompt: LocalizedStringKey, text: Binding<String>, focused: FocusState<Bool>.Binding,
         accessibilityID: String, autoFocus: Bool = true, onSubmit: @escaping () -> Void = {})
    {
        self.prompt = prompt
        _text = text
        _focused = focused
        self.accessibilityID = accessibilityID
        self.autoFocus = autoFocus
        self.onSubmit = onSubmit
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($focused)
                .onSubmit { focused = false; onSubmit() }
                .accessibilityIdentifier(accessibilityID)
            if !text.isEmpty {
                Button("清除搜索", systemImage: "xmark.circle.fill") { text = "" }
                    .buttonStyle(.borderless)
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 48)
        .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(16)))
        .task {
            if autoFocus {
                focused = true
            }
        }
        .onDisappear { focused = false }
    }
}
