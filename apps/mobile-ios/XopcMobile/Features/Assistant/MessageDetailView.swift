import SwiftUI

struct MessageDetailView: View {
    let message: TimelineMessage
    let configuration: GatewayConfiguration
    let conversationID: String?
    let assistantState: AssistantState?

    @Environment(\.dismiss) private var dismiss
    @State private var path: [Destination] = []

    private enum Destination: Hashable { case execution }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if message.role == "assistant",
                       conversationID != nil,
                       !message.isPending || message.turnId != nil
                    {
                        Button {
                            path.append(.execution)
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: message.isPending ? "circle.dotted" : "checkmark.circle")
                                Text("执行过程")
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
                        }
                        Divider()
                    }
                    if !message.markdownParts.isEmpty {
                        MarkdownBodyView(parts: message.markdownParts, configuration: configuration, conversationID: conversationID)
                            .padding(.vertical, 22)
                    } else if message.text.isEmpty {
                        Text("无文本内容")
                            .padding(.vertical, 22)
                    } else {
                        Text(verbatim: message.text)
                            .textSelection(.enabled)
                            .padding(.vertical, 22)
                    }
                    if !message.references.isEmpty {
                        Divider()
                        Text("引用").font(.headline).padding(.top, 18)
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(message.references) { reference in
                                Label(reference.title, systemImage: reference.kind.systemImage)
                            }
                        }
                        .padding(.vertical, 14)
                    }
                    if !message.attachments.isEmpty {
                        Divider()
                        Text("附件").font(.headline).padding(.top, 18)
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(message.attachments) { attachment in
                                Label(
                                    attachment.name ?? AppLocalization.string("附件", locale: AppLocalization.selectedLocale),
                                    systemImage: "paperclip"
                                )
                            }
                        }
                        .padding(.vertical, 14)
                    }
                    Divider()
                    HStack {
                        Text(message.role == "assistant"
                            ? LocalizedStringResource("AI 回复")
                            : LocalizedStringResource("我的消息"))
                        Spacer()
                        Text(message.isPending
                            ? LocalizedStringResource("发送中")
                            : LocalizedStringResource("已完成"))
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 18)
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 28)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color(.systemBackground))
            .navigationTitle("消息详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.headline)
                            .frame(width: 44, height: 44)
                            .background(Color.secondary.opacity(0.08), in: .circle)
                    }
                    .accessibilityLabel("关闭")
                }
            }
            .navigationDestination(for: Destination.self) { destination in
                switch destination {
                case .execution:
                    if let conversationID {
                        ExecutionProcessView(
                            configuration: configuration,
                            conversationID: conversationID,
                            turnID: message.turnId ?? message.id,
                            assistantState: assistantState
                        )
                    }
                }
            }
        }
        .presentationDetents([.large])
    }
}

struct ExecutionProcessView: View {
    let configuration: GatewayConfiguration
    let conversationID: String
    let turnID: String
    let assistantState: AssistantState?

    @State private var detail: ExecutionDetail?
    @State private var isLoading = true
    @State private var error: String?

    private var groups: [ExecutionStepGroup] {
        detail?.groups(live: isLive) ?? []
    }

    private var isLive: Bool {
        assistantState?.runID == turnID
    }

    private var toolCount: Int {
        detail?.steps.filter { $0.kind == "tool" }.count ?? 0
    }

