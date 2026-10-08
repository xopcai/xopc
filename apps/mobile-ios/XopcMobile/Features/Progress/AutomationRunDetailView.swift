import SwiftUI

// swiftlint:disable:next type_body_length
struct AutomationRunDetailView: View {
    let configuration: GatewayConfiguration
    let runID: String
    let initialRun: AutomationRunRecord?
    let onOpenConversation: (String, String, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var run: AutomationRunRecord?
    @State private var events: [AutomationRunEvent] = []
    @State private var isLoading = true
    @State private var isWorking = false
    @State private var detailError: String?
    @State private var eventError: String?
    @State private var actionError: String?
    @State private var confirmsCancel = false
    @State private var rerunID: String?
    @State private var pollRevision = 0

    private var displayedRun: AutomationRunRecord? {
        run ?? initialRun
    }

    private var statusAppearance: (symbol: String, color: Color) {
        switch displayedRun?.status {
        case "succeeded":
            ("checkmark.circle", .green)
        case "failed", "timeout":
            ("exclamationmark.circle", .red)
        case "cancelled":
            ("xmark.circle", .secondary)
        default:
            ("clock", .blue)
        }
    }

    var body: some View {
        List {
            if let displayedRun {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        if !displayedRun.automationName.isEmpty {
                            Text(verbatim: displayedRun.automationName)
                                .font(.headline)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityAddTraits(.isHeader)
                        }
                        Group {
                            if dynamicTypeSize.isAccessibilitySize {
                                VStack(alignment: .leading, spacing: 8) {
                                    runStatusIcon
                                    runStatus(displayedRun)
                                }
                            } else {
                                HStack(spacing: 12) {
                                    runStatusIcon
                                    runStatus(displayedRun)
                                }
                            }
                        }
                        if let summary = displayedRun.summary, !summary.isEmpty {
                            if let maintenance = MemoryMaintenanceSummary(summary) {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("记忆维护已完成")
                                        .font(.subheadline.weight(.semibold))
                                    LazyVGrid(columns: metricColumns, alignment: .leading, spacing: 10) {
                                        ForEach(maintenance.metrics) { metric in
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(LocalizedStringKey(metric.label))
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                                    .fixedSize(horizontal: false, vertical: true)
                                                Text(metric.count, format: .number)
                                                    .font(.subheadline.weight(.semibold))
                                                    .monospacedDigit()
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                        }
                                    }
                                }
                            } else {
                                MarkdownBodyView(
                                    parts: MarkdownBlock.parse(summary).map(MarkdownPart.init),
                                    configuration: configuration,
                                    conversationID: displayedRun.conversationId
                                )
                            }
                        }
                        if let message = displayedRun.error, !message.isEmpty {
                            Text(AutomationRunErrorCopy.display(message, locale: locale))
                                .foregroundStyle(.red)
                                .textSelection(.enabled)
                        }
                        if displayedRun.isActive {
                            Button("取消运行", role: .destructive) { confirmsCancel = true }
                                .disabled(isWorking)
                                .frame(maxWidth: .infinity)
                        } else if displayedRun.canRerun {
                            Button("重新运行") { Task { await rerun() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(isWorking)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.vertical, 8)
                }
                Section("执行结果") {
                    if let conversationID = displayedRun.conversationId {
                        Button("打开会话", systemImage: "bubble.left.and.bubble.right") {
                            Task { await openConversation(conversationID) }
                        }
                        .disabled(isWorking)
                    }
                    Button("返回自动化", systemImage: "clock") { dismiss() }
                }
            } else if isLoading {
                ProgressListSkeleton()
            }
            if let detailError {
                Section {
                    Label(detailError, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    Button("重试") { pollRevision += 1 }
                }
            }
            Section("时间线") {
                if let eventError {
                    Label(eventError, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    Button("重试") { Task { await loadEvents() } }
                } else if events.isEmpty, !isLoading {
                    Text("暂无事件").foregroundStyle(.secondary)
                } else {
                    ForEach(events) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(AutomationRunEventCopy.display(event.message, locale: locale))
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(event.createdAtMs.millisecondsDate, format: .dateTime.month().day().hour().minute().second())
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .navigationTitle("运行详情")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(runID):\(pollRevision)") { await poll() }
        .refreshable { await load() }
        .confirmationDialog("取消此次运行？", isPresented: $confirmsCancel) {
            Button("确认取消运行", role: .destructive) { Task { await cancel() } }
        } message: {
            Text("正在运行的操作会被停止。")
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
        .navigationDestination(isPresented: Binding(get: { rerunID != nil }, set: {
            if !$0 {
                rerunID = nil
            }
        })) {
            if let rerunID {
                AutomationRunDetailView(configuration: configuration, runID: rerunID, initialRun: nil,
                                        onOpenConversation: onOpenConversation)
            }
        }
        .overlay {
            if isWorking {
                ProgressView().padding().background(.regularMaterial, in: .circle)
            }
        }
    }

    private var metricColumns: [GridItem] {
        let count = dynamicTypeSize.isAccessibilitySize ? 1 : 2
        return Array(repeating: GridItem(.flexible()), count: count)
    }

    private var runStatusIcon: some View {
        Image(systemName: statusAppearance.symbol)
            .font(.title2)
            .foregroundStyle(statusAppearance.color)
            .frame(width: 48, height: 48)
            .accessibilityHidden(true)
    }

    private func runStatus(_ run: AutomationRunRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(LocalizedStringKey(run.status))
                .font(.title2.bold())
                .fixedSize(horizontal: false, vertical: true)
            Text((run.startedAtMs ?? run.createdAtMs).millisecondsDate,
                 format: .dateTime.month().day().hour().minute())
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @MainActor private func poll() async {
        repeat {
            await load()
            guard !Task.isCancelled, displayedRun?.isActive == true else { return }
            try? await Task.sleep(for: .seconds(4))
        } while !Task.isCancelled
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        let client = GatewayClient(configuration: configuration)
        do {
            run = try await client.fetchAutomationRun(id: runID)
            detailError = nil
        } catch is CancellationError {
            return
        } catch {
            detailError = error.localizedDescription
        }
        await loadEvents()
    }

    @MainActor private func loadEvents() async {
        do {
            events = try await GatewayClient(configuration: configuration).fetchAutomationRunEvents(id: runID)
            eventError = nil
        } catch is CancellationError {
        } catch {
            eventError = error.localizedDescription
        }
    }

    @MainActor private func cancel() async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await GatewayClient(configuration: configuration).cancelAutomationRun(id: runID)
            await load()
        } catch {
            actionError = error.localizedDescription
        }
    }

    @MainActor private func rerun() async {
        isWorking = true
        defer { isWorking = false }
        do {
            let next = try await GatewayClient(configuration: configuration).rerunAutomation(id: runID)
            rerunID = next.id
        } catch {
            actionError = error.localizedDescription
        }
    }

    @MainActor private func openConversation(_ id: String) async {
        isWorking = true
        defer { isWorking = false }
        do {
            let history = try await GatewayClient(configuration: configuration).fetchHistory(conversationID: id)
            onOpenConversation(
                id,
                displayedRun?.automationName
                    ?? AppLocalization.string("自动化运行", locale: AppLocalization.selectedLocale),
                history.session.agentId ?? "main"
            )
        } catch {
            actionError = error.localizedDescription
        }
    }
}
