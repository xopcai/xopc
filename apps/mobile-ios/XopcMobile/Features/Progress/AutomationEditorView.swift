import SwiftUI

struct AutomationEditorView: View {
    let configuration: GatewayConfiguration
    let existing: AutomationRecord

    @Environment(\.locale) private var locale
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var instruction: String
    @State private var cron: String
    @State private var isEnabled: Bool
    @State private var isSaving = false
    @State private var error: String?

    init(configuration: GatewayConfiguration, existing: AutomationRecord) {
        self.configuration = configuration
        self.existing = existing
        _name = State(initialValue: existing.name)
        _instruction = State(initialValue: existing.action.instruction ?? "")
        _cron = State(initialValue: existing.trigger.schedule?.cronExpression ?? "")
        _isEnabled = State(initialValue: existing.enabled)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    TextField("名称", text: $name)
                    TextField("执行说明", text: $instruction, axis: .vertical)
                        .lineLimit(4 ... 10)
                        .accessibilityIdentifier("automation-instruction")
                }
                Section("定时规则") {
                    automationScheduleText(existing, locale: locale, expression: cron)
                    DisclosureGroup("高级排期") {
                        TextField("Cron 表达式", text: $cron)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    Toggle(isOn: $isEnabled) {
                        Text("启用自动化")
                    }
                }
            }
            .navigationTitle("编辑自动化")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { Task { await save() } }
                        .disabled(isSaving || !canSave)
                }
            }
            .overlay {
                if isSaving {
                    ProgressView("正在保存…").padding().background(.regularMaterial, in: .rect(cornerRadius: 14))
                }
            }
            .alert("保存失败", isPresented: Binding(get: { error != nil }, set: {
                if !$0 {
                    error = nil
                }
            })) {
                Button("好", role: .cancel) {}
            } message: { Text(error ?? "未知错误") }
        }
    }

    private var canSave: Bool {
        [name, instruction, cron].allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let client = GatewayClient(configuration: configuration)
            _ = try await client.updateScheduledAutomation(
                existing, name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                instruction: instruction.trimmingCharacters(in: .whitespacesAndNewlines),
                cron: cron.trimmingCharacters(in: .whitespacesAndNewlines), enabled: isEnabled
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
