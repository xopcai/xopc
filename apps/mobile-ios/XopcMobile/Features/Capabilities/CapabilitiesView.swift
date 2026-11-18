// swiftlint:disable file_length
import CoreImage.CIFilterBuiltins
import Photos
import SwiftUI

private let capabilityQrContext = CIContext()
private let capabilityCompactDetent = PresentationDetent.height(420)
private let capabilityExpandedDetent = PresentationDetent.fraction(0.82)

private enum CapabilityCategory: String, CaseIterable, Identifiable {
    case plugins, skills, connections, agents, channels

    var id: String {
        rawValue
    }

    var title: LocalizedStringResource {
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

    var tabWidth: CGFloat {
        switch self {
        case .agents: 86
        case .channels: 74
        default: 56
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
    var iconUrl: String?

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
    let onSetupChat: (String, String?) -> Void
    var onPersonalChanged: () -> Void = {}

    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("navigation.capabilities") private var category = CapabilityCategory.plugins
    @State private var queries: [CapabilityCategory: String] = [:]
    @State private var positions: [CapabilityCategory: String] = [:]
    @State private var pages: [CapabilityCategory: CapabilityCatalogPage] = [:]
    @State private var failures: Set<CapabilityCategory> = []
    @State private var requests: [CapabilityCategory: Task<Void, Never>] = [:]
    @State private var detail: CapabilityCatalogItem?
    @State private var pendingChatPrompt: String?
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SegmentedTabs(options: CapabilityCategory.allCases.map {
                SegmentOption(id: $0, title: $0.title, accessibilityID: "capability-category-\($0.id)", minimumWidth: 44)
            }, selected: category, label: "capability_title", minimumSegmentWidth: 44, onSelect: selectCategory)
            .padding(.horizontal, 18)
            .accessibilityIdentifier("capability-categories")

            TabView(selection: $category) {
                ForEach(CapabilityCategory.allCases) { kind in
                    catalogPage(kind).tag(kind)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .accessibilityIdentifier("capability-pager")
        }
        .background(mobileTheme.canvas)
        .safeAreaInset(edge: .bottom, spacing: 0) { searchField }
        .mobilePageTitle(Text("capability_title"))
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if category == .skills {
                    Button("capability_skill_market", systemImage: "magnifyingglass") { openSkillMarket() }
                        .labelStyle(.iconOnly).foregroundStyle(mobileTheme.action).accessibilityIdentifier("capability-add-skills")
                } else if category == .plugins {
                    Button("capability_search_plugins", systemImage: "magnifyingglass") { searchFocused = true }
                        .labelStyle(.iconOnly).foregroundStyle(mobileTheme.action)
                        .accessibilityIdentifier("capability-add-plugins")
                }
                if category == .skills || category == .agents || category == .connections {
                    Button(setupLabel, systemImage: "plus") { startSetup() }
                        .labelStyle(.iconOnly).foregroundStyle(mobileTheme.action)
                        .accessibilityIdentifier(category == .connections ? "capability-add-mcp" : "capability-chat-setup-\(category.id)")
                }
            }
        }
        .onChange(of: category, initial: true) {
            searchFocused = false
            loadNearby()
        }
        .onChange(of: locale.identifier) { reloadCatalog() }
        .onChange(of: configuration) { reloadCatalog() }
        .onDisappear { cancelRequests() }
        .sheet(item: $detail, onDismiss: {
            guard let prompt = pendingChatPrompt else { return }
            pendingChatPrompt = nil
            onSetupChat(prompt, nil)
        }) { item in detailView(item) }
    }

    private var setupLabel: LocalizedStringKey {
        switch category {
        case .agents: "capability_create_agent"
        case .skills: "capability_create_skill"
        default: "capability_add_mcp"
        }
    }

    private func openSkillMarket() {
        searchFocused = false
        detail = CapabilityCatalogItem(id: "marketplace:search", name: AppLocalization.string("capability_skill_market", locale: locale),
                                       description: nil, group: "available", avatar: nil)
    }

    private func startSetup() {
        searchFocused = false
        if category == .connections {
            detail = CapabilityCatalogItem(id: "mcp:setup", name: AppLocalization.string("capability_add_mcp", locale: locale),
                                           description: nil, group: "available", avatar: nil)
            return
        }
        let key = category == .agents ? "capability_agent_setup_prompt" : "capability_skill_setup_prompt"
        onSetupChat(AppLocalization.string(key, locale: locale),
                    category == .agents ? (locale.identifier.hasPrefix("zh") ? "zh-CN" : "en") : nil)
    }

    private var query: Binding<String> {
        Binding(get: { queries[category, default: ""] },
                set: { queries[category] = String($0.prefix(160)) })
    }

    private func selectCategory(_ option: CapabilityCategory) {
        let cases = CapabilityCategory.allCases
        guard option != category, let from = cases.firstIndex(of: category),
              let to = cases.firstIndex(of: option) else { return }
        withAnimation(!reduceMotion && abs(to - from) == 1 ? .easeOut(duration: 0.23) : nil) {
            category = option
        }
    }

    private func catalogPage(_ kind: CapabilityCategory) -> some View {
        let query = queries[kind, default: ""]
        return ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    Color.clear.frame(height: 0).id("capability-top").accessibilityHidden(true)
                    catalogContent(kind, query: query)
                }
                .scrollTargetLayout()
                .padding(.horizontal, 18)
            }
            .scrollPosition(id: Binding(get: { positions[kind] }, set: { positions[kind] = $0 }))
            .onChange(of: query) { _, _ in
                positions[kind] = "capability-top"
                scroll.scrollTo("capability-top", anchor: .top)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .accessibilityHidden(kind != category)
    }

