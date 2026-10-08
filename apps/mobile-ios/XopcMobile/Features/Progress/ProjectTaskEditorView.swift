import SwiftUI

struct ProjectTaskEditorView: View {
    let configuration: GatewayConfiguration
    let projectID: String

    @Environment(\.dismiss) private var dismiss
    @State private var objective = ""
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("任务目标") {
                    TextField("描述需要完成的事项", text: $objective, axis: .vertical)
                        .lineLimit(3 ... 8)
                }
                Section {
                    Text("任务将加入当前项目的待办列表，不会立即启动助手执行。")
                        .mobileTextStyle(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("新建项目任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { Task { await save() } }
                        .disabled(isSaving || objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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

    @MainActor private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await GatewayClient(configuration: configuration).createProjectTask(
                projectID: projectID, objective: objective.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
