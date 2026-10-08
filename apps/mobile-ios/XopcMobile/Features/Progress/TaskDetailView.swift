import SwiftUI

struct TaskDetailView: View {
    let configuration: GatewayConfiguration
    let taskID: String
    let onOpenConversation: (String, String, String) -> Void

    @State private var detail: TaskDetailEnvelope?
    @State private var error: String?
    @State private var isWorking = false
    @State private var confirmsClose = false
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
                                Text(LocalizedStringKey(detail.task.phase))
                                    .mobileTextStyle(.secondary)
                                    .foregroundStyle(.secondary)
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
                    let commands = availableCommands(for: detail).filter { $0 != primaryCommand(for: detail) }
                    if !commands.isEmpty {
                        Section("操作") {
                            ForEach(commands, id: \.self) { command in
                                Button(label(for: command)) {
                                    if command == "close" {
                                        confirmsClose = true
                                    } else {
                                        Task { await apply(command, to: detail.task) }
                                    }
                                }
                                .disabled(isWorking)
                            }
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    VStack(spacing: 8) {
                        Button {
                            editingTask = detail.task
                        } label: {
                            Text("编辑").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        Button {
                            Task { await openTaskConversation(detail.task) }
                        } label: {
                            Label("进入任务对话", systemImage: "bubble.left.and.bubble.right")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isWorking)
                        if let command = primaryCommand(for: detail) {
                            Button {
                                if command == "close" {
                                    confirmsClose = true
                                } else {
                                    Task { await apply(command, to: detail.task) }
                                }
                            } label: {
                                Text(label(for: command)).frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .disabled(isWorking)
                        }
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
        .navigationTitle("任务")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $editingTask, onDismiss: { Task { await load() } }) { task in
            TaskEditorView(configuration: configuration, task: task)
        }
        .confirmationDialog("关闭任务？", isPresented: $confirmsClose, titleVisibility: .visible) {
            Button("关闭任务") {
                if let task = detail?.task {
                    Task { await apply("close", to: task) }
                }
            }
            Button("取消", role: .cancel) {}
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
    func apply(_ command: String, to task: TaskRecord) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await GatewayClient(configuration: configuration).commandTask(task, command: command)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
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

    func label(for command: String) -> LocalizedStringKey {
        switch command {
        case "mark_ready": "设为可开始"
        case "start": "开始执行"
        case "request_review": "请求复核"
        case "close": "关闭任务"
        case "reopen": "重新打开"
        default: LocalizedStringKey(command)
        }
    }

    func label(for status: TaskAcceptanceStatus) -> LocalizedStringKey {
        switch status {
        case .passed: "已通过"
        case .failed: "未通过"
        case .pending: "待核对"
        }
    }

    func isSupported(_ command: String) -> Bool {
        ["mark_ready", "start", "request_review", "close", "reopen"].contains(command)
    }

    func availableCommands(for detail: TaskDetailEnvelope) -> [String] {
        detail.allowedCommands?.filter {
            isSupported($0)
                && ($0 != "start" || detail.task.delegateAgentId != nil)
                && ($0 != "close" || TaskAcceptanceStatus.allPassed(in: detail))
        } ?? []
    }

    func primaryCommand(for detail: TaskDetailEnvelope) -> String? {
        let commands = availableCommands(for: detail)
        return ["mark_ready", "start", "request_review", "close", "reopen"].first(where: commands.contains)
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
