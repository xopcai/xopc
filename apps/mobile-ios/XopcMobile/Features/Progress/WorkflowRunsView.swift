import SwiftUI

struct WorkflowRunsView: View {
    let configuration: GatewayConfiguration

    @State private var runs: [WorkflowRunSummary] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        List {
            if isLoading, runs.isEmpty {
                ProgressListSkeleton()
            } else if runs.isEmpty, error == nil {
                ContentUnavailableView("暂无工作流运行", systemImage: "arrow.triangle.branch",
                                       description: Text("在对话中发起工作流后，运行记录会显示在这里。"))
            }
            ForEach(runs) { run in
                NavigationLink {
                    WorkflowRunDetailView(configuration: configuration, runID: run.id)
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(run.title).mobileTextStyle(.rowTitle)
                            Text(WorkflowStatusCopy.label(run.status)).mobileTextStyle(.secondary).foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: WorkflowStatusCopy.symbol(run.status))
                    }
                }
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                Button("重试") { Task { await load() } }
            }
        }
        .navigationTitle("工作流")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button("刷新", systemImage: "arrow.clockwise") { Task { await load() } }
                .disabled(isLoading)
        }
        .task(id: configuration) { await load() }
        .refreshable { await load() }
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            runs = try await GatewayClient(configuration: configuration).fetchWorkflowRuns()
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct WorkflowRunDetailView: View {
    let configuration: GatewayConfiguration
    let runID: String

    @State private var detail: WorkflowRunDetail?
    @State private var isLoading = true
    @State private var isCancelling = false
    @State private var error: String?
    @State private var confirmsCancel = false

    var body: some View {
        List {
            if let detail {
                Section {
                    Label(detail.run.title, systemImage: WorkflowStatusCopy.symbol(detail.run.status))
                        .mobileTextStyle(.detailTitle)
                    Text(WorkflowStatusCopy.label(detail.run.status))
                        .foregroundStyle(.secondary)
                    Text("已完成 \(completedCount) / \(detail.agents.count) 项 Agent 工作")
                        .mobileTextStyle(.secondary)
                    if detail.controls.canCancel {
                        Button("取消运行", role: .destructive) { confirmsCancel = true }
                            .disabled(isCancelling)
                    }
                }
                if let goal = detail.run.goal, !goal.isEmpty {
                    Section("目标") { Text(goal).textSelection(.enabled) }
                }
                if let result = detail.run.result, !result.summary.isEmpty {
                    Section("结果") {
                        MarkdownBodyView(parts: MarkdownBlock.parse(result.summary).map(MarkdownPart.init),
                                         configuration: configuration, conversationID: nil)
                    }
                }
                if !detail.phases.isEmpty {
                    Section("阶段") {
                        ForEach(detail.phases) { step in stepRow(step, title: step.title ?? step.id) }
                    }
                }
                if !detail.agents.isEmpty {
                    Section("Agent 工作") {
                        ForEach(detail.agents) { step in stepRow(step, title: step.label ?? step.id) }
                    }
                }
            } else if isLoading {
                ProgressListSkeleton()
            }
            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    Button("重试") { Task { await load() } }
                }
            }
        }
        .navigationTitle("工作流概览")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: runID) { await poll() }
        .refreshable { await load() }
        .confirmationDialog("取消此次工作流运行？", isPresented: $confirmsCancel) {
            Button("确认取消运行", role: .destructive) { Task { await cancel() } }
        }
    }

    private var completedCount: Int {
        detail?.agents.filter { ["done", "succeeded"].contains($0.status) }.count ?? 0
    }

    private func stepRow(_ step: WorkflowRunStep, title: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                Text(step.error ?? step.resultPreview ?? WorkflowStatusCopy.label(step.status))
                    .mobileTextStyle(.secondary).foregroundStyle(step.error == nil ? Color.secondary : Color.red)
            }
        } icon: {
            Image(systemName: WorkflowStatusCopy.symbol(step.status))
        }
    }

    @MainActor private func poll() async {
        repeat {
            await load()
            guard !Task.isCancelled, let detail, ["queued", "running"].contains(detail.run.status) else { return }
            try? await Task.sleep(for: .seconds(4))
        } while !Task.isCancelled
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await GatewayClient(configuration: configuration).fetchWorkflowRun(id: runID)
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor private func cancel() async {
        isCancelling = true
        defer { isCancelling = false }
        do {
            try await GatewayClient(configuration: configuration).cancelWorkflowRun(id: runID)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private enum WorkflowStatusCopy {
    static func label(_ status: String) -> String {
        AppLocalization.string(status, locale: AppLocalization.selectedLocale)
    }

    static func symbol(_ status: String) -> String {
        switch status {
        case "succeeded", "done": "checkmark.circle"
        case "failed": "exclamationmark.circle"
        case "cancelled": "xmark.circle"
        default: "clock"
        }
    }
}
