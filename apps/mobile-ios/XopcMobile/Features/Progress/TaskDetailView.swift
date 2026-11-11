import SwiftUI

struct TaskDetailView: View {
    let configuration: GatewayConfiguration
    let taskID: String

    @State private var detail: TaskDetailEnvelope?
    @State private var error: String?
    @State private var showingConversation = false

    var body: some View {
        Group {
            if let detail {
                List {
                    Section {
                        Text(detail.task.title).mobileTextStyle(.rowTitle)
                        LabeledContent("运行状态") { Text(LocalizedStringKey(detail.operationalState)) }
                    }
                    if let attention = detail.attention, !attention.isEmpty {
                        Section("需要你处理") {
                            ForEach(Array(attention.enumerated()), id: \.offset) { entry in
                                Text(entry.element.summary)
                            }
                        }
                    }
                    if let receipt = detail.receipts?.max(by: { ($0.finalizedAt ?? 0) < ($1.finalizedAt ?? 0) }),
                       let summary = receipt.summary, !summary.isEmpty {
                        Section("执行结果") { Text(summary).textSelection(.enabled) }
                    }
                    if let objective = detail.task.contract?.objective ?? detail.task.body, !objective.isEmpty {
                        Section("目标") { Text(objective).textSelection(.enabled) }
                    }
                    if let criteria = detail.task.contract?.acceptanceCriteria, !criteria.isEmpty {
                        Section("验收标准") {
                            ForEach(Array(criteria.enumerated()), id: \.offset) { entry in Text(entry.element) }
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    Button("继续任务") { showingConversation = true }
                        .buttonStyle(.borderedProminent).frame(minHeight: 44)
                        .accessibilityIdentifier("task-detail-continue")
                }
                .refreshable { await load() }
            } else if let error {
                ContentUnavailableView {
                    Label("无法读取任务", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("重试") { Task { await load() } }
                }
            } else {
                ProgressListSkeleton()
            }
        }
        .navigationTitle("任务详情")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $showingConversation) {
            TaskConversationView(configuration: configuration, taskID: taskID)
        }
        .task(id: taskID) { await load() }
        .onChange(of: showingConversation) { _, showing in
            if !showing { Task { await load() } }
        }
    }

    private func load() async {
        do {
            detail = try await GatewayClient(configuration: configuration).fetchTask(id: taskID)
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

struct TaskConversationView: View {
    let configuration: GatewayConfiguration
    let taskID: String
    var returnLabel: LocalizedStringKey?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var detail: TaskDetailEnvelope?
    @State private var conversation: ConversationSelection?
    @State private var nestedTaskID: String?
    @State private var voiceCall = RealtimeVoiceCall()
    @State private var error: String?
    @State private var overviewExpanded = false
    @State private var showingStatus = false
    @State private var optionsRevision = 0
    @State private var searchRevision = 0
    @State private var editingTask: TaskRecord?
    @State private var confirmsCancel = false
    @State private var composerHeight: CGFloat = 120
    @State private var isWorking = false

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                if let conversation {
                    AssistantView(
                        configuration: configuration, isActive: true, realtimeVoiceCall: voiceCall,
                        conversation: conversation, personalAgent: nil, quickChatHandoff: nil,
                        onStartConversation: { _ in }, onStartScopedConversation: { _, _, _ in },
                        onConversationUpdated: { self.conversation = $0 }, onQuickChatHandled: { _ in },
                        onPersonalAgentUpdated: { _ in }, onOpenSettings: { optionsRevision += 1 },
                        onInputFocusChanged: { focused in
                            if focused {
                                overviewExpanded = false
                            }
                        },
                        showsFloatingHeader: false, sessionActionsRequest: optionsRevision, messageSearchRequest: searchRevision
                    ) { composer, _ in
                        composer.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { composerHeight = $0 }
                    }
                } else if let error {
                    ContentUnavailableView {
                        Label("无法读取任务", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: {
                        Button("重试") { Task { await load() } }
                    }
                } else {
                    VStack(spacing: 20) {
                        ForEach(0 ..< 4) { _ in
                            RoundedRectangle(cornerRadius: 8).fill(.quaternary).frame(height: 64)
                        }
                        Spacer()
                    }.padding(.horizontal, 20).padding(.top, 88).redacted(reason: .placeholder)
                }
                if overviewExpanded {
                    Color.black.opacity(0.12)
                        .padding(.top, 64).padding(.bottom, composerHeight)
                        .onTapGesture { setExpanded(false) }
                        .accessibilityLabel("收起任务详情")
                }
                VStack(spacing: 0) {
                    taskHeader
                    if overviewExpanded, let detail {
                        overview(detail)
                            .frame(height: max(0, min(geometry.size.height * 0.5, geometry.size.height - composerHeight - 64)))
                            .background(Color(uiColor: .secondarySystemGroupedBackground))
                            .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: 14, bottomTrailingRadius: 14))
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            if case let .route("tasks", id) = ChatMessageLink.resolve(url.absoluteString) {
                if id != taskID { nestedTaskID = id }
            } else {
                openURL(url)
            }
            return .handled
        })
        .navigationDestination(item: $nestedTaskID) { id in
            TaskConversationView(configuration: configuration, taskID: id)
        }
        .navigationTitle("任务对话")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(returnLabel == nil ? .visible : .hidden, for: .navigationBar)
        .task(id: taskID) { await load() }
        .task(id: conversation?.id) {
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(8)) } catch { return }
                guard editingTask == nil, !showingStatus, !isWorking else { continue }
                await refresh()
            }
        }
        .sheet(item: $editingTask, onDismiss: { Task { await refresh() } }) { task in
            TaskEditorView(configuration: configuration, task: task)
        }
        .sheet(isPresented: $showingStatus, onDismiss: { Task { await refresh() } }) {
            if let detail {
                TaskStatusView(configuration: configuration, detail: detail)
            }
        }
        .fullScreenCover(isPresented: Binding(get: { voiceCall.phase != .idle && voiceCall.expanded }, set: {
            if !$0 {
                voiceCall.minimize()
            }
        })) { RealtimeVoiceCallView(call: voiceCall) }
        .confirmationDialog("取消任务？", isPresented: $confirmsCancel, titleVisibility: .visible) {
            Button("取消任务", role: .destructive) { Task { await cancelTask() } }
            Button("保留任务", role: .cancel) {}
        } message: { Text("结束此任务，不标记为完成。之后可以重新打开。") }
        .alert("操作失败", isPresented: Binding(get: { conversation != nil && error != nil }, set: {
            if !$0 {
                error = nil
            }
        })) { Button("好", role: .cancel) { error = nil } } message: { Text(error ?? "") }
    }

    private var latestReceipt: TaskReceipt? {
        detail?.receipts?.max(by: { ($0.finalizedAt ?? 0) < ($1.finalizedAt ?? 0) })
    }

    private var taskHeader: some View {
        HStack(spacing: 4) {
            if let returnLabel {
                Button { dismiss() } label: { Image(systemName: "chevron.backward").frame(width: 44, height: 44).contentShape(.rect) }
                    .accessibilityLabel(Text(returnLabel)).accessibilityIdentifier("task-chat-close")
            }
            Button { setExpanded(!overviewExpanded) } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(detail?.task.title ?? AppLocalization.resolve("任务详情")).font(.subheadline.weight(.medium)).lineLimit(1)
                        if let detail {
                            HStack(spacing: 4) {
                                Text(LocalizedStringKey(detail.task.resolution == "done" ? "已完成"
                                        : detail.task.resolution == "cancelled" ? "cancelled" : detail.task.phase))
                                if let summary = latestReceipt?.summary, !summary.isEmpty {
                                    Text("·"); Text(summary).lineLimit(1)
                                }
                            }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: overviewExpanded ? "chevron.up" : "chevron.down").font(.caption)
                }.frame(minHeight: 48).contentShape(.rect)
            }.disabled(detail == nil).accessibilityIdentifier("task-chat-summary-toggle")
                .accessibilityValue(overviewExpanded ? "展开" : "收起")
            Menu {
                if let detail {
                    Button("编辑") { editingTask = detail.task }
                    Button("调整状态") { showingStatus = true }
                    if detail.allowedCommands?.contains("close") == true {
                        Button("取消任务", role: .destructive) { confirmsCancel = true }
                    }
                }
                Button("搜索消息") { searchRevision += 1 }
                Button("会话选项") { optionsRevision += 1 }
                Button("刷新") { Task { await refresh() } }
            } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(.rect) }
                .disabled(isWorking).accessibilityLabel("更多").accessibilityIdentifier("task-chat-menu")
        }.buttonStyle(.plain).padding(.horizontal, 8).frame(minHeight: 64)
            .background(Color(uiColor: .systemGroupedBackground))
    }

    private func overview(_ detail: TaskDetailEnvelope) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let attention = detail.attention, !attention.isEmpty {
                    overviewSection("需要留意") {
                        ForEach(attention.enumerated().map { TaskAttentionDisplay(index: $0.offset, text: $0.element.summary) }) {
                            Text($0.text)
                        }
                    }
                }
                if let receipt = detail.receipts?.max(by: { ($0.finalizedAt ?? 0) < ($1.finalizedAt ?? 0) }),
                   let summary = receipt.summary, !summary.isEmpty
                {
                    overviewSection("执行结果") { Text(summary).textSelection(.enabled) }
                }
                let objective = detail.task.contract?.objective ?? detail.task.body ?? ""
                if !objective.isEmpty {
                    overviewSection("目标") { Text(objective).textSelection(.enabled) }
                }
                if let criteria = detail.task.contract?.acceptanceCriteria, !criteria.isEmpty {
                    overviewSection("验收标准") {
                        ForEach(criteria.enumerated().map {
                            TaskCriterionDisplay(version: detail.task.latestContractVersion ?? 0, index: $0.offset, text: $0.element)
                        }) { criterion in
                            let status = TaskAcceptanceStatus.resolve(criterion.text, index: criterion.index, detail: detail)
                            Label(criterion.text, systemImage: status == .passed ? "checkmark.circle"
                                : status == .failed ? "exclamationmark.circle" : "circle")
                                .accessibilityValue(status == .passed ? "已通过" : status == .failed ? "未通过" : "待核对")
                        }
                    }
                }
                if let outputs = detail.task.contract?.expectedOutputs, !outputs.isEmpty {
                    overviewSection("预期产出") { ForEach(outputs, id: \.self) { Text($0) } }
                }
                properties(detail, objective: objective)
                DisclosureGroup("变更记录") {
                    ForEach(detail.phaseChanges ?? []) { change in
                        HStack {
                            Text(LocalizedStringKey(change.fromPhase)); Text("→"); Text(LocalizedStringKey(change.toPhase))
                        }.padding(.vertical, 4)
                    }
                    ForEach(detail.runs ?? []) { run in
                        LabeledContent("第 \(run.attempt) 次") { Text(LocalizedStringKey(run.status)) }
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
        }.accessibilityIdentifier("task-chat-overview")
    }

    private func properties(_ detail: TaskDetailEnvelope, objective: String) -> some View {
        DisclosureGroup("详细信息") {
            VStack(alignment: .leading, spacing: 10) {
                if let body = detail.task.body, !body.isEmpty, body != objective {
                    Text(body)
                }
                LabeledContent("运行状态") { Text(LocalizedStringKey(detail.operationalState)) }
                if let priority = detail.task.priority {
                    LabeledContent("优先级") { Text(LocalizedStringKey(priority)) }
                }
                if let due = detail.task.dueAt {
                    LabeledContent("截止日期") { Text(due.millisecondsDate, format: .dateTime.month().day().hour().minute()) }
                }
                if let projectID = detail.task.projectId {
                    LabeledContent("项目") { Text(projectID) }
                }
            }.padding(.top, 8)
        }
    }

    private func overviewSection(_ title: LocalizedStringKey, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            content()
        }
    }

    private func setExpanded(_ expanded: Bool) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { overviewExpanded = expanded }
    }

    @MainActor private func refresh() async {
        do { detail = try await GatewayClient(configuration: configuration).fetchTask(id: taskID) }
        catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    @MainActor private func load() async {
        do {
            let client = GatewayClient(configuration: configuration)
            let detail = try await client.fetchTask(id: taskID)
            self.detail = detail
            let id = try await client.ensureTaskConversation(taskID: taskID)
            try Task.checkCancellation()
            conversation = .existing(id: id, title: detail.task.title, agentId: detail.task.delegateAgentId ?? "main")
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    @MainActor private func cancelTask() async {
        guard let detail, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await GatewayClient(configuration: configuration).commandTask(detail.task, command: "close", resolution: "cancelled")
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
}

private struct TaskCriterionDisplay: Identifiable {
    let version: Int
    let index: Int
    let text: String
    var id: String {
        "\(version):\(index)"
    }
}

private struct TaskAttentionDisplay: Identifiable {
    let index: Int
    let text: String
    var id: Int {
        index
    }
}

private struct TaskStatusView: View {
    let configuration: GatewayConfiguration
    let detail: TaskDetailEnvelope
    @Environment(\.dismiss) private var dismiss
    @State private var agents: [AgentSummary] = []
    @State private var agentID = ""
    @State private var agentsError: String?
    @State private var error: String?
    @State private var isWorking = false
    @State private var confirmsCancel = false

    private var allowed: [String] {
        detail.allowedCommands ?? []
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(["backlog", "ready", "active", "review", "closed"], id: \.self) { phase in
                        Button {
                            if let command = detail.phaseCommand(for: phase) {
                                Task { await apply(command, phase: phase) }
                            }
                        } label: {
                            HStack {
                                Text(LocalizedStringKey(phase))
                                Spacer()
                                if phase == detail.task.phase {
                                    Image(systemName: "checkmark")
                                }
                            }.frame(minHeight: 44)
                        }
                        .disabled(isWorking || detail.phaseCommand(for: phase) == nil)
                        .accessibilityIdentifier("task-phase-\(phase)")
                    }
                    if detail.task.phase != "closed", !allowed.contains("move") {
                        Text("任务正在执行或等待条件满足，请先处理当前执行或等待事项。")
                            .foregroundStyle(.secondary)
                    }
                } header: { Text("阶段") } footer: {
                    Text("调整阶段不会启动或停止执行，每次变更都会记录。")
                }
                if allowed.contains("mark_ready"), !allowed.contains("move") {
                    Section {
                        Button("设为可开始") { Task { await apply("mark_ready") } }
                    }
                }
                if allowed.contains("start") {
                    Section {
                        Picker("Agent", selection: $agentID) {
                            Text("选择 Agent").tag("")
                            ForEach(agents) { Text($0.displayName).tag($0.id) }
                        }
                        if let agentsError {
                            Text(agentsError).foregroundStyle(.red)
                            Button("重试") { Task { await loadAgents() } }
                        }
                        Button("开始执行") { Task { await apply("start", agentID: agentID) } }
                            .disabled(!agents.contains(where: { $0.id == agentID }))
                    } header: { Text("执行任务") } footer: {
                        Text("选择 Agent 后开始执行，将创建一次任务运行。")
                    }
                }
                if allowed.contains("close") {
                    Section {
                        Button("完成任务") { Task { await apply("close") } }
                            .accessibilityIdentifier("task-complete")
                        Button("取消任务", role: .destructive) { confirmsCancel = true }
                            .accessibilityIdentifier("task-cancel")
                    }
                }
            }
            .disabled(isWorking)
            .navigationTitle("调整状态")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }.disabled(isWorking)
                }
            }
            .task {
                if allowed.contains("start") {
                    await loadAgents()
                }
            }
            .confirmationDialog("取消任务？", isPresented: $confirmsCancel, titleVisibility: .visible) {
                Button("取消任务", role: .destructive) { Task { await apply("close", resolution: "cancelled") } }
                Button("保留任务", role: .cancel) {}
            } message: { Text("结束此任务，不标记为完成。之后可以重新打开。") }
            .alert("操作失败", isPresented: Binding(get: { error != nil }, set: {
                if !$0 {
                    error = nil
                }
            })) {
                Button("关闭并刷新") { dismiss() }
                Button("好", role: .cancel) { error = nil }
            } message: { Text(error ?? "未知错误") }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(isWorking)
    }

    @MainActor private func loadAgents() async {
        do {
            let catalog = try await GatewayClient(configuration: configuration).fetchAgents()
            agents = catalog.agents
            let preferred = detail.task.delegateAgentId ?? catalog.defaultId
            agentID = agents.contains(where: { $0.id == preferred }) ? preferred : agents.first?.id ?? ""
            agentsError = nil
        } catch { agentsError = error.localizedDescription }
    }

    @MainActor private func apply(_ command: String, phase: String? = nil,
                                  resolution: String = "done", agentID: String? = nil) async
    {
        guard !isWorking, allowed.contains(command) else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await GatewayClient(configuration: configuration).commandTask(
                detail.task, command: command, phase: phase, resolution: resolution, agentID: agentID
            )
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
