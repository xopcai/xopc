import Foundation

enum AppLocalization {
    static var selectedLocale: Locale {
        switch UserDefaults.standard.string(forKey: "app.language") {
        case "chinese": Locale(identifier: "zh-Hans")
        case "english": Locale(identifier: "en")
        default: .autoupdatingCurrent
        }
    }

    static func string(_ key: String, locale: Locale, bundle: Bundle = .main) -> String {
        let strings = localizedBundle(for: locale, in: bundle)
        return strings.localizedString(forKey: key, value: key, table: "Localizable")
    }

    static func resolve(
        _ resource: LocalizedStringResource,
        locale: Locale = selectedLocale,
        bundle: Bundle = .main
    ) -> String {
        String(localized: resource.defaultValue, table: resource.table, bundle: localizedBundle(for: locale, in: bundle))
    }

    private static func localizedBundle(for locale: Locale, in bundle: Bundle) -> Bundle {
        let language = locale.identifier.hasPrefix("zh") ? "zh-Hans" : "en"
        return bundle.path(forResource: language, ofType: "lproj")
            .flatMap(Bundle.init(path:)) ?? bundle
    }
}
