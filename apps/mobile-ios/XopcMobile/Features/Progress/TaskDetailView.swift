import SwiftUI

struct TaskConversationView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let taskID: String
    var returnLabel: LocalizedStringKey?
    var opensDetails = false

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var detail: TaskDetailEnvelope?
    @State private var conversation: ConversationSelection?
    @State private var nestedTaskID: String?
    @State private var voiceCall = RealtimeVoiceCall()
    @State private var error: String?
    @State private var showingDetails = false
    @State private var showingStatus = false
    @State private var optionsRevision = 0
    @State private var searchRevision = 0
    @State private var editingTask: TaskRecord?

    var body: some View {
        if opensDetails {
            taskDetailsPage
        } else {
            conversationBody
        }
    }

    private var taskDetailsPage: some View {
        detailsContent
            .mobilePageTitle(Text("任务详情"))
            .task(id: taskID) { await refresh() }
    }

    private var detailsContent: some View {
        VStack(spacing: 0) {
            if let detail {
                overview(detail)
                Divider()
                taskActions(detail.task)
            } else if let error {
                ContentUnavailableView {
                    Label("无法读取任务", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("重试") { Task { await refresh() } }
                }
            } else {
                ProgressListSkeleton()
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
    }

    private var conversationBody: some View {
        ZStack(alignment: .top) {
            if let conversation {
                AssistantView(
                    configuration: configuration, isActive: true, realtimeVoiceCall: voiceCall,
                    conversation: conversation, personalAgent: nil,
                    onStartConversation: { _ in }, onStartScopedConversation: { _, _, _ in },
                    onConversationUpdated: { self.conversation = $0 },
                    onOpenSettings: { optionsRevision += 1 }, onInputFocusChanged: { _ in },
                    showsFloatingHeader: false, sessionActionsRequest: optionsRevision, messageSearchRequest: searchRevision
                ) { composer in
                    VStack(spacing: 0) {
                        Button { showingDetails = true } label: {
                            Label("任务详情", systemImage: "info.circle")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(mobileTheme.secondary)
                                .padding(.horizontal, 10).frame(height: 28)
                                .background(mobileTheme.card, in: Capsule())
                                .frame(minHeight: 44).contentShape(.rect)
                        }.buttonStyle(.plain).accessibilityIdentifier("task-chat-details-tip")
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 20)
                        composer
                    }
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
            taskHeader
        }
        .environment(\.openURL, OpenURLAction { url in
            if case let .route("tasks", id) = ChatMessageLink.resolve(url.absoluteString) {
                if id != taskID {
                    nestedTaskID = id
                }
            } else {
                openURL(url)
            }
            return .handled
        })
        .navigationDestination(item: $nestedTaskID) { id in
            TaskConversationView(configuration: configuration, taskID: id)
        }
        .mobilePageTitle(Text("任务对话"))
        .toolbar(returnLabel == nil ? .visible : .hidden, for: .navigationBar)
        .task(id: taskID) { await load() }
        .task(id: conversation?.id) {
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(8)) } catch { return }
                guard editingTask == nil, !showingStatus else { continue }
                await refresh()
            }
        }
        .sheet(isPresented: $showingDetails) {
            NavigationStack {
                detailsContent
                    .navigationTitle("任务详情")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("关闭") { showingDetails = false }.accessibilityIdentifier("task-chat-details-close")
                        }
                    }
            }
            .presentationDetents([.fraction(0.76), .large])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: Binding(get: { voiceCall.phase != .idle && voiceCall.expanded }, set: {
            if !$0 {
                voiceCall.minimize()
            }
        })) { RealtimeVoiceCallView(call: voiceCall) }
        .alert("操作失败", isPresented: Binding(get: { conversation != nil && error != nil }, set: {
            if !$0 {
                error = nil
            }
        })) { Button("好", role: .cancel) { error = nil } } message: { Text(error ?? "") }
    }

    private var taskHeader: some View {
        HStack(spacing: 4) {
            if let returnLabel {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.backward").frame(width: 44, height: 44)
                        .background(mobileTheme.card, in: Circle())
                        .contentShape(.rect)
                }
                .accessibilityLabel(Text(returnLabel)).accessibilityIdentifier("task-chat-close")
            }
            Text(detail?.task.title ?? AppLocalization.resolve("任务对话"))
                .font(.subheadline.weight(.medium)).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Menu {
                Button("搜索消息") { searchRevision += 1 }
                Button("会话选项") { optionsRevision += 1 }
            } label: {
                Image(systemName: "ellipsis.circle").frame(width: 44, height: 44)
                    .background(mobileTheme.card, in: Circle())
                    .contentShape(.rect)
            }
            .accessibilityLabel("更多").accessibilityIdentifier("task-chat-menu")
        }.buttonStyle(.plain).foregroundStyle(mobileTheme.foreground).padding(.horizontal, 12).frame(minHeight: 64)
            .background(mobileTheme.canvas)
    }

    private func taskActions(_ task: TaskRecord) -> some View {
        HStack(spacing: 8) {
            Button { editingTask = task } label: {
                Text("编辑任务").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("task-chat-edit")
            Button { showingStatus = true } label: {
                Text("调整状态").foregroundStyle(mobileTheme.onAction)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("task-chat-status")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
    }
}

extension TaskConversationView {
    private func overview(_ detail: TaskDetailEnvelope) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(detail.task.title).mobileTextStyle(.rowTitle)
                Text(LocalizedStringKey(detail.task.resolution ?? detail.task.phase))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(mobileTheme.action)
                LabeledContent("运行状态") { Text(LocalizedStringKey(detail.operationalState)) }
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
                    overviewSection("执行结果") {
                        Text(summary).textSelection(.enabled)
                        ForEach(Array((receipt.remainingWork ?? []).enumerated()), id: \.offset) { _, work in
                            Text(work).foregroundStyle(.secondary)
                        }
                    }
                }
                let objective = detail.task.contract?.objective ?? detail.task.body ?? ""
                if !objective.isEmpty {
                    overviewSection("目标") { Text(objective).textSelection(.enabled) }
                }
                TaskReviewControls(configuration: configuration, detail: detail) { self.detail = $0 }
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
}

private struct TaskReviewControls: View {
    let configuration: GatewayConfiguration
    let detail: TaskDetailEnvelope
    let onUpdated: (TaskDetailEnvelope) -> Void

    @State private var busy = false
    @State private var error: String?

    var body: some View {
        if let reason = detail.presentation?.reason {
            Text(reason).foregroundStyle(.secondary)
        }
        if let resultID = detail.signoffResultID {
            Button("确认验收") {
                Task { await mutate { try await $0.commandTask(detail.task, command: "signoff", resultID: resultID) } }
            }.buttonStyle(.borderedProminent).disabled(busy).accessibilityIdentifier("task-signoff")
        }
        if let checks = detail.acceptanceChecks, !checks.isEmpty {
            Section("验收标准") {
                ForEach(checks) { check in
                    let status = TaskAcceptanceStatus.resolve(check, detail: detail)
                    let icon = status == .passed ? "checkmark.circle" : status == .failed ? "exclamationmark.circle" : "circle"
                    if let target = detail.acceptanceTarget, detail.task.phase != "closed",
                       detail.waits?.contains(where: { $0.status == "active" }) != true
                    {
                        Button {
                            Task {
                                await mutate { client in
                                    try await client.reviewTaskCheck(detail.task, checkID: check.id, resultID: target.id,
                                                                     status: status == .passed ? "unverified" : "passed")
                                }
                            }
                        } label: { Label(check.criterion, systemImage: icon) }
                            .disabled(busy)
                            .accessibilityValue(status == .passed ? "已通过" : status == .failed ? "未通过" : "待核对")
                    } else {
                        Label(check.criterion, systemImage: icon)
                    }
                }
            }
        }
        if let error {
            Text(error).foregroundStyle(.red)
        }
    }

    @MainActor private func mutate(_ update: (GatewayClient) async throws -> Void) async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        let client = GatewayClient(configuration: configuration)
        do {
            try await update(client)
            try await onUpdated(client.fetchTask(id: detail.task.id))
        } catch is CancellationError {} catch {
            self.error = error.localizedDescription
            if let latest = try? await client.fetchTask(id: detail.task.id) {
                onUpdated(latest)
            }
        }
    }
}

private struct TaskAttentionDisplay: Identifiable {
    let index: Int
    let text: String
    var id: Int {
        index
    }
}
