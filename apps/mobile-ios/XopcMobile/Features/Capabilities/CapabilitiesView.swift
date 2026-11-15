// swiftlint:disable file_length
import CoreImage.CIFilterBuiltins
import SwiftUI

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
    @State private var category = CapabilityCategory.plugins
    @State private var query = ""
    @State private var pages: [CapabilityCategory: CapabilityCatalogPage] = [:]
    @State private var failed = false
    @State private var loading = true
    @State private var revision = 0
    @State private var detail: CapabilityCatalogItem?
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        Color.clear.frame(height: 0).id("capability-top").accessibilityHidden(true)
                        catalogContent
                    }
                    .padding(.horizontal, 18)
                }
                .onChange(of: query) { _, _ in scroll.scrollTo("capability-top") }
                .onChange(of: category) { _, _ in scroll.scrollTo("capability-top") }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .background {
            if detail == nil {
                HorizontalSwipeCapture(reserveBackEdge: true, onEnd: { distance, _ in swipeCategory(distance) })
            }
        }
        .background(mobileTheme.canvas)
        .safeAreaInset(edge: .bottom, spacing: 0) { searchField }
        .mobilePageTitle(Text("capability_title")) {
            MobilePageTitleMenu(options: CapabilityCategory.allCases.map {
                SegmentOption(id: $0, title: $0.title, accessibilityID: "capability-category-\($0.id)")
            }, selected: category, identifier: "capability-title", onSelect: selectCategory)
        }
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
                    Button(setupLabel, systemImage: "plus") { startSetupChat() }
                        .labelStyle(.iconOnly).foregroundStyle(mobileTheme.action)
                        .accessibilityIdentifier("capability-chat-setup-\(category.id)")
                }
            }
        }
        .task(id: "\(category.id):\(revision):\(locale.identifier)") { await load() }
        .sheet(item: $detail) { item in detailView(item) }
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

    private func startSetupChat() {
        searchFocused = false
        let key = switch category {
        case .agents: "capability_agent_setup_prompt"
        case .skills: "capability_skill_setup_prompt"
        default: "capability_mcp_setup_prompt"
        }
        onSetupChat(AppLocalization.string(key, locale: locale),
                    category == .agents ? (locale.identifier.hasPrefix("zh") ? "zh-CN" : "en") : nil)
    }

    private func selectCategory(_ option: CapabilityCategory) {
        guard option != category else { return }
        searchFocused = false
        query = ""
        category = option
    }

    private func swipeCategory(_ distance: CGFloat) {
        guard abs(distance) >= 40 else { return }
        let categories = CapabilityCategory.allCases
        guard let index = categories.firstIndex(of: category) else { return }
        let next = index + (distance < 0 ? 1 : -1)
        if categories.indices.contains(next) { selectCategory(categories[next]) }
    }

    @ViewBuilder private var catalogContent: some View {
        let page = pages[category]
        let groups = Dictionary(grouping: matches, by: \.group)
        if loading, page == nil {
            ProgressListSkeleton()
        }
        if failed || page?.incomplete == true {
            HStack {
                Text(failed ? "capability_load_failed" : "capability_partial")
                    .foregroundStyle(mobileTheme.secondary)
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
                    .padding(.top, 14)
                    .padding(.bottom, 2)
                    .padding(.leading, 4)
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
        let placeholder = category == .skills
            ? AppLocalization.string("capability_search_installed_skills", locale: locale)
            : String(format: AppLocalization.string("capability_search", locale: locale), localizedCategory)
        return HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(placeholder, text: $query)
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
        .background(mobileTheme.input, in: .capsule)
        .padding(.horizontal, 18)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .background(mobileTheme.canvas)
    }

    private func catalogRow(_ item: CapabilityCatalogItem) -> some View {
        HStack(spacing: 14) {
            icon(item)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: item.name).font(.body.weight(.medium)).lineLimit(1)
                if let description = item.description, !description.isEmpty {
                    Text(verbatim: description).font(.footnote).foregroundStyle(mobileTheme.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(mobileTheme.secondary)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 76)
        .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(18)))
        .contentShape(.rect)
    }

    @ViewBuilder private func icon(_ item: CapabilityCatalogItem, extent: CGFloat = 48) -> some View {
        if category == .agents, personal?.agentId == item.id {
            PersonalAgentAvatar(configuration: configuration, agent: personal, size: extent, active: false)
        } else if category == .agents {
            ConfiguredAgentAvatar(configuration: configuration, agent: item.agent, size: extent, active: false)
        } else {
            CapabilityLogo(reference: item.iconUrl, origin: configuration.baseURL,
                           label: ["marketplace:search", "mcp:setup"].contains(item.id) ? "" : item.name,
                           symbol: category.symbol, extent: extent)
        }
    }

    private func detailView(_ item: CapabilityCatalogItem) -> some View {
        CapabilitySettingsPanel(configuration: configuration, category: category.id,
                                itemID: category == .connections ? item.id : item.targetId ?? item.id, name: item.name,
                                summary: item.description ?? "", onChanged: {
                                    revision += 1
                                    if item.id == personal?.agentId {
                                        onPersonalChanged()
                                    }
                                },
                                onClose: { detail = nil },
                                onStartChat: category == .agents && item.group != "disabled" ? {
                                    detail = nil
                                    onOpenAgent(item.id, personal?.agentId == item.id)
                                } : nil) { icon(item, extent: 44) }
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
    let qrUrl: String?
    let flow: String?
    let revision: Int?
    let pollAction: String?
    let results: [Result]?
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
                                        onStartChat: nil)
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
    let onStartChat: (() -> Void)?
    @ViewBuilder let icon: () -> Icon

    @Environment(\.mobileTheme) private var theme
    @Environment(\.locale) private var locale
    @Environment(\.openURL) private var openURL
    @State private var panel: CapabilityPanelPayload?
    @State private var values: [String: String] = [:]
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var advanced = false
    @State private var detailsOpen = false
    @State private var newGroup = ""
    @State private var openWhenReady = false
    @State private var openedURL: URL?
    @State private var confirmation: CapabilityPanelPayload.Action?
    @State private var confirmationOpen = false

    private var panelHeader: some View {
        HStack(spacing: 10) {
            icon()
            Text(verbatim: name).font(.title3.weight(.bold)).lineLimit(2)
                .foregroundStyle(theme.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            if let onStartChat {
                panelHeaderButton("capability_start_chat", symbol: "bubble.left", tint: theme.action, fill: theme.active, action: onStartChat)
                    .accessibilityIdentifier("capability-start-chat")
            }
            panelHeaderButton(LocalizedStringKey(t("关闭", "Close")), symbol: "xmark", tint: theme.foreground, fill: theme.input, action: onClose)
                .accessibilityIdentifier("capability-panel-close")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(theme.panel)
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
                VStack(alignment: .leading, spacing: 18) {
                    if let message = panel?.message {
                        Text(verbatim: message).font(.subheadline).foregroundStyle(theme.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                            .background(theme.input, in: .rect(cornerRadius: theme.corner(14)))
                            .accessibilityIdentifier("capability-panel-status")
                    } else if !summary.isEmpty {
                        Text(verbatim: summary).font(.subheadline).foregroundStyle(theme.secondary)
                    }
                    if busy {
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
                    if let qrCodeURL = panel?.qrUrl, let image = qrImage(qrCodeURL) {
                        Image(uiImage: image)
                            .interpolation(.none).resizable().scaledToFit()
                            .frame(width: 180, height: 180).padding(12).background(.white, in: .rect(cornerRadius: 16))
                            .frame(maxWidth: .infinity)
                            .accessibilityLabel(t("通道配对二维码", "Channel pairing QR code"))
                    }
                    if let url = verifiedURL {
                        Button(t("继续授权", "Continue sign-in")) { openURL(url) }.buttonStyle(.bordered)
                    }
                    if let details = panel?.details, !details.isEmpty {
                        DisclosureGroup(t("查看详情", "View details"), isExpanded: $detailsOpen) {
                            Text(verbatim: details).font(.footnote).foregroundStyle(theme.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
                        }.accessibilityIdentifier("capability-panel-review-details")
                    }
                    ForEach(mainFields) { field in input(field) }
                    ForEach(Array(mainActions.enumerated()), id: \.element.id) { index, action in
                        actionButton(action, prominent: index == 0 && panel?.pollAction == nil)
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
                        .padding(12).background(theme.input, in: .rect(cornerRadius: theme.corner(14)))
                    }
                    if !extraFields.isEmpty || !extraActions.isEmpty {
                        DisclosureGroup(t("更多选项", "More options"), isExpanded: $advanced) {
                            VStack(spacing: 10) {
                                ForEach(extraFields) { field in input(field) }
                                ForEach(extraActions) { action in actionButton(action, prominent: false) }
                            }.padding(.top, 8)
                        }
                        .padding(12).background(theme.input, in: .rect(cornerRadius: theme.corner(14)))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 4)
                .padding(.bottom, 24)
                .disabled(busy)
            }
            .background(theme.panel)
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) { panelHeader }
            .alert(confirmation?.label ?? "", isPresented: $confirmationOpen, presenting: confirmation) { action in
                Button(t("确认", "Confirm")) { Task { await load(action.id) } }
                Button(t("取消", "Cancel"), role: .cancel) {}
            } message: { action in Text(verbatim: action.confirmation ?? "") }
        }
        .presentationDetents(itemID == "marketplace:search" ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(theme.panel)
        .task { await load() }
        .task(id: panel?.pollAction) {
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

    private func perform(_ action: CapabilityPanelPayload.Action) {
        if action.confirmation != nil, action.inlineReview != true {
            confirmation = action; confirmationOpen = true
        } else {
            Task { await load(action.id) }
        }
    }

    @ViewBuilder private func actionButton(_ action: CapabilityPanelPayload.Action, prominent: Bool) -> some View {
        let button = Button { perform(action) } label: {
            Text(verbatim: action.label).frame(maxWidth: .infinity, minHeight: 36)
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
                } else {
                    TextField(field.hint ?? field.label, text: value, axis: field.type == "multiline" ? .vertical : .horizontal)
                        .lineLimit(field.type == "multiline" ? 3 ... 6 : 1 ... 1)
                        .submitLabel(field.id == "query" ? .search : .done)
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
        return UIImage(ciImage: output.transformed(by: CGAffineTransform(scaleX: 8, y: 8)))
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    private func load(_ action: String? = nil, polling: Bool = false) async {
        guard !busy else { return }
        busy = !polling
        if !polling {
            errorMessage = nil
        }
        if action?.hasPrefix("authorize") == true || action?.hasPrefix("status:") == true || action?.hasPrefix("status-server:") == true, !polling {
            openWhenReady = true; openedURL = nil
        }
        let before = panel?.pollAction
        let previousValues = values
        defer {
            if !polling {
                busy = false
            }
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
            if polling && (busy || panel?.pollAction != action) {
                return
            }
            panel = result
            values = Dictionary((result.fields ?? []).map { ($0.id,
                                                             (polling ? previousValues[$0.id] : nil) ?? ($0.type == "secret" ? "" : $0.value ?? "")) },
                                uniquingKeysWith: { first, _ in first })
            errorMessage = nil
            if openWhenReady, let url = verifiedURL, url != openedURL {
                openedURL = url; openWhenReady = false; openURL(url)
            }
            if !polling && action != "search" && action != nil || polling && before != nil && result.pollAction == nil {
                onChanged()
            }
        } catch is CancellationError {
        } catch {
            if !polling {
                if case let GatewayClientError.http(status, message?) = error, status == 400 || status == 409 {
                    errorMessage = message
                } else {
                    errorMessage = t("暂时无法完成，请重试。", "Could not complete this action. Try again.")
                }
            }
        }
    }
}
