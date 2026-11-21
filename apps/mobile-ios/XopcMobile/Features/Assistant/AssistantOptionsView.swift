import SwiftUI
import UIKit

// swiftlint:disable file_length

struct AssistantSessionActionsView: View {
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection?
    let state: AssistantState
    let onStartConversation: (String) -> Void
    let pendingReferences: [ContextReference]
    let onAddReference: (ContextReference) -> Void
    let onConversationUpdated: (ConversationSelection) -> Void
    let onStartScopedConversation: (ProjectRecord?, String?) -> Void
    var isTaskConversation = false
    var onSearch: (() -> Void)?
    var onShare: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @State private var options = AssistantOptionsState()

    var body: some View {
        NavigationStack {
            List {
                if let onShare, let conversation, !conversation.isDraft, !state.messages.isEmpty {
                    Button(action: onShare) { optionRow("分享会话", symbol: "square.and.arrow.up") }
                        .accessibilityIdentifier("assistant-share")
                }
                if !isTaskConversation, let onSearch {
                    Button(action: onSearch) { optionRow("搜索消息", symbol: "magnifyingglass") }
                        .accessibilityIdentifier("assistant-search")
                }
                NavigationLink {
                    ConversationContextView(configuration: configuration, conversation: conversation,
                                            summary: state.contextSummary, isLoading: state.isLoadingContext,
                                            errorMessage: state.contextError, pendingReferences: pendingReferences,
                                            onAddReference: onAddReference,
                                            onStartScopedConversation: { project, mode in
                                                dismiss(); onStartScopedConversation(project, mode)
                                            }, onDirectoryChanged: reloadContext, onRetry: reloadContext)
                } label: {
                    optionRow("上下文", value: state.contextSummary?.work.project?.title ?? "Local", symbol: "folder")
                }
                if !isTaskConversation {
                    NavigationLink {
                        List(state.agents) { agent in
                            Button {
                                dismiss()
                                onStartConversation(agent.id)
                            } label: {
                                HStack {
                                    ConfiguredAgentAvatar(configuration: configuration, agent: agent, size: 36, active: false)
                                    Text(agent.localizedName(locale))
                                    Spacer()
                                    if agent.id == conversation?.agentId {
                                        Image(systemName: "checkmark")
                                    }
                                }.frame(minHeight: 44)
                            }
                        }.navigationTitle("选择新对话对象")
                    } label: {
                        optionRow("对话对象", value: state.agents.first(where: { $0.id == conversation?.agentId })?.localizedName(locale)
                            ?? state.selectedAgent?.localizedName(locale) ?? conversation?.agentId ?? "Main", symbol: "person.crop.circle")
                    }
                }
                if let conversation {
                    NavigationLink {
                        AssistantOptionPicker(configuration: configuration, conversation: conversation,
                                              state: options, pickingModel: true, onSave: onConversationUpdated)
                    } label: {
                        optionRow("模型", value: options.selectedModel?.name ?? "默认模型", symbol: "waveform")
                    }.disabled(options.isLoading)
                    NavigationLink {
                        AssistantOptionPicker(configuration: configuration, conversation: conversation,
                                              state: options, pickingModel: false, onSave: onConversationUpdated)
                    } label: {
                        optionRow("思考档位", value: thinkingLabel(options.thinkingLevel), symbol: "slider.horizontal.3")
                    }.disabled(options.isLoading)
                }
                if !isTaskConversation {
                    Button {
                        dismiss()
                        onStartConversation(conversation?.agentId ?? state.selectedAgentID ?? "main")
                    } label: { optionRow("新建会话", symbol: "square.and.pencil") }
                    NavigationLink {
                        SessionEnvironmentSettingsView(configuration: configuration, conversation: conversation,
                                                       summary: state.contextSummary, onStartScopedConversation: { project, mode in
                                                           dismiss(); onStartScopedConversation(project, mode)
                                                       }, onDirectoryChanged: reloadContext)
                    } label: { optionRow("执行环境与范围", symbol: "folder.badge.gearshape") }
                }
                if let error = options.errorMessage {
                    Text(error).foregroundStyle(.red)
                    Button("重试") { Task { await loadOptions() } }
                }
            }
            .listStyle(.plain)
            .navigationTitle("会话选项")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭", systemImage: "xmark") { dismiss() }.frame(width: 44, height: 44)
                }
            }
            .task { await loadOptions() }
        }
        .presentationDetents([.fraction(0.85)])
        .presentationDragIndicator(.visible)
    }

    private func optionRow(_ title: LocalizedStringKey, value: String? = nil, symbol: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 20)).frame(width: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).mobileTextStyle(.body)
                if let value {
                    Text(value).mobileTextStyle(.footnote).foregroundStyle(.secondary)
                }
            }
        }.frame(minHeight: 52).foregroundStyle(.primary)
    }

    private func loadOptions() async {
        if let conversation {
            await options.load(conversation, using: GatewayClient(configuration: configuration))
        }
    }

    private func reloadContext() {
        guard let conversation, !conversation.isDraft else { return }
        Task { await state.loadContext(for: conversation, using: GatewayClient(configuration: configuration)) }
    }
}

