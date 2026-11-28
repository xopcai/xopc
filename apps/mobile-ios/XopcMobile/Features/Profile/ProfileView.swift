// swiftlint:disable file_length
import SwiftUI

struct PersonalAgentSettingsRow: View {
    let configuration: GatewayConfiguration
    var personalAgent: PersonalAgentRecord?
    let busy: Bool
    let error: String?
    let onOpenPersonalAgent: () -> Void
    let onSaved: (PersonalAgentRecord) -> Void
    @State private var editing = false

    var body: some View {
        Button {
            if personalAgent?.isReady == true {
                editing = true
            } else {
                onOpenPersonalAgent()
            }
        } label: {
            HStack(spacing: 12) {
                PersonalAgentAvatar(configuration: configuration, agent: personalAgent, size: 40, active: false)
                VStack(alignment: .leading, spacing: 3) {
                    if let personalAgent, personalAgent.isReady {
                        Text(personalAgent.displayName).foregroundStyle(.primary)
                    } else {
                        Text("创建我的助手").foregroundStyle(.primary)
                    }
                    if let error {
                        Text(error).mobileTextStyle(.caption).foregroundStyle(.red)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }.frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityIdentifier(personalAgent?.isReady == true ? "profile-personal-agent-configure" : "profile-personal-agent-open")
        .sheet(isPresented: $editing) {
            if let personalAgent {
                let conversation = ConversationSummary(key: personalAgent.conversationId, agentId: personalAgent.agentId,
                                                       name: personalAgent.displayName, status: "active", updatedAt: "",
                                                       messageCount: 1, projectId: nil, transcriptId: nil)
                PersonalAgentProfileView(configuration: configuration, record: personalAgent,
                                         conversation: ConversationSelection(summary: conversation), onSaved: onSaved)
                    .mobileSheetPreset(.large)
            }
        }
    }
}

struct PersonalGoalsView: View {
    let configuration: GatewayConfiguration
    @State private var summary: MobileUserSummary?
    @State private var error = false
    @State private var selectedGoal: MobileUserGoal?
    @State private var editing = false
    @State private var completed = false
    @State private var pagerProgress = PageScrollProgress()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.mobileTheme) private var theme

    private let goalTabs = [
        SegmentOption(id: false, title: "进行中", accessibilityID: "personal-goals-ongoing"),
        SegmentOption(id: true, title: "已达成", accessibilityID: "personal-goals-achieved")
    ]

    var body: some View {
        VStack(spacing: 0) {
            SegmentedTabs(options: goalTabs, selected: completed, label: "状态", swipeToSelect: !editing, pagerProgress: pagerProgress) { next in
                MobileMotion.perform(MobileMotion.pagerDuration, reduceMotion: reduceMotion) { completed = next }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
            MobilePagePager(pages: goalTabs.map(\.id), selection: $completed, progress: pagerProgress) { page in
                goalList(completed: page)
            }
            .accessibilityIdentifier("personal-goals-pager")
        }
        .background(theme.canvas.ignoresSafeArea())
        .mobilePageTitle(Text("目标"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                MobileHeaderIconButton("添加", systemImage: "plus", tone: .accent) { selectedGoal = nil; editing = true }
                    .disabled(summary == nil)
                    .accessibilityIdentifier("settings-goal-add")
            }
            .mobileTransparentToolbarItem()
        }
        .task(id: configuration) { await load() }
        .sheet(isPresented: $editing) {
            GoalEditorView(configuration: configuration, goal: selectedGoal) { await load() }
                .mobileSheetPreset(.medium)
        }
    }

    private func goalList(completed: Bool) -> some View {
        List {
            if let summary {
                let goals = summary.goals.filter { ($0.status == "achieved") == completed }
                ForEach(goals) { goal in
                    Button {
                        selectedGoal = goal
                        editing = true
                    } label: {
                        goalRow(goal.title, outcome: goal.desiredOutcome)
                    }
                    .accessibilityIdentifier("goal-\(goal.id)")
                }
                if goals.isEmpty {
                    if !completed, summary.goals.isEmpty, let focus = summary.primaryFocus {
                        goalRow(focus.title, outcome: focus.desiredOutcome)
                    } else {
                        Text("暂无目标").foregroundStyle(.secondary)
                    }
                }
            } else if error {
                Button("重试") { Task { await load() } }
            } else {
                ProfileSkeleton()
            }
        }
        .scrollContentBackground(.hidden)
        .accessibilityIdentifier("personal-goals-list")
        .refreshable { await load() }
    }

    private func goalRow(_ title: String, outcome: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).mobileTextStyle(.rowTitle).foregroundStyle(.primary)
            if let outcome, !outcome.isEmpty {
                Text(outcome).mobileTextStyle(.secondary).foregroundStyle(.secondary)
            }
        }
    }

    @MainActor private func load() async {
        do {
            summary = try await GatewayClient(configuration: configuration).fetchMobileUserSummary()
            error = false
        } catch is CancellationError {} catch { self.error = true }
    }
}

struct UserUnderstandingView: View {
    let configuration: GatewayConfiguration
    @State private var summary: MobileUserSummary?
    @AppStorage("navigation.privacy-memory") private var savedSection = 0
    private var section: Int {
        (0 ... 2).contains(savedSection) ? savedSection : 0
    }

