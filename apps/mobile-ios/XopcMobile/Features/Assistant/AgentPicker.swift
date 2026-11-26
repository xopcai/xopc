import SwiftUI

extension AgentSummary {
    // swiftlint:disable:next large_tuple
    private static let builtIns: [String: (names: [String], descriptions: [String], label: String)] = [
        "main": (["Main", "Smart Assistant"], ["General assistant", "General-purpose personal assistant.",
                                               "Your personal intelligent assistant for answering questions, handling everyday tasks, and chatting with you anytime."], "assistant"),
        "conductor": (["Conductor"], ["Talks with the user, delegates complex work to specialist Agents, and delivers verified results.",
                                      "User-facing coordination Agent for task planning, delegation, progress, verification, and reporting to the user."], "conductor"),
        "task-router": (["Task Router"], ["Selects one suitable specialist for a delegated task."], "task_router"),
        "coder": (["Coder", "Coding Expert"], ["Software development, debugging, refactoring, and tests.",
                                               "Software engineering agent for repository understanding, implementation, debugging, refactoring, tests, and review."], "coding"),
        "writer": (["Writer", "Writing Assistant"], ["Drafting, editing, rewriting, and audience-aware content."], "writing"),
        "researcher": (["Researcher", "Research Assistant"], ["Deep research, source comparison, and fact synthesis."], "research"),
        "data-analyst": (["Data Analyst"], ["Data cleaning, analysis, visualization, and reproducible reports."], "data"),
        "creative": (["Creative", "Creative Assistant"], ["Visual direction, image prompts, design critique, and creative options."], "creative")
    ]

    var builtInAvatar: String? {
        Self.builtIns[id] == nil ? nil : "agent-\(id)"
    }

    func localizedName(_ locale: Locale) -> String {
        let value = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard let entry = Self.builtIns[id], value.isEmpty || ([id] + entry.names).contains(where: { $0.caseInsensitiveCompare(value) == .orderedSame })
        else { return value.isEmpty ? id : value }
        return AppLocalization.string("agent_builtin_\(entry.label)_name", locale: locale)
    }

    func localizedDescription(_ locale: Locale) -> String {
        let value = description?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if id.range(of: #"^personal-[a-f0-9]{12}$"#, options: .regularExpression) != nil,
           value.isEmpty || value.caseInsensitiveCompare("A personal AI that adapts its responses to the user and coordinates work.") == .orderedSame
        {
            return AppLocalization.string("agent_personal_description", locale: locale)
        }
        guard let entry = Self.builtIns[id], value.isEmpty || entry.descriptions.contains(where: { $0.caseInsensitiveCompare(value) == .orderedSame })
        else { return value }
        return AppLocalization.string("agent_builtin_\(entry.label)_description", locale: locale)
    }
}

struct AgentRuntimeBadge: View {
    let label: String
    @Environment(\.mobileTheme) private var theme

    var body: some View {
        Text(label)
            .font(.caption2.weight(.medium))
            .foregroundStyle(theme.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(theme.input, in: Capsule())
    }
}

struct ExternalAgentProjectPickerView: View {
    let configuration: GatewayConfiguration
    let agent: AgentSummary
    let onSelectProject: (ProjectRecord) -> Void

    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.locale) private var locale
    @State private var projects: [ProjectRecord] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var workspaceProjects: [ProjectRecord] {
        projects.filter { project in
            project.status != "archived"
                && project.workspaceRoot?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        }
    }

    var body: some View {
        List {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
                Button("重试") { Task { await load() } }
            } else if workspaceProjects.isEmpty {
                ContentUnavailableView {
                    Label("需要先绑定项目目录", systemImage: "folder.badge.questionmark")
                } description: {
                    Text("\(agent.localizedName(locale)) 运行在电脑宿主机，请在电脑端为至少一个项目绑定本地工作目录后再使用。")
                }
            } else {
                Section {
                    ForEach(workspaceProjects) { project in
                        Button {
                            onSelectProject(project)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(project.name).font(.headline)
                                if let root = project.workspaceRoot, !root.isEmpty {
                                    Text(root).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            .frame(minHeight: 48)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("选择要操作的代码项目")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(mobileTheme.panel.ignoresSafeArea())
        .navigationTitle(agent.localizedName(locale))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            projects = try await GatewayClient(configuration: configuration).fetchProjects().items
        } catch is CancellationError {} catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct AgentPicker: View {
    let configuration: GatewayConfiguration
    let agents: [AgentSummary]
    let currentID: String?
    let personal: PersonalAgentRecord?
    let select: (String) -> Void
    var onSelectProjectAgent: ((ProjectRecord, String) -> Void)?

    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.locale) private var locale
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var catalog: [AgentSummary] = []
    @State private var didLoad = false
    @State private var loadFailed = false

    var body: some View {
        NavigationStack {
            List {
                let list = didLoad ? catalog : agents
                if loadFailed, list.isEmpty {
                    Button("重试") { Task { await refresh() } }
                }
                ForEach(list.filter { agent in
                    search.isEmpty || agent.localizedName(locale).localizedCaseInsensitiveContains(search)
                        || agent.localizedDescription(locale).localizedCaseInsensitiveContains(search)
                }) { agent in
                    if agent.isExternalRuntime, let onSelectProjectAgent {
                        NavigationLink {
                            ExternalAgentProjectPickerView(configuration: configuration, agent: agent) { project in
                                dismiss()
                                onSelectProjectAgent(project, agent.id)
                            }
                        } label: {
                            agentRow(agent)
                        }
                        .accessibilityIdentifier("agent-picker-\(agent.id)")
                    } else {
                        Button {
                            dismiss()
                            select(agent.id)
                        } label: {
                            agentRow(agent)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("agent-picker-\(agent.id)")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(mobileTheme.panel.ignoresSafeArea())
            .searchable(text: $search, prompt: "搜索")
            .navigationTitle("切换 Agent").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } }
            }
            .task { await refresh() }
        }
        .mobileSheetPreset(.medium)
    }

    private func agentRow(_ agent: AgentSummary) -> some View {
        HStack(spacing: 12) {
            if let personal, personal.agentId == agent.id {
                PersonalAgentAvatar(configuration: configuration, agent: personal, size: 42, active: false)
            } else {
                ConfiguredAgentAvatar(configuration: configuration, agent: agent, size: 42, active: false)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(agent.localizedName(locale)).font(.headline)
                    if let badge = agent.externalRuntimeBadge {
                        AgentRuntimeBadge(label: badge)
                    }
                }
                let description = agent.localizedDescription(locale)
                if !description.isEmpty {
                    Text(description).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if agent.id == currentID {
                Image(systemName: "checkmark").foregroundStyle(.tint)
            }
        }
        .frame(minHeight: 52)
    }

    private func refresh() async {
        do {
            catalog = try await GatewayClient(configuration: configuration).fetchAgents().agents
            didLoad = true
            loadFailed = false
        } catch is CancellationError {} catch { loadFailed = true }
    }
}
