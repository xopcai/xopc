import SwiftUI

struct ProfileView: View {
    let configuration: GatewayConfiguration
    let onOpenGatewaySettings: () -> Void
    var bottomInset: CGFloat = 0

    @Environment(\.locale) private var locale

    @State private var summary: MobileUserSummary?
    @State private var error: String?
    @State private var goalEditorPresented = false
    @State private var selectedGoal: MobileUserGoal?

    var body: some View {
        List {
            if let summary {
                Section {
                    NavigationLink {
                        UserUnderstandingView(configuration: configuration, summary: summary)
                    } label: {
                        HStack(spacing: 14) {
                            Text(String((summary.profile.callName ?? summary.suggestedCallName ?? "X").prefix(2)))
                                .font(.title2.bold()).foregroundStyle(.blue)
                                .frame(width: 64, height: 64)
                                .background(.blue.opacity(0.1), in: .circle)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(summary.profile.callName?.isEmpty == false ? summary.profile.callName ?? "你" : summary.suggestedCallName ?? "你")
                                    .font(.title3.bold())
                                Text(summary.profile.role?.isEmpty == false ? summary.profile.role ?? "" : "你的个人 AI 工作空间")
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Text("\(summary.counts.total) 条理解 · \(summary.counts.review) 条待确认")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 8)
                    }
                }
                Section {
                    ForEach(summary.goals) { goal in
                        Button {
                            selectedGoal = goal
                            goalEditorPresented = true
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(goal.title).font(.headline).foregroundStyle(.primary)
                                if let outcome = goal.desiredOutcome {
                                    Text(outcome).font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    if summary.goals.isEmpty {
                        if let focus = summary.primaryFocus {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(focus.title).font(.headline)
                                if let outcome = focus.desiredOutcome {
                                    Text(outcome).font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                        } else {
                            Button("添加一个当前目标", systemImage: "flag") {
                                selectedGoal = nil
                                goalEditorPresented = true
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text("我的目标")
                        Spacer()
                        Button("添加") { selectedGoal = nil; goalEditorPresented = true }
                    }
                }
                Section("xopc 如何理解你") {
                    Text("你提供的信息和协作中逐渐学到的内容").foregroundStyle(.secondary)
                    HStack {
                        understandingCount(summary.counts.explicit, "你告诉 xopc")
                        understandingCount(summary.counts.learned, "逐渐学到")
                        understandingCount(summary.counts.review, "待确认")
                    }
                    LabeledContent("工作记忆", value: "\(summary.counts.workMemory) 条")
                    NavigationLink("查看全部理解") { UserUnderstandingView(configuration: configuration, summary: summary) }
                }
                if !summary.recent.isEmpty {
                    Section("最近理解") {
                        ForEach(summary.recent) { item in
                            Text(item.statement)
                        }
                    }
                }
                if let rules = summary.rules, !rules.isEmpty {
                    Section("我们如何协作") {
                        ForEach(rules) { rule in Text(rule.statement) }
                    }
                }
            } else if error != nil {
                Section {
                    HStack(spacing: 14) {
                        Text("X").font(.title2.bold()).foregroundStyle(.blue)
                            .frame(width: 64, height: 64).background(.blue.opacity(0.1), in: .circle)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("你").font(.title3.bold())
                            Text("你的个人 AI 工作空间").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 8)
                }
                Section("我的目标") {
                    Text("连接 Gateway 后可查看和管理当前目标").foregroundStyle(.secondary)
                }
                Section("xopc 如何理解你") {
                    Text("你提供的信息和协作中逐渐学到的内容").foregroundStyle(.secondary)
                    Text("连接 Gateway 后可查看个人理解和工作记忆").font(.subheadline).foregroundStyle(.secondary)
                }
                Section {
                    Label("个人理解暂时无法读取", systemImage: "wifi.slash")
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("连接 Gateway") { onOpenGatewaySettings() }
                        Spacer()
                        Button("重试") { Task { await load() } }
                    }
                }
            } else {
                Section { ProfileSkeleton() }
            }
        }
        .contentMargins(.bottom, bottomInset, for: .scrollContent)
        .navigationTitle(AppLocalization.string("我的", locale: locale))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    AppSettingsView(configuration: configuration, onOpenGatewaySettings: onOpenGatewaySettings)
                } label: {
                    Image(systemName: "gearshape").accessibilityLabel("设置")
                }
            }
        }
        .sheet(isPresented: $goalEditorPresented) {
            GoalEditorView(configuration: configuration, goal: selectedGoal) { await load() }
        }
    }

    private func understandingCount(_ value: Int, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(value)").font(.title2.bold())
            Text(title).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @MainActor private func load() async {
        do { summary = try await GatewayClient(configuration: configuration).fetchMobileUserSummary(); error = nil }
        catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

private struct UserUnderstandingView: View {
    let configuration: GatewayConfiguration
    @State var summary: MobileUserSummary
    @State private var section = 0
    @State private var filter = "all"
    @State private var query = ""
    @State private var assertions: [MobileUserAssertion] = []
    @State private var nextCursor: String?
    @State private var editingProfile = false
    @State private var error: String?

    var body: some View {
        List {
            Picker("内容", selection: $section) {
                Text("概览").tag(0)
                Text("理解").tag(1)
            }
            .pickerStyle(.segmented)
            if section == 0 {
                Section("基本信息") {
                    LabeledContent("称呼", value: summary.profile.callName ?? summary.suggestedCallName ?? "你")
                    LabeledContent("角色", value: summary.profile.role ?? "未设置")
                    Button("编辑基本信息") { editingProfile = true }
                }
                Section("当前重点") {
                    Text(summary.primaryFocus?.title ?? "尚未设置当前重点")
                    if let outcome = summary.primaryFocus?.desiredOutcome {
                        Text(outcome).foregroundStyle(.secondary)
                    }
                }
                Section("理解") {
                    LabeledContent("你告诉 xopc", value: "\(summary.counts.explicit)")
                    LabeledContent("逐渐学到", value: "\(summary.counts.learned)")
                    LabeledContent("待确认", value: "\(summary.counts.review)")
                    Button("查看全部理解") { section = 1 }
                }
                Section("最近理解") {
                    ForEach(summary.recent) { item in
                        NavigationLink(item.statement) {
                            UserAssertionDetailView(configuration: configuration, id: item.id)
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
            } else {
                Picker("筛选", selection: $filter) {
                    Text("全部").tag("all")
                    Text("你提供").tag("explicit")
                    Text("逐渐学到").tag("learned")
                    Text("待确认").tag("review")
                }
                .pickerStyle(.segmented)
                ForEach(assertions) { item in
                    NavigationLink {
                        UserAssertionDetailView(configuration: configuration, id: item.id) {
                            Task {
                                await refreshSummary()
                                await loadAssertions()
                            }
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.statement)
                            Text(item.authority == "user_explicit" ? "你提供" : "逐渐学到")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if let nextCursor {
                    Button("加载更多") { Task { await loadAssertions(cursor: nextCursor) } }
                } else if assertions.isEmpty {
                    ContentUnavailableView("暂无理解", systemImage: "text.bubble",
                                           description: Text("你与 xopc 协作时，有用的偏好和信息会出现在这里。"))
                }
            }
            if error != nil { Text("内容暂时无法读取，请下拉重试").foregroundStyle(.secondary) }
        }
        .navigationTitle("关于你")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "搜索理解")
        .task(id: "\(section):\(filter):\(query)") {
            guard section == 1 else { return }
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            if !Task.isCancelled { await loadAssertions() }
        }
        .refreshable { await loadAssertions() }
        .sheet(isPresented: $editingProfile) {
            ProfileEditorView(configuration: configuration, profile: summary.profile) {
                await refreshSummary()
            }
        }
    }

    @MainActor private func refreshSummary() async {
        do { summary = try await GatewayClient(configuration: configuration).fetchMobileUserSummary() }
        catch { self.error = error.localizedDescription }
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
                    if hasDueDate { DatePicker("日期", selection: $dueDate, displayedComponents: .date) }
                    if goal != nil {
                        Picker("状态", selection: $status) {
                            Text("进行中").tag("active")
                            Text("已暂停").tag("paused")
                            Text("已完成").tag("achieved")
                        }
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
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
                if let error { Text(error).foregroundStyle(.red) }
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
                Section("xopc 的理解") {
                    if editing { TextEditor(text: $statement).frame(minHeight: 160) }
                    else { Text(item.statement).font(.title3) }
                }
                Section("依据与范围") {
                    LabeledContent("来源", value: item.sources?.compactMap(\.label).joined(separator: " · ") ?? "系统推断")
                    LabeledContent("范围", value: item.scope?.type ?? "全局")
                    if let confidence = item.confidence {
                        LabeledContent("置信度", value: "\(Int(confidence * 100))%")
                    }
                }
                Section {
                    if editing {
                        Button("保存修改") { Task { await save() } }
                            .disabled(statement.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        Button("取消") { editing = false }
                    } else {
                        Button("编辑") { statement = item.statement; editing = true }
                        Button("删除这条理解", role: .destructive) { showDelete = true }
                    }
                }
            } else if error == nil { ProgressView() }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("理解详情")
        .task { await load() }
        .confirmationDialog("删除这条理解？", isPresented: $showDelete) {
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

struct AboutView: View {
    var body: some View {
        List {
            LabeledContent("应用", value: "xopc")
            LabeledContent("客户端", value: "原生 iOS")
            LabeledContent("最低系统", value: "iOS 17")
        }
        .navigationTitle("关于 xopc")
    }
}