    private var completedCount: Int {
        groups.filter { $0.kind == "tool" && $0.status == "done" }
            .reduce(0) { $0 + $1.steps.count }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if detail != nil, !groups.isEmpty {
                    HStack(spacing: 8) {
                        Image(systemName: isLive ? "circle.dotted" : hasUnresolvedSteps ? "exclamationmark.circle" : "checkmark.circle")
                        Text(executionStatusTitle).fontWeight(.medium)
                        Spacer(minLength: 8)
                        Text("共 \(toolCount) 步 · 完成 \(completedCount) 步")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                    .padding(.bottom, 14)
                }
                if isLoading, detail == nil {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("正在读取执行过程…").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                } else if isLive, groups.isEmpty {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("助手正在执行，步骤出现后会自动更新").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                }
                if let error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("暂时无法读取执行过程").font(.subheadline)
                        Text(error).font(.caption).foregroundStyle(.secondary)
                        Button("重试") { Task { await load() } }.frame(minHeight: 44)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
                }
                ForEach(groups) { group in
                    if group.kind == "tool" {
                        ExecutionToolGroupView(group: group)
                    } else if let text = group.steps.first?.text, !text.isEmpty {
                        Text(text).font(.subheadline).foregroundStyle(.secondary)
                            .textSelection(.enabled).padding(.vertical, 14)
                    }
                    Divider()
                }
                if !isLoading, error == nil, groups.isEmpty, !isLive {
                    ContentUnavailableView("暂无执行步骤", systemImage: "list.bullet.rectangle")
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("执行过程")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(conversationID):\(turnID)") { await poll() }
    }

    private var hasUnresolvedSteps: Bool {
        groups.contains { ["error", "stopped"].contains($0.status) }
    }

    private var executionStatusTitle: LocalizedStringResource {
        if isLive {
            return "执行中"
        }
        return hasUnresolvedSteps ? "执行已结束" : "已完成"
    }

    @MainActor private func poll() async {
        var settledPolls = 0
        while !Task.isCancelled {
            await load()
            if isLive {
                settledPolls = 0
            } else {
                settledPolls += 1
                if settledPolls >= 3 {
                    break
                }
            }
            try? await Task.sleep(for: .seconds(3))
        }
    }

    @MainActor private func load() async {
        isLoading = detail == nil
        defer { isLoading = false }
        do {
            let response = try await GatewayClient(configuration: configuration)
                .fetchExecutionDetail(conversationID: conversationID, turnID: turnID)
            guard !Task.isCancelled else { return }
            detail = response
            error = nil
        } catch is CancellationError {
        } catch {
            if !isLive {
                self.error = error.localizedDescription
            }
        }
    }
}

private struct ExecutionToolGroupView: View {
    let group: ExecutionStepGroup
    @State private var isExpanded = false

    private var title: String {
        ExecutionCategory.title(group.category)
    }

    private var accessibilityLabel: String {
        let locale = AppLocalization.selectedLocale
        let count = if group.steps.count == 1 {
            AppLocalization.string("1 次", locale: locale)
        } else {
            String(
                format: AppLocalization.string("%lld 次", locale: locale),
                locale: locale,
                Int64(group.steps.count)
            )
        }
        return "\(title), \(count)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                if group.hasDetails {
                    isExpanded.toggle()
                }
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: ExecutionCategory.icon(group.category))
                        .font(.body).foregroundStyle(.blue)
                        .frame(width: 34, height: 34)
                        .background(Color.blue.opacity(0.09), in: .circle)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 7) {
                            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                            if group.steps.count > 1 {
                                Text("\(group.steps.count) 次").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if !isExpanded, let preview = group.firstPreview {
                            Text(preview).font(.subheadline).foregroundStyle(.secondary)
                                .lineLimit(group.steps.count > 1 ? 2 : 3)
                                .multilineTextAlignment(.leading)
                        }
                        if group.status == "stopped" {
                            Text("未取得结果").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: statusIcon)
                        .foregroundStyle(group.status == "error" ? .red : .secondary)
                    if group.hasDetails {
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(accessibilityLabel)
            if group.steps.count == 1, let failure = group.steps[0].failure {
                Text(failure).font(.caption).foregroundStyle(.red)
                    .textSelection(.enabled).padding(.leading, 46)
            }
            if isExpanded, group.hasDetails {
                ForEach(Array(group.steps.enumerated()), id: \.element.id) { index, step in
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(index + 1)").font(.caption).foregroundStyle(.secondary).frame(width: 18)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(title).font(.caption).foregroundStyle(.secondary)
                            if let preview = step.publicPreview {
                                if let url = step.previewURL {
                                    Link(preview, destination: url)
                                } else {
                                    Text(preview).textSelection(.enabled)
                                }
                            }
                            if let failure = step.failure {
                                Text(failure).foregroundStyle(.red).textSelection(.enabled)
                            }
                        }
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.leading, 46)
                .padding(.bottom, 4)
            }
        }
        .padding(.vertical, 12)
    }

    private var statusIcon: String {
        switch group.status {
        case "running": "circle.dotted"
        case "error": "exclamationmark.circle"
        case "stopped": "circle"
        default: "checkmark.circle"
        }
    }
}
