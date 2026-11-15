import SwiftUI

struct AutomationsView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void

    @State private var items: [AutomationRecord] = []
    @State private var filter = "all"
    @State private var searchText = ""
    @State private var searchOpen = false
    @State private var setupPrompt: String?
    @State private var editingAutomation: AutomationRecord?
    @State private var selectedAutomationID: String?
    @State private var workingID: String?
    @State private var isLoading = false
    @State private var error: String?
    @FocusState private var isSearchFocused: Bool

    var body: some View {
        List {
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
                    ZStack(alignment: .topTrailing) {
                        Button {
                            selectedAutomationID = automation.id
                        } label: {
                            AutomationListRow(automation: automation)
                                .padding(.trailing, 38)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("automation-\(automation.id)")

                        AutomationActionsMenu(automation: automation, inList: true, busy: workingID != nil,
                                              onEdit: { editingAutomation = automation },
                                              onToggle: { Task { await toggle(automation) } },
                                              onDelete: { Task { await delete(automation) } })
                    }
                    .listRowSeparator(.hidden)
                    .listRowBackground(RoundedRectangle(cornerRadius: mobileTheme.corner(18)).fill(mobileTheme.panel))
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                }
            }
            if !isLoading, error == nil, filter == "all", searchText.isEmpty {
                Section("从这里开始") {
                    AutomationExamples(scope: .workspace) { setupPrompt = $0 }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(mobileTheme.canvas)
        .safeAreaInset(edge: .top, spacing: 0) {
            if searchOpen {
                PageSearchField("搜索", text: $searchText, focused: $isSearchFocused,
                                accessibilityID: "automation-search")
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                    .background(mobileTheme.canvas)
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                PageSearchButton("搜索", isOpen: $searchOpen, query: $searchText,
                                 accessibilityID: "automation-open-search")
                Menu {
                    filterOption("全部", id: "all")
                    filterOption("已启用", id: "enabled")
                    filterOption("已暂停", id: "paused")
                    filterOption("需关注", id: "attention")
                } label: {
                    Label("筛选", systemImage: "line.3.horizontal.decrease")
                        .foregroundStyle(filter == "all" ? mobileTheme.foreground : mobileTheme.action)
                }
                .accessibilityIdentifier("automation-filter-menu")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Button {
                isSearchFocused = false
                setupPrompt = ""
            } label: {
                Label("新建自动化", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .disabled(setupPrompt != nil)
            .accessibilityIdentifier("automation-create-in-chat")
            .padding(.horizontal, 16).padding(.vertical, 8).background(mobileTheme.canvas)
        }
        .navigationDestination(item: $selectedAutomationID) { id in
            AutomationDetailView(configuration: configuration, automationID: id, onOpenConversation: onOpenConversation,
                                 onChanged: { Task { await load() } })
        }
        .sheet(item: $editingAutomation, onDismiss: { Task { await load() } }) { automation in
            AutomationEditorView(configuration: configuration, existing: automation)
        }
        .modifier(AutomationSetupPresentation(configuration: configuration, scope: .workspace,
                                              prompt: $setupPrompt, onClosed: { Task { await load() } }))
        .alert("无法读取自动化", isPresented: errorBinding) { Button("好", role: .cancel) {} } message: { Text(error ?? "未知错误") }
    }

    private func filterOption(_ title: LocalizedStringKey, id: String) -> some View {
        Button {
            isSearchFocused = false
            filter = id
        } label: {
            if filter == id {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
        .accessibilityIdentifier("automation-filter-\(id)")
        .accessibilityAddTraits(filter == id ? .isSelected : [])
    }

    private var visibleItems: [AutomationRecord] {
        searchedItems.filter { item in
            switch filter {
            case "enabled": item.enabled
            case "paused": !item.enabled
            case "attention": ["failed", "timeout", "timed_out"].contains(item.state?.lastRunStatus ?? "")
            default: true
            }
        }
    }

    @MainActor private func toggle(_ automation: AutomationRecord) async {
        guard workingID == nil else { return }
        workingID = automation.id
        defer { workingID = nil }
        do {
            let updated = try await GatewayClient(configuration: configuration).setAutomation(automation, enabled: !automation.enabled)
            if let index = items.firstIndex(where: { $0.id == updated.id }) {
                items[index] = updated
            }
            await load()
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func delete(_ automation: AutomationRecord) async {
        guard workingID == nil else { return }
        workingID = automation.id
        defer { workingID = nil }
        do {
            try await GatewayClient(configuration: configuration).deleteAutomation(automation)
            items.removeAll { $0.id == automation.id }
            await load()
        } catch { self.error = error.localizedDescription }
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
            items = MobileListCache.shared.read(.automations, scope: scope) ?? []
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await GatewayClient(configuration: configuration).fetchAutomations()
            try Task.checkCancellation()
            items = loaded
            MobileListCache.shared.write(loaded, to: .automations, scope: scope, requestedAt: requestedAt)
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

private extension AutomationRecord {
    var canEditFromMobile: Bool {
        management == nil && trigger.schedule?.kind == "cron" && action.kind == "agent"
    }

    var canToggleFromMobile: Bool {
        management?.editable?.contains("enabled") ?? (management == nil)
    }

    var canDeleteFromMobile: Bool {
        management?.deletable ?? (management == nil)
    }

    var canRunFromMobile: Bool {
        management?.runnable != false
    }
}

func automationScheduleText(_ automation: AutomationRecord, locale: Locale, expression: String? = nil) -> Text {
    let schedule = automation.trigger.schedule
    if let once = schedule?.onceAt, let date = ISO8601DateFormatter().date(from: once) {
        return Text("仅执行一次 · \(date.formatted(.dateTime.month().day().hour().minute().locale(locale)))")
    }
    if let interval = schedule?.everyMs, interval > 0 {
        if interval.isMultiple(of: 3_600_000) {
            return Text("每 \(interval / 3_600_000) 小时")
        }
        if interval.isMultiple(of: 60000) {
            return Text("每 \(interval / 60000) 分钟")
        }
    }
    if automation.trigger.kind == "manual" {
        return Text("手动触发")
    }
    let custom = Text("自定义计划")
    let fields = (expression ?? schedule?.cronExpression ?? "").split(whereSeparator: \.isWhitespace)
    guard fields.count == 5, fields[3] == "*" else { return custom }
    if fields.dropFirst().allSatisfy({ $0 == "*" }), fields[0].hasPrefix("*/"),
       let interval = Int(fields[0].dropFirst(2)), (1 ... 59).contains(interval), 60.isMultiple(of: interval)
    {
        return Text("每 \(interval) 分钟")
    }
    if fields[0] == "0", fields.suffix(3).allSatisfy({ $0 == "*" }), fields[1].hasPrefix("*/"),
       let interval = Int(fields[1].dropFirst(2)), (1 ... 23).contains(interval), 24.isMultiple(of: interval)
    {
        return Text("每 \(interval) 小时")
    }
    guard fields[0].allSatisfy(\.isNumber), fields[1].allSatisfy(\.isNumber),
          let minute = Int(fields[0]), (0 ... 59).contains(minute), let hour = Int(fields[1]), (0 ... 23).contains(hour)
    else { return custom }
    let time = String(format: "%02d:%02d", hour, minute)
    if fields[2] == "*", fields[4] == "*" {
        return Text("每天 \(time)")
    }
    if fields[2] == "*", fields[4] == "1-5" {
        return Text("工作日 \(time)")
    }
    if fields[2] == "*", fields[4].count == 1, let weekday = Int(fields[4]), (0 ... 7).contains(weekday) {
        let formatter = DateFormatter()
        formatter.locale = locale
        let day = formatter.shortWeekdaySymbols[weekday % 7]
        return Text("每\(day) \(time)")
    }
    if fields[4] == "*", fields[2].allSatisfy(\.isNumber), let day = Int(fields[2]), (1 ... 31).contains(day) {
        return Text("每月 \(day) 日 \(time)")
    }
    return custom
}

private struct AutomationListRow: View {
    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.locale) private var locale
    let automation: AutomationRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(automation.enabled ? LocalizedStringResource("已启用") : LocalizedStringResource("已暂停"))
                .mobileTextStyle(.caption).foregroundStyle(automation.enabled ? mobileTheme.action : Color.secondary)
            Text(automation.name).mobileTextStyle(.rowTitle).lineLimit(2)
            if let summary = automation.description ?? automation.action.instruction ?? automation.action.goal,
               !summary.isEmpty
            {
                Text(summary).mobileTextStyle(.secondary).foregroundStyle(.secondary).lineLimit(3)
            }
            HStack(spacing: 8) {
                Image(systemName: "clock").accessibilityHidden(true)
                automationScheduleText(automation, locale: locale).lineLimit(1)
                if automation.enabled, let next = automation.state?.nextRunAtMs {
                    Spacer(minLength: 4)
                    Text(next.millisecondsDate, format: .dateTime.month().day().hour().minute()).lineLimit(1)
                }
            }
            .mobileTextStyle(.caption).foregroundStyle(.secondary)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct AutomationActionsMenu: View {
    let automation: AutomationRecord
    let inList: Bool
    let busy: Bool
    let onEdit: () -> Void
    let onToggle: () -> Void
    let onDelete: () -> Void
    @State private var confirmingDelete = false

    var body: some View {
        if automation.canEditFromMobile || automation.canDeleteFromMobile || (inList && automation.canToggleFromMobile) {
            Menu {
                if automation.canEditFromMobile {
                    Button("编辑自动化", systemImage: "pencil", action: onEdit)
                        .accessibilityIdentifier("automation-menu-edit")
                }
                if inList, automation.canToggleFromMobile {
                    Button(automation.enabled ? LocalizedStringKey("暂停") : LocalizedStringKey("启用"),
                           systemImage: automation.enabled ? "pause.circle" : "play.circle", action: onToggle)
                        .accessibilityIdentifier("automation-menu-toggle")
                }
                if automation.canDeleteFromMobile {
                    Button("删除", systemImage: "trash", role: .destructive) { confirmingDelete = true }
                        .accessibilityIdentifier("automation-menu-delete")
                }
            } label: {
                Label("自动化操作", systemImage: "ellipsis").labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityIdentifier(inList ? "automation-card-menu-\(automation.id)" : "automation-detail-menu")
            .confirmationDialog("删除自动化？", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("删除", role: .destructive, action: onDelete)
                Button("取消", role: .cancel) {}
            }
        }
    }
}

struct AutomationDetailView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let automationID: String
    let onOpenConversation: (String, String, String) -> Void
    var onChanged: () -> Void = {}
    @Environment(\.dismiss) private var dismiss

    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
                            Group {
                                if dynamicTypeSize.isAccessibilitySize {
                                    VStack(alignment: .leading, spacing: 10) {
                                        automationIcon
                                        automationIdentity(automation)
                                    }
                                } else {
                                    HStack(alignment: .top, spacing: 14) {
                                        automationIcon
                                        automationIdentity(automation)
                                    }
                                }
                            }
                            Group {
                                if dynamicTypeSize.isAccessibilitySize {
                                    VStack(spacing: 12) {
                                        if automation.canRunFromMobile {
                                            runButton
                                        }
                                        if automation.canToggleFromMobile {
                                            enabledButton(automation)
                                        }
                                    }
                                } else {
                                    HStack(spacing: 12) {
                                        if automation.canRunFromMobile {
                                            runButton
                                        }
                                        if automation.canToggleFromMobile {
                                            enabledButton(automation)
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 8)
                    }
                    Section("运行方式") {
                        AutomationDetailValueRow("计划") { automationScheduleText(automation, locale: locale) }
                        if let next = automation.state?.nextRunAtMs {
                            AutomationDetailValueRow("下次运行") {
                                Text(next.millisecondsDate, format: .dateTime.month().day().hour().minute())
                            }
                        }
                        if let last = automation.state?.lastRunAtMs {
                            AutomationDetailValueRow("上次运行") {
                                Text(last.millisecondsDate, format: .dateTime.month().day().hour().minute())
                            }
                        }
                        if let instruction = automation.action.instruction ?? automation.action.goal ?? automation.description {
                            AutomationInstructionView(instruction: instruction)
                        }
                    }
                    if let status = automation.state?.lastRunStatus {
                        Section("运行状态") {
                            AutomationDetailValueRow("结果") {
                                Text(LocalizedStringKey(status))
                            }
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
        .mobilePageTitle(Text("自动化"))
        .toolbar {
            if let automation {
                ToolbarItem(placement: .topBarTrailing) {
                    AutomationActionsMenu(automation: automation, inList: false, busy: isWorking,
                                          onEdit: { editingAutomation = automation }, onToggle: {},
                                          onDelete: { Task { await delete(automation) } })
                }
            }
        }
        .task { await load() }
        .sheet(item: $editingAutomation, onDismiss: { Task { await load(); onChanged() } }) { automation in
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

    private var automationIcon: some View {
        Image(systemName: "clock")
            .font(.title2)
            .foregroundStyle(.tint)
            .frame(width: 48, height: 48)
            .background(mobileTheme.action.opacity(0.10), in: .circle)
            .accessibilityHidden(true)
    }

    private func automationIdentity(_ automation: AutomationRecord) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(automation.name)
                .mobileTextStyle(.detailTitle)
                .fixedSize(horizontal: false, vertical: true)
            Text(automation.enabled
                ? LocalizedStringResource("已启用")
                : LocalizedStringResource("已暂停"))
                .mobileTextStyle(.secondary)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var runButton: some View {
        Button { Task { await run() } } label: {
            Text("立即运行")
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(.borderedProminent)
        .disabled(isWorking)
    }

    private func enabledButton(_ automation: AutomationRecord) -> some View {
        Button {
            Task { await setEnabled(!automation.enabled) }
        } label: {
            Text(automation.enabled
                ? LocalizedStringResource("暂停")
                : LocalizedStringResource("启用"))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(.bordered)
        .disabled(isWorking)
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
        do {
            self.automation = try await GatewayClient(configuration: configuration).setAutomation(automation, enabled: enabled)
            onChanged()
        } catch { actionError = error.localizedDescription }
    }

    @MainActor private func delete(_ automation: AutomationRecord) async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await GatewayClient(configuration: configuration).deleteAutomation(automation)
            onChanged()
            dismiss()
        } catch { actionError = error.localizedDescription }
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

private struct AutomationDetailValueRow<Value: View>: View {
    let label: LocalizedStringKey
    @ViewBuilder let value: Value

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(_ label: LocalizedStringKey, @ViewBuilder value: () -> Value) {
        self.label = label
        self.value = value()
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 6) {
                    Text(label)
                    value.foregroundStyle(.secondary)
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(label)
                    Spacer(minLength: 12)
                    value
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

private struct AutomationInstructionView: View {
    let instruction: String

    @State private var isExpanded = false

    private let previewLimit = 240

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: displayedInstruction)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .accessibilityIdentifier("automation-definition-body")
            if instruction.count > previewLimit {
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
                .foregroundStyle(.tint)
                .frame(maxWidth: .infinity, minHeight: 48)
                .accessibilityIdentifier("automation-definition-toggle")
            }
        }
    }

    private var displayedInstruction: String {
        guard !isExpanded, instruction.count > previewLimit else { return instruction }
        return String(instruction.prefix(previewLimit)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }
}
