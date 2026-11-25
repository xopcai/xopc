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
            [.fraction(0.72), .large]
        case .large:
            [.fraction(0.88), .large]
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

/// Unified sheet header: left title (+ optional subtitle), optional trailing slot, right circular `xmark` close button.
struct MobileSheetHeader<Trailing: View>: View {
    @Environment(\.mobileTheme) private var theme
    let title: String
    var subtitle: String = ""
    var closeID: String = "sheet-close"
    let onClose: () -> Void
    @ViewBuilder let trailing: () -> Trailing

    init(
        title: String,
        subtitle: String = "",
        closeID: String = "sheet-close",
        onClose: @escaping () -> Void,
        @ViewBuilder trailing: @escaping () -> Trailing
    ) {
        self.title = title
        self.subtitle = subtitle
        self.closeID = closeID
        self.onClose = onClose
        self.trailing = trailing
    }

    var body: some View {
        HStack(spacing: MobileDesignTokens.groupGap) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .font(.headline)
                    .foregroundStyle(theme.foreground)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                if !subtitle.isEmpty {
                    Text(verbatim: subtitle)
                        .font(.caption)
                        .foregroundStyle(theme.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            trailing()
            MobileCloseButton(accessibilityID: closeID, action: onClose)
        }
        .padding(.horizontal, MobileDesignTokens.sheetPaddingX)
        .padding(.vertical, 10)
    }
}

extension MobileSheetHeader where Trailing == EmptyView {
    init(
        title: String,
        subtitle: String = "",
        closeID: String = "sheet-close",
        onClose: @escaping () -> Void
    ) {
        self.init(title: title, subtitle: subtitle, closeID: closeID, onClose: onClose) {
            EmptyView()
        }
    }
}
