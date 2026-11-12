import SwiftUI

struct TaskStatusView: View {
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
                if let resultID = detail.signoffResultID {
                    Button("确认验收") { Task { await apply("signoff", resultID: resultID) } }
                        .accessibilityIdentifier("task-status-signoff")
                }
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
                        if detail.runs?.isEmpty == true {
                            Button("完成任务") { Task { await apply("close") } }
                                .accessibilityIdentifier("task-complete")
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
                                  resolution: String = "done", agentID: String? = nil, resultID: String? = nil) async
    {
        guard !isWorking, allowed.contains(command) || (command == "signoff" && resultID == detail.signoffResultID && resultID != nil)
        else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await GatewayClient(configuration: configuration).commandTask(
                detail.task, command: command, phase: phase, resolution: resolution, agentID: agentID, resultID: resultID
            )
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