    @ViewBuilder private func catalogContent(_ kind: CapabilityCategory, query: String) -> some View {
        let page = pages[kind]
        let failed = failures.contains(kind)
        let loading = requests[kind] != nil || (page == nil && !failed)
        let groups = Dictionary(grouping: matches(kind, query: query), by: \.group)
        if loading, page == nil {
            VStack(alignment: .leading, spacing: 10) {
                ProgressListSkeleton()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("加载中")
            .accessibilityIdentifier("capability-loading")
        }
        if failed || page?.incomplete == true {
            HStack {
                Text(failed ? "capability_load_failed" : "capability_partial")
                    .foregroundStyle(mobileTheme.secondary)
                Spacer()
                Button("capability_retry") { load(kind, refresh: true) }
            }
        }
        if groups.isEmpty, !loading, !failed {
            ContentUnavailableView {
                Label(query.isEmpty ? "capability_empty" : "capability_no_matches", systemImage: "magnifyingglass")
            } actions: {
                if !query.isEmpty {
                    Button("capability_clear") { queries[kind] = "" }
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
                    .padding(.top, 14)
                    .padding(.bottom, 2)
                    .padding(.leading, 4)
                    .id("capability-group-\(group)")
                ForEach(rows) { item in
                    catalogRow(item, kind: kind).id("capability-item-\(item.id)")
                }
            }
        }
    }

    private func matches(_ kind: CapabilityCategory, query: String) -> [CapabilityCatalogItem] {
        guard var rows = pages[kind]?.items else { return [] }
        if kind == .agents {
            rows = rows.map { item in
                CapabilityCatalogItem(id: item.id, name: item.agent.localizedName(locale),
                                      description: item.agent.localizedDescription(locale), group: item.group, avatar: item.avatar)
            }
        }
        if kind == .agents, let personal, personal.state == "ready" {
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
        let placeholder = category == .skills
            ? AppLocalization.string("capability_search_installed_skills", locale: locale)
            : String(format: AppLocalization.string("capability_search", locale: locale), localizedCategory)
        return HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(placeholder, text: query)
                .focused($searchFocused)
                .submitLabel(.search)
                .onSubmit { searchFocused = false }
                .accessibilityIdentifier("capability-search")
            if !query.wrappedValue.isEmpty {
                Button { query.wrappedValue = "" } label: {
                    Label("capability_clear", systemImage: "xmark.circle.fill")
                        .labelStyle(.iconOnly)
                        .frame(width: 44, height: 44)
                        .contentShape(.circle)
                        .hoverEffect(.highlight)
                }
                .buttonStyle(MobilePressStyle(radius: 22))
                .accessibilityIdentifier("capability-search-clear")
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 50)
        .background(mobileTheme.input, in: .capsule)
        .padding(.horizontal, 18)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .background(mobileTheme.canvas)
    }

    private func openDetails(_ item: CapabilityCatalogItem) {
        searchFocused = false
        detail = item
    }

    private func catalogRow(_ item: CapabilityCatalogItem, kind: CapabilityCategory) -> some View {
        HStack(spacing: 0) {
            Button {
                searchFocused = false
                if kind == .agents {
                    onOpenAgent(item.id, personal?.agentId == item.id)
                } else {
                    openDetails(item)
                }
            } label: {
                HStack(spacing: 14) {
                    icon(item, kind: kind)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: item.name).font(.body.weight(.medium)).lineLimit(1)
                        if let description = item.description, !description.isEmpty {
                            Text(verbatim: description).font(.footnote).foregroundStyle(mobileTheme.secondary).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                    if kind == .connections, item.group == "available" || item.group == "attention" {
                        Text("capability_connect").font(.subheadline.weight(.medium))
                            .foregroundStyle(mobileTheme.action).padding(.trailing, 8)
                    }
                    if kind != .agents {
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                            .foregroundStyle(mobileTheme.secondary).accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(minHeight: 76)
                .contentShape(.rect)
                .contentShape(.hoverEffect, .rect(cornerRadius: mobileTheme.corner(18)))
                .hoverEffect(.highlight, isEnabled: kind != .agents || item.group != "disabled")
            }
            .buttonStyle(MobilePressStyle(radius: mobileTheme.corner(18)))
            .accessibilityIdentifier("capability-row-\(item.id)")
            .disabled(kind == .agents && item.group == "disabled")

            if kind == .agents {
                Button {
                    openDetails(item)
                } label: {
                    Image(systemName: "ellipsis").font(.body.weight(.semibold))
                        .foregroundStyle(mobileTheme.secondary).frame(width: 44, height: 44).contentShape(.rect)
                        .contentShape(.hoverEffect, .circle)
                        .hoverEffect(.highlight)
                }
                .buttonStyle(MobilePressStyle(radius: 22))
                .accessibilityLabel("设置")
                .accessibilityValue(item.name)
                .accessibilityIdentifier("capability-settings-\(item.id)")
                .padding(.trailing, 8)
            }
        }
        .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(18)))
    }

    @ViewBuilder private func icon(_ item: CapabilityCatalogItem, kind: CapabilityCategory, extent: CGFloat = 48) -> some View {
        if kind == .agents, personal?.agentId == item.id {
            PersonalAgentAvatar(configuration: configuration, agent: personal, size: extent, active: false)
        } else if kind == .agents {
            ConfiguredAgentAvatar(configuration: configuration, agent: item.agent, size: extent, active: false)
        } else {
            CapabilityLogo(reference: item.iconUrl, origin: configuration.baseURL,
                           label: ["marketplace:search", "mcp:setup"].contains(item.id) ? "" : item.name,
                           symbol: kind.symbol, extent: extent)
        }
    }

    private func detailView(_ item: CapabilityCatalogItem) -> some View {
        CapabilitySettingsPanel(configuration: configuration, category: category.id,
                                itemID: category == .connections ? item.id : item.targetId ?? item.id, name: item.name,
                                summary: item.description ?? "", onChanged: {
                                    load(category, refresh: true)
                                    if item.id == personal?.agentId {
                                        onPersonalChanged()
                                    }
                                },
                                onClose: { detail = nil },
                                onUseInChat: { prompt in
                                    pendingChatPrompt = prompt
                                    detail = nil
                                }) { icon(item, kind: category, extent: 44) }
    }

    // swiftlint:disable:next identifier_name
    private func localized(_ zh: String, _ en: String) -> String {
        locale.identifier.hasPrefix("zh") ? zh : en
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

    private func loadNearby() {
        let cases = CapabilityCategory.allCases
        guard let index = cases.firstIndex(of: category) else { return }
        load(category)
        if index > 0 { load(cases[index - 1]) }
        if index + 1 < cases.count { load(cases[index + 1]) }
    }

    private func cancelRequests() {
        requests.values.forEach { $0.cancel() }
        requests.removeAll()
    }

    private func reloadCatalog() {
        cancelRequests()
        pages.removeAll()
        failures.removeAll()
        loadNearby()
    }

    private func load(_ kind: CapabilityCategory, refresh: Bool = false) {
        guard requests[kind] == nil, refresh || (pages[kind] == nil && !failures.contains(kind)) else { return }
        failures.remove(kind)
        requests[kind] = Task { @MainActor in
            do {
                let response: GatewayEnvelope<CapabilityCatalogPage> = try await GatewayClient(configuration: configuration).request(
                    path: "/api/capabilities/mobile-catalog",
                    queryItems: [URLQueryItem(name: "category", value: kind.id), URLQueryItem(name: "locale", value: locale.identifier)]
                )
                guard response.isSuccessful, let page = response.payload else { throw GatewayClientError.invalidResponse }
                try Task.checkCancellation()
                pages[kind] = page
            } catch {
                if !Task.isCancelled { failures.insert(kind) }
            }
            if !Task.isCancelled { requests[kind] = nil }
        }
    }
}

private struct CapabilityPanelPayload: Decodable {
    let available: Bool?
    struct Choice: Decodable, Identifiable {
        let id: String
        let label: String
    }

    struct Field: Decodable, Identifiable {
        // swiftlint:disable:next nesting
        struct Visibility: Decodable { let field: String; let value: String }
        let id: String
        let label: String
        let type: String
        let value: String?
        let hint: String?
        let advanced: Bool?
        let options: [Choice]?
        let visibleWhen: Visibility?
    }

    struct Action: Decodable, Identifiable {
        let id: String
        let label: String
        let confirmation: String?
        let inlineReview: Bool?
        let advanced: Bool?
    }

    struct Result: Decodable, Identifiable {
        let id: String
        let name: String
        let summary: String?
        let source: String
        let iconUrl: String?
        let action: Action?
    }

    let fields: [Field]?
    let actions: [Action]?
    let message: String?
    let details: String?
    let authorizationUrl: URL?
    let deviceVerificationCode: String?
    let qrUrl: String?
    let expiresAt: Double?
    let flow: String?
    let revision: Int?
    let pollAction: String?
    let results: [Result]?
    let chatPrompt: String?
}

struct ConversationMcpAction: View {
    let configuration: GatewayConfiguration
    let conversationID: String
    let activeRun: Bool

    @Environment(\.locale) private var locale
    @State private var available = false
    @State private var panelConversationID: String?
    @State private var revision = 0
    private var title: String {
        AppLocalization.string("capability_mcp_continue", locale: locale)
    }

    var body: some View {
        Group {
            if available {
                Button("capability_mcp_continue", systemImage: "link") { panelConversationID = conversationID }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .accessibilityIdentifier("chat-mcp-setup")
                    .padding(.bottom, 6)
            }
        }
        .task(id: "\(conversationID):\(activeRun):\(revision)") {
            guard !activeRun else { return }
            let response: GatewayEnvelope<CapabilityPanelPayload>? = try? await GatewayClient(configuration: configuration).request(
                path: "/api/capabilities/mobile-actions/panel/connections",
                queryItems: [.init(name: "id", value: "conversation:" + conversationID),
                             .init(name: "locale", value: locale.identifier)]
            )
            if !Task.isCancelled {
                available = response?.payload?.available == true
            }
        }
        .onChange(of: conversationID) { available = false; panelConversationID = nil }
        .sheet(isPresented: Binding(get: { panelConversationID != nil }, set: {
            if !$0 {
                panelConversationID = nil; revision += 1
            }
        })) {
            if let panelConversationID {
                CapabilitySettingsPanel(configuration: configuration, category: "connections",
                                        itemID: "conversation:" + panelConversationID, name: title, summary: "",
                                        onChanged: {}, onClose: { self.panelConversationID = nil; revision += 1 },
                                        onUseInChat: { _ in self.panelConversationID = nil; revision += 1 })
                {
                    CapabilityLogo(reference: nil, origin: configuration.baseURL, label: "", symbol: "link", extent: 44)
                }
            }
        }
    }
}

private struct CapabilityPanelCommand: Encodable {
    let action: String
    let values: [String: String]
    let flow: String?
    let revision: Int?
}

// swiftlint:disable:next type_body_length
private struct CapabilitySettingsPanel<Icon: View>: View {
    let configuration: GatewayConfiguration
    let category: String
    let itemID: String
    let name: String
    let summary: String
    let onChanged: () -> Void
    let onClose: () -> Void
    let onUseInChat: (String) -> Void
    @ViewBuilder let icon: () -> Icon

    @Environment(\.mobileTheme) private var theme
    @Environment(\.locale) private var locale
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var panel: CapabilityPanelPayload?
    @State private var values: [String: String] = [:]
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var advanced = false
    @State private var detailsOpen = false
    @State private var newGroup = ""
    @State private var openWhenReady = false
    @State private var openedURL: URL?
    @State private var pollingNow = false
    @State private var showQr = false
    @State private var drawerDetent = capabilityCompactDetent
    @State private var savingQr = false
    @State private var qrFeedback: String?
    @State private var confirmation: CapabilityPanelPayload.Action?
    @State private var confirmationOpen = false
    @State private var requestRevision = 0
    @FocusState private var focusedField: String?

    private var panelHeader: some View {
        HStack(spacing: 10) {
            icon()
            Text(verbatim: name).font(.title3.weight(.bold)).lineLimit(2)
                .foregroundStyle(theme.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            panelHeaderButton(LocalizedStringKey(t("关闭", "Close")), symbol: "xmark", tint: theme.foreground, fill: theme.input, action: onClose)
                .accessibilityIdentifier("capability-panel-close")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(theme.canvas)
    }

    private func panelHeaderButton(_ label: LocalizedStringKey, symbol: String, tint: Color, fill: Color,
                                   action: @escaping () -> Void) -> some View
    {
        Button(action: action) {
            Image(systemName: symbol).foregroundStyle(tint)
                .frame(width: 44, height: 44).background(fill, in: .circle).contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    panelStatus
                    if panel == nil, errorMessage == nil {
                        ProgressListSkeleton()
                    } else if busy {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                    if let errorMessage {
                        Text(verbatim: errorMessage).font(.subheadline).foregroundStyle(theme.danger)
                        if panel == nil {
                            Button(t("重试", "Retry")) { Task { await load() } }
                        }
                        if let action = panel?.pollAction {
                            Button(t("刷新状态", "Refresh status")) { Task { await load(action) } }
                        }
                    }
                    setupOptions
                    if let details = panel?.details, !details.isEmpty {
                        DisclosureGroup(t("查看详情", "View details"), isExpanded: $detailsOpen) {
                            Text(verbatim: details).font(.footnote).foregroundStyle(theme.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
                        }
                        .padding(14)
                        .background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
                        .accessibilityIdentifier("capability-panel-review-details")
                    }
                    if !mainFields.isEmpty {
                        VStack(spacing: 14) {
                            ForEach(mainFields) { field in input(field) }
                        }
                        .padding(14)
                        .background(theme.panel, in: .rect(cornerRadius: theme.corner(16)))
                    }
                    ForEach(mainActions.filter { $0.id != primaryAction?.id && $0.id != cancelPairing?.id }) { action in
                        actionButton(action, prominent: false)
                    }
                    ForEach(panel?.results ?? []) { result in
                        HStack(spacing: 12) {
                            CapabilityLogo(reference: result.iconUrl, origin: configuration.baseURL, label: result.name,
                                           symbol: "checklist", extent: 40)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(verbatim: result.name).font(.subheadline.weight(.semibold))
                                if let summary = result.summary {
                                    Text(verbatim: summary).font(.caption).lineLimit(2)
                                }
                                Text(verbatim: result.source).font(.caption2)
                            }
                            .foregroundStyle(theme.foreground)
                            Spacer(minLength: 0)
                            if let action = result.action {
                                Button { perform(action) } label: { Text(verbatim: action.label) }
                                    .buttonStyle(.bordered).accessibilityIdentifier("capability-panel-\(action.id)")
                            } else {
                                Text(t("已安装", "Installed")).font(.caption).foregroundStyle(theme.secondary)
                            }
                        }
                        .padding(12).background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
                    }
                    if !extraFields.isEmpty || !extraActions.isEmpty {
                        DisclosureGroup(t("更多选项", "More options"), isExpanded: $advanced) {
                            VStack(spacing: 10) {
                                ForEach(extraFields) { field in input(field) }
                                ForEach(extraActions) { action in actionButton(action, prominent: false) }
                            }.padding(.top, 8)
                        }
                        .padding(12).background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 4)
                .padding(.bottom, 24)
                .disabled(busy)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(theme.canvas)
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) { panelHeader }
            .safeAreaInset(edge: .bottom, spacing: 0) { panelFooter }
            .alert(confirmation?.label ?? "", isPresented: $confirmationOpen, presenting: confirmation) { action in
                Button(t("确认", "Confirm")) { Task { await load(action.id) } }
                Button(t("取消", "Cancel"), role: .cancel) {}
            } message: { action in Text(verbatim: action.confirmation ?? "") }
        }
        .presentationDetents([capabilityCompactDetent, capabilityExpandedDetent, .large], selection: $drawerDetent)
        .presentationContentInteraction(.scrolls)
        .presentationDragIndicator(.visible)
        .presentationBackground(theme.canvas)
        .onDisappear {
            requestRevision += 1
            values.removeAll()
        }
        .task { await load() }
        .onChange(of: scenePhase) {
            guard scenePhase == .active, let action = panel?.pollAction else { return }
            Task { await load(action, polling: true) }
        }
        .onChange(of: panel?.qrUrl) { qrFeedback = nil }
        .onChange(of: verifiedURL) { showQr = false }
        .onChange(of: needsExpandedDrawer, initial: true) {
            drawerDetent = needsExpandedDrawer ? capabilityExpandedDetent : capabilityCompactDetent
        }
        .task(id: (panel?.pollAction ?? "") + ":" + (panel?.flow ?? "")) {
            guard let action = panel?.pollAction else { return }
            for _ in 0 ..< 75 {
                do { try await Task.sleep(for: .seconds(4)) } catch { return }
                guard panel?.pollAction == action else { return }
                await load(action, polling: true)
            }
            if panel?.pollAction == action {
                errorMessage = t("等待时间过长，可以刷新状态或重新开始。", "This is taking longer than expected. Refresh or start again.")
            }
        }
    }

    @ViewBuilder private var setupOptions: some View {
        if verifiedURL != nil, let code = panel?.deviceVerificationCode {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(t("验证码", "Verification code")).font(.caption).foregroundStyle(theme.secondary)
                    Text(verbatim: code).font(.headline.monospaced()).foregroundStyle(theme.foreground)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    UIPasteboard.general.setItems([["public.utf8-plain-text": code]], options: [.localOnly: true])
                } label: {
                    Label(t("复制", "Copy"), systemImage: "document.on.document").frame(minHeight: 34)
                }
                .buttonStyle(.bordered).buttonBorderShape(.capsule).tint(theme.action)
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(theme.panel, in: .rect(cornerRadius: theme.corner(16)))
            .overlay { RoundedRectangle(cornerRadius: theme.corner(16)).strokeBorder(theme.secondary.opacity(0.18)) }
        }
        if verifiedURL != nil, panel?.qrUrl != nil {
            Button { showQr.toggle() } label: {
                HStack {
                    Text(showQr ? t("收起二维码", "Hide QR code") : t("其他方式", "Other ways"))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: showQr ? "chevron.up" : "chevron.down").accessibilityHidden(true)
                }
                .font(.subheadline.weight(.medium)).foregroundStyle(theme.action)
                .padding(.horizontal, 14).frame(minHeight: 44)
                .background(theme.panel, in: .rect(cornerRadius: theme.corner(16)))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("capability-panel-other-methods")
        }
        if let code = panel?.qrUrl, verifiedURL == nil || showQr, let image = qrImage(code) {
            VStack(spacing: 12) {
                Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                    .frame(width: 180, height: 180).padding(4)
                    .background(.white).clipShape(.rect(cornerRadius: 16))
                    .accessibilityLabel(t("授权二维码", "Authorization QR code"))
                    .accessibilityIdentifier("capability-panel-qr")
                Text(t("从扫一扫的相册入口选图，或用另一台设备扫码。",
                       "Select the saved image if the scanner supports Photos, or scan with another device."))
                    .font(.footnote).foregroundStyle(theme.secondary)
                    .multilineTextAlignment(.center)
                if verifiedURL != nil { qrSaveAction(code, prominent: false) }
            }
            .frame(maxWidth: .infinity)
            .padding(16)
            .background(theme.panel, in: .rect(cornerRadius: theme.corner(16)))
        }
    }

    @ViewBuilder private func qrSaveAction(_ code: String, prominent: Bool) -> some View {
        let button = Button {
            guard let image = qrImage(code) else {
                qrFeedback = t("无法生成二维码。", "Could not generate the QR code.")
                return
            }
            Task { await saveQr(image, code: code) }
        } label: {
            Label(savingQr ? t("正在保存…", "Saving…") : t("保存二维码", "Save QR code"),
                  systemImage: "square.and.arrow.down")
                .font(.headline).foregroundStyle(prominent ? theme.onAction : theme.action)
                .frame(maxWidth: .infinity, minHeight: 40)
        }
        .disabled(savingQr)
        .accessibilityIdentifier("capability-panel-save-qr")
        if prominent {
            button.buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
        } else {
            button.buttonStyle(.bordered).buttonBorderShape(.capsule).tint(theme.action)
        }
        if let qrFeedback {
            Text(verbatim: qrFeedback).font(.footnote).foregroundStyle(theme.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private var readyPrompt: String? {
        guard panel?.pollAction == nil, errorMessage == nil, let prompt = panel?.chatPrompt, !prompt.isEmpty else { return nil }
        let changed = (panel?.fields ?? []).contains { field in
            (values[field.id] ?? "") != (field.type == "secret" ? "" : field.value ?? "")
        }
        return changed ? nil : prompt
    }

    private var primaryAction: CapabilityPanelPayload.Action? {
        guard readyPrompt == nil, verifiedURL == nil, panel?.qrUrl == nil, panel?.pollAction == nil else { return nil }
        return mainActions.first
    }

    private var cancelPairing: CapabilityPanelPayload.Action? {
        mainActions.first { $0.id == "pair-cancel" }
    }

    @ViewBuilder private var panelStatus: some View {
        if panel?.message != nil || readyPrompt != nil || panel?.pollAction != nil {
            HStack(spacing: 10) {
                if panel?.pollAction != nil {
                    Circle().fill(theme.action).frame(width: 8, height: 8).accessibilityHidden(true)
                } else if readyPrompt != nil {
                    Image(systemName: "checkmark.circle").foregroundStyle(.green).accessibilityHidden(true)
                }
                Text(verbatim: panel?.message ?? t("可在对话中使用", "Ready to use in chat"))
                    .font(.subheadline).foregroundStyle(theme.foreground)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(theme.panel, in: .rect(cornerRadius: theme.corner(16)))
            .accessibilityIdentifier("capability-panel-status")
        } else if panel != nil, !summary.isEmpty, category != "agents" {
            Text(verbatim: summary).font(.subheadline).foregroundStyle(theme.secondary)
        }
    }

    @ViewBuilder private var panelFooter: some View {
        if readyPrompt != nil || primaryAction != nil || verifiedURL != nil || panel?.qrUrl != nil || cancelPairing != nil {
            VStack(spacing: 4) {
                if let prompt = readyPrompt {
                    Button {
                        focusedField = nil
                        onUseInChat(prompt)
                    } label: {
                        Label(t(itemID.hasPrefix("conversation:") ? "返回对话" : "通过对话使用",
                                itemID.hasPrefix("conversation:") ? "Back to chat" : "Use in chat"),
                              systemImage: "bubble.left")
                            .font(.headline).foregroundStyle(theme.onAction)
                            .frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
                    .accessibilityIdentifier("capability-use-in-chat")
                } else if let url = verifiedURL {
                    Button { openAuthorization(url) } label: {
                        Label(authorizationLabel, systemImage: "arrow.up.right")
                            .font(.headline).foregroundStyle(theme.onAction).frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
                    .accessibilityIdentifier("capability-panel-open-authorization")
                } else if let code = panel?.qrUrl {
                    qrSaveAction(code, prominent: true)
                } else if let action = primaryAction {
                    actionButton(action, prominent: true)
                }
                if let cancel = cancelPairing, cancel.id != primaryAction?.id {
                    actionButton(cancel, prominent: false)
                }
            }
            .tint(theme.action)
            .disabled(busy)
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 12)
            .background(theme.canvas)
            .overlay(alignment: .top) { Divider().accessibilityHidden(true) }
        }
    }

    private var visibleFields: [CapabilityPanelPayload.Field] {
        (panel?.fields ?? []).filter { field in
            guard let rule = field.visibleWhen else { return true }
            return values[rule.field] == rule.value
        }
    }

    private var mainFields: [CapabilityPanelPayload.Field] {
        visibleFields.filter { $0.advanced != true }
    }

    private var extraFields: [CapabilityPanelPayload.Field] {
        visibleFields.filter { $0.advanced == true }
    }

    private var needsExpandedDrawer: Bool {
        let shownFields = advanced ? visibleFields : mainFields
        return (panel?.qrUrl != nil && (verifiedURL == nil || showQr))
            || (advanced && (!extraFields.isEmpty || !extraActions.isEmpty))
            || (detailsOpen && panel?.details?.isEmpty == false)
            || shownFields.count >= 3
            || shownFields.contains { $0.type == "multiline" || $0.type == "list" }
            || (panel?.results?.count ?? 0) >= 3
    }

    private var mainActions: [CapabilityPanelPayload.Action] {
        (panel?.actions ?? []).filter { $0.advanced != true }
    }

    private var extraActions: [CapabilityPanelPayload.Action] {
        (panel?.actions ?? []).filter { $0.advanced == true }
    }

    private var verifiedURL: URL? {
        guard let url = panel?.authorizationUrl, url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }

    private var authorizationLabel: String {
        if let openedURL, openedURL == verifiedURL { return t("重新打开授权页", "Reopen authorization") }
        if panel?.deviceVerificationCode != nil { return t("打开验证页", "Open verification page") }
        return t("前往授权", "Open authorization")
    }

    private func openAuthorization(_ url: URL) {
        openURL(url) { accepted in
            if accepted { openedURL = url }
            else { errorMessage = t("无法打开授权页面，请重试。", "Could not open authorization. Try again.") }
        }
    }

    private func perform(_ action: CapabilityPanelPayload.Action) {
        focusedField = nil
        if action.confirmation != nil, action.inlineReview != true {
            confirmation = action; confirmationOpen = true
        } else {
            Task { await load(action.id) }
        }
    }

    @ViewBuilder private func actionButton(_ action: CapabilityPanelPayload.Action, prominent: Bool) -> some View {
        let button = Button { perform(action) } label: {
            Text(verbatim: action.label)
                .foregroundStyle(prominent ? theme.onAction : (action.id == "pair-cancel" ? theme.secondary : theme.action))
                .frame(maxWidth: .infinity, minHeight: 36)
        }.accessibilityIdentifier("capability-panel-\(action.id)")
        if prominent {
            button.buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
        } else {
            button.buttonStyle(.plain).foregroundStyle(theme.action).frame(minHeight: 44)
        }
    }

    @ViewBuilder private func input(_ field: CapabilityPanelPayload.Field) -> some View {
        let value = Binding(get: { values[field.id] ?? "" }, set: { values[field.id] = $0 })
        if field.type == "toggle" {
            Toggle(isOn: Binding(get: { value.wrappedValue == "true" }, set: { value.wrappedValue = String($0) })) {
                Text(verbatim: field.label)
            }
        } else if field.type == "select" {
            Picker(selection: value) {
                ForEach(field.options ?? []) { option in Text(verbatim: option.label).tag(option.id) }
            } label: { Text(verbatim: field.label) }
        } else if field.type == "list" {
            groupList(field, selection: value)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: field.label).font(.subheadline.weight(.medium))
                if field.type == "secret" {
                    SecureField(field.hint ?? field.label, text: value).textContentType(nil)
                        .focused($focusedField, equals: field.id)
                } else {
                    TextField(field.hint ?? field.label, text: value, axis: field.type == "multiline" ? .vertical : .horizontal)
                        .lineLimit(field.type == "multiline" ? 3 ... 6 : 1 ... 1)
                        .submitLabel(field.id == "query" ? .search : .done)
                        .focused($focusedField, equals: field.id)
                        .onSubmit {
                            if field.id == "query" {
                                Task { await load("search") }
                            }
                        }
                }
            }
            .textFieldStyle(.plain)
            .padding(12).background(theme.input, in: .rect(cornerRadius: theme.corner(14)))
            .accessibilityIdentifier("capability-field-\(field.id)")
        }
    }

    private func groupList(_ field: CapabilityPanelPayload.Field, selection: Binding<String>) -> some View {
        let groups = selection.wrappedValue.split(separator: "\n").map(String.init).reduce(into: [String]()) { result, item in
            if !item.isEmpty, !result.contains(item) {
                result.append(item)
            }
        }
        let addGroup = {
            let group = newGroup.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !group.isEmpty, group.count <= 160, group.rangeOfCharacter(from: CharacterSet(charactersIn: ",\r\n")) == nil else { return }
            if !groups.contains(group) {
                selection.wrappedValue = (groups + [group]).joined(separator: "\n")
            }
            newGroup = ""
        }
        return VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: field.label).font(.subheadline.weight(.medium))
            ForEach(groups, id: \.self) { group in
                HStack {
                    Text(verbatim: group)
                    Spacer(minLength: 8)
                    Button(t("移除", "Remove")) { selection.wrappedValue = groups.filter { $0 != group }.joined(separator: "\n") }
                        .accessibilityLabel(t("移除 ", "Remove ") + group)
                }
            }
            HStack {
                TextField(field.hint ?? field.label, text: $newGroup).submitLabel(.done).onSubmit(addGroup)
                    .onChange(of: newGroup) { _, value in
                        if value.count > 160 {
                            newGroup = String(value.prefix(160))
                        }
                    }
                Button(t("添加群聊", "Add group"), action: addGroup).disabled(newGroup.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(12).background(theme.input, in: .rect(cornerRadius: theme.corner(14)))
        .accessibilityIdentifier("capability-field-\(field.id)")
    }

    // swiftlint:disable:next identifier_name
    private func t(_ zh: String, _ en: String) -> String {
        locale.identifier.hasPrefix("zh") ? zh : en
    }

    private func qrImage(_ value: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8)
        guard let output = filter.outputImage else { return nil }
        let bounds = output.extent.insetBy(dx: -4, dy: -4)
        let scale = CGAffineTransform(scaleX: 8, y: 8)
        let padded = output.composited(over: CIImage(color: .white).cropped(to: bounds)).transformed(by: scale)
        return capabilityQrContext.createCGImage(padded, from: bounds.applying(scale)).map { UIImage(cgImage: $0) }
    }

    @MainActor private func saveQr(_ image: UIImage, code: String) async {
        guard !savingQr, panel?.qrUrl == code else { return }
        if let expiresAt = panel?.expiresAt, Date().timeIntervalSince1970 * 1000 >= expiresAt {
            qrFeedback = t("二维码已过期，请刷新状态。", "The QR code expired. Refresh its status.")
            return
        }
        savingQr = true
        defer { savingQr = false }
        let failure = t("未能保存二维码，请检查相册权限后重试。", "Could not save the QR code. Check photo access and try again.")
        let access = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard panel?.qrUrl == code else { return }
        guard access == .authorized || access == .limited else {
            qrFeedback = failure
            return
        }
        guard let data = image.pngData() else {
            qrFeedback = failure
            return
        }
        do {
            try await PHPhotoLibrary.shared().performChanges { @Sendable in
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }
            if panel?.qrUrl == code { qrFeedback = t("已保存到相册。", "Saved to Photos.") }
        } catch {
            if panel?.qrUrl == code { qrFeedback = failure }
        }
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    private func load(_ action: String? = nil, polling: Bool = false) async {
        guard !busy, !polling || !pollingNow else { return }
        if polling { pollingNow = true }
        busy = !polling
        if !polling {
            errorMessage = nil
        }
        if action?.hasPrefix("authorize") == true || action?.hasPrefix("status:") == true || action?.hasPrefix("status-server:") == true, !polling {
            openWhenReady = true; openedURL = nil
        }
        requestRevision += 1
        let revision = requestRevision
        let before = panel?.pollAction
        defer {
            if polling { pollingNow = false }
            else { busy = false }
        }
        do {
            let client = GatewayClient(configuration: configuration)
            let path = "/api/capabilities/mobile-actions/panel/\(category)"
            let body = try action.map { try client.encoder.encode(CapabilityPanelCommand(
                action: $0, values: polling ? [:] : values, flow: panel?.flow, revision: panel?.revision
            )) }
            let response: GatewayEnvelope<CapabilityPanelPayload> = try await client.request(
                path: path, queryItems: [URLQueryItem(name: "id", value: itemID), URLQueryItem(name: "locale", value: locale.identifier)],
                method: action == nil ? "GET" : "POST", body: body
            )
            guard let result = response.payload, response.isSuccessful else { throw GatewayClientError.invalidResponse }
            try Task.checkCancellation()
            guard revision == requestRevision else { return }
            if polling && (busy || panel?.pollAction != action) {
                return
            }
            let currentValues = values
            panel = result
            values = Dictionary((result.fields ?? []).map { ($0.id,
                                                             (polling ? currentValues[$0.id] : nil) ?? ($0.type == "secret" ? "" : $0.value ?? "")) },
                                uniquingKeysWith: { first, _ in first })
            errorMessage = nil
            if openWhenReady, let url = verifiedURL, url != openedURL {
                openWhenReady = false
                openAuthorization(url)
            }
            if !polling && action != "search" && action != nil || polling && before != nil && result.pollAction == nil {
                onChanged()
            }
        } catch is CancellationError {
        } catch {
            if !polling, revision == requestRevision {
                if case let GatewayClientError.http(status, message?) = error, status == 400 || status == 409 {
                    errorMessage = message
                } else {
                    errorMessage = t("暂时无法完成，请重试。", "Could not complete this action. Try again.")
                }
            }
        }
    }
}
