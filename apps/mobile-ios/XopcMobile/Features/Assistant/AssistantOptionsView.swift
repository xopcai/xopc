import SwiftUI

struct AssistantSessionActionsView: View {
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection?
    let state: AssistantState
    let onStartConversation: (String) -> Void
    let pendingReferences: [ContextReference]
    let onAddReference: (ContextReference) -> Void
    let onConversationUpdated: (ConversationSelection) -> Void
    let onStartScopedConversation: (ProjectRecord?, String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var options = AssistantOptionsState()

    var body: some View {
        NavigationStack {
            List {
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
                NavigationLink {
                    List(state.agents) { agent in
                        Button {
                            dismiss()
                            onStartConversation(agent.id)
                        } label: {
                            HStack {
                                Text(agent.displayName)
                                Spacer()
                                if agent.id == conversation?.agentId {
                                    Image(systemName: "checkmark")
                                }
                            }.frame(minHeight: 44)
                        }
                    }.navigationTitle("助手角色")
                } label: {
                    optionRow("助手角色", value: state.agents.first(where: { $0.id == conversation?.agentId })?.displayName
                        ?? state.selectedAgent?.displayName ?? conversation?.agentId ?? "Main", symbol: "person.crop.circle")
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
                    if !state.pendingInputs.isEmpty || state.queueError != nil {
                        NavigationLink {
                            ScrollView {
                                QueuedInputsCard(inputs: state.pendingInputs, errorMessage: state.queueError,
                                                 isUpdating: state.isUpdatingQueue,
                                                 onUpdate: { input, content in
                                                     Task { await state.updateQueuedInput(input, content: content, in: conversation,
                                                                                          using: GatewayClient(configuration: configuration)) }
                                                 }, onCancel: { input in
                                                     Task { await state.cancelQueuedInput(input, in: conversation,
                                                                                          using: GatewayClient(configuration: configuration)) }
                                                 }).padding()
                            }.navigationTitle("后续消息队列")
                        } label: { optionRow("后续消息队列", symbol: "square.and.pencil") }
                    }
                }
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

private func thinkingLabel(_ level: String) -> String {
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

private struct AssistantOptionPicker: View {
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection
    let state: AssistantOptionsState
    let pickingModel: Bool
    let onSave: (ConversationSelection) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        List {
            if pickingModel {
                ForEach(state.models.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }) { model in
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
                Button("重试", action: save).disabled(state.isSaving)
            }
        }
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

struct AssistantOptionsView: View {
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection
    let onSave: (ConversationSelection) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var state = AssistantOptionsState()

    var body: some View {
        NavigationStack {
            Form {
                if state.isLoading, state.models.isEmpty {
                    ProgressView("正在读取模型…")
                } else {
                    Section("模型") {
                        Picker("当前模型", selection: modelBinding) {
                            ForEach(state.models) { model in
                                Text(model.name).tag(model.id)
                            }
                        }
                    }
                    Section("思考强度") {
                        Picker("思考强度", selection: $state.thinkingLevel) {
                            ForEach(state.thinkingOptions, id: \.self) { level in
                                Text(thinkingLabel(level)).tag(level)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                }
                if let errorMessage = state.errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("助手设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                        .disabled(state.selectedModelID.isEmpty || state.isSaving)
                }
            }
            .task {
                await state.load(conversation, using: GatewayClient(configuration: configuration))
            }
        }
    }

    private var modelBinding: Binding<String> {
        Binding(
            get: { state.selectedModelID },
            set: { state.selectModel($0) }
        )
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
