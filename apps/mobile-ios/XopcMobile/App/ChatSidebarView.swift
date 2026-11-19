import SwiftUI

struct ChatSidebarView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let personal: PersonalAgentRecord?
    let openingPersonal: Bool
    let selectedID: String?
    let recent: [ConversationSummary]
    let recentNextOffset: Int?
    let recentLoading: Bool
    let recentError: Bool
    let attention: Int
    let onClose: () -> Void
    let onNavigate: (HomeDestination) -> Void
    let onPersonal: () -> Void
    let onConversation: (ConversationSummary) -> Void
    let onNew: () -> Void
    let onRetry: () -> Void
    let onLoadMore: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image("LaunchLogo").resizable().scaledToFit().frame(width: 30, height: 30)
                    .accessibilityHidden(true)
                Text(verbatim: "xopc").font(.title2.bold())
                Spacer()
                circleButton("关闭导航", icon: Image(systemName: "xmark"), action: onClose)
                    .accessibilityIdentifier("chat-sidebar-close")
            }
            .padding(.leading, 10)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    row("搜索对话", symbol: "magnifyingglass") { onNavigate(.conversationSearch) }
                        .background(mobileTheme.input, in: .rect(cornerRadius: mobileTheme.corner(20)))
                        .padding(.bottom, 4)
                        .accessibilityIdentifier("chat-sidebar-search")
                    personalRow
                    row("工作台", symbol: "square.grid.2x2", badge: attention) { onNavigate(.progress) }
                        .accessibilityIdentifier("chat-sidebar-workbench")
                    row("自动化", symbol: "clock") { onNavigate(.automations) }
                        .accessibilityIdentifier("chat-sidebar-automations")
                    row("资料库", symbol: "doc") { onNavigate(.library) }
                        .accessibilityIdentifier("chat-sidebar-library")
                    row("capability_title", symbol: "puzzlepiece") { onNavigate(.capabilities) }
                        .accessibilityIdentifier("chat-sidebar-capabilities")
                    let recentRows = recent.filter { $0.id != personal?.conversationId && $0.isRecentSidebarCandidate }
                    ForEach(recentRows) { item in
                        Button { onConversation(item) } label: {
                            Text(verbatim: item.displayName)
                                .lineLimit(1).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .padding(.horizontal, 10)
                                .background(selectedID == item.id ? mobileTheme.card : .clear,
                                            in: .rect(cornerRadius: mobileTheme.corner(12)))
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selectedID == item.id ? .isSelected : [])
                        .accessibilityIdentifier("chat-sidebar-session-\(item.id)")
                    }
                    pagination
                }
                .padding(.bottom, 6)
            }
            .scrollIndicators(.hidden)
            .accessibilityIdentifier("chat-sidebar-list")
            HStack {
                Button(action: onNew) {
                    Label("新建对话", systemImage: "square.and.pencil")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 46)
                        .padding(.horizontal, 18)
                        .foregroundStyle(mobileTheme.onAction)
                        .background(mobileTheme.action, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("chat-sidebar-new")
                Spacer()
                circleButton("设置", icon: Image("SettingsSliders")) { onNavigate(.settings) }
                    .accessibilityIdentifier("chat-sidebar-profile")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(mobileTheme.panel.ignoresSafeArea(edges: .vertical))
        .accessibilityAction(.escape, onClose)
    }

    @ViewBuilder
    private var pagination: some View {
        if recentLoading {
            ProgressView().padding(10)
        } else if recentError {
            HStack {
                Text("无法读取对话").font(.footnote).foregroundStyle(.secondary)
                Spacer()
                Button("重试", action: recentNextOffset == nil ? onRetry : onLoadMore).frame(minHeight: 44)
            }.padding(.horizontal, 10)
        } else if let recentNextOffset {
            Color.clear.frame(height: 32)
                .accessibilityHidden(true)
                .id(recentNextOffset)
                .onAppear(perform: onLoadMore)
        }
    }

    private var personalRow: some View {
        let title = if let personal, !personal.displayName.isEmpty {
            Text(verbatim: personal.displayName)
        } else {
            Text("个人助理")
        }
        return row(title, loading: openingPersonal, action: onPersonal) {
            PersonalAgentAvatar(configuration: configuration, agent: personal, size: 24, active: false)
                .accessibilityHidden(true)
        }
        .background(personal?.conversationId == selectedID && personal != nil ? mobileTheme.card : .clear,
                    in: .rect(cornerRadius: mobileTheme.corner(12)))
        .disabled(openingPersonal)
        .accessibilityIdentifier("chat-sidebar-personal")
    }

    private func circleButton(_ title: LocalizedStringKey, icon: Image, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            icon.font(.title3)
                .frame(width: 46, height: 46)
                .background(mobileTheme.card, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private func row(_ title: LocalizedStringKey, symbol: String, badge: Int = 0,
                     action: @escaping () -> Void) -> some View
    {
        row(Text(title), badge: badge, action: action) {
            Image(systemName: symbol).font(.title3).foregroundStyle(.secondary).frame(width: 24)
        }
    }

    private func row(_ title: Text, badge: Int = 0, loading: Bool = false,
                     action: @escaping () -> Void, @ViewBuilder icon: () -> some View) -> some View
    {
        Button(action: action) {
            HStack(spacing: 12) {
                icon()
                title.lineLimit(1)
                Spacer()
                if loading {
                    ProgressView()
                } else if badge > 0 {
                    Text(badge > 99 ? "99+" : String(badge))
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .foregroundStyle(mobileTheme.onAttention)
                        .background(mobileTheme.attention, in: Capsule())
                }
            }
            .frame(minHeight: 46)
            .padding(.horizontal, 10)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}
