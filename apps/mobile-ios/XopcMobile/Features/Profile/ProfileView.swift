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
                        (error.map { Text(verbatim: $0) } ?? Text("配置我的助手"))
                            .mobileTextStyle(.caption).foregroundStyle(error == nil ? Color.secondary : .red)
                    } else {
                        Text("创建我的助手").foregroundStyle(.primary)
                        if let error {
                            Text(error).mobileTextStyle(.caption).foregroundStyle(.red)
                        }
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

    var body: some View {
        List {
            if let summary {
                ForEach(summary.goals) { goal in
                    Button {
                        selectedGoal = goal
                        editing = true
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(goal.title).mobileTextStyle(.rowTitle).foregroundStyle(.primary)
                            if let outcome = goal.desiredOutcome, !outcome.isEmpty {
                                Text(outcome).mobileTextStyle(.secondary).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if summary.goals.isEmpty {
                    if let focus = summary.primaryFocus {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(focus.title).mobileTextStyle(.rowTitle)
                            if let outcome = focus.desiredOutcome, !outcome.isEmpty {
                                Text(outcome).mobileTextStyle(.secondary).foregroundStyle(.secondary)
                            }
                        }
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
        .mobilePageTitle(Text("目标"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("添加", systemImage: "plus") { selectedGoal = nil; editing = true }
                    .disabled(summary == nil)
                    .accessibilityIdentifier("settings-goal-add")
            }
        }
        .task(id: configuration) { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $editing) {
            GoalEditorView(configuration: configuration, goal: selectedGoal) { await load() }
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
    @State private var section = 0
    @State private var filter = "all"
    @State private var query = ""
    @State private var searchOpen = false
    @FocusState private var searchFocused: Bool
    @Environment(\.mobileTheme) private var theme
    @State private var assertions: [MobileUserAssertion] = []
    @State private var nextCursor: String?
    @State private var editingProfile = false
    @State private var error: String?

    var body: some View {
        List {
            if section == 0, let summary {
                Section("基本信息") {
                    LabeledContent("称呼", value: summary.profile.callName ?? summary.suggestedCallName ?? "你")
                    if let role = summary.profile.role, !role.isEmpty {
                        LabeledContent("角色", value: role)
                    }
                    Button("编辑基本信息") { editingProfile = true }
                }
                Section {
                    Text("记住你的偏好。记错了，随时改。")
                        .foregroundStyle(.secondary)
                    if summary.recent.isEmpty {
                        Text("试着告诉 xopc「回答时先给结论」，让它记住你的偏好。")
                    }
                    ForEach(summary.recent.prefix(3)) { item in
                        memoryRow(item)
                    }
                    Button("查看全部记忆") { selectSection(1) }
                } header: {
                    Text("xopc 记住的你")
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
                Section("工作记忆") {
                    LabeledContent("已保存", value: "\(summary.counts.workMemory) 条")
                    Text("事实、决定和经验保存在资料库中。").foregroundStyle(.secondary)
                }
            } else if section == 1 {
                SegmentedTabs(options: [
                    SegmentOption(id: "all", title: "全部", accessibilityID: "about-you-filter-all"),
                    SegmentOption(id: "explicit", title: "你说过的", accessibilityID: "about-you-filter-explicit"),
                    SegmentOption(id: "learned", title: "协作中发现", accessibilityID: "about-you-filter-learned"),
                    SegmentOption(id: "review", title: "待确认", accessibilityID: "about-you-filter-review")
                ], selected: filter, label: "筛选") { filter = $0 }
                    .accessibilityIdentifier("about-you-filter-tabs")
                    .listRowBackground(Color.clear)
                ForEach(assertions) { item in
                    memoryRow(item)
                }
                if let nextCursor {
                    Button("加载更多") { Task { await loadAssertions(cursor: nextCursor) } }
                } else if assertions.isEmpty {
                    ContentUnavailableView("暂无相关记忆", systemImage: "text.bubble",
                                           description: Text("试试其他筛选，或在聊天中告诉 xopc 你的偏好。"))
                }
            }
            if error != nil {
                Text("内容暂时无法读取，请下拉重试").foregroundStyle(.secondary)
            } else if section == 0, summary == nil {
                ProfileSkeleton()
            }
        }
        .mobilePageTitle(Text("隐私与记忆")) {
            MobilePageTitleMenu(options: [
                SegmentOption(id: 0, title: "概览", accessibilityID: "about-you-tab-overview"),
                SegmentOption(id: 1, title: "记住的你", accessibilityID: "about-you-tab-understanding")
            ], selected: section, identifier: "about-you-menu", onSelect: selectSection)
        }
        .toolbar {
            if section == 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    PageSearchButton("搜索记忆", isOpen: $searchOpen, query: $query,
                                     accessibilityID: "about-you-search-toggle")
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if section == 1, searchOpen {
                PageSearchField("搜索记忆", text: $query, focused: $searchFocused, accessibilityID: "about-you-search")
                    .padding(.horizontal, 20).padding(.bottom, 8).background(theme.canvas)
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
        .refreshable {
            await refreshSummary()
            if section == 1 {
                await loadAssertions()
            }
        }
        .sheet(isPresented: $editingProfile) {
            if let summary {
                ProfileEditorView(configuration: configuration, profile: summary.profile) { await refreshSummary() }
            }
        }
    }

    private func selectSection(_ selection: Int) {
        guard section != selection else { return }
        searchFocused = false
        searchOpen = false
        query = ""
        section = selection
    }

    private func memoryRow(_ item: MobileUserAssertion) -> some View {
        NavigationLink {
            UserAssertionDetailView(configuration: configuration, id: item.id) {
                Task {
                    await refreshSummary()
                    if section == 1 {
                        await loadAssertions()
                    }
                }
            }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(item.statement).lineLimit(3)
                Text(userMemorySource(item))
                    .mobileTextStyle(.caption).foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
    }

    @MainActor private func refreshSummary() async {
        do {
            summary = try await GatewayClient(configuration: configuration).fetchMobileUserSummary()
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    @MainActor private func loadAssertions(cursor: String? = nil) async {
        do {
            let page = try await GatewayClient(configuration: configuration)
                .fetchUserAssertions(filter: filter, query: query, cursor: cursor)
            assertions = cursor == nil ? page.items : assertions + page.items
            nextCursor = page.nextCursor
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

private struct ProfileSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) { Text("用户名称").font(.title2); Text("正在读取个人理解") }
            .redacted(reason: .placeholder)
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
                    Picker("语言", selection: $language) {
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
