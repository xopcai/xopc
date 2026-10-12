import SwiftUI

struct TaskDetailView: View {
    let configuration: GatewayConfiguration
    let taskID: String
    let onOpenConversation: (String, String, String) -> Void

    @State private var detail: TaskDetailEnvelope?
    @State private var error: String?
    @State private var isWorking = false
    @State private var showingStatus = false
    @State private var editingTask: TaskRecord?

    var body: some View {
        Group {
            if let detail {
                List {
                    Section {
                        HStack(alignment: .top, spacing: 16) {
                            Image(systemName: "doc.text")
                                .font(.title2)
                                .foregroundStyle(.blue)
                                .frame(width: 48, height: 48)
                                .background(Color.blue.opacity(0.1), in: .circle)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 10) {
                                Text(detail.task.title)
                                    .mobileTextStyle(.detailTitle)
                                    .fixedSize(horizontal: false, vertical: true)
                                Button { showingStatus = true } label: {
                                    Label(LocalizedStringKey(detail.task.phase == "closed" && detail.task.resolution == "done" ? "已完成"
                                              : detail.task.resolution == "cancelled" ? "cancelled" : detail.task.phase),
                                    systemImage: "chevron.down")
                                        .frame(minHeight: 44)
                                }.disabled(isWorking)
                                if let projectID = detail.task.projectId {
                                    Label(projectID, systemImage: "folder")
                                        .mobileTextStyle(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.vertical, 10)
                    }
                    Section("说明") {
                        if let body = detail.task.body, !body.isEmpty {
                            MarkdownBodyView(parts: MarkdownBlock.parse(body).map(MarkdownPart.init),
                                             configuration: configuration, conversationID: nil)
                        } else {
                            Text("暂无说明").foregroundStyle(.secondary)
                        }
                    }
                    if let objective = detail.task.contract?.objective, !objective.isEmpty, objective != detail.task.title {
                        Section("目标") { Text(objective) }
                    }
                    if let criteria = detail.task.contract?.acceptanceCriteria, !criteria.isEmpty {
                        Section {
                            ForEach(criteria.enumerated().map {
                                TaskCriterionDisplay(version: detail.task.latestContractVersion ?? 0,
                                                     index: $0.offset, text: $0.element)
                            }) { criterion in
                                let status = TaskAcceptanceStatus.resolve(
                                    criterion.text, index: criterion.index, detail: detail
                                )
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: status == .passed ? "checkmark.circle.fill"
                                        : status == .failed ? "exclamationmark.circle.fill" : "circle.dotted")
                                        .foregroundStyle(status == .passed ? .green
                                            : status == .failed ? .red : .secondary)
                                        .accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(criterion.text)
                                            .fixedSize(horizontal: false, vertical: true)
                                        Text(label(for: status))
                                            .mobileTextStyle(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .accessibilityElement(children: .combine)
                            }
                        } header: {
                            HStack {
                                Text("验收标准")
                                Spacer()
                                Text("\(TaskAcceptanceStatus.passedCount(in: detail))/\(criteria.count)")
                            }
                        }
                    }
                    if let outputs = detail.task.contract?.expectedOutputs, !outputs.isEmpty {
                        Section("预期产出") {
                            ForEach(outputs, id: \.self) { Text($0) }
                        }
                    }
                    if let attention = detail.attention, !attention.isEmpty {
                        Section("需要留意") {
                            ForEach(attention.enumerated().map {
                                TaskAttentionDisplay(index: $0.offset, text: $0.element.summary)
                            }) { item in
                                Text(item.text)
                            }
                        }
                    }
                    Section("详细信息") {
                        LabeledContent("运行状态") { Text(LocalizedStringKey(detail.operationalState)) }
                        LabeledContent("阶段") { Text(LocalizedStringKey(detail.task.phase)) }
                        if let dueAt = detail.task.dueAt {
                            LabeledContent("截止日期") { Text(dueAt.millisecondsDate, format: .dateTime.year().month().day().hour().minute()) }
                        }
                        if let priority = detail.task.priority {
                            LabeledContent("优先级") { Text(LocalizedStringKey(priority)) }
                        }
                        LabeledContent("最近更新") {
                            Text(detail.task.updatedAt.millisecondsDate, format: .dateTime.month().day().hour().minute())
                        }
                    }
                    if let receipts = detail.receipts, !receipts.isEmpty {
                        Section("执行结果") {
                            ForEach(receipts) { receipt in
                                VStack(alignment: .leading, spacing: 6) {
                                    if let summary = receipt.summary, !summary.isEmpty {
                                        Text(summary).mobileTextStyle(.rowTitle)
                                    } else {
                                        Text(LocalizedStringKey(receipt.status)).mobileTextStyle(.rowTitle)
                                    }
                                    if receipt.needsUser == true {
                                        Label("需要你的参与", systemImage: "person.crop.circle.badge.exclamationmark").foregroundStyle(.orange)
                                    }
                                }
                            }
                        }
                        if let latest = receipts.max(by: { ($0.finalizedAt ?? 0) < ($1.finalizedAt ?? 0) }),
                           let artifacts = latest.evidence?.filter({ $0.kind == "artifact" }), !artifacts.isEmpty
                        {
                            Section("产出文件") {
                                ForEach(artifacts, id: \.title) { artifact in
                                    Label(artifact.title, systemImage: "doc")
                                }
                            }
                        }
                    }
                    if let runs = detail.runs, !runs.isEmpty {
                        Section("运行记录") {
                            ForEach(runs) { run in
                                LabeledContent("第 \(run.attempt) 次") { Text(LocalizedStringKey(run.status)) }
                            }
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    VStack(spacing: 8) {
                        HStack(spacing: 8) {
                            Button { showingStatus = true } label: {
                                Text("调整状态").frame(maxWidth: .infinity, minHeight: 44)
                            }.accessibilityIdentifier("task-adjust-status")
                            Button { editingTask = detail.task } label: {
                                Text("编辑").frame(maxWidth: .infinity, minHeight: 44)
                            }.accessibilityIdentifier("task-edit")
                            Button { Task { await openTaskConversation(detail.task) } } label: {
                                Text("任务对话").frame(maxWidth: .infinity, minHeight: 44)
                            }.accessibilityIdentifier("task-edit-chat")
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .buttonStyle(.bordered)
                        .disabled(isWorking)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
                    .background(.regularMaterial)
                }
            } else if let error {
                ContentUnavailableView("无法读取任务", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView("正在读取任务…")
            }
        }
        .navigationTitle("任务详情")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $editingTask, onDismiss: { Task { await load() } }) { task in
            TaskEditorView(configuration: configuration, task: task)
        }
        .sheet(isPresented: $showingStatus, onDismiss: { Task { await load() } }) {
            if let detail {
                TaskStatusView(configuration: configuration, detail: detail)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("刷新").disabled(isWorking)
            }
        }
        .alert("操作失败", isPresented: Binding(get: { detail != nil && error != nil }, set: {
            if !$0 {
                error = nil
            }
        })) {
            Button("好", role: .cancel) {}
        } message: { Text(error ?? "未知错误") }
    }
}

private extension TaskDetailView {
    @MainActor
    func load() async {
        do { detail = try await GatewayClient(configuration: configuration).fetchTask(id: taskID); error = nil }
        catch { self.error = error.localizedDescription }
    }

    @MainActor
    func openTaskConversation(_ task: TaskRecord) async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let conversationID = try await GatewayClient(configuration: configuration)
                .ensureTaskConversation(taskID: task.id)
            onOpenConversation(conversationID, task.title, task.delegateAgentId ?? "main")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func label(for status: TaskAcceptanceStatus) -> LocalizedStringKey {
        switch status {
        case .passed: "已通过"
        case .failed: "未通过"
        case .pending: "待核对"
        }
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
                    ForEach(["backlog", "ready", "active", "review"], id: \.self) { phase in
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
                    Text("调整阶段不会自动启动 Agent。")
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
                            .disabled(TaskAcceptanceStatus.completionBlock(in: detail) != nil)
                            .accessibilityIdentifier("task-complete")
                        if let reason = TaskAcceptanceStatus.completionBlock(in: detail) {
                            Text(completionHint(reason)).foregroundStyle(.secondary)
                        }
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

    private func completionHint(_ reason: String) -> LocalizedStringKey {
        switch reason {
        case "execution": "请先处理当前执行或等待事项，再完成任务。"
        case "criteria": "请先在桌面端补充验收标准并完成验收，再标记完成。"
        default: "所有验收标准通过后才能完成，请在桌面端核对验收。"
        }
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
        if command == "close", resolution == "done", TaskAcceptanceStatus.completionBlock(in: detail) != nil {
            return
        }
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
