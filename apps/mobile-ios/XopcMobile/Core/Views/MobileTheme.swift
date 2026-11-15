import SwiftUI

enum MobileThemePreset: String, CaseIterable, Identifiable {
    case `default`, porcelain, dawn, emerald, clay

    var id: String { rawValue }

    var title: LocalizedStringResource {
        switch self {
        case .default: "color_scheme_default"
        case .porcelain: "color_scheme_porcelain"
        case .dawn: "color_scheme_dawn"
        case .emerald: "color_scheme_emerald"
        case .clay: "color_scheme_clay"
        }
    }

    fileprivate var cornerScale: CGFloat {
        switch self {
        case .emerald: 0.8
        case .clay: 1.2
        case .dawn: 1.25
        default: 1
        }
    }
}

struct MobileTheme {
    let preset: MobileThemePreset
    let canvas: Color
    let panel: Color
    let foreground: Color
    let secondary: Color
    let grouped: Color
    let input: Color
    let edge: Color
    let action: Color
    let onAction: Color
    let bubble: Color
    let card: Color

    init(preset: MobileThemePreset = .default, dark: Bool = false) {
        self.preset = preset
        let values = Self.colors(preset, dark)
        canvas = Self.color(values.canvas)
        panel = Self.color(values.panel)
        foreground = Self.color(values.foreground)
        secondary = Self.color(values.secondary)
        grouped = Self.color(values.grouped)
        input = Self.color(values.input)
        edge = Self.color(values.edge)
        action = Self.color(values.action)
        onAction = Self.color(values.onAction)
        bubble = Self.color(values.bubble)
        card = Self.color(values.card)
    }

    func corner(_ base: CGFloat) -> CGFloat { (base * preset.cornerScale).rounded() }

    private static func color(_ rgb: UInt32) -> Color {
        Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }

    // The same semantic roles and preset colors as the HarmonyOS client.
    private static func colors(_ preset: MobileThemePreset, _ dark: Bool) ->
        (canvas: UInt32, panel: UInt32, foreground: UInt32, secondary: UInt32, grouped: UInt32, input: UInt32,
         edge: UInt32, action: UInt32, onAction: UInt32, bubble: UInt32, card: UInt32)
    {
        switch (preset, dark) {
        case (.default, false):
            (0xE9EDF3, 0xFFFFFF, 0x142033, 0x46566C, 0xF2F5F9, 0xD8E0EB,
             0xCBD4E1, 0x0054C6, 0xFFFFFF, 0xD5E6FF, 0xFFFFFF)
        case (.default, true):
            (0x14171C, 0x1B1F26, 0xF4F6F8, 0xB8BEC8, 0x171B21, 0x242933,
             0x323844, 0xA8BCFF, 0x14171C, 0x252F40, 0x222730)
        case (.porcelain, false):
            (0xF6F0E7, 0xFFFCF7, 0x352E2A, 0x665B54, 0xF1EAE1, 0xEFE5DC,
             0xE4DCD3, 0x844633, 0xFFFFFF, 0xE9E0D5, 0xE8DED3)
        case (.porcelain, true):
            (0x211C19, 0x2B2420, 0xF3EAE1, 0xC5B5A8, 0x241E1A, 0x3B3029,
             0x4A3E35, 0xE4AE98, 0x211C19, 0x372B24, 0x302822)
        case (.dawn, false):
            (0xEDF2F7, 0xF8FBFF, 0x262626, 0x595F66, 0xDAE3EC, 0xE7EBF4,
             0xCFDAE5, 0x245781, 0xFFFFFF, 0xDFE6EF, 0xE0E8F2)
        case (.dawn, true):
            (0x172433, 0x253342, 0xF3F6FA, 0xBFC7D0, 0x0C1722, 0x415264,
             0x415264, 0xAFD5FB, 0x172433, 0x26394D, 0x253547)
        case (.emerald, false):
            (0xF0FDF4, 0xFFFFFF, 0x052E16, 0x166534, 0xE8F8ED, 0xDCFCE7,
             0x86EFAC, 0x087446, 0xFFFFFF, 0xE0EBE4, 0xDFEBE3)
        case (.emerald, true):
            (0x000000, 0x0A0A0A, 0xD1FAE5, 0x6EE7B7, 0x050B07, 0x111111,
             0x134E2A, 0x78DDB0, 0x000000, 0x172B21, 0x14221B)
        case (.clay, false):
            (0xFFFAF0, 0xFFFFFF, 0x0A0A0A, 0x6A6A6A, 0xF7F0E4, 0xFAF5E8,
             0xE5E5E5, 0x705430, 0xFFFFFF, 0xEBE5DB, 0xEAE1D3)
        case (.clay, true):
            (0x0A1A1A, 0x1A2A2A, 0xFFFAF0, 0xA4D4C5, 0x142222, 0x243636,
             0x2A3A3A, 0xFFB084, 0x0A1A1A, 0x1B3030, 0x1A2B2A)
        }
    }
}

private struct MobileThemeKey: EnvironmentKey {
    static let defaultValue = MobileTheme()
}

extension EnvironmentValues {
    var mobileTheme: MobileTheme {
        get { self[MobileThemeKey.self] }
        set { self[MobileThemeKey.self] = newValue }
    }
}
