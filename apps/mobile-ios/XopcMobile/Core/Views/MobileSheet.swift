import SwiftUI

/// Four canonical sheet height & chrome presets aligned across iOS, Android, and HarmonyOS.
enum MobileSheetPreset: Sendable, CaseIterable {
    case compact
    case medium
    case large
    case immersive

    var detents: Set<PresentationDetent> {
        switch self {
        case .compact:
            [.height(340), .medium]
        case .medium:
            [.fraction(0.70), .large]
        case .large:
            [.large]
        case .immersive:
            [.fraction(0.94)]
        }
    }

    var dragIndicator: Visibility {
        switch self {
        case .immersive:
            .hidden
        case .compact, .medium, .large:
            .visible
        }
    }
}

private struct MobileSheetPresetModifier: ViewModifier {
    @Environment(\.mobileTheme) private var theme
    let preset: MobileSheetPreset
    let background: Color?

    func body(content: Content) -> some View {
        content
            .presentationDetents(preset.detents)
            .presentationDragIndicator(preset.dragIndicator)
            .presentationCornerRadius(theme.corner(MobileDesignTokens.radiusLg))
            .presentationBackground(background ?? theme.panel)
    }
}

extension View {
    func mobileSheetPreset(_ preset: MobileSheetPreset, background: Color? = nil) -> some View {
        modifier(MobileSheetPresetModifier(preset: preset, background: background))
    }
}

/// Unified circular close button for sheets and modal headers (consistent `xmark` symbol).
struct MobileCloseButton: View {
    @Environment(\.mobileTheme) private var theme
    var accessibilityID: String = "sheet-close"
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.secondary)
                .frame(width: MobileDesignTokens.buttonHeightSm, height: MobileDesignTokens.buttonHeightSm)
                .background(theme.input, in: .circle)
                .frame(width: MobileDesignTokens.buttonHeightMd, height: MobileDesignTokens.buttonHeightMd)
                .contentShape(.circle)
        }
        .buttonStyle(MobilePressStyle(radius: MobileDesignTokens.buttonHeightMd / 2))
        .accessibilityLabel("关闭")
        .accessibilityIdentifier(accessibilityID)
    }
}

/// Unified sheet header: left title (+ optional subtitle), right circular `xmark` close button.
struct MobileSheetHeader: View {
    @Environment(\.mobileTheme) private var theme
    let title: String
    var subtitle: String = ""
    var closeID: String = "sheet-close"
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: MobileDesignTokens.groupGap) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(theme.foreground)
                    .lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(theme.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            MobileCloseButton(accessibilityID: closeID, action: onClose)
        }
        .padding(.horizontal, MobileDesignTokens.sheetPaddingX)
        .padding(.vertical, 10)
    }
}
