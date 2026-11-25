import SwiftUI

private struct ProjectWrite: Encodable {
    var name: String?
    var description: String?
    var status: String?
    var expectedVersion: Int?
}

extension GatewayClient {
    func saveProject(_ project: ProjectRecord?, name: String, description: String, key: UUID) async throws -> ProjectRecord {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 160, description.count <= 4000 else {
            throw GatewayClientError.invalidResponse
        }
        let body = ProjectWrite(name: trimmed, description: description, expectedVersion: project?.version)
        return try await writeProject(project, body: body, key: key)
    }

    func changeProjectStatus(_ project: ProjectRecord, archived: Bool) async throws -> ProjectRecord {
        try await writeProject(project, body: ProjectWrite(status: archived ? "archived" : "active",
                                                           expectedVersion: project.version))
    }

    func changeProjectPin(_ project: ProjectRecord, pinned: Bool) async throws -> ProjectRecord {
        try await writeProject(project, body: ProjectWrite(expectedVersion: project.version), action: pinned ? "pin" : "unpin")
    }

    private func writeProject(_ project: ProjectRecord?, body: ProjectWrite, action: String? = nil,
                              key: UUID? = nil) async throws -> ProjectRecord
    {
        let path = "/api/projects" + (project.map { "/\($0.id)" } ?? "") + (action.map { "/\($0)" } ?? "")
        let response: ProjectDetailEnvelope = try await request(path: path, method: project == nil || action != nil ? "POST" : "PATCH",
                                                                body: encoder.encode(body), idempotencyKey: project == nil ? key : nil)
        guard response.ok, project == nil || response.project.id == project?.id else { throw GatewayClientError.invalidResponse }
        return response.project
    }
}

struct ProjectManageView: View {
    let configuration: GatewayConfiguration
    let project: ProjectRecord?
    let onSaved: (ProjectRecord) -> Void

    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var description: String
    @State private var busy = false
    @State private var savingKey = UUID()
    @State private var error: String?

    init(configuration: GatewayConfiguration, project: ProjectRecord? = nil, onSaved: @escaping (ProjectRecord) -> Void) {
        self.configuration = configuration
        self.project = project
        self.onSaved = onSaved
        _name = State(initialValue: project?.name ?? "")
        _description = State(initialValue: project?.description ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("名称", text: $name).accessibilityIdentifier("project-edit-name")
                    TextField("描述", text: $description, axis: .vertical)
                        .lineLimit(3 ... 8)
                        .accessibilityIdentifier("project-edit-description")
                }
                if let project {
                    Section {
                        Button(project.pinnedAt == nil ? "置顶" : "取消置顶", systemImage: "pin") {
                            perform { try await $0.changeProjectPin(project, pinned: project.pinnedAt == nil) }
                        }
                        Button(project.status == "archived" ? "恢复项目" : "归档项目", systemImage: "archivebox") {
                            perform { try await $0.changeProjectStatus(project, archived: project.status != "archived") }
                        }
                    }
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
            }
            .scrollContentBackground(.hidden)
            .background(mobileTheme.panel.ignoresSafeArea())
            .disabled(busy)
            .navigationTitle(project == nil ? "新建项目" : "项目设置")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: name) { savingKey = UUID() }
            .onChange(of: description) { savingKey = UUID() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        perform { try await $0.saveProject(project, name: name, description: description, key: savingKey) }
                    }
                    .disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || name.count > 160 || description.count > 4000
                        || (name == project?.name && description == (project?.description ?? "")))
                    .accessibilityIdentifier("project-edit-save")
                }
            }
        }
        .interactiveDismissDisabled(busy)
        .mobileSheetPreset(.medium)
    }

    private func perform(_ operation: @escaping (GatewayClient) async throws -> ProjectRecord) {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await onSaved(operation(GatewayClient(configuration: configuration)))
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
