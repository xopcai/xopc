import SwiftUI

struct AppSettingsView: View {
    @Environment(\.locale) private var locale

    var body: some View {
        List {
            Section("显示") {
                NavigationLink {
                    LanguageSettingsView()
                } label: {
                    Label("语言", systemImage: "globe")
                }
                NavigationLink {
                    AppearanceSettingsView()
                } label: {
                    Label("主题", systemImage: "circle.lefthalf.filled")
                }
            }
        }
        .navigationTitle(AppLocalization.string("设置", locale: locale))
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