    @State private var filter = "all"
    @State private var query = ""
    @State private var searchOpen = false
    @FocusState private var searchFocused: Bool
    @Environment(\.mobileTheme) private var theme
    @State private var assertions: [MobileUserAssertion] = []
    @State private var nextCursor: String?
    @State private var workItems: [MobileWorkMemory] = []
    @State private var workCursor: String?
    @State private var workLoading = true
    @State private var workFailed = false
    @State private var expandedWorkID: String?
    @State private var editingProfile = false
    @State private var error: String?

    var body: some View {
        TabView(selection: Binding(get: { section }, set: { selectSection($0) })) {
            ForEach(0 ... 2, id: \.self) { page in
                memoryPage(page).tag(page)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .background(theme.canvas.ignoresSafeArea())
        .accessibilityIdentifier("about-you-pager")
        .mobilePageTitle(Text("隐私与记忆")) {
            MobilePageTitleMenu(options: [
                SegmentOption(id: 0, title: "概览", accessibilityID: "about-you-tab-overview"),
                SegmentOption(id: 1, title: "记住的你", accessibilityID: "about-you-tab-understanding"),
                SegmentOption(id: 2, title: "工作记忆", accessibilityID: "about-you-tab-work")
            ], selected: section, identifier: "about-you-menu", onSelect: selectSection)
        }
        .toolbar {
            if section == 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    PageSearchButton("搜索记忆", isOpen: $searchOpen, query: $query,
                                     accessibilityID: "about-you-search-toggle")
                }
                .mobileTransparentToolbarItem()
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if section == 1, searchOpen {
                PageSearchField("搜索记忆", text: $query, focused: $searchFocused, accessibilityID: "about-you-search")
                    .padding(.horizontal, 20).padding(.bottom, 8)
            }
        }
        .task(id: configuration) { await refreshSummary() }
        .task(id: "\(section):\(filter):\(query)") {
            guard section == 1 else { return }
            if !query.isEmpty {
                try? await Task.sleep(for: .milliseconds(300))
            }
            if !Task.isCancelled {
                await loadAssertions()
            }
        }
        .task(id: section) {
            if section == 2 {
                await loadWork()
            }
        }
        .sheet(isPresented: $editingProfile) {
            if let summary {
                ProfileEditorView(configuration: configuration, profile: summary.profile) { await refreshSummary() }
                    .mobileSheetPreset(.medium)
            }
        }
    }

    private func memoryPage(_ page: Int) -> some View {
        List {
            if page == 0 {
                if let summary {
                    overview(summary)
                } else if error == nil {
                    ProfileSkeleton()
                }
            } else if page == 2 {
                workMemory
            } else {
                personalMemory
            }
            if page != 2, error != nil {
                Section {
                    Text("内容暂时无法读取，请下拉重试").foregroundStyle(.secondary)
                    Button("重试") { Task { await refreshSection(page) } }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .listSectionSpacing(12)
        .refreshable { await refreshSection(page) }
    }

    @ViewBuilder
    private func overview(_ summary: MobileUserSummary) -> some View {
        Section("基本信息") {
            LabeledContent("称呼", value: summary.profile.callName.flatMap { $0.isEmpty ? nil : $0 } ?? summary.suggestedCallName ?? "你")
            if let role = summary.profile.role, !role.isEmpty {
                LabeledContent("角色", value: role)
            }
            if let timezone = summary.profile.timezone, !timezone.isEmpty {
                LabeledContent("时区", value: timezone)
            }
            Button("编辑基本信息") { editingProfile = true }
        }
        Section {
            Button {
                selectSection(2)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "doc.text").foregroundStyle(theme.action)
                    Text("工作记忆").mobileTextStyle(.rowTitle).foregroundStyle(.primary)
                    Spacer(minLength: 8)
                    Text(summary.counts.workMemory.formatted()).foregroundStyle(.secondary)
                    Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
            .accessibilityIdentifier("about-you-work-memory")
        }
        overviewMemorySummary(summary)
        Section("记忆设置") {
            LabeledContent("使用记忆") { Text(summary.settings.memoryEnabled ? "已开启" : "toggle_off") }
            LabeledContent("显示记忆引用") { Text(summary.settings.showMemoryReferences ? "已开启" : "toggle_off") }
            LabeledContent("保存敏感记忆") { Text(memoryWritePolicy(summary.settings.sensitiveWritePolicy)) }
        }
    }

    @ViewBuilder
    private func overviewMemorySummary(_ summary: MobileUserSummary) -> some View {
        Section("xopc 记住的你") {
            if summary.recent.isEmpty {
                Text("暂无相关记忆").foregroundStyle(.secondary)
            }
            ForEach(summary.recent.prefix(3)) { item in
                UserMemoryRow(configuration: configuration, item: item, onUpdated: memoryUpdated)
            }
            Button("查看全部记忆") { selectSection(1) }
        }
        Section {
            NavigationLink {
                PersonalGoalsView(configuration: configuration)
            } label: {
                Label("目标", systemImage: "flag")
            }
            .accessibilityIdentifier("about-you-goals")
        }
        if let focus = summary.primaryFocus {
            Section("最近在关注") {
                Text(focus.title)
                if let outcome = focus.desiredOutcome, !outcome.isEmpty {
                    Text(outcome).foregroundStyle(.secondary)
                }
            }
        }
        if let rules = summary.rules, !rules.isEmpty {
            Section("我们如何协作") { ForEach(rules) { Text($0.statement) } }
        }
    }

    @ViewBuilder
    private var personalMemory: some View {
        SegmentedTabs(options: [
            SegmentOption(id: "all", title: "全部", accessibilityID: "about-you-filter-all"),
            SegmentOption(id: "explicit", title: "你说过的", accessibilityID: "about-you-filter-explicit"),
            SegmentOption(id: "learned", title: "协作中发现", accessibilityID: "about-you-filter-learned"),
            SegmentOption(id: "review", title: "待确认", accessibilityID: "about-you-filter-review")
        ], selected: filter, label: "筛选", swipeToSelect: true) { filter = $0 }
            .accessibilityIdentifier("about-you-filter-tabs")
            .listRowBackground(Color.clear)
        ForEach(assertions) { item in
            UserMemoryRow(configuration: configuration, item: item, onUpdated: memoryUpdated)
        }
        if let nextCursor {
            Button("加载更多") { Task { await loadAssertions(cursor: nextCursor) } }
        } else if assertions.isEmpty, error == nil {
            ContentUnavailableView("暂无相关记忆", systemImage: "text.bubble")
        }
    }

    @ViewBuilder
    private var workMemory: some View {
        if workFailed {
            Section {
                Text("暂时无法读取工作记忆。").foregroundStyle(.secondary)
                Button("重试") { Task { await loadWork() } }
            }
        } else if workLoading, workItems.isEmpty {
            ProfileSkeleton()
        } else if workItems.isEmpty {
            ContentUnavailableView("还没有工作记忆", systemImage: "doc.text")
        }
        if !workItems.isEmpty {
            Section {
                ForEach(workItems) { item in
                    WorkMemoryRow(item: item, expandedWorkID: $expandedWorkID)
                }
                if let workCursor, !workFailed {
                    Button("加载更多") { Task { await loadWork(cursor: workCursor) } }
                        .disabled(workLoading)
                }
            }
        }
    }
}

@MainActor
extension UserUnderstandingView {
    private func refreshSection(_ page: Int) async {
        switch page {
        case 1: await loadAssertions()
        case 2: await loadWork()
        default: await refreshSummary()
        }
    }

    private func memoryWritePolicy(_ policy: String) -> LocalizedStringKey {
        switch policy {
        case "allow": "允许"
        case "deny": "禁止"
        case "confirm": "先确认"
        default: "未设置"
        }
    }

    private func loadWork(cursor: String? = nil) async {
        if cursor != nil, workLoading || cursor != workCursor {
            return
        }
        workLoading = true
        workFailed = false
        defer { workLoading = false }
        do {
            let page = try await GatewayClient(configuration: configuration).fetchWorkMemory(cursor: cursor)
            try Task.checkCancellation()
            workItems = cursor == nil ? page.items : workItems + page.items
            workCursor = page.nextCursor == cursor ? nil : page.nextCursor
        } catch is CancellationError {
            return
        } catch {
            if !Task.isCancelled {
                workFailed = true
            }
        }
    }

    private func selectSection(_ selection: Int) {
        guard section != selection else { return }
        searchFocused = false
        searchOpen = false
        query = ""
        savedSection = selection
    }

    private func memoryUpdated() {
        Task {
            await refreshSummary()
            if section == 1 {
                await loadAssertions()
            }
        }
    }

    private func refreshSummary() async {
        do {
            summary = try await GatewayClient(configuration: configuration).fetchMobileUserSummary()
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    private func loadAssertions(cursor: String? = nil) async {
        do {
            let page = try await GatewayClient(configuration: configuration)
                .fetchUserAssertions(filter: filter, query: query, cursor: cursor)
            assertions = cursor == nil ? page.items : assertions + page.items
            nextCursor = page.nextCursor
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

private struct WorkMemoryRow: View {
    let item: MobileWorkMemory
    @Binding var expandedWorkID: String?
    @Environment(\.mobileTheme) private var theme

    var body: some View {
        DisclosureGroup(isExpanded: Binding(get: { expandedWorkID == item.id }, set: { expanded in
            expandedWorkID = expanded ? item.id : nil
        })) {
            Text(item.content).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(workMemoryKind(item.kind)).fontWeight(.semibold).foregroundStyle(theme.action)
                    Text(userMemoryScope(item.scope.type)).foregroundStyle(.secondary)
                }
                .font(.footnote)
                if expandedWorkID != item.id {
                    Text(item.content).lineLimit(3)
                }
                Text(item.updatedAt.millisecondsDate, format: .dateTime.year().month().day())
                    .font(.caption).foregroundStyle(.secondary)
                if item.status != "active" {
                    Text(item.status == "stale" ? "已过时" : "待你确认")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)
        }
        .accessibilityIdentifier("work-memory-\(item.id)")
    }

    private func workMemoryKind(_ kind: String) -> LocalizedStringKey {
        switch kind {
        case "decision": "决定"
        case "task_lesson": "经验"
        case "work_thread": "工作线索"
        case "project_fact", "workspace_fact": "事实"
        case "commitment": "承诺"
        case "open_question": "待解决问题"
        default: "记忆"
        }
    }
}

private struct UserMemoryRow: View {
    let configuration: GatewayConfiguration
    let item: MobileUserAssertion
    let onUpdated: () -> Void

    var body: some View {
        NavigationLink {
            UserAssertionDetailView(configuration: configuration, id: item.id, onChanged: onUpdated)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(item.statement).lineLimit(3)
                Text(userMemorySource(item))
                    .mobileTextStyle(.caption).foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
    }
}

private struct ProfileSkeleton: View {
    var body: some View {
        MobileListSkeleton(rows: 3)
    }
}

private struct GoalEditorView: View {
    let configuration: GatewayConfiguration
    let goal: MobileUserGoal?
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var outcome = ""
    @State private var status = "active"
    @State private var dueDate = Date()
    @State private var hasDueDate = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("目标", text: $title)
                    TextField("期望结果", text: $outcome, axis: .vertical).lineLimit(3 ... 6)
                    Toggle("设置完成日期", isOn: $hasDueDate)
                    if hasDueDate {
                        DatePicker("日期", selection: $dueDate, displayedComponents: .date)
                    }
                    if goal != nil {
                        Picker("状态", selection: $status) {
                            Text("进行中").tag("active")
                            Text("已暂停").tag("paused")
                            Text("已完成").tag("achieved")
                        }
                    }
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
            }
            .navigationTitle(goal == nil ? "添加目标" : "编辑目标")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task {
                            busy = true
                            do {
                                try await GatewayClient(configuration: configuration).saveUserGoal(
                                    id: goal?.id, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                                    desiredOutcome: outcome.trimmingCharacters(in: .whitespacesAndNewlines),
                                    status: status,
                                    targetAt: hasDueDate ? Int64(dueDate.timeIntervalSince1970 * 1000) : nil
                                )
                                await onSaved()
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    }
                    .disabled(busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || outcome.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                title = goal?.title ?? ""
                outcome = goal?.desiredOutcome ?? ""
                status = goal?.status ?? "active"
                if let targetAt = goal?.targetAt {
                    hasDueDate = true
                    dueDate = Date(timeIntervalSince1970: Double(targetAt) / 1000)
                }
            }
        }
    }
}

private struct ProfileEditorView: View {
    let configuration: GatewayConfiguration
    let profile: MobileUserProfile
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var role = ""
    @State private var pronouns = ""
    @State private var timezone = ""
    @State private var language = "zh"
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    TextField("希望 xopc 如何称呼你", text: $name)
                    TextField("角色", text: $role)
                    TextField("称谓", text: $pronouns)
                    TextField("时区", text: $timezone)
                    Picker("回复语言", selection: $language) {
                        Text("中文").tag("zh")
                        Text("English").tag("en")
                    }
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
            }
            .navigationTitle("编辑基本信息")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task {
                            do {
                                try await GatewayClient(configuration: configuration).updateUserProfile(
                                    callName: name, role: role, pronouns: pronouns, timezone: timezone, locale: language
                                )
                                await onSaved()
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }
                    }
                }
            }
            .onAppear {
                name = profile.callName ?? ""
                role = profile.role ?? ""
                pronouns = profile.pronouns ?? ""
                timezone = profile.timezone ?? TimeZone.current.identifier
                language = profile.locale?.hasPrefix("en") == true ? "en" : "zh"
            }
        }
    }
}

private struct UserAssertionDetailView: View {
    let configuration: GatewayConfiguration
    let id: String
    var onChanged: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @Environment(\.mobileTheme) private var theme
    @State private var item: MobileUserAssertion?
    @State private var statement = ""
    @State private var editing = false
    @State private var error: String?
    @State private var showDelete = false

    var body: some View {
        Form {
            if let item {
                Section("记住的内容") {
                    if editing {
                        TextEditor(text: $statement).frame(minHeight: 160)
                    } else {
                        Text(item.statement).mobileTextStyle(.sectionTitle)
                    }
                }
                Section {
                    Text(userMemorySource(item)).foregroundStyle(.secondary)
                    DisclosureGroup("来源与使用") {
                        if let sources = item.sources?.compactMap(\.label), !sources.isEmpty {
                            Text(sources.joined(separator: " · "))
                        } else {
                            Text("暂无更详细的来源记录")
                        }
                        LabeledContent {
                            Text(userMemoryScope(item.scope?.type))
                        } label: {
                            Text("在哪里使用")
                        }
                    }
                }
                Section {
                    if editing {
                        Button("保存修改") { Task { await save() } }
                            .disabled(statement.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        Button("取消") { editing = false }
                    } else {
                        Button("编辑") { statement = item.statement; editing = true }
                        Button("删除这条记忆", role: .destructive) { showDelete = true }
                    }
                }
            } else if error == nil {
                ProgressView()
            }
            if let error {
                Text(error).foregroundStyle(.red)
            }
        }
        .scrollContentBackground(.hidden)
        .background(theme.canvas.ignoresSafeArea())
        .mobilePageTitle(Text("记忆详情"))
        .task { await load() }
        .confirmationDialog("删除这条记忆？", isPresented: $showDelete) {
            Button("删除", role: .destructive) { Task { await remove() } }
        } message: { Text("原始对话和文件不会删除。") }
    }

    @MainActor private func load() async {
        do { item = try await GatewayClient(configuration: configuration).fetchUserAssertion(id: id) }
        catch { self.error = error.localizedDescription }
    }

    @MainActor private func save() async {
        do {
            try await GatewayClient(configuration: configuration).updateUserAssertion(id: id, statement: statement)
            editing = false
            onChanged()
            await load()
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func remove() async {
        do {
            try await GatewayClient(configuration: configuration).deleteUserAssertion(id: id)
            onChanged()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

private func userMemorySource(_ item: MobileUserAssertion) -> LocalizedStringKey {
    if ["candidate", "needs_review", "conflicted"].contains(item.status) {
        return "待你确认"
    }
    switch item.authority {
    case "user_explicit": return "你说过的"
    case "system_inferred": return "xopc 的推测"
    case "external_untrusted": return "来自关联资料"
    case "user_observed": return "协作中发现"
    default: return "来源未记录"
    }
}

private func userMemoryScope(_ scope: String?) -> LocalizedStringKey {
    switch scope {
    case "global": "所有对话"
    case "agent": "当前助手"
    case "project": "当前项目"
    case "workspace": "当前工作区"
    case "session": "当前对话"
    default: "指定范围"
    }
}

struct AboutView: View {
    @Environment(\.locale) private var locale
    @Environment(\.mobileTheme) private var theme
    private var version: String? {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    }

    var body: some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image("LaunchLogo").resizable().scaledToFit().frame(width: 64, height: 64).accessibilityHidden(true)
                    Text("xopc").mobileTextStyle(.detailTitle)
                    if let version {
                        Text(version).mobileTextStyle(.secondary).foregroundStyle(.secondary)
                            .accessibilityIdentifier("settings-about-version")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .listRowBackground(Color.clear)
            }
            Section {
                aboutLink("官网", icon: "globe", path: "", id: "website")
                aboutLink("帮助与支持", icon: "questionmark.circle", path: "/support", id: "support")
                aboutLink("隐私政策", icon: "lock", path: "/privacy", id: "privacy")
                aboutLink("用户协议", icon: "doc.text", path: "/terms", id: "terms")
            }
        }
        .scrollContentBackground(.hidden)
        .background(theme.canvas.ignoresSafeArea())
        .listSectionSpacing(16)
        .mobilePageTitle(Text("关于 xopc"))
    }

    @ViewBuilder
    private func aboutLink(_ title: LocalizedStringKey, icon: String, path: String, id: String) -> some View {
        let language = locale.language.languageCode?.identifier == "zh" ? "zh" : "en"
        if let url = URL(string: "https://xopc.ai/\(language)\(path)") {
            Link(destination: url) {
                HStack {
                    Label(title, systemImage: icon).foregroundStyle(.primary)
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.footnote).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }.frame(minHeight: 44)
            }
            .accessibilityIdentifier("settings-about-\(id)")
        }
    }
}
