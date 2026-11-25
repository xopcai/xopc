import SwiftUI

enum MobileBannerTone: Sendable {
    case info
    case warning
    case danger
    case success
}

/// Unified inline feedback banner for errors, warnings, partial loads, and tips.
struct MobileInlineBanner: View {
    @Environment(\.mobileTheme) private var theme
    let message: String
    var tone: MobileBannerTone = .info
    var actionLabel: String?
    var onAction: (() -> Void)?

    private var containerColor: Color {
        switch tone {
        case .info: theme.grouped
        case .warning: theme.warningFill
        case .danger: theme.dangerSoft
        case .success: theme.successSoft
        }
    }

    private var foregroundColor: Color {
        switch tone {
        case .info: theme.secondary
        case .warning: theme.warningForeground
        case .danger: theme.danger
        case .success: theme.success
        }
    }

    var body: some View {
        HStack(spacing: MobileDesignTokens.itemGap) {
            Text(message)
                .font(.footnote)
                .foregroundStyle(foregroundColor)
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let actionLabel, let onAction {
                Button(actionLabel, action: onAction)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(tone == .danger ? theme.danger : theme.action)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(containerColor, in: .rect(cornerRadius: theme.corner(MobileDesignTokens.radiusSm)))
    }
}

/// Unified floating undo bar for soft-delete and trash actions.
struct MobileUndoBar: View {
    @Environment(\.mobileTheme) private var theme
    let message: String
    let undoLabel: String
    var disabled = false
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: MobileDesignTokens.itemGap) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(theme.foreground)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(undoLabel, action: onUndo)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(theme.action)
                .disabled(disabled)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(theme.active, in: .rect(cornerRadius: theme.corner(MobileDesignTokens.radiusMd)))
    }
}

/// Unified calm error panel with retry action.
struct MobileErrorView: View {
    @Environment(\.mobileTheme) private var theme
    let message: String
    let retryLabel: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: MobileDesignTokens.groupGap) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(theme.secondary)
                .multilineTextAlignment(.center)
            Button(retryLabel, action: onRetry)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(theme.action)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
    }
}

/// Unified calm empty state for list views.
struct MobileEmptyState: View {
    @Environment(\.mobileTheme) private var theme
    let message: String
    var systemImage: String?
    var actionLabel: String?
    var onAction: (() -> Void)?

    var body: some View {
        VStack(spacing: MobileDesignTokens.itemGap) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.title3)
                    .foregroundStyle(theme.secondary)
            }
            Text(message)
                .font(.subheadline)
                .foregroundStyle(theme.secondary)
                .multilineTextAlignment(.center)
            if let actionLabel, let onAction {
                Button(actionLabel, action: onAction)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(theme.action)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 32)
    }
}

/// Unified pulsing list skeleton honoring `accessibilityReduceMotion`.
struct MobileListSkeleton: View {
    @Environment(\.mobileTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var rows: Int = 3
    @State private var pulsing = false

    var body: some View {
        VStack(spacing: 18) {
            ForEach(0 ..< rows, id: \.self) { _ in
                HStack(spacing: MobileDesignTokens.groupGap) {
                    RoundedRectangle(cornerRadius: theme.corner(6))
                        .fill(theme.input)
                        .frame(width: 28, height: 28)
                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: theme.corner(4))
                            .fill(theme.input)
                            .frame(height: 16)
                            .frame(maxWidth: 220, alignment: .leading)
                        RoundedRectangle(cornerRadius: theme.corner(4))
                            .fill(theme.input)
                            .frame(height: 12)
                            .frame(maxWidth: 150, alignment: .leading)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.vertical, 12)
        .opacity(reduceMotion ? 0.72 : (pulsing ? 0.90 : 0.45))
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: MobileMotion.skeletonDuration).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("加载中")
    }
}

enum MobileButtonVariant: Sendable {
    case primary, secondary, tonal, danger, ghost
}

enum MobileButtonSize: Sendable {
    case sm, md, lg

    var minHeight: CGFloat {
        switch self {
        case .sm: MobileDesignTokens.buttonHeightSm
        case .md: MobileDesignTokens.buttonHeightMd
        case .lg: MobileDesignTokens.buttonHeightLg
        }
    }
}

/// Unified button hierarchy aligned with three-platform Calm Intelligence spec.
struct MobileButton: View {
    @Environment(\.mobileTheme) private var theme
    let title: String
    var variant: MobileButtonVariant = .primary
    var size: MobileButtonSize = .md
    var fullWidth = false
    var disabled = false
    let action: () -> Void

    private var background: Color {
        switch variant {
        case .primary: theme.action
        case .secondary: theme.input
        case .tonal: theme.active
        case .danger: theme.dangerSoft
        case .ghost: .clear
        }
    }

    private var foreground: Color {
        switch variant {
        case .primary: theme.onAction
        case .secondary: theme.foreground
        case .tonal: theme.action
        case .danger: theme.danger
        case .ghost: theme.action
        }
    }

    var body: some View {
        let radius = theme.corner(MobileDesignTokens.radiusSm)
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(variant == .primary ? .semibold : .medium))
                .foregroundStyle(foreground)
                .padding(.horizontal, 16)
                .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: size.minHeight)
        }
        .buttonStyle(MobilePressStyle(radius: radius, restingBackground: background))
        .opacity(disabled ? MobileDesignTokens.disabledOpacity : 1)
        .disabled(disabled)
    }
}

/// Unified borderless layered card surface.
struct MobileCard<Content: View>: View {
    @Environment(\.mobileTheme) private var theme
    var background: Color?
    var padding: CGFloat = MobileDesignTokens.cardPadding
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background ?? theme.grouped, in: .rect(cornerRadius: theme.corner(MobileDesignTokens.radiusMd)))
    }
}

/// Unified semantic status pill badge.
struct MobileBadge: View {
    @Environment(\.mobileTheme) private var theme
    let label: String
    var tone: MobileBannerTone = .info

    private var colors: (bg: Color, fg: Color) {
        switch tone {
        case .info: (theme.active, theme.action)
        case .warning: (theme.warningFill, theme.warningForeground)
        case .danger: (theme.dangerSoft, theme.danger)
        case .success: (theme.successSoft, theme.success)
        }
    }

    var body: some View {
        Text(label)
            .font(.caption2.weight(.medium))
            .foregroundStyle(colors.fg)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(colors.bg, in: .capsule)
    }
}
