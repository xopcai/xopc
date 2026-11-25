import SwiftUI

enum MobileThemePreset: String, CaseIterable, Identifiable {
    case `default`, porcelain, emerald, clay

    var id: String {
        rawValue
    }

    var title: LocalizedStringResource {
        switch self {
        case .default: "color_scheme_default"
        case .porcelain: "color_scheme_porcelain"
        case .emerald: "color_scheme_emerald"
        case .clay: "color_scheme_clay"
        }
    }

    fileprivate var cornerScale: CGFloat {
        switch self {
        case .emerald: 0.8
        case .clay: 1.2
        default: 1
        }
    }
}

struct MobileTheme: Sendable {
    let preset: MobileThemePreset
    let canvas: Color
    let panel: Color
    let foreground: Color
    let secondary: Color
    let grouped: Color
    let input: Color
    let active: Color
    let danger: Color
    let dangerSoft: Color
    let attention: Color
    let onAttention: Color
    let success: Color
    let successSoft: Color
    let scrim: Color
    let assistantBubble: Color
    let reaction: Color
    let action: Color
    let onAction: Color
    let bubble: Color
    let card: Color

    var warningFill: Color {
        attention
    }

    var warningForeground: Color {
        onAttention
    }

    init(preset: MobileThemePreset = .default, dark: Bool = false) {
        self.preset = preset
        let values = Self.colors(preset, dark)
        canvas = Self.color(values.canvas)
        panel = Self.color(values.panel)
        foreground = Self.color(values.foreground)
        secondary = Self.color(values.secondary)
        grouped = Self.color(values.grouped)
        input = Self.color(values.input)
        active = Self.color(values.active)
        danger = Self.color(values.danger)
        dangerSoft = Self.color(dark ? 0x382124 : 0xFDECEC)
        attention = Self.color(dark ? 0x352C22 : 0xFFF2D2)
        onAttention = Self.color(dark ? 0xFFBC63 : 0x734600)
        success = Self.color(dark ? 0x66D89A : 0x176141)
        successSoft = Self.color(dark ? 0x1A2F24 : 0xE6F5EC)
        scrim = Color.black.opacity(dark ? 0.45 : 0.40)
        assistantBubble = dark ? input : panel
        reaction = dark ? active : panel
        action = Self.color(values.action)
        onAction = Self.color(values.onAction)
        bubble = Self.color(values.bubble)
        card = Self.color(values.card)
    }

    func corner(_ base: CGFloat) -> CGFloat {
        (base * preset.cornerScale).rounded()
    }

    private static func color(_ rgb: UInt32) -> Color {
        Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }

    /// The same semantic roles and preset colors as the HarmonyOS client.
    private static func colors(_ preset: MobileThemePreset, _ dark: Bool) ->
        // swiftlint:disable:next large_tuple
        (canvas: UInt32, panel: UInt32, foreground: UInt32, secondary: UInt32, grouped: UInt32, input: UInt32,
         active: UInt32, danger: UInt32, action: UInt32, onAction: UInt32, bubble: UInt32, card: UInt32)
    {
        switch (preset, dark) {
        case (.default, false):
            (0xE9EDF3, 0xFFFFFF, 0x142033, 0x46566C, 0xF2F5F9, 0xD8E0EB,
             0xE5F0FF, 0xA12632, 0x0054C6, 0xFFFFFF, 0xC7D5E7, 0xFFFFFF)
        case (.default, true):
            (0x14171C, 0x1B1F26, 0xF4F6F8, 0xB8BEC8, 0x171B21, 0x242933,
             0x43516B, 0xFF8383, 0xA8BCFF, 0x14171C, 0x2D394D, 0x222730)
        case (.porcelain, false):
            (0xF6F0E7, 0xFFFCF7, 0x352E2A, 0x665B54, 0xF1EAE1, 0xEBDFD4,
             0xE8D9CF, 0x9C3B3B, 0x844633, 0xFFFFFF, 0xE9E0D5, 0xE8DED3)
        case (.porcelain, true):
            (0x211C19, 0x2B2420, 0xF3EAE1, 0xC5B5A8, 0x241E1A, 0x3B3029,
             0x5E4B40, 0xE8A19A, 0xE4AE98, 0x211C19, 0x4E392E, 0x302822)
        case (.emerald, false):
            (0xE8F5ED, 0xFFFFFF, 0x052E16, 0x166534, 0xE8F8ED, 0xCFE9D8,
             0xBDF2D1, 0xB91C1C, 0x087446, 0xFFFFFF, 0xE0EBE4, 0xDFEBE3)
        case (.emerald, true):
            (0x000000, 0x131916, 0xD1FAE5, 0x6EE7B7, 0x080D0A, 0x202A24,
             0x13513E, 0xFF8080, 0x78DDB0, 0x000000, 0x223D2F, 0x14221B)
        case (.clay, false):
            (0xF5EDE1, 0xFFFFFF, 0x0A0A0A, 0x565044, 0xF7F0E4, 0xE7DCCC,
             0xECE4D3, 0xB42332, 0x705430, 0xFFFFFF, 0xEBE5DB, 0xEAE1D3)
        case (.clay, true):
            (0x0A1A1A, 0x1A2A2A, 0xFFFAF0, 0xA4D4C5, 0x142222, 0x243636,
             0x376058, 0xFF9292, 0xFFB084, 0x0A1A1A, 0x284540, 0x1A2B2A)
        }
    }
}

extension EnvironmentValues {
    @Entry var mobileTheme: MobileTheme = .init()
}

extension View {
    func mobilePageTitle(_ title: Text) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Color.clear.frame(width: 1, height: 1).accessibilityHidden(true)
                }
            }
    }

    func mobilePageTitle(_ title: Text, @ViewBuilder switcher: () -> some View) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .principal, content: switcher) }
    }
}

struct MobilePressStyle: ButtonStyle {
    @Environment(\.mobileTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let radius: CGFloat
    var restingBackground = Color.clear

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? theme.active : restingBackground, in: .rect(cornerRadius: radius))
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
