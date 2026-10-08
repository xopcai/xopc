import SwiftUI

struct AppSettingsView: View {
    let configuration: GatewayConfiguration
    let onOpenGatewaySettings: () -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        List {
            Section("连接与通知") {
                Button {
                    onOpenGatewaySettings()
                } label: {
                    Label("Gateway 管理", systemImage: "network")
                }
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
                    Label("分享中心", systemImage: "square.and.arrow.up")
                }
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
                    Label("xopc", systemImage: "info.circle")
                }
            }
        }
        .navigationTitle(AppLocalization.string("设置", locale: locale))
    }
}

private struct ShareCenterView: View {
    let configuration: GatewayConfiguration
    @State private var shares: [MobileShare] = []
    @State private var showInactive = false
    @State private var error: String?

    private var visibleShares: [MobileShare] {
        showInactive ? shares : shares.filter { !$0.revoked && !$0.expired }
    }

    var body: some View {
        List {
            if error != nil {
                Section {
                    Text("分享记录暂时无法读取").foregroundStyle(.secondary)
                    Button("重试") { Task { await load() } }
                }
            }
            ForEach(visibleShares) { share in
                VStack(alignment: .leading, spacing: 6) {
                    Text(share.fileName).font(.headline)
                    Text(share.revoked ? "已撤销" : share.expired ? "已过期" : "有效")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(share.expiresAt).font(.caption2).foregroundStyle(.secondary)
                    if let url = URL(string: share.shareUrl) {
                        ShareLink(item: url) { Label("分享链接", systemImage: "square.and.arrow.up") }
                    }
                }
                .swipeActions {
                    if !share.revoked, !share.expired {
                        Button("撤销", role: .destructive) { Task { await revoke(share) } }
                        Menu("延长") {
                            ForEach([1, 3, 7], id: \.self) { days in
                                Button("\(days) 天") { Task { await extend(share, days: days) } }
                            }
                        }
                        .tint(.blue)
                    }
                }
            }
            if visibleShares.isEmpty, error == nil {
                ContentUnavailableView("暂无分享", systemImage: "square.and.arrow.up")
            }
        }
        .navigationTitle("分享中心")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(showInactive ? "隐藏失效" : "显示失效") { showInactive.toggle() }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    @MainActor private func load() async {
        do {
            shares = try await GatewayClient(configuration: configuration).fetchShares()
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func revoke(_ share: MobileShare) async {
        do {
            try await GatewayClient(configuration: configuration).revokeShare(id: share.id)
            await load()
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func extend(_ share: MobileShare, days: Int) async {
        do {
            try await GatewayClient(configuration: configuration).extendShare(id: share.id, days: days)
            await load()
        } catch { self.error = error.localizedDescription }
    }
}

private struct NotificationSettingsView: View {
    var body: some View {
        Form {
            Section {
                LabeledContent("通知") { Text("由系统管理") }
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    Link("打开系统通知设置", destination: url)
                }
            } footer: {
                Text("通知权限可在 iOS 系统设置中管理。")
            }
        }
        .navigationTitle("通知")
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
        .navigationTitle(AppLocalization.string("语言", locale: locale))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct AppearanceSettingsView: View {
    @Environment(\.locale) private var locale
    @AppStorage("app.appearance") private var appearance = AppAppearance.system.rawValue

    var body: some View {
        Form {
            Section {
                Picker("主题", selection: $appearance) {
                    ForEach(AppAppearance.allCases) { item in Text(item.title).tag(item.rawValue) }
                }
                .pickerStyle(.inline)
            }
        }
        .navigationTitle(AppLocalization.string("主题", locale: locale))
        .navigationBarTitleDisplayMode(.inline)
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