func thinkingLabel(_ level: String) -> String {
    let label: String = switch level {
    case "off": "关闭"
    case "low": "低"
    case "medium": "中"
    case "high": "高"
    case "xhigh": "极高"
    default: level
    }
    return AppLocalization.string(label, locale: AppLocalization.selectedLocale)
}

struct AssistantOptionPicker: View {
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection
    let state: AssistantOptionsState
    let pickingModel: Bool
    let onSave: (ConversationSelection) -> Void
    var reloadAfterError = false

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        List {
            if pickingModel {
                ForEach(state.models.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.id.localizedCaseInsensitiveContains(search) }) { model in
                    Button {
                        state.selectModel(model.id)
                        save()
                    } label: {
                        HStack {
                            Text(model.name)
                            Spacer()
                            if state.selectedModelID == model.id {
                                Image(systemName: "checkmark")
                            }
                        }.frame(minHeight: 44)
                    }.disabled(state.isSaving)
                }
            } else {
                ForEach(state.thinkingOptions, id: \.self) { level in
                    Button {
                        state.thinkingLevel = level
                        save()
                    } label: {
                        HStack {
                            Text(thinkingLabel(level))
                            Spacer()
                            if state.thinkingLevel == level {
                                Image(systemName: "checkmark")
                            }
                        }.frame(minHeight: 44)
                    }.disabled(state.isSaving)
                }
            }
            if let error = state.errorMessage {
                Text(error).foregroundStyle(.red)
                if reloadAfterError {
                    Button("重试") {
                        Task { await state.load(conversation, using: GatewayClient(configuration: configuration)) }
                    }.disabled(state.isLoading || state.isSaving)
                } else {
                    Button("重试", action: save).disabled(state.isSaving)
                }
            }
        }
        .disabled(state.isLoading)
        .searchable(text: $search, prompt: "搜索")
        .navigationTitle(pickingModel ? "模型" : "思考档位")
        .navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(state.isSaving)
    }

    private func save() {
        Task {
            if let updated = await state.save(conversation, using: GatewayClient(configuration: configuration)) {
                onSave(updated)
                dismiss()
            }
        }
    }
}

private struct SessionShareEnvelope<Value: Decodable>: Decodable {
    let payload: Value
}

private struct SessionSharePreview: Decodable {
    struct Message: Decodable, Identifiable {
        let id: String
        let role: String
        let markdown: String
    }

    struct Attachment: Decodable, Identifiable {
        let id: String
        let fileName: String
    }

    let title: String
    let transcriptId: String
    let cutoffSeq: Int
    let metadataUpdatedAt: String
    let messageCount: Int
    let messages: [Message]
    let attachmentCandidates: [Attachment]
}

