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

struct AgentPicker: View {
    let configuration: GatewayConfiguration
    let agents: [AgentSummary]
    let currentID: String?
    let personal: PersonalAgentRecord?
    let select: (String) -> Void

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
                    Button {
                        dismiss()
                        select(agent.id)
                    } label: {
                        HStack(spacing: 12) {
                            if let personal, personal.agentId == agent.id {
                                PersonalAgentAvatar(configuration: configuration, agent: personal, size: 42, active: false)
                            } else {
                                ConfiguredAgentAvatar(configuration: configuration, agent: agent, size: 42, active: false)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(agent.localizedName(locale)).font(.headline)
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
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("agent-picker-\(agent.id)")
                }
            }
            .searchable(text: $search, prompt: "搜索")
            .navigationTitle("切换 Agent").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } }
            }
            .task { await refresh() }
        }
    }

    private func refresh() async {
        do {
            catalog = try await GatewayClient(configuration: configuration).fetchAgents().agents
            didLoad = true
            loadFailed = false
        } catch is CancellationError {} catch { loadFailed = true }
    }
}
