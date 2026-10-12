import SwiftUI

struct TaskEditorView: View {
    let configuration: GatewayConfiguration
    let task: TaskRecord

    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var bodyText: String
    @State private var projectID: String
    @State private var dueDate: Date
    @State private var hasDueDate: Bool
    @State private var projects: [ProjectRecord] = []
    @State private var projectsError: String?
    @State private var priority: String
    @State private var isSaving = false
    @State private var error: String?
    @State private var confirmsDiscard = false

    private var isDirty: Bool {
        title != task.title || bodyText != (task.body ?? "") || priority != (task.priority ?? "normal")
            || projectID != (task.projectId ?? "") || hasDueDate != (task.dueAt != nil)
            || (hasDueDate && Int64((dueDate.timeIntervalSince1970 * 1000).rounded()) != task.dueAt)
    }

    init(configuration: GatewayConfiguration, task: TaskRecord) {
        self.configuration = configuration
        self.task = task
        _title = State(initialValue: task.title)
        _bodyText = State(initialValue: task.body ?? "")
        _projectID = State(initialValue: task.projectId ?? "")
        _hasDueDate = State(initialValue: task.dueAt != nil)
        _dueDate = State(initialValue: task.dueAt?.millisecondsDate ?? Date())
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
                Section("项目") {
                    Picker("项目", selection: $projectID) {
                        Text("不关联项目").tag("")
                        if !projectID.isEmpty, !projects.contains(where: { $0.id == projectID }) {
                            Text(projectID).tag(projectID)
                        }
                        ForEach(projects) { Text($0.name).tag($0.id) }
                    }
                    if let projectsError {
                        Text(projectsError).foregroundStyle(.red)
                        Button("重试") { Task { await loadProjects() } }
                    }
                }
                Section("截止日期") {
                    Toggle("设置截止日期", isOn: $hasDueDate)
                    if hasDueDate {
                        DatePicker("截止日期", selection: $dueDate, displayedComponents: [.date, .hourAndMinute])
                    }
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
            .disabled(isSaving)
            .task { await loadProjects() }
            .navigationTitle("编辑任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") {
                    if isDirty {
                        confirmsDiscard = true
                    } else {
                        dismiss()
                    }
                }.disabled(isSaving) }
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
        .interactiveDismissDisabled(isSaving || isDirty)
        .confirmationDialog("放弃修改？", isPresented: $confirmsDiscard, titleVisibility: .visible) {
            Button("放弃修改", role: .destructive) { dismiss() }
            Button("继续编辑", role: .cancel) {}
        }
    }

    @MainActor private func loadProjects() async {
        do { projects = try await GatewayClient(configuration: configuration).fetchProjects().items; projectsError = nil }
        catch { projectsError = error.localizedDescription }
    }

    @MainActor private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            _ = try await GatewayClient(configuration: configuration).updateTask(
                task, mutation: TaskUpdateMutation(
                    expectedVersion: task.version, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                    body: bodyText.trimmingCharacters(in: .whitespacesAndNewlines), priority: priority,
                    projectId: projectID.isEmpty ? nil : projectID,
                    dueAt: hasDueDate ? Int64((dueDate.timeIntervalSince1970 * 1000).rounded()) : nil
                )
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
