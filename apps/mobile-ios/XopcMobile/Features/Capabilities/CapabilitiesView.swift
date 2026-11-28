// swiftlint:disable file_length
import CoreImage.CIFilterBuiltins
import Photos
import SwiftUI
import UIKit

private let capabilityQrContext = CIContext()
private let capabilityCompactDetent = PresentationDetent.height(420)
private let capabilityExpandedDetent = PresentationDetent.fraction(0.82)

struct CapabilityCardLabel<Leading: View, Trailing: View>: View {
    @Environment(\.mobileTheme) private var theme
    let title: String
    let description: String?
    var hoverEnabled = true
    @ViewBuilder let leading: () -> Leading
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 14) {
            leading()
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: title).font(.body.weight(.medium)).lineLimit(1)
                if let description, !description.isEmpty {
                    Text(verbatim: description).font(.footnote).foregroundStyle(theme.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            trailing()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 76)
        .contentShape(.rect)
        .contentShape(.hoverEffect, .rect(cornerRadius: theme.corner(18)))
        .hoverEffect(.highlight, isEnabled: hoverEnabled)
    }
}

enum CapabilityCategory: String, CaseIterable, Identifiable, Sendable {
    case plugins, skills, connections, devices, agents, channels

    var id: String {
        rawValue
    }

    var titleKey: String {
        switch self {
        case .plugins: "capability_plugins"
        case .skills: "capability_skills"
        case .connections: "capability_connections"
        case .devices: "device_connection_devices"
        case .agents: "capability_agents"
        case .channels: "capability_channels"
        }
    }

    var title: LocalizedStringResource {
        switch self {
        case .plugins: "capability_plugins"
        case .skills: "capability_skills"
        case .connections: "capability_connections"
        case .devices: "device_connection_devices"
        case .agents: "capability_agents"
        case .channels: "capability_channels"
        }
    }

