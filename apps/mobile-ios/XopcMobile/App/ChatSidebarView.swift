import SwiftUI

struct ChatSidebarView: View {
    let configuration: GatewayConfiguration
    let personal: PersonalAgentRecord?
    let openingPersonal: Bool
    let selectedID: String?
    let recent: [ConversationSummary]
    let recentLoading: Bool
    let recentError: Bool
    let attention: Int
    let onClose: () -> Void
    let onNavigate: (HomeDestination) -> Void
    let onPersonal: () -> Void
    let onConversation: (ConversationSummary) -> Void
    let onNew: () -> Void
    let onRetry: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image("LaunchLogo").resizable().scaledToFit().frame(width: 30, height: 30)
                    .accessibilityHidden(true)
                Text(verbatim: "xopc").font(.title2.bold())
                Spacer()
                circleButton("关闭导航", symbol: "xmark", action: onClose)
                    .accessibilityIdentifier("chat-sidebar-close")
            }
            .padding(.leading, 10)
            row("搜索对话", symbol: "magnifyingglass") { onNavigate(.conversations) }
                .background(ChatAppearance.card(colorScheme), in: Capsule())
                .accessibilityIdentifier("chat-sidebar-search")
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    personalRow
                    row("进展", symbol: "checkmark.circle", badge: attention) { onNavigate(.progress) }
                        .accessibilityIdentifier("chat-sidebar-progress")
                    row("项目", symbol: "folder") { onNavigate(.projects) }
                        .accessibilityIdentifier("chat-sidebar-projects")
                    row("自动化", symbol: "clock") { onNavigate(.automations) }
                        .accessibilityIdentifier("chat-sidebar-automations")
                    row("资料", symbol: "doc") { onNavigate(.library) }
                        .accessibilityIdentifier("chat-sidebar-library")
                    Text("最近对话").font(.footnote).foregroundStyle(.secondary)
                        .padding(.leading, 10).padding(.top, 14)
                    ForEach(recent.filter { $0.id != personal?.conversationId && $0.status != "archived" && $0.messageCount > 0 }.prefix(6)) { item in
                        Button { onConversation(item) } label: {
                            Text(verbatim: item.displayName)
                                .lineLimit(1).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .padding(.horizontal, 10)
                                .background(selectedID == item.id ? ChatAppearance.card(colorScheme) : .clear,
                                            in: .rect(cornerRadius: 12))
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selectedID == item.id ? .isSelected : [])
                        .accessibilityIdentifier("chat-sidebar-session-\(item.id)")
                    }
                    if recentLoading {
                        ProgressView().padding(10)
                    } else if recentError {
                        HStack {
                            Text("无法读取对话").font(.footnote).foregroundStyle(.secondary)
                            Spacer()
                            Button("重试", action: onRetry).frame(minHeight: 44)
                        }.padding(.horizontal, 10)
                    }
                    row("历史记录", symbol: "list.bullet") { onNavigate(.conversations) }
                        .accessibilityIdentifier("chat-sidebar-history")
                }
                .padding(.vertical, 6)
            }
            .scrollIndicators(.hidden)
            HStack {
                Button(action: onNew) {
                    Label("新建对话", systemImage: "square.and.pencil")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 46)
                        .padding(.horizontal, 18)
                        .foregroundStyle(colorScheme == .dark ? Color.black : .white)
                        .background(ChatAppearance.action(colorScheme), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("chat-sidebar-new")
                Spacer()
                circleButton("设置", symbol: "person") { onNavigate(.settings) }
                    .accessibilityIdentifier("chat-sidebar-profile")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color("LaunchBackground").ignoresSafeArea(edges: .vertical))
        .accessibilityAction(.escape, onClose)
    }

    private var personalRow: some View {
        Button(action: onPersonal) {
            HStack(spacing: 12) {
                PersonalAgentAvatar(configuration: configuration, agent: personal, size: 42, active: false)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    if let personal, personal.isReady {
                        Text(verbatim: personal.displayName).font(.headline).lineLimit(1)
                        Text("个人助理").font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text("个人助理").font(.headline)
                    }
                }
                Spacer()
                if openingPersonal {
                    ProgressView()
                } else {
                    Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 62)
            .background(personal?.conversationId == selectedID && personal != nil ? ChatAppearance.card(colorScheme) : .clear,
                        in: .rect(cornerRadius: 14))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(openingPersonal)
        .accessibilityIdentifier("chat-sidebar-personal")
    }

    private func circleButton(_ title: LocalizedStringKey, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.title3)
                .frame(width: 46, height: 46)
                .background(ChatAppearance.card(colorScheme), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private func row(_ title: LocalizedStringKey, symbol: String, badge: Int = 0,
                     action: @escaping () -> Void) -> some View
    {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.title3).foregroundStyle(.secondary).frame(width: 24)
                Text(title)
                Spacer()
                if badge > 0 {
                    Text(badge > 99 ? "99+" : String(badge))
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .foregroundStyle(ChatAppearance.action(colorScheme))
                        .background(ChatAppearance.action(colorScheme).opacity(0.15), in: Capsule())
                }
            }
            .frame(minHeight: 46)
            .padding(.horizontal, 10)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

extension ChatAppearance {
    static func canvas(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 21 / 255, green: 24 / 255, blue: 29 / 255)
            : Color(uiColor: .systemGroupedBackground)
    }
}
