import SwiftUI

struct ChatConnectionNotice: View {
    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.locale) private var locale

    let phase: ChatConnectionPhase
    let stage: Int
    let syncFailed: Bool
    let onRetry: () -> Void

    private var labels: (title: String, detail: String?, action: String?)? {
        if phase == .connected {
            return syncFailed ? ("会话同步中断", nil, "重试同步") : nil
        }
        guard stage > 0 else { return nil }
        if phase == .phoneOffline {
            return ("手机网络已断开", "网络恢复后会自动重连", nil)
        }
        return stage == 2
            ? ("暂时连不上网关", "会继续自动重试", "立即重连")
            : ("正在重连…", nil, nil)
    }

    var body: some View {
        if let labels {
            HStack(spacing: 8) {
                Image(systemName: phase == .phoneOffline ? "wifi.slash" : "arrow.clockwise")
                    .font(.subheadline)
                    .foregroundStyle(mobileTheme.secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(AppLocalization.string(labels.title, locale: locale))
                        .font(.subheadline.weight(.medium))
                    if let detail = labels.detail {
                        Text(AppLocalization.string(detail, locale: locale))
                            .font(.caption)
                            .foregroundStyle(mobileTheme.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 8)
                .accessibilityElement(children: .combine)
                if let action = labels.action {
                    Button(action: onRetry) {
                        Text(AppLocalization.string(action, locale: locale))
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 8)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(mobileTheme.action)
                    .accessibilityIdentifier("chat-network-retry")
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 4)
            .frame(minHeight: 44)
            .background(mobileTheme.card, in: .rect(cornerRadius: mobileTheme.corner(14)))
            .padding(.bottom, 4)
            .accessibilityIdentifier("chat-network-notice")
        }
    }
}