    var symbol: String {
        switch self {
        case .plugins: "puzzlepiece"
        case .skills: "checklist"
        case .connections: "link"
        case .devices: "iphone"
        case .agents: "person.2"
        case .channels: "bubble.left"
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
    let initialCategory: String?
    let onOpenAgent: (String, Bool) -> Void
    let onSetupChat: (String, String?) -> Void
    let onPersonalChanged: () -> Void
    let onOpenDeviceChat: (String, String) -> Void
    let onShareDeviceFile: (MessageAttachment) async throws -> Void
    let onPairDevice: () -> Void
    @Environment(\.locale) private var locale
    private let category: CapabilityCategory
    @State private var query = ""
    @State private var scrollPosition: String?
    @State private var page: CapabilityCatalogPage?
    @State private var failed = false
    @State private var request: Task<Void, Never>?
    @State private var detail: CapabilityCatalogItem?
    @State private var pendingChatPrompt: String?
    @FocusState private var searchFocused: Bool

    init(
        configuration: GatewayConfiguration,
        personal: PersonalAgentRecord?,
        initialCategory: String? = nil,
        onOpenAgent: @escaping (String, Bool) -> Void,
        onSetupChat: @escaping (String, String?) -> Void,
        onPersonalChanged: @escaping () -> Void = {},
        onOpenDeviceChat: @escaping (String, String) -> Void = { _, _ in },
        onShareDeviceFile: @escaping (MessageAttachment) async throws -> Void = { _ in },
        onPairDevice: @escaping () -> Void = {}
    ) {
        self.configuration = configuration
        self.personal = personal
        self.initialCategory = initialCategory
        self.onOpenAgent = onOpenAgent
        self.onSetupChat = onSetupChat
        self.onPersonalChanged = onPersonalChanged
        self.onOpenDeviceChat = onOpenDeviceChat
        self.onShareDeviceFile = onShareDeviceFile
        self.onPairDevice = onPairDevice
        category = initialCategory.flatMap(CapabilityCategory.init(rawValue:)) ?? .plugins
    }

    var body: some View {
        Group {
            if category == .devices {
                DeviceConnectionsView(configuration: configuration, active: true,
                                      onOpenChat: onOpenDeviceChat, onShareFile: onShareDeviceFile,
                                      onLocalTool: openDeviceTool, onPair: onPairDevice)
                    .id(ComposerDraftStore.accountScope(configuration))
            } else {
                catalogPage
            }
        }
        .background(mobileTheme.canvas)
        .safeAreaInset(edge: .top, spacing: 0) {
            if category != .devices {
                searchField
            }
        }
        .mobilePageTitle(Text(category.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 8) {
                    if category == .skills {
                        MobileHeaderIconButton("capability_skill_market", systemImage: "square.grid.2x2", tone: .accent) { openSkillMarket() }
                            .accessibilityIdentifier("capability-add-skills")
                    } else if category == .plugins {
                        MobileHeaderIconButton("capability_search_plugins", systemImage: "magnifyingglass", tone: .accent) { searchFocused = true }
                            .accessibilityIdentifier("capability-add-plugins")
                    }
                    if category == .skills || category == .agents || category == .connections {
                        MobileHeaderIconButton(setupLabel, systemImage: "plus", tone: .accent) { startSetup() }
                            .accessibilityIdentifier(category == .connections ? "capability-add-mcp" : "capability-chat-setup-\(category.id)")
                    }
                }
            }
            .mobileTransparentToolbarItem()
        }
        .onAppear { load() }
        .onChange(of: locale.identifier) { reloadCatalog() }
        .onChange(of: configuration) { reloadCatalog() }
        .onDisappear { cancelRequest() }
        .sheet(item: $detail, onDismiss: {
            guard let prompt = pendingChatPrompt else { return }
            pendingChatPrompt = nil
            onSetupChat(prompt, nil)
        }) { item in
            detailView(item)
                .mobileSheetPreset(.large)
        }
    }

    private func openDeviceTool(_ tool: String) {
        let key = switch tool {
        case "mobile.contacts.pick": "device_connection_contact_prompt"
        case "mobile.calendar.query_events": "device_connection_calendar_prompt"
        default: "device_connection_location_prompt"
        }
        onSetupChat(AppLocalization.string(key, locale: locale), nil)
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

    private var queryBinding: Binding<String> {
        Binding(get: { query }, set: { query = String($0.prefix(160)) })
    }

    private var catalogPage: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    Color.clear.frame(height: 0).id("capability-top").accessibilityHidden(true)
                    catalogContent
                }
                .scrollTargetLayout()
                .padding(.horizontal, 18)
            }
            .accessibilityIdentifier("capability-catalog-\(category.id)")
            .scrollPosition(id: $scrollPosition)
            .onChange(of: query) { _, _ in
                scrollPosition = "capability-top"
                scroll.scrollTo("capability-top", anchor: .top)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    @ViewBuilder private var catalogContent: some View {
        let loading = request != nil || (page == nil && !failed)
        let groups = Dictionary(grouping: matches, by: \.group)
        if loading, page == nil {
            VStack(alignment: .leading, spacing: 10) {
                ProgressListSkeleton()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("加载中")
            .accessibilityIdentifier("capability-loading")
        }
        if failed || page?.incomplete == true {
            MobileInlineBanner(
                message: AppLocalization.string(failed ? "capability_load_failed" : "capability_partial", locale: locale),
                tone: failed ? .danger : .warning,
                actionLabel: AppLocalization.string("capability_retry", locale: locale),
                onAction: { load(refresh: true) }
            )
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
                    .id("capability-group-\(group)")
                ForEach(rows) { item in
                    catalogRow(item).id("capability-item-\(item.id)")
                }
            }
        }
    }

    private var matches: [CapabilityCatalogItem] {
        guard var rows = page?.items else { return [] }
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
            TextField(placeholder, text: queryBinding)
                .focused($searchFocused)
                .submitLabel(.search)
                .onSubmit { searchFocused = false }
                .accessibilityIdentifier("capability-search")
            if !query.isEmpty {
                Button { query = "" } label: {
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

    private func catalogRow(_ item: CapabilityCatalogItem) -> some View {
        HStack(spacing: 0) {
            Button {
                searchFocused = false
                if category == .agents {
                    onOpenAgent(item.id, personal?.agentId == item.id)
                } else {
                    openDetails(item)
                }
            } label: {
                CapabilityCardLabel(title: item.name, description: item.description,
                                    hoverEnabled: category != .agents || item.group != "disabled")
                {
                    icon(item)
                } trailing: {
                    if category == .connections, item.group == "available" || item.group == "attention" {
                        Text("capability_connect").font(.subheadline.weight(.medium))
                            .foregroundStyle(mobileTheme.action).padding(.trailing, 8)
                    }
                    if category != .agents {
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                            .foregroundStyle(mobileTheme.secondary).accessibilityHidden(true)
                    }
                }
            }
            .buttonStyle(MobilePressStyle(radius: mobileTheme.corner(18)))
            .accessibilityIdentifier("capability-row-\(item.id)")
            .disabled(category == .agents && item.group == "disabled")

            if category == .agents {
                Button {
                    openDetails(item)
                } label: {
                    Image(systemName: "ellipsis.circle").font(.body.weight(.regular))
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
                                    load(refresh: true)
                                    if item.id == personal?.agentId {
                                        onPersonalChanged()
                                    }
                                },
                                onClose: { detail = nil },
                                onUseInChat: { prompt in
                                    pendingChatPrompt = prompt
                                    detail = nil
                                }) { icon(item, extent: 44) }
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

    private func cancelRequest() {
        request?.cancel()
        request = nil
    }

    private func reloadCatalog() {
        cancelRequest()
        page = nil
        failed = false
        load()
    }

    private func load(refresh: Bool = false) {
        guard category != .devices, request == nil, refresh || (page == nil && !failed) else { return }
        failed = false
        request = Task { @MainActor in
            do {
                let response: GatewayEnvelope<CapabilityCatalogPage> = try await GatewayClient(configuration: configuration).request(
                    path: "/api/capabilities/mobile-catalog",
                    queryItems: [URLQueryItem(name: "category", value: category.id), URLQueryItem(name: "locale", value: locale.identifier)]
                )
                guard response.isSuccessful, let loaded = response.payload else { throw GatewayClientError.invalidResponse }
                try Task.checkCancellation()
                page = loaded
            } catch {
                if !Task.isCancelled {
                    failed = true
                }
            }
            if !Task.isCancelled {
                request = nil
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

    struct Visibility: Decodable { let field: String; let value: String }

    struct Link: Decodable, Identifiable {
        let label: String
        let url: URL
        let visibleWhen: Visibility?
        var id: String {
            url.absoluteString + ":" + label
        }
    }

    struct Copyable: Decodable {
        let label: String
        let content: String
        let note: String?
        let visibleWhen: Visibility?
    }

    struct Field: Decodable, Identifiable {
        let id: String
        let label: String
        let type: String
        let value: String?
        let hint: String?
        let description: String?
        let required: Bool?
        let format: String?
        let addLabel: String?
        let keyLabel: String?
        let valueLabel: String?
        let keyPlaceholder: String?
        let maxItems: Int?
        let advanced: Bool?
        let options: [Choice]?
        let visibleWhen: Visibility?
        let presentation: String?
        let retain: Bool?
    }

    struct Action: Decodable, Identifiable {
        let id: String
        let label: String
        let confirmation: String?
        let inlineReview: Bool?
        let advanced: Bool?
        let visibleWhen: Visibility?
        let dismiss: Bool?
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
    let headline: String?
    let subtitle: String?
    let steps: [String]?
    let links: [Link]?
    let copyable: Copyable?
    let reviewText: String?
    let tone: String?
    let advancedLabel: String?
    let detailsLabel: String?
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
                .mobileSheetPreset(.large)
            }
        }
    }
}

struct LinkedMcpSetupView: View {
    @Environment(\.locale) private var locale
    let configuration: GatewayConfiguration
    let name: String
    let serverURL: String
    let onClose: () -> Void
    let onUseInChat: (String) -> Void

    var body: some View {
        CapabilitySettingsPanel(configuration: configuration, category: "connections", itemID: "mcp:setup",
                                name: AppLocalization.string("capability_add_mcp", locale: locale), summary: "",
                                onChanged: {}, onClose: onClose, onUseInChat: onUseInChat,
                                initialFields: ["id": name, "url": serverURL])
        {
            CapabilityLogo(reference: nil, origin: configuration.baseURL, label: "", symbol: "link", extent: 44)
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
    var initialFields: [String: String] = [:]
    @ViewBuilder let icon: () -> Icon

    @Environment(\.mobileTheme) private var theme
    @Environment(\.locale) private var locale
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var panel: CapabilityPanelPayload?
    @State private var values: [String: String] = [:]
    @State private var retainedValues: [String: String] = [:]
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
    @State private var copiedBlock = false
    @FocusState private var focusedField: String?
    @State private var focusedCredential: String?

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

    private var panelNavigation: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    panelStatus
                    panelSteps
                    panelCopyable
                    panelLinks
                    if let review = panel?.reviewText {
                        Text(verbatim: review)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(theme.foreground)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(theme.panel, in: .rect(cornerRadius: theme.corner(16)))
                            .accessibilityIdentifier("capability-panel-review-text")
                    }
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
                    if itemID != "mcp:setup" {
                        panelDetails
                    }
                    if !mainFields.isEmpty {
                        VStack(spacing: 14) {
                            ForEach(mainFields) { field in input(field) }
                        }
                        .padding(14)
                        .background(theme.panel, in: .rect(cornerRadius: theme.corner(16)))
                    }
                    if itemID == "mcp:setup" {
                        panelDetails
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
                        DisclosureGroup(isExpanded: $advanced) {
                            VStack(spacing: 10) {
                                ForEach(extraFields) { field in input(field) }
                                ForEach(extraActions) { action in actionButton(action, prominent: false) }
                            }.padding(.top, 8)
                        } label: {
                            Text(verbatim: panel?.advancedLabel ?? t("更多选项", "More options"))
                        }
                        .padding(12).background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
                        .onChange(of: advanced) {
                            if itemID == "mcp:setup" {
                                dismissPanelKeyboard()
                            }
                        }
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
    }

    private var panelPresentation: some View {
        panelNavigation
            .presentationDetents([capabilityCompactDetent, capabilityExpandedDetent, .large], selection: $drawerDetent)
            .presentationContentInteraction(.scrolls)
            .presentationDragIndicator(.visible)
            .presentationBackground(theme.canvas)
            .onChange(of: panel?.qrUrl) { qrFeedback = nil }
            .onChange(of: panel?.copyable?.content) { copiedBlock = false }
            .onChange(of: verifiedURL) { showQr = false }
            .onChange(of: needsExpandedDrawer, initial: true) {
                drawerDetent = needsExpandedDrawer ? capabilityExpandedDetent : capabilityCompactDetent
            }
    }

    private var pollIdentity: String {
        (panel?.pollAction ?? "") + ":" + (panel?.flow ?? "")
    }

    var body: some View {
        panelPresentation
            .onDisappear {
                requestRevision += 1
                values.removeAll()
                retainedValues.removeAll()
            }
            .task { await load() }
            .onChange(of: scenePhase) { refreshActiveSetup() }
            .task(id: pollIdentity) { await pollSetupStatus() }
    }

    private func refreshActiveSetup() {
        guard scenePhase == .active, let action = panel?.pollAction else { return }
        Task { await load(action, polling: true) }
    }

    private func pollSetupStatus() async {
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
                if verifiedURL != nil {
                    qrSaveAction(code, prominent: false)
                }
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
        if panel?.headline != nil || panel?.subtitle != nil {
            VStack(alignment: .leading, spacing: 4) {
                if let headline = panel?.headline {
                    Text(verbatim: headline)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(theme.foreground)
                        .accessibilityAddTraits(.isHeader)
                }
                if let subtitle = panel?.subtitle {
                    Text(verbatim: subtitle).font(.footnote).foregroundStyle(theme.secondary)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
        if panel?.message != nil || readyPrompt != nil || panel?.pollAction != nil {
            HStack(spacing: 10) {
                if panel?.pollAction != nil {
                    Circle().fill(theme.action).frame(width: 8, height: 8).accessibilityHidden(true)
                } else if readyPrompt != nil || panel?.tone == "success" {
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

    @ViewBuilder private var panelSteps: some View {
        let steps = (panel?.steps ?? []).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if !steps.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .top, spacing: 8) {
                        if steps.count > 1 {
                            Text("\(index + 1).")
                                .font(.footnote.weight(.semibold).monospacedDigit())
                                .foregroundStyle(theme.action)
                        }
                        Text(verbatim: step)
                            .font(.footnote)
                            .foregroundStyle(theme.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(14)
            .background(theme.panel, in: .rect(cornerRadius: theme.corner(16)))
            .accessibilityIdentifier("capability-panel-steps")
        }
    }

    private var visibleCopyable: CapabilityPanelPayload.Copyable? {
        guard let block = panel?.copyable, !block.content.isEmpty, isVisible(block.visibleWhen) else { return nil }
        return block
    }

    @ViewBuilder private var panelCopyable: some View {
        if let block = visibleCopyable {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(verbatim: block.label)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(theme.foreground)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        UIPasteboard.general.setItems([["public.utf8-plain-text": block.content]], options: [.localOnly: true])
                        copiedBlock = true
                    } label: {
                        Label(copiedBlock ? t("已复制", "Copied") : t("复制", "Copy"),
                              systemImage: copiedBlock ? "checkmark" : "document.on.document")
                            .font(.footnote.weight(.medium))
                            .frame(minHeight: 30)
                    }
                    .buttonStyle(.bordered).buttonBorderShape(.capsule).tint(theme.action)
                    .accessibilityIdentifier("capability-panel-copy-block")
                }
                ScrollView(.vertical) {
                    Text(verbatim: block.content)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(theme.foreground)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 136)
                .padding(10)
                .background(theme.input, in: .rect(cornerRadius: theme.corner(12)))
                if let note = block.note, !note.isEmpty {
                    Text(verbatim: note)
                        .font(.caption)
                        .foregroundStyle(theme.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(14)
            .background(theme.panel, in: .rect(cornerRadius: theme.corner(16)))
            .accessibilityIdentifier("capability-panel-copyable")
        }
    }

    private var visibleLinks: [CapabilityPanelPayload.Link] {
        (panel?.links ?? []).filter { link in
            isVisible(link.visibleWhen) && link.url.scheme == "https" && link.url.host != nil && link.url.user == nil && link.url.password == nil
        }
    }

    @ViewBuilder private var panelLinks: some View {
        if !visibleLinks.isEmpty {
            VStack(spacing: 8) {
                ForEach(visibleLinks) { link in
                    Button { openURL(link.url) } label: {
                        HStack(spacing: 8) {
                            Text(verbatim: link.label)
                                .font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "arrow.up.right")
                                .font(.caption.weight(.semibold))
                                .accessibilityHidden(true)
                        }
                        .foregroundStyle(theme.action)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
                    }
                    .buttonStyle(.plain)
                }
            }
            .accessibilityIdentifier("capability-panel-links")
        }
    }

    @ViewBuilder private var panelDetails: some View {
        if let details = panel?.details, !details.isEmpty {
            DisclosureGroup(isExpanded: $detailsOpen) {
                Text(verbatim: details).font(.footnote).foregroundStyle(theme.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
            } label: {
                Text(verbatim: panel?.detailsLabel ?? t("查看详情", "View details"))
            }
            .padding(14)
            .background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
            .accessibilityIdentifier("capability-panel-review-details")
        }
    }

    @ViewBuilder private var panelFooter: some View {
        if readyPrompt != nil || primaryAction != nil || verifiedURL != nil || panel?.qrUrl != nil || cancelPairing != nil {
            VStack(spacing: 4) {
                if let prompt = readyPrompt {
                    Button {
                        dismissPanelKeyboard()
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
        (panel?.fields ?? []).filter { isVisible($0.visibleWhen) }
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
            || panel?.reviewText != nil
            || !(panel?.steps?.isEmpty ?? true)
            || visibleCopyable != nil
            || !visibleLinks.isEmpty
            || (advanced && (!extraFields.isEmpty || !extraActions.isEmpty))
            || (detailsOpen && panel?.details?.isEmpty == false)
            || shownFields.count >= 3
            || shownFields.contains { ["multiline", "list", "headers"].contains($0.type) }
            || (panel?.results?.count ?? 0) >= 3
    }

    private var mainActions: [CapabilityPanelPayload.Action] {
        (panel?.actions ?? []).filter { $0.advanced != true && isVisible($0.visibleWhen) }
    }

    private var extraActions: [CapabilityPanelPayload.Action] {
        (panel?.actions ?? []).filter { $0.advanced == true && isVisible($0.visibleWhen) }
    }

    private func isVisible(_ rule: CapabilityPanelPayload.Visibility?) -> Bool {
        guard let rule else { return true }
        return (values[rule.field] ?? "") == rule.value
    }

    private var verifiedURL: URL? {
        guard let url = panel?.authorizationUrl, url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }

    private var authorizationLabel: String {
        if let openedURL, openedURL == verifiedURL {
            return t("重新打开授权页", "Reopen authorization")
        }
        if panel?.deviceVerificationCode != nil {
            return t("打开验证页", "Open verification page")
        }
        return t("前往授权", "Open authorization")
    }

    private func openAuthorization(_ url: URL) {
        openURL(url) { accepted in
            if accepted {
                openedURL = url
            } else {
                errorMessage = t("无法打开授权页面，请重试。", "Could not open authorization. Try again.")
            }
        }
    }

    private func perform(_ action: CapabilityPanelPayload.Action) {
        dismissPanelKeyboard()
        if action.dismiss == true {
            onClose()
        } else if action.confirmation != nil, action.inlineReview != true {
            confirmation = action; confirmationOpen = true
        } else {
            Task { await load(action.id) }
        }
    }

    private func dismissPanelKeyboard() {
        focusedField = nil
        focusedCredential = nil
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

    private func fieldTitle(_ field: CapabilityPanelPayload.Field) -> some View {
        HStack(spacing: 4) {
            Text(verbatim: field.label).font(.subheadline.weight(.medium)).foregroundStyle(theme.foreground)
            if field.required == true {
                Text("*").font(.subheadline.weight(.semibold)).foregroundStyle(theme.action).accessibilityLabel(t("必填", "Required"))
            }
        }
    }

    @ViewBuilder private func fieldDescription(_ field: CapabilityPanelPayload.Field) -> some View {
        if let description = field.description, !description.isEmpty {
            Text(verbatim: description)
                .font(.caption)
                .foregroundStyle(theme.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private func input(_ field: CapabilityPanelPayload.Field) -> some View {
        let value = fieldValueBinding(field)
        VStack(alignment: .leading, spacing: 6) {
            if field.type == "toggle" {
                Toggle(isOn: Binding(get: { value.wrappedValue == "true" }, set: { value.wrappedValue = String($0) })) {
                    Text(verbatim: field.label)
                }
            } else if field.presentation == "segmented" {
                SegmentedTabs(
                    options: (field.options ?? []).map { option in
                        SegmentOption(
                            id: option.id,
                            title: LocalizedStringResource(stringLiteral: option.label),
                            accessibilityID: "capability-field-\(field.id)-\(option.id)"
                        )
                    },
                    selected: value.wrappedValue,
                    label: LocalizedStringKey(field.label),
                    swipeToSelect: true
                ) { next in
                    value.wrappedValue = next
                }
                .accessibilityIdentifier("capability-field-\(field.id)")
            } else if field.type == "select" {
                selectInput(field, value: value)
            } else if field.type == "list" {
                groupList(field, selection: value)
            } else if field.type == "headers" {
                VStack(alignment: .leading, spacing: 6) {
                    fieldTitle(field)
                    CapabilityKeyValueEditor(
                        encoded: value, focus: $focusedField, credentialFocus: $focusedCredential,
                        isEnvironment: field.id == "mcp-env",
                        keyLabel: field.keyLabel, valueLabel: field.valueLabel,
                        keyPlaceholder: field.keyPlaceholder, addLabel: field.addLabel, maxItems: field.maxItems
                    )
                }
            } else if field.format == "json" || field.id == "mcp-json" {
                jsonInput(field, value: value)
            } else {
                textInput(field, value: value)
            }
            fieldDescription(field)
        }
    }

    private func fieldValueBinding(_ field: CapabilityPanelPayload.Field) -> Binding<String> {
        Binding(get: { values[field.id] ?? "" }, set: {
            values[field.id] = $0
            if field.retain == true {
                retainedValues[field.id] = $0
            }
            if field.presentation == "segmented" {
                dismissPanelKeyboard()
                errorMessage = nil
            }
        })
    }

    @ViewBuilder private func selectInput(_ field: CapabilityPanelPayload.Field, value: Binding<String>) -> some View {
        let picker = Picker(selection: value) {
            ForEach(field.options ?? []) { option in Text(verbatim: option.label).tag(option.id) }
        } label: { Text(verbatim: field.label) }
        if itemID == "mcp:setup" {
            HStack(spacing: 8) {
                fieldTitle(field).accessibilityHidden(true)
                Spacer(minLength: 0)
                picker
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .accessibilityLabel(Text(verbatim: field.label))
                    .accessibilityIdentifier("capability-field-\(field.id)")
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(theme.input, in: .rect(cornerRadius: theme.corner(14)))
        } else {
            picker
        }
    }

    private func jsonInput(_ field: CapabilityPanelPayload.Field, value: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldTitle(field)
            ZStack(alignment: .topLeading) {
                if value.wrappedValue.isEmpty, let hint = field.hint {
                    Text(verbatim: hint).foregroundStyle(theme.secondary)
                        .padding(.top, 8).padding(.leading, 5)
                        .accessibilityHidden(true)
                }
                TextEditor(text: value)
                    .scrollContentBackground(.hidden)
                    .focused($focusedField, equals: field.id)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel(Text(verbatim: field.label))
                    .accessibilityIdentifier("capability-field-\(field.id)")
            }
            .font(.system(.footnote, design: .monospaced))
            .frame(height: 144)
        }
        .padding(12).background(theme.input, in: .rect(cornerRadius: theme.corner(14)))
    }

    private func textInput(_ field: CapabilityPanelPayload.Field, value: Binding<String>) -> some View {
        let isUrl = field.format == "url" || (itemID == "mcp:setup" && field.id == "url")
        let isCode = field.format == "code" || isUrl || itemID == "mcp:setup"
        return VStack(alignment: .leading, spacing: 6) {
            fieldTitle(field)
            if field.type == "secret", itemID == "mcp:setup" {
                McpCredentialInput(
                    label: field.label, placeholder: field.hint ?? field.label,
                    text: value, focus: $focusedCredential, fieldID: field.id
                )
            } else if field.type == "secret" {
                SecureField(field.hint ?? field.label, text: value).textContentType(nil)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($focusedField, equals: field.id)
            } else {
                TextField(field.hint ?? field.label, text: value, axis: field.type == "multiline" ? .vertical : .horizontal)
                    .lineLimit(field.type == "multiline" ? 3 ... 6 : 1 ... 1)
                    .keyboardType(isUrl ? .URL : .default)
                    .textInputAutocapitalization(isCode ? .never : nil)
                    .autocorrectionDisabled(isCode)
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
            fieldTitle(field)
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
                Button(field.addLabel ?? t("添加项目", "Add item"), action: addGroup)
                    .disabled(newGroup.trimmingCharacters(in: .whitespaces).isEmpty)
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
        guard access == .authorized || access == .limited, let data = image.pngData() else {
            qrFeedback = failure
            return
        }
        do {
            try await PHPhotoLibrary.shared().performChanges { @Sendable in
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }
            if panel?.qrUrl == code {
                qrFeedback = t("已保存到相册。", "Saved to Photos.")
            }
        } catch {
            if panel?.qrUrl == code {
                qrFeedback = failure
            }
        }
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    private func load(_ action: String? = nil, polling: Bool = false) async {
        guard !busy, !polling || !pollingNow else { return }
        if polling {
            pollingNow = true
        }
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
            if polling {
                pollingNow = false
            } else {
                busy = false
            }
        }
        do {
            let client = GatewayClient(configuration: configuration)
            let path = "/api/capabilities/mobile-actions/panel/\(category)"
            let submitted = itemID == "mcp:setup" ? values.filter { entry in
                visibleFields.contains { $0.id == entry.key }
            } : values
            let body = try action.map { try client.encoder.encode(CapabilityPanelCommand(
                action: $0, values: polling ? [:] : submitted, flow: panel?.flow, revision: panel?.revision
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
            let prefill = panel == nil && action == nil ? initialFields : [:]
            panel = result
            if result.actions?.contains(where: { $0.dismiss == true }) == true,
               result.actions?.contains(where: { $0.id == "add-another" }) != true
            {
                retainedValues.removeAll()
            }
            values = Dictionary((result.fields ?? []).map { ($0.id,
                                                             (polling ? currentValues[$0.id] : nil)
                                                                 ?? (itemID == "mcp:setup" && $0.retain == true ? retainedValues[$0.id] : nil)
                                                                 ?? prefill[$0.id]
                                                                 ?? ($0.type == "secret" ? "" : $0.value ?? "")) },
                                uniquingKeysWith: { first, _ in first })
            errorMessage = nil
            if openWhenReady, let url = verifiedURL, url != openedURL {
                openWhenReady = false
                openAuthorization(url)
            }
            if itemID == "mcp:setup" {
                if action == "save", result.actions?.contains(where: { $0.dismiss == true }) == true {
                    onChanged()
                }
            } else if !polling && action != "search" && action != nil || polling && before != nil && result.pollAction == nil {
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

private struct McpCredentialInput: UIViewRepresentable {
    let label: String
    let placeholder: String
    @Binding var text: String
    @Binding var focus: String?
    let fieldID: String
    @Environment(\.mobileTheme) private var theme

    func makeUIView(context: Context) -> UITextField {
        let input = UITextField()
        input.delegate = context.coordinator
        input.font = .preferredFont(forTextStyle: .body)
        input.adjustsFontForContentSizeCategory = true
        input.autocapitalizationType = .none
        input.autocorrectionType = .no
        input.spellCheckingType = .no
        input.smartQuotesType = .no
        input.smartDashesType = .no
        input.smartInsertDeleteType = .no
        input.keyboardType = .asciiCapable
        input.returnKeyType = .done
        input.setContentHuggingPriority(.defaultLow, for: .horizontal)
        input.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return input
    }

    func updateUIView(_ input: UITextField, context: Context) {
        context.coordinator.field = self
        let masked = String(repeating: "•", count: text.count)
        if input.text != masked {
            input.text = masked
        }
        input.placeholder = placeholder
        input.accessibilityLabel = label
        input.textColor = UIColor(theme.foreground)
        if input.isFirstResponder, focus != fieldID {
            input.resignFirstResponder()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(field: self)
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var field: McpCredentialInput

        init(field: McpCredentialInput) {
            self.field = field
        }

        func textFieldDidBeginEditing(_: UITextField) {
            field.focus = field.fieldID
        }

        func textFieldDidEndEditing(_: UITextField) {
            if field.focus == field.fieldID {
                field.focus = nil
            }
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            textField.resignFirstResponder()
            return false
        }

        func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
            let credential = field.text
            guard let start = credential.index(credential.startIndex, offsetBy: range.location, limitedBy: credential.endIndex),
                  let end = credential.index(start, offsetBy: range.length, limitedBy: credential.endIndex) else { return false }
            // Keep the credential in form state so the system input only ever contains bullets.
            let updated = credential.replacingCharacters(in: start ..< end, with: string)
            field.text = updated
            textField.text = String(repeating: "•", count: updated.count)
            let offset = min(range.location + string.count, updated.count)
            if let cursor = textField.position(from: textField.beginningOfDocument, offset: offset) {
                textField.selectedTextRange = textField.textRange(from: cursor, to: cursor)
            }
            return false
        }
    }
}

private struct CapabilityKeyValueEditor: View {
    @Binding var encoded: String
    let focus: FocusState<String?>.Binding
    @Binding var credentialFocus: String?
    let isEnvironment: Bool
    var keyLabel: String?
    var valueLabel: String?
    var keyPlaceholder: String?
    var addLabel: String?
    var maxItems: Int?
    @Environment(\.locale) private var locale
    @Environment(\.mobileTheme) private var theme

    private var prefix: String {
        isEnvironment ? "mcp-env" : "mcp-header"
    }

    private var resolvedNameLabel: String {
        keyLabel ?? (isEnvironment ? t("变量名", "Variable name") : t("请求头名称", "Header name"))
    }

    private var resolvedValueLabel: String {
        valueLabel ?? (isEnvironment ? t("变量值", "Variable value") : t("请求头值", "Header value"))
    }

    private var resolvedKeyPlaceholder: String {
        keyPlaceholder ?? (isEnvironment ? "API_KEY" : "X-API-Key")
    }

    private var resolvedAddLabel: String {
        addLabel ?? (isEnvironment ? t("添加变量", "Add variable") : t("添加请求头", "Add header"))
    }

    private var resolvedMaxItems: Int {
        maxItems ?? (isEnvironment ? 32 : 16)
    }

    private var rows: [[String]] {
        let decoded = try? JSONDecoder().decode([[String]].self, from: Data(encoded.utf8))
        let pairs = (decoded ?? []).filter { $0.count == 2 }
        return pairs.isEmpty ? [["", ""]] : pairs
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(rows.indices, id: \.self) { index in
                HStack(alignment: .top, spacing: 4) {
                    VStack(spacing: 0) {
                        TextField(resolvedKeyPlaceholder, text: cell(index, 0))
                            .focused(focus, equals: "\(prefix)-name-\(index)")
                            .accessibilityLabel(resolvedNameLabel)
                            .accessibilityIdentifier("\(prefix)-name-\(index)")
                            .padding(10)
                        Divider().padding(.horizontal, 10)
                        McpCredentialInput(
                            label: resolvedValueLabel, placeholder: resolvedValueLabel, text: cell(index, 1),
                            focus: $credentialFocus, fieldID: "\(prefix)-value-\(index)"
                        )
                        .accessibilityIdentifier("\(prefix)-value-\(index)")
                        .padding(10)
                    }
                    .textFieldStyle(.plain)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .background(theme.input, in: .rect(cornerRadius: theme.corner(12)))
                    if rows.count > 1 {
                        Button {
                            var pairs = rows
                            pairs.remove(at: index)
                            write(pairs)
                        } label: {
                            Image(systemName: "minus.circle")
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(theme.secondary)
                        .accessibilityLabel(isEnvironment ? t("移除变量", "Remove variable") : t("移除请求头", "Remove header"))
                    }
                }
            }
            if rows.count < resolvedMaxItems {
                Button {
                    write(rows + [["", ""]])
                } label: {
                    Label(resolvedAddLabel, systemImage: "plus")
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.action)
            }
        }
    }

    private func cell(_ index: Int, _ column: Int) -> Binding<String> {
        Binding(get: { rows.indices.contains(index) ? rows[index][column] : "" }, set: { value in
            var pairs = rows
            guard pairs.indices.contains(index) else { return }
            pairs[index][column] = value
            write(pairs)
        })
    }

    private func write(_ pairs: [[String]]) {
        guard let data = try? JSONEncoder().encode(pairs),
              let json = String(bytes: data, encoding: .utf8) else { return }
        encoded = json
    }

    private func t(_ chinese: String, _ english: String) -> String {
        locale.identifier.hasPrefix("zh") ? chinese : english
    }
}
