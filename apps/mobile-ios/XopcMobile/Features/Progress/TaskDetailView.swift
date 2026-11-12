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
                       let summary = receipt.summary, !summary.isEmpty
                    {
                        Section("执行结果") { Text(summary).textSelection(.enabled) }
                    }
                    if let objective = detail.task.contract?.objective ?? detail.task.body, !objective.isEmpty {
                        Section("目标") { Text(objective).textSelection(.enabled) }
                    }
                    TaskReviewControls(configuration: configuration, detail: detail) { self.detail = $0 }
                }
                .safeAreaInset(edge: .bottom) {
                    if detail.signoffResultID == nil {
                        Button("继续任务") { showingConversation = true }
                            .buttonStyle(.borderedProminent).frame(minHeight: 44)
                            .accessibilityIdentifier("task-detail-continue")
                    } else {
                        Button("继续任务") { showingConversation = true }
                            .buttonStyle(.bordered).frame(minHeight: 44)
                            .accessibilityIdentifier("task-detail-continue")
                    }
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
            if !showing {
                Task { await load() }
            }
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
