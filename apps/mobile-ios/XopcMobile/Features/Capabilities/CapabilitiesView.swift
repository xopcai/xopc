import SwiftUI

private enum CapabilityCategory: String, CaseIterable, Identifiable {
    case plugins, skills, connections, agents, channels

    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .plugins: "capability_plugins"
        case .skills: "capability_skills"
        case .connections: "capability_connections"
        case .agents: "capability_agents"
        case .channels: "capability_channels"
        }
    }

    var symbol: String {
        switch self {
        case .plugins: "puzzlepiece"
        case .skills: "checklist"
        case .connections: "link"
        case .agents: "person.2"
        case .channels: "bubble.left"
        }
    }

    var promptKey: String {
        switch self {
        case .plugins: "capability_plugin_prompt"
        case .skills: "capability_skill_prompt"
        case .connections: "capability_connection_prompt"
        case .agents: "capability_agent_prompt"
        case .channels: "capability_channel_prompt"
        }
    }
}

private struct CapabilityCatalogPage: Decodable {
    let items: [CapabilityCatalogItem]
    let incomplete: Bool?
}

private struct CapabilityCatalogItem: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let group: String
    let avatar: String?
    var targetId: String?
    var version: String?
    var issue: String?

    var agent: AgentSummary {
        AgentSummary(id: id, name: name, description: description, language: nil, avatar: avatar, isDefault: nil)
    }
}