private struct SessionShareResult: Decodable {
    let id: String
    let fileName: String
    let shareUrl: URL
    let expiresAt: String
    let reachability: String
    let messageCount: Int
    let attachmentCount: Int
    let expired: Bool?
    let revoked: Bool?

    var usable: Bool {
        ["https", "http"].contains(shareUrl.scheme?.lowercased() ?? "") &&
            shareUrl.host != nil && shareUrl.user == nil
    }
}

private struct SessionShareList: Decodable {
    let shares: [SessionShareResult]
}

private struct SessionShareRequest: Encodable {
    let expectedTranscriptId: String
    let expectedCutoffSeq: Int
    let expectedMetadataUpdatedAt: String
    let ttlMs: Int
    let attachmentIds: [String]
    let includeToolActivities = false
}

struct ConversationShareView: View {
    let configuration: GatewayConfiguration
    let conversationID: String

    @Environment(\.dismiss) private var dismiss
    @Environment(\.mobileTheme) private var theme
    @State private var preview: SessionSharePreview?
    @State private var result: SessionShareResult?
    @State private var selected: Set<String> = []
    @State private var ttl = 86_400_000
    @State private var previewShown = false
    @State private var busy = true
    @State private var failed = false
    @State private var copied = false
    @State private var revoked = false
    @State private var confirmingRevoke = false

    private var client: GatewayClient {
        GatewayClient(configuration: configuration)
    }

    private var endpoint: String {
        "/api/sessions/\(conversationID)"
    }

    private var attachments: [SessionSharePreview.Attachment] {
        preview?.attachmentCandidates.filter { selected.contains($0.id) } ?? []
    }

    private var title: LocalizedStringKey {
        if previewShown {
            return "分享预览"
        }
        if result != nil {
            return "分享链接"
        }
        if revoked {
            return "分享已撤销"
        }
        return "分享会话"
    }

    var body: some View {
        NavigationStack {
            List {
                if failed {
                    Section {
                        Text("暂时无法完成分享操作。").foregroundStyle(.secondary)
                        if result == nil {
                            Button("重试") { Task { await load() } }
                        }
                    }
                }
                if busy {
                    ProgressView()
                }
                if let result {
                    resultRows(result)
                } else if revoked {
                    Button("重新分享") {
                        selected.removeAll()
                        ttl = 86_400_000
                        Task { await load() }
                    }
                } else if let preview {
                    if previewShown {
                        previewRows(preview)
                    } else {
                        setupRows(preview)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if previewShown {
                        Button("返回") { previewShown = false }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("关闭") { dismiss() }.disabled(busy)
                }
            }
        }
        .task { await load() }
        .confirmationDialog("撤销链接", isPresented: $confirmingRevoke, titleVisibility: .visible) {
            Button("撤销链接", role: .destructive) { Task { await revoke() } }
        } message: {
            Text("撤销后，持有此链接的人将无法打开分享。")
        }
    }

    private func snapshotCard(_ name: String, messages: Int, attachments: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name).font(.headline)
            Text("\(messages) 条消息 · \(attachments) 个附件").font(.subheadline).foregroundStyle(.secondary)
        }
    }

