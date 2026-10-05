import SwiftUI

struct AutomationsView: View {
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void

    @State private var items: [AutomationRecord] = []
    @State private var filter = "all"
    @State private var searchText = ""
    @State private var isCreating = false
    @State private var isLoading = false
    @State private var error: String?
    @FocusState private var isSearchFocused: Bool

    var body: some View {
        List {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    TextField("搜索", text: $searchText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($isSearchFocused)
                        .accessibilityIdentifier("automation-search")
                    if !searchText.isEmpty {
                        Button("清除搜索", systemImage: "xmark.circle.fill") { searchText = "" }
                            .labelStyle(.iconOnly)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .background(Color(.secondarySystemGroupedBackground), in: .capsule)
                Button("刷新", systemImage: "arrow.clockwise") {
                    isSearchFocused = false
                    Task { await load() }
                }
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
                .background(Color(.secondarySystemGroupedBackground), in: .circle)
            }
            .listRowBackground(Color.clear)
            HStack(spacing: 8) {
                filterButton("全部", value: "all", count: searchedItems.count)
                filterButton("已启用", value: "enabled", count: searchedItems.filter(\.enabled).count)
                filterButton("已暂停", value: "paused", count: searchedItems.filter { !$0.enabled }.count)
            }
            .listRowBackground(Color.clear)
            VStack(alignment: .leading, spacing: 4) {
                Text("管理定时运行、状态与最近结果").font(.subheadline.weight(.semibold))
                Text("已加载 \(items.count) 项").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color.blue.opacity(0.08), in: .rect(cornerRadius: 16))
            .listRowBackground(Color.clear)
            if isLoading, items.isEmpty {
                ProgressListSkeleton()
            } else if visibleItems.isEmpty {
                if searchText.isEmpty {
                    ContentUnavailableView("暂无自动化", systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90",
                                           description: Text("已配置的自动化会显示在这里。"))
                        .listRowBackground(Color.clear)
                } else {
                    ContentUnavailableView("没有匹配的自动化", systemImage: "magnifyingglass",
                                           description: Text("试试其他关键词或清除搜索。"))
                        .listRowBackground(Color.clear)
                }
            } else {
                ForEach(visibleItems) { automation in
                    NavigationLink {
                        AutomationDetailView(configuration: configuration, automationID: automation.id,
                                             onOpenConversation: onOpenConversation)
                    } label: {
                        AutomationListRow(automation: automation)
                    }
                    .accessibilityIdentifier("automation-\(automation.id)")
                    .listRowSeparator(.hidden)
                    .listRowBackground(RoundedRectangle(cornerRadius: 16).fill(Color(.secondarySystemGroupedBackground)))
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color(.systemGroupedBackground))
        .refreshable { await load() }
        .task { await load() }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("新建自动化", systemImage: "plus") { isCreating = true }
            }
        }
        .sheet(isPresented: $isCreating, onDismiss: { Task { await load() } }) {
            AutomationEditorView(configuration: configuration)
        }
        .alert("无法读取自动化", isPresented: errorBinding) { Button("好", role: .cancel) {} } message: { Text(error ?? "未知错误") }
    }

    private var visibleItems: [AutomationRecord] {
        searchedItems.filter { filter == "all" || (filter == "enabled") == $0.enabled }
    }

    private var searchedItems: [AutomationRecord] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return items }
        return items.filter { $0.name.localizedCaseInsensitiveContains(query)
            || $0.description?.localizedCaseInsensitiveContains(query) == true
            || $0.action.instruction?.localizedCaseInsensitiveContains(query) == true
            || $0.action.goal?.localizedCaseInsensitiveContains(query) == true
        }
    }

    private func filterButton(_ title: LocalizedStringKey, value: String, count: Int) -> some View {
        Button {
            isSearchFocused = false
            filter = value
        } label: {
            HStack(spacing: 5) {
                Text(title).font(.subheadline.weight(.medium))
                Text(count, format: .number).font(.caption)
            }
            .frame(minHeight: 44)
            .padding(.horizontal, 12)
            .background(filter == value ? Color.blue.opacity(0.12) : Color(.secondarySystemGroupedBackground), in: .capsule)
        }
        .buttonStyle(.plain)
        .foregroundStyle(filter == value ? Color.blue : Color.secondary)
        .accessibilityIdentifier("automation-filter-\(value)")
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
        do { items = try await GatewayClient(configuration: configuration).fetchAutomations(); error = nil }
        catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

private struct AutomationListRow: View {
    let automation: AutomationRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "clock")
                    .font(.title3)
                    .foregroundStyle(.blue)
                    .frame(width: 44, height: 44)
                    .background(Color.blue.opacity(0.1), in: .circle)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(automation.name).font(.headline).lineLimit(2)
                    if automation.enabled {
                        Text("已启用").font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        Text("已暂停").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            if let summary = automation.description ?? automation.action.instruction ?? automation.action.goal,
               !summary.isEmpty
            {
                Text(summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 8) {
                Image(systemName: "calendar").accessibilityHidden(true)
                if let next = automation.state?.nextRunAtMs {
                    Text(next.millisecondsDate, format: .dateTime.month().day().hour().minute())
                } else if let cron = automation.trigger.schedule?.cronExpression {
                    Text(cron).lineLimit(1)
                } else {
                    Text("手动触发")
                }
                Spacer(minLength: 8)
                if let status = automation.state?.lastRunStatus {
                    Text(LocalizedStringKey(status))
                }
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }
}

struct AutomationDetailView: View {
    let configuration: GatewayConfiguration
    let automationID: String
    let onOpenConversation: (String, String, String) -> Void

    @Environment(\.locale) private var locale
    @State private var automation: AutomationRecord?
    @State private var runs: [AutomationRunRecord] = []
    @State private var runsError: String?
    @State private var isWorking = false
    @State private var error: String?
    @State private var editingAutomation: AutomationRecord?
    @State private var openedRunID: String?
    @State private var actionError: String?

    var body: some View {
        Group {
            if let automation {
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 18) {
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: "clock")
                                    .font(.title2)
                                    .foregroundStyle(.blue)
                                    .frame(width: 48, height: 48)
                                    .background(Color.blue.opacity(0.1), in: .circle)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(automation.name).font(.title2.bold())
                                    Text(automation.enabled ? "已启用" : "已暂停")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            HStack(spacing: 12) {
                                Button { Task { await run() } } label: {
                                    Text("立即运行").frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(isWorking)
                                Button {
                                    Task { await setEnabled(!automation.enabled) }
                                } label: {
                                    Text(automation.enabled ? "暂停" : "启用").frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.bordered)
                                .disabled(isWorking)
                            }
                        }
                        .padding(.vertical, 8)
                    }
                    Section("运行方式") {
                        let schedule = automation.trigger.schedule
                        let plan = schedule?.cronExpression ?? schedule?.onceAt
                            ?? schedule?.everyMs.map { Duration.milliseconds($0).formatted() } ?? "—"
                        LabeledContent("计划", value: plan)
                        if let next = automation.state?.nextRunAtMs {
                            LabeledContent("下次运行") { Text(next.millisecondsDate, format: .dateTime.month().day().hour().minute()) }
                        }
                        if let last = automation.state?.lastRunAtMs {
                            LabeledContent("上次运行") { Text(last.millisecondsDate, format: .dateTime.month().day().hour().minute()) }
                        }
                        if let instruction = automation.action.instruction ?? automation.action.goal ?? automation.description {
                            AutomationInstructionView(instruction: instruction)
                        }
                    }
                    if automation.trigger.schedule?.kind == "cron", automation.action.kind == "agent" {
                        Section {
                            Button("编辑自动化") { editingAutomation = automation }
                                .frame(maxWidth: .infinity)
                        }
                    }
                    if let status = automation.state?.lastRunStatus {
                        Section("运行状态") {
                            LabeledContent("结果") { Text(LocalizedStringKey(status)) }
                        }
                    }
                    Section("最近运行") {
                        if let runsError {
                            Label(runsError, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                            Button("重试") { Task { await loadRuns() } }
                        }
                        if runs.isEmpty {
                            Text("暂无运行记录").foregroundStyle(.secondary)
                        }
                        ForEach(runs) { run in
                            NavigationLink {
                                AutomationRunDetailView(configuration: configuration, runID: run.id, initialRun: run,
                                                        onOpenConversation: onOpenConversation)
                            } label: {
                                ProgressRow(title: AppLocalization.string(run.status, locale: locale),
                                            subtitle: run.error ?? run.summary,
                                            state: automation.name, date: run.createdAtMs.millisecondsDate,
                                            symbol: run.status == "succeeded" ? "checkmark.circle" : "clock")
                            }
                            .accessibilityIdentifier("automation-run-\(run.id)")
                        }
                    }
                }
            } else if let error {
                ContentUnavailableView("无法读取自动化", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView("正在读取自动化…")
            }
        }
        .navigationTitle("自动化")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $editingAutomation, onDismiss: { Task { await load() } }) { automation in
            AutomationEditorView(configuration: configuration, existing: automation)
        }
        .navigationDestination(isPresented: Binding(get: { openedRunID != nil }, set: {
            if !$0 {
                openedRunID = nil
            }
        })) {
            if let openedRunID {
                AutomationRunDetailView(configuration: configuration, runID: openedRunID, initialRun: nil,
                                        onOpenConversation: onOpenConversation)
            }
        }
        .alert("操作未完成", isPresented: Binding(get: { actionError != nil }, set: {
            if !$0 {
                actionError = nil
            }
        })) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "未知错误")
        }
        .overlay {
            if isWorking {
                ProgressView().padding().background(.regularMaterial, in: .circle)
            }
        }
    }

    @MainActor private func load() async {
        do {
            let client = GatewayClient(configuration: configuration)
            automation = try await client.fetchAutomation(id: automationID)
            error = nil
            await loadRuns()
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func loadRuns() async {
        do {
            runs = try await GatewayClient(configuration: configuration).fetchAutomationRuns(id: automationID)
            runsError = nil
        } catch {
            runsError = error.localizedDescription
        }
    }

    @MainActor private func setEnabled(_ enabled: Bool) async {
        guard let automation else { return }
        isWorking = true
        defer { isWorking = false }
        do { self.automation = try await GatewayClient(configuration: configuration).setAutomation(automation, enabled: enabled) }
        catch { actionError = error.localizedDescription }
    }

    @MainActor private func run() async {
        isWorking = true
        defer { isWorking = false }
        do {
            let runID = try await GatewayClient(configuration: configuration).runAutomation(id: automationID)
            await load()
            openedRunID = runID
        } catch { actionError = error.localizedDescription }
    }
}

private struct AutomationInstructionView: View {
    let instruction: String

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(instruction)
                .lineLimit(isExpanded ? nil : 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .accessibilityIdentifier("automation-definition-body")
            Button {
                isExpanded.toggle()
            } label: {
                if isExpanded {
                    Text("收起完整内容")
                } else {
                    Text("展开完整内容")
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.blue)
            .frame(maxWidth: .infinity, minHeight: 44)
            .accessibilityIdentifier("automation-definition-toggle")
        }
    }
}