// swiftlint:disable:next type_body_length
struct CapabilitiesView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let personal: PersonalAgentRecord?
    let onOpenAgent: (String, Bool) -> Void
    let onOpenDraft: (String) -> Void

    @Environment(\.locale) private var locale
    @State private var category = CapabilityCategory.plugins
    @State private var query = ""
    @State private var pages: [CapabilityCategory: CapabilityCatalogPage] = [:]
    @State private var failed = false
    @State private var loading = true
    @State private var revision = 0
    @State private var detail: CapabilityCatalogItem?
    @FocusState private var searchFocused: Bool

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    Color.clear.frame(height: 0).id("capability-top")
                    catalogContent
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .onChange(of: query) { _, _ in scroll.scrollTo("capability-top") }
            .onChange(of: category) { _, _ in scroll.scrollTo("capability-top") }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(mobileTheme.canvas)
        .safeAreaInset(edge: .bottom, spacing: 0) { searchField }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { categoryMenu }
            ToolbarItem(placement: .primaryAction) {
                Button("capability_retry", systemImage: "arrow.clockwise") { revision += 1 }
                    .labelStyle(.iconOnly).disabled(loading).accessibilityIdentifier("capability-refresh")
            }
        }
        .task(id: "\(category.id):\(revision):\(locale.identifier)") { await load() }
        .sheet(item: $detail) { item in detailView(item) }
    }

    private var categoryMenu: some View {
        Menu {
            ForEach(CapabilityCategory.allCases) { option in
                Button {
                    if category != option {
                        searchFocused = false
                        query = ""
                        category = option
                    }
                } label: {
                    if category == option {
                        Label(option.title, systemImage: "checkmark")
                    } else {
                        Text(option.title)
                    }
                }
                .accessibilityIdentifier("capability-category-\(option.id)")
            }
        } label: {
            HStack(spacing: 6) {
                Text(category.title).font(.headline)
                Image(systemName: "chevron.down").font(.caption.weight(.semibold))
            }
            .foregroundStyle(.primary)
            .frame(minHeight: 44)
        }
        .accessibilityIdentifier("capability-category")
    }

    @ViewBuilder private var catalogContent: some View {
        let page = pages[category]
        let groups = Dictionary(grouping: matches, by: \.group)
        Button {
            searchFocused = false
            let label = AppLocalization.string("capability_\(category.id)", locale: locale)
            let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
            onOpenDraft(term.isEmpty ? prompt("capability_find_prompt", label)
                : prompt("capability_find_query_prompt", label, quoted(term)))
        } label: {
            Label("capability_discover", systemImage: "bubble.left")
                .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(mobileTheme.action)
                .background(mobileTheme.grouped, in: .rect(cornerRadius: mobileTheme.corner(16)))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("capability-discover")
        if loading, page == nil {
            ProgressListSkeleton()
        }
        if failed || page?.incomplete == true {
            HStack {
                Text(failed ? "capability_load_failed" : "capability_partial")
                    .foregroundStyle(.secondary)
                Spacer()
                Button("capability_retry") { revision += 1 }
            }
        }
        if groups.isEmpty, !loading, !failed {
            ContentUnavailableView {
                Label(query.isEmpty ? "capability_empty" : "capability_no_matches", systemImage: "magnifyingglass")
            } actions: {
                if !query.isEmpty {
                    Button("capability_clear") { query = "" }
                }
            }
            .accessibilityIdentifier("capability-empty")
        }
        ForEach(["attention", "assistant", "expert", "connected", "installed", "configured", "disabled", "available"], id: \.self) { group in
            if let rows = groups[group] {
                Text(groupTitle(group))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 8)
                ForEach(rows) { item in
                    Button {
                        searchFocused = false
                        detail = item
                    } label: {
                        catalogRow(item)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("capability-row-\(item.id)")
                }
            }
        }
    }

    private var matches: [CapabilityCatalogItem] {
        var rows = pages[category]?.items ?? []
        if category == .agents {
            rows = rows.map { item in
                CapabilityCatalogItem(id: item.id, name: item.agent.localizedName(locale),
                                      description: item.agent.localizedDescription(locale), group: item.group, avatar: item.avatar)
            }
        }
        if category == .agents, let personal, personal.state == "ready" {
            rows.removeAll { $0.id == personal.agentId }
            rows.insert(CapabilityCatalogItem(id: personal.agentId, name: personal.displayName,
                                              description: AppLocalization.string("capability_personal_description", locale: locale),
                                              group: "assistant", avatar: nil), at: 0)
        }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return needle.isEmpty ? rows : rows.filter { item in
            [item.name, item.id, item.description ?? ""].contains { $0.localizedCaseInsensitiveContains(needle) }
        }
    }

    private var searchField: some View {
        let localizedCategory = AppLocalization.string("capability_\(category.id)", locale: locale)
        let format = AppLocalization.string("capability_search", locale: locale)
        return HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(String(format: format, localizedCategory), text: $query)
                .focused($searchFocused)
                .submitLabel(.search)
                .onSubmit { searchFocused = false }
                .onChange(of: query) { _, value in
                    if value.count > 160 {
                        query = String(value.prefix(160))
                    }
                }
                .accessibilityIdentifier("capability-search")
            if !query.isEmpty {
                Button("capability_clear", systemImage: "xmark.circle.fill") { query = "" }
                    .labelStyle(.iconOnly)
                    .frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 50)
        .background(mobileTheme.panel, in: .capsule)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(mobileTheme.canvas)
    }

    private func prompt(_ key: String, _ arguments: CVarArg...) -> String {
        String(format: AppLocalization.string(key, locale: locale), arguments: arguments)
    }

    private func quoted(_ text: String) -> String {
        guard let encoded = try? JSONEncoder().encode(text) else { return "" }
        return String(bytes: encoded, encoding: .utf8) ?? ""
    }

    private func channelIssue(_ code: String) -> LocalizedStringKey {
        switch code {
        case "telegram.missing_credential": "capability_channel_telegram"
        case "weixin.missing_account": "capability_channel_weixin"
        case "feishu.missing_credentials": "capability_channel_feishu"
        default: "capability_channel_config"
        }
    }

    private func administrationURL(_ item: CapabilityCatalogItem) -> URL? {
        guard var base = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false),
              base.scheme == "https", base.host != nil, base.user == nil, base.password == nil else { return nil }
        let id = (item.targetId ?? item.id).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        base.query = nil
        switch category {
        case .plugins: base.percentEncodedFragment = "/capabilities/extensions" + (item.group == "available" ? "" : "/\(id)")
        case .channels: base.percentEncodedFragment = "/capabilities/channels/\(id)"
        case .connections: base.fragment = "/capabilities/connectors"
        default: return nil
        }
        return base.url
    }

    private func catalogRow(_ item: CapabilityCatalogItem) -> some View {
        HStack(spacing: 12) {
            icon(item)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: item.name).font(.subheadline.weight(.semibold))
                if let description = item.description, !description.isEmpty {
                    Text(verbatim: description).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        }
        .frame(minHeight: 62)
        .contentShape(.rect)
    }

    @ViewBuilder private func icon(_ item: CapabilityCatalogItem) -> some View {
        if category == .agents, personal?.agentId == item.id {
            PersonalAgentAvatar(configuration: configuration, agent: personal, size: 44, active: false)
        } else if category == .agents {
            ConfiguredAgentAvatar(configuration: configuration, agent: item.agent, size: 44, active: false)
        } else {
            Image(systemName: category.symbol)
                .foregroundStyle(Color.accentColor)
                .frame(width: 44, height: 44)
                .background(Color.accentColor.opacity(0.11), in: .rect(cornerRadius: mobileTheme.corner(12)))
                .accessibilityHidden(true)
        }
    }

    // swiftlint:disable:next function_body_length
    private func detailView(_ item: CapabilityCatalogItem) -> some View {
        let canStartChat = category == .agents && item.group != "disabled"
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    icon(item)
                    Text(verbatim: item.name).font(.title2.weight(.semibold))
                    Text(groupTitle(item.group)).font(.subheadline).foregroundStyle(.secondary)
                    if let description = item.description {
                        Text(verbatim: description)
                    }
                    if let version = item.version {
                        Text(verbatim: prompt("capability_version_label", version)).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let issue = item.issue {
                        Text(channelIssue(issue)).font(.subheadline).foregroundStyle(mobileTheme.secondary)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(mobileTheme.grouped, in: .rect(cornerRadius: mobileTheme.corner(12)))
                    }
                    if canStartChat {
                        Button("capability_start_chat") {
                            detail = nil
                            onOpenAgent(item.id, personal?.agentId == item.id)
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("capability-start-chat")
                    }
                    if personal?.agentId != item.id {
                        Button {
                            detail = nil
                            onOpenDraft(prompt(category.promptKey, quoted(item.id)))
                        } label: {
                            Label("capability_open_chat", systemImage: "bubble.left")
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .foregroundStyle(canStartChat ? mobileTheme.action : mobileTheme.onAction)
                                .background(canStartChat ? mobileTheme.grouped : mobileTheme.action,
                                            in: .rect(cornerRadius: mobileTheme.corner(14)))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("capability-open-chat")
                    }
                    if let url = administrationURL(item) {
                        Link(destination: url) { Label("capability_web_manage", systemImage: "arrow.up.right") }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("capability-web-manage")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭", systemImage: "xmark") { detail = nil }
                        .labelStyle(.iconOnly)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(mobileTheme.panel)
    }

    private func groupTitle(_ group: String) -> LocalizedStringKey {
        switch group {
        case "assistant": "capability_my_assistants"
        case "expert": "capability_experts"
        case "installed": "capability_installed"
        case "connected": "capability_connected"
        case "configured": "capability_configured"
        case "attention": "capability_attention"
        case "disabled": "capability_disabled"
        default: "capability_available"
        }
    }

    @MainActor private func load() async {
        let requested = category
        failed = false
        loading = true
        defer {
            if !Task.isCancelled {
                loading = false
            }
        }
        do {
            let response: GatewayEnvelope<CapabilityCatalogPage> = try await GatewayClient(configuration: configuration).request(
                path: "/api/capabilities/mobile-catalog",
                queryItems: [URLQueryItem(name: "category", value: requested.id), URLQueryItem(name: "locale", value: locale.identifier)]
            )
            guard response.isSuccessful, let page = response.payload else { throw GatewayClientError.invalidResponse }
            try Task.checkCancellation()
            pages[requested] = page
        } catch is CancellationError {} catch {
            if !Task.isCancelled {
                failed = true
            }
        }
    }
}