    // swiftlint:disable:next function_body_length
    @ViewBuilder private func setupRows(_ preview: SessionSharePreview) -> some View {
        Section {
            HStack {
                snapshotCard(preview.title, messages: preview.messageCount, attachments: attachments.count)
                Spacer()
                Button("预览") { previewShown = true }.disabled(busy)
            }
        }
        Section {
            if !preview.attachmentCandidates.isEmpty {
                DisclosureGroup {
                    ForEach(preview.attachmentCandidates) { file in
                        Toggle(file.fileName, isOn: Binding(
                            get: { selected.contains(file.id) },
                            set: {
                                if $0 {
                                    selected.insert(file.id)
                                } else {
                                    selected.remove(file.id)
                                }
                            }
                        ))
                    }
                } label: {
                    LabeledContent {
                        if attachments.isEmpty {
                            Text("不包含")
                        } else {
                            Text("\(attachments.count) 个")
                        }
                    } label: { Text("附件") }
                }.disabled(busy)
            }
            Picker("有效期", selection: $ttl) {
                Text("1 小时").tag(3_600_000)
                Text("24 小时").tag(86_400_000)
                Text("7 天").tag(604_800_000)
                Text("30 天").tag(2_592_000_000)
            }.disabled(busy)
        } footer: {
            Text("持链接者可查看当前快照。后续消息不会同步。")
        }
        Section {
            Button {
                Task { await create(preview) }
            } label: {
                Text("创建分享链接").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .disabled(busy || failed || preview.messageCount == 0)
            .accessibilityIdentifier("conversation-share-create")
        }
    }

    @ViewBuilder private func previewRows(_ preview: SessionSharePreview) -> some View {
        Section {
            snapshotCard(preview.title, messages: preview.messageCount, attachments: attachments.count)
        }
        Section {
            ForEach(preview.messages) { message in
                Text(message.markdown)
                    .padding(10)
                    .background(message.role == "user" ? theme.input : theme.panel, in: .rect(cornerRadius: 12))
                    .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
                    .listRowBackground(Color.clear)
            }
            ForEach(attachments) { file in Label(file.fileName, systemImage: "paperclip") }
        }
    }

    @ViewBuilder private func resultRows(_ result: SessionShareResult) -> some View {
        Section {
            snapshotCard(result.fileName, messages: result.messageCount, attachments: result.attachmentCount)
            Text(result.shareUrl.absoluteString).textSelection(.enabled)
            if let expiresAt = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(result.expiresAt) {
                LabeledContent("到期时间") { Text(expiresAt, format: .dateTime) }
            } else {
                LabeledContent("到期时间", value: result.expiresAt)
            }
            if result.reachability == "lan" {
                Text("同一局域网内可访问").foregroundStyle(.secondary)
            } else if result.reachability == "local-only" {
                Text("仅网关所在电脑可访问").foregroundStyle(.secondary)
            }
        }
        Section {
            Button {
                UIPasteboard.general.url = result.shareUrl
                copied = true
            } label: { Label(copied ? "已复制" : "复制链接", systemImage: "doc.on.doc") }
            Link(destination: result.shareUrl) { Label("查看分享页", systemImage: "arrow.up.right") }
            ShareLink(item: result.shareUrl)
            Button("撤销链接", role: .destructive) { confirmingRevoke = true }
        }.disabled(busy)
    }

    private func load() async {
        busy = true
        failed = false
        defer { busy = false }
        do {
            let existing: SessionShareEnvelope<SessionShareList> = try await client.request(path: endpoint + "/shares")
            result = existing.payload.shares.first { $0.expired == false && $0.revoked == false && $0.usable }
            if result == nil {
                let response: SessionShareEnvelope<SessionSharePreview> = try await client.request(path: endpoint + "/share-preview")
                preview = response.payload
            }
            revoked = false
        } catch { failed = true }
    }

    private func create(_ preview: SessionSharePreview) async {
        guard !busy else { return }
        busy = true
        failed = false
        defer { busy = false }
        do {
            let request = SessionShareRequest(expectedTranscriptId: preview.transcriptId, expectedCutoffSeq: preview.cutoffSeq,
                                              expectedMetadataUpdatedAt: preview.metadataUpdatedAt, ttlMs: ttl,
                                              attachmentIds: attachments.map(\.id))
            let response: SessionShareEnvelope<SessionShareResult> = try await client.request(
                path: endpoint + "/shares", method: "POST", body: client.encoder.encode(request)
            )
            guard response.payload.usable else { throw GatewayClientError.invalidURL }
            result = response.payload
            copied = false
        } catch { failed = true }
    }

    private func revoke() async {
        guard !busy, let result else { return }
        busy = true
        failed = false
        defer { busy = false }
        do {
            try await client.revokeShare(id: result.id)
            self.result = nil
            preview = nil
            revoked = true
        } catch { failed = true }
    }
}
