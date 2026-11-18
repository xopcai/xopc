import SwiftUI

struct AppSettingsView: View {
    let configuration: GatewayConfiguration
    let gatewayName: String
    let onOpenGatewaySettings: () -> Void
    let personalAgent: PersonalAgentRecord?
    let personalAgentBusy: Bool
    let personalAgentError: String?
    let onOpenPersonalAgent: () -> Void
    let onPersonalAgentSaved: (PersonalAgentRecord) -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        List {
            Section("个性化") {
                PersonalAgentSettingsRow(configuration: configuration, personalAgent: personalAgent,
                                         busy: personalAgentBusy, error: personalAgentError, onOpenPersonalAgent: onOpenPersonalAgent, onSaved: onPersonalAgentSaved)
                NavigationLink {
                    UserUnderstandingView(configuration: configuration)
                } label: {
                    Label("隐私与记忆", systemImage: "lock")
                }
                .accessibilityIdentifier("settings-privacy-memory")
                NavigationLink {
                    PersonalGoalsView(configuration: configuration)
                } label: {
                    Label("目标", systemImage: "flag")
                }
                .accessibilityIdentifier("settings-goals")
            }
            Section("连接与通知") {
                Button {
                    onOpenGatewaySettings()
                } label: {
                    LabeledContent {
                        Text(gatewayName)
                    } label: {
                        Label("Gateway 管理", systemImage: "network")
                    }
                }
                .accessibilityLabel("Gateway 管理")
                NavigationLink {
                    ModelSettingsView(configuration: configuration)
                } label: {
                    Label("模型设置", systemImage: "slider.horizontal.3")
                }
                .accessibilityIdentifier("settings-models")
                NavigationLink {
                    NotificationSettingsView()
                } label: {
                    Label("通知", systemImage: "bell")
                }
            }
            Section("数据与分享") {
                NavigationLink {
                    ShareCenterView(configuration: configuration)
                } label: {
                    Label("分享记录", systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("settings-share-history")
                NavigationLink {
                    FilesView(configuration: configuration)
                } label: {
                    Label("文件", systemImage: "folder")
                }
            }
            Section("偏好设置") {
                NavigationLink {
                    LanguageSettingsView()
                } label: {
                    Label("语言", systemImage: "globe")
                }
                NavigationLink {
                    AppearanceSettingsView()
                } label: {
                    Label("外观", systemImage: "sun.max")
                }
            }
            Section("关于") {
                NavigationLink {
                    AboutView()
                } label: {
                    Label("关于 xopc", systemImage: "info.circle")
                }
                .accessibilityIdentifier("settings-about")
            }
        }
        .listSectionSpacing(16)
        .navigationTitle(Text(verbatim: AppLocalization.string("设置", locale: locale)))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ShareCenterView: View {
    let configuration: GatewayConfiguration
    @State private var shares: [MobileShare] = []
    @State private var activeOnly = false
    @State private var loaded = false
    @State private var busy = false
    @State private var failed = false
    @State private var revokeTarget: MobileShare?

    private var visibleShares: [MobileShare] {
        activeOnly ? shares.filter(\.isActive) : shares
    }

    var body: some View {
        List {
            Section {
                SegmentedTabs(options: [
                    SegmentOption(id: false, title: "全部", accessibilityID: "share-filter-all"),
                    SegmentOption(id: true, title: "仅有效", accessibilityID: "share-filter-active")
                ], selected: activeOnly, label: "筛选") { activeOnly = $0 }
            }

            if failed {
                Section {
                    Text("暂时无法读取分享记录。").foregroundStyle(.secondary)
                    Button("重试") { Task { await load() } }
                }
            } else if !loaded {
                Text("正在读取分享记录").redacted(reason: .placeholder)
            } else if visibleShares.isEmpty {
                Section {
                    Text(activeOnly ? "没有有效的分享链接" : "暂无分享记录").font(.headline)
                }
            }
            Section {
                ForEach(visibleShares) { share in
                    shareRow(share)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(12)
        .navigationTitle("分享记录")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: configuration) { await load() }
        .refreshable { await load() }
        .confirmationDialog("撤销链接", isPresented: Binding(get: { revokeTarget != nil }, set: {
            if !$0 { revokeTarget = nil }
        }), titleVisibility: .visible, presenting: revokeTarget) { share in
            Button("撤销", role: .destructive) {
                Task { await update(share) { client in try await client.revokeShare(id: share.id) } }
            }
        } message: { _ in
            Text("该链接将立即停止访问。")
        }
    }

    private func shareRow(_ share: MobileShare) -> some View {
        HStack(spacing: 12) {
            Image(systemName: shareIcon(share.kind)).foregroundStyle(.secondary).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(share.fileName).mobileTextStyle(.rowTitle).lineLimit(2)
                Text(share.revoked ? "已撤销" : share.expired ? "已过期" : "有效")
                    .font(.footnote).foregroundStyle(share.isActive ? Color.green : Color.secondary)
                if let created = share.createdAt {
                    Text("分享于 \(displayDate(created))").font(.caption).foregroundStyle(.secondary)
                }
                Text("有效期至 \(displayDate(share.expiresAt))").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if share.isActive {
                Menu {
                    if let link = share.shareUrl, let url = URL(string: link),
                       ["https", "http"].contains(url.scheme?.lowercased() ?? "")
                    {
                        Link("打开链接", destination: url)
                        ShareLink(item: url) { Label("分享链接", systemImage: "square.and.arrow.up") }
                    }
                    Menu("延长有效期") {
                        ForEach([1, 3, 7], id: \.self) { days in
                            Button("\(days) 天") {
                                Task { await update(share) { client in try await client.extendShare(id: share.id, days: days) } }
                            }
                        }
                    }
                    Button("撤销链接", role: .destructive) { revokeTarget = share }
                } label: {
                    Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("分享操作")
                .disabled(busy || failed)
            }
        }
        .padding(.vertical, 6)
        .accessibilityIdentifier("share-record-\(share.id)")
    }

    private func shareIcon(_ kind: String?) -> String {
        switch kind {
        case "directory": "folder"
        case "session": "bubble.left"
        case "note": "note.text"
        case "site": "globe"
        default: "doc"
        }
    }

    private func displayDate(_ value: String) -> String {
        let date = (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value))
            ?? (try? Date.ISO8601FormatStyle().parse(value))
        return date?.formatted(date: .abbreviated, time: .shortened) ?? value
    }

    @MainActor private func load() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        await fetch()
    }

    @MainActor private func fetch() async {
        do {
            let rows = try await GatewayClient(configuration: configuration).fetchShares()
            try Task.checkCancellation()
            shares = rows
            loaded = true
            failed = false
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }

    @MainActor private func update(_ share: MobileShare, action: (GatewayClient) async throws -> Void) async {
        guard !busy, !failed, share.isActive else { return }
        busy = true
        defer { busy = false }
        do {
            try await action(GatewayClient(configuration: configuration))
            await fetch()
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }
}

private struct NotificationSettingsView: View {
    var body: some View {
        Form {
            Section {
                if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                    Link("系统通知设置", destination: url)
                }
            }
        }
        .navigationTitle("通知")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct LanguageSettingsView: View {
    @Environment(\.locale) private var locale
    @AppStorage("app.language") private var language = AppLanguage.system.rawValue

    var body: some View {
        Form {
            Section {
                Picker("应用语言", selection: $language) {
                    ForEach(AppLanguage.allCases) { item in Text(item.title).tag(item.rawValue) }
                }
                .pickerStyle(.inline)
            }
        }
        .navigationTitle(Text(verbatim: AppLocalization.string("语言", locale: locale)))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct AppearanceSettingsView: View {
    @Environment(\.locale) private var locale
    @Environment(\.mobileTheme) private var mobileTheme
    @AppStorage("app.appearance") private var appearance = AppAppearance.system.rawValue
    @AppStorage("app.colorPreset") private var colorPreset = MobileThemePreset.default.rawValue

    var body: some View {
        Form {
            Section("display_mode") {
                Picker("主题", selection: $appearance) {
                    ForEach(AppAppearance.allCases) { item in Text(item.title).tag(item.rawValue) }
                }
                .pickerStyle(.inline)
                .listRowBackground(mobileTheme.panel)
            }
            Section("color_scheme") {
                Picker("color_scheme", selection: $colorPreset) {
                    ForEach(MobileThemePreset.allCases) { preset in
                        HStack(spacing: 12) {
                            Text(preset.title)
                            Spacer()
                            themeSwatch(preset, dark: false)
                            themeSwatch(preset, dark: true)
                        }
                        .tag(preset.rawValue)
                        .accessibilityIdentifier("color-scheme-\(preset.rawValue)")
                    }
                }
                .pickerStyle(.inline)
                .listRowBackground(mobileTheme.panel)
            }
        }
        .scrollContentBackground(.hidden)
        .background(mobileTheme.canvas)
        .navigationTitle(Text(verbatim: AppLocalization.string("外观", locale: locale)))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func themeSwatch(_ preset: MobileThemePreset, dark: Bool) -> some View {
        let preview = MobileTheme(preset: preset, dark: dark)
        let shape = RoundedRectangle(cornerRadius: preview.corner(6))
        return shape.fill(preview.canvas)
            .overlay {
                RoundedRectangle(cornerRadius: preview.corner(4))
                    .fill(preview.panel)
                    .overlay { Circle().fill(preview.action).frame(width: 7, height: 7) }
                    .padding(3)
            }
            .frame(width: 28, height: 20)
            .accessibilityHidden(true)
    }
}

enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case chinese
    case english

    var id: String {
        rawValue
    }

    var title: LocalizedStringResource {
        switch self {
        case .system: "跟随系统"
        case .chinese: "简体中文"
        case .english: "English"
        }
    }

    var locale: Locale {
        switch self {
        case .system: .autoupdatingCurrent
        case .chinese: Locale(identifier: "zh-Hans")
        case .english: Locale(identifier: "en")
        }
    }
}

enum AppAppearance: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String {
        rawValue
    }

    var title: LocalizedStringResource {
        switch self {
        case .system: "跟随系统"
        case .light: "浅色"
        case .dark: "深色"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
