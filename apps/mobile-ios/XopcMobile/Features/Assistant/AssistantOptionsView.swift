import SwiftUI

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

    private func thinkingLabel(_ level: String) -> String {
        switch level {
        case "off": "关闭"
        case "low": "低"
        case "medium": "中"
        case "high": "高"
        case "xhigh": "极高"
        default: level
        }
    }
}
