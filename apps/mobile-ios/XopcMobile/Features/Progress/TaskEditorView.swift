import SwiftUI

struct TaskEditorView: View {
    let configuration: GatewayConfiguration
    let task: TaskRecord

    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var bodyText: String
    @State private var priority: String
    @State private var isSaving = false
    @State private var error: String?

    init(configuration: GatewayConfiguration, task: TaskRecord) {
        self.configuration = configuration
        self.task = task
        _title = State(initialValue: task.title)
        _bodyText = State(initialValue: task.body ?? "")
        _priority = State(initialValue: task.priority ?? "normal")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("任务标题") {
                    TextField("任务标题", text: $title)
                }
                Section("说明") {
                    TextField("任务说明", text: $bodyText, axis: .vertical)
                        .lineLimit(4 ... 10)
                }
                Section("优先级") {
                    Picker("优先级", selection: $priority) {
                        Text("低").tag("low")
                        Text("普通").tag("normal")
                        Text("高").tag("high")
                        Text("紧急").tag("critical")
                    }
                }
            }
            .navigationTitle("编辑任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { Task { await save() } }
                        .disabled(isSaving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
            _ = try await GatewayClient(configuration: configuration).updateTask(
                task, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                body: bodyText.trimmingCharacters(in: .whitespacesAndNewlines), priority: priority
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
