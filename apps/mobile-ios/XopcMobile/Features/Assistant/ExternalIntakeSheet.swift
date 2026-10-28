import SwiftUI

struct ExternalIntakeSheet: View {
    let batch: ExternalIntakeBatch
    let configuration: GatewayConfiguration
    let current: ConversationSelection?
    var importError: String? = nil
    let onSelect: (ExternalIntakeBatch, ConversationSelection) -> Void
    let onCancel: () -> Void
    @State private var search = ""
    @State private var selected = "new"
    @State private var results: [ConversationSummary] = []
    @State private var loading = false
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var chooseAgain = false
    private var effectiveTarget: ExternalIntakeTarget? { chooseAgain ? nil : batch.target }
    @State private var excluded: Set<UUID> = []

    var body: some View {
        NavigationStack {
            List {
                Section("文件") {
                    ForEach(batch.files) { file in
                        HStack {
                            Label(file.name, systemImage: file.mimeType.hasPrefix("image/") ? "photo" : "doc")
                            Spacer()
                            Button(excluded.contains(file.id) ? "恢复" : "移除") {
                                if excluded.contains(file.id) { excluded.remove(file.id) } else { excluded.insert(file.id) }
                            }.buttonStyle(.borderless)
                        }
                    }
                    ForEach(batch.errors.indices, id: \.self) { index in Text(batch.errors[index]).foregroundStyle(.red) }
                }
                Section("添加到") {
                    if let target = effectiveTarget {
                        Text(target.title)
                        if target.scope == ComposerDraftStore.accountScope(configuration) {
                            Button("选择其他对话") { chooseAgain = true; selected = "new" }
                        }
                        if target.scope != ComposerDraftStore.accountScope(configuration) {
                            Text("请切换回原网关和账号继续").foregroundStyle(.red)
                        }
                    } else {
                        targetRow("new", title: "新对话（推荐）")
                        if let current { targetRow(current.id, title: "当前对话 · \(current.title)") }
                        TextField("搜索已有对话", text: $search)
                        if loading { RoundedRectangle(cornerRadius: 8).fill(.quaternary).frame(height: 48) }
                        ForEach(results.filter { $0.id != current?.id && $0.status != "archived" }) { summary in
                            targetRow(summary.id, title: summary.displayName, detail: summary.agentId)
                        }
                    }
                }
                if let message = errorMessage ?? importError { Text(message).foregroundStyle(.red) }
            }
            .navigationTitle("添加到对话")
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 12) {
                    Text("保留原草稿，点击发送后才交给 AI").font(.footnote).foregroundStyle(.secondary)
                    Button("加入输入框") { Task { await add() } }
                        .buttonStyle(.borderedProminent).disabled(busy || batch.files.allSatisfy { excluded.contains($0.id) } ||
                            (effectiveTarget != nil && effectiveTarget?.scope != ComposerDraftStore.accountScope(configuration)))
                }.padding().frame(maxWidth: .infinity).background(.regularMaterial)
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消", action: onCancel).disabled(busy) } }
            .task(id: search) {
                loading = true
                defer { loading = false }
                do {
                    let page = try await GatewayClient(configuration: configuration).fetchConversations(search: search)
                    guard !Task.isCancelled else { return }
                    results = page.items
                } catch is CancellationError { return }
                catch { errorMessage = error.localizedDescription }
            }
            .interactiveDismissDisabled()
        }
    }

    private func targetRow(_ id: String, title: String, detail: String? = nil) -> some View {
        Button { selected = id } label: {
            HStack {
                Image(systemName: selected == id ? "largecircle.fill.circle" : "circle")
                VStack(alignment: .leading) { Text(title); if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) } }
            }.frame(minHeight: 44)
        }.buttonStyle(.plain).disabled(busy)
    }

    @MainActor private func add() async {
        busy = true
        defer { busy = false }
        do {
            let conversation: ConversationSelection
            if let target = effectiveTarget {
                conversation = target.isDraft ? .intakeDraft(target)
                    : .existing(id: target.conversationID, title: target.title, agentId: target.agentID)
            } else if selected == "new" {
                let agents = try await GatewayClient(configuration: configuration).fetchAgents()
                conversation = .draft(agentId: agents.defaultId)
            } else if let current, current.id == selected { conversation = current }
            else if let summary = results.first(where: { $0.id == selected }) { conversation = ConversationSelection(summary: summary) }
            else { throw CocoaError(.fileNoSuchFile) }
            if !conversation.isDraft {
                _ = try await GatewayClient(configuration: configuration).fetchAgentConfiguration(conversationID: conversation.id)
            }
            guard !Task.isCancelled else { return }
            var assigned = batch
            assigned.target = ExternalIntakeTarget(scope: ComposerDraftStore.accountScope(configuration),
                conversationID: conversation.id, title: conversation.title, agentID: conversation.agentId, isDraft: conversation.isDraft, projectID: conversation.projectId, executionMode: conversation.executionMode, model: conversation.model, thinkingLevel: conversation.thinkingLevel)
            assigned.files.removeAll { excluded.contains($0.id) }
            try ExternalIntakeStore().save(assigned)
            onSelect(assigned, conversation)
        } catch { errorMessage = error.localizedDescription }
    }
}
