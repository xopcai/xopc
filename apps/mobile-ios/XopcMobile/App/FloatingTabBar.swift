import SwiftUI

struct FloatingTabBar: View {
    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.displayScale) private var displayScale

    let configuration: GatewayConfiguration
    let selectedTab: MobileTab
    let personalAgent: PersonalAgentRecord?
    let personalUnread: Int
    let personalWorking: Bool
    let pendingAttention: Int
    let hasPendingRecording: Bool
    let onSelect: (MobileTab) -> Void

    @Namespace private var activePillNamespace

    private var isZh: Bool {
        locale.language.languageCode?.identifier == "zh"
    }

    private var adaLabel: String {
        let trimmed = personalAgent?.displayName.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Ada" : trimmed
    }

    private var borderWidth: CGFloat {
        reduceTransparency ? max(1 / max(displayScale, 1), 1) : 0.75
    }

    private var borderColor: Color {
        if reduceTransparency {
            return mobileTheme.secondary.opacity(colorScheme == .dark ? 0.34 : 0.24)
        }
        return colorScheme == .dark ? Color.white.opacity(0.14) : Color.black.opacity(0.08)
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(MobileTab.coreTabs, id: \.self) { tab in
                tabButton(for: tab)
            }
        }
        .padding(4)
        .background { pillBackground }
        .overlay {
            Capsule()
                .strokeBorder(borderColor, lineWidth: borderWidth)
                .allowsHitTesting(false)
        }
        .shadow(
            color: Color.black.opacity(colorScheme == .dark ? 0.32 : 0.10),
            radius: reduceTransparency ? 4 : 14,
            y: reduceTransparency ? 2 : 6
        )
        .frame(maxWidth: 440)
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .animation(MobileMotion.animation(MobileMotion.standardDuration, reduceMotion: reduceMotion), value: selectedTab)
        .sensoryFeedback(.selection, trigger: selectedTab)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("mobile-floating-tab-bar")
    }

    @ViewBuilder
    private var pillBackground: some View {
        if reduceTransparency {
            Capsule().fill(mobileTheme.panel)
        } else {
            ZStack {
                Capsule().fill(.regularMaterial)
                Capsule().fill(mobileTheme.panel.opacity(colorScheme == .dark ? 0.42 : 0.56))
            }
        }
    }

    private func tabButton(for tab: MobileTab) -> some View {
        let isSelected = selectedTab == tab
        let title = label(for: tab)
        let foreground = isSelected
            ? (colorScheme == .dark ? mobileTheme.foreground : mobileTheme.action)
            : mobileTheme.secondary
        let activeFill = colorScheme == .dark
            ? mobileTheme.active.opacity(0.92)
            : mobileTheme.action.opacity(0.13)

        return Button {
            onSelect(tab)
        } label: {
            VStack(spacing: 3) {
                tabIcon(for: tab, selected: isSelected)
                    .frame(width: 24, height: 22)
                    .overlay(alignment: .topTrailing) {
                        tabBadge(for: tab)
                            .offset(x: 9, y: -5)
                    }
                Text(verbatim: title)
                    .font(.caption2.weight(isSelected ? .semibold : .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, 3)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background {
                if isSelected {
                    if reduceMotion {
                        Capsule().fill(activeFill)
                    } else {
                        Capsule()
                            .fill(activeFill)
                            .matchedGeometryEffect(id: "floating-tab-active-pill", in: activePillNamespace)
                    }
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityValue(accessibilityValue(for: tab))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(tab.accessibilityID)
    }

    @ViewBuilder
    private func tabIcon(for tab: MobileTab, selected: Bool) -> some View {
        switch tab {
        case .ada:
            PersonalAgentAvatar(
                configuration: configuration,
                agent: personalAgent,
                size: 22,
                active: selected,
                working: personalWorking
            )
            .accessibilityHidden(true)
        case .conversations:
            Image(systemName: selected ? "bubble.left.and.bubble.right.fill" : "bubble.left.and.bubble.right")
                .font(.callout.weight(selected ? .semibold : .medium))
                .accessibilityHidden(true)
        case .workbench:
            Image(systemName: selected ? "square.grid.2x2.fill" : "square.grid.2x2")
                .font(.callout.weight(selected ? .semibold : .medium))
                .accessibilityHidden(true)
        case .notes:
            Image(systemName: "note.text")
                .font(.callout.weight(selected ? .semibold : .medium))
                .accessibilityHidden(true)
        case .library:
            Image(systemName: selected ? "doc.on.doc.fill" : "doc.on.doc")
                .font(.callout.weight(selected ? .semibold : .medium))
                .accessibilityHidden(true)
        case .pinnedSpace:
            Image(systemName: selected ? "square.stack.fill" : "square.stack")
                .font(.callout.weight(selected ? .semibold : .medium))
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func tabBadge(for tab: MobileTab) -> some View {
        switch tab {
        case .ada:
            if personalUnread > 0 {
                countBadge(personalUnread, fill: mobileTheme.action, foreground: mobileTheme.onAction)
            } else if personalWorking {
                dotBadge(color: mobileTheme.action)
            }
        case .workbench:
            if pendingAttention > 0 {
                countBadge(pendingAttention, fill: mobileTheme.onAttention, foreground: mobileTheme.panel)
            }
        case .notes:
            if hasPendingRecording {
                dotBadge(color: mobileTheme.onAttention)
            }
        case .conversations, .library, .pinnedSpace:
            EmptyView()
        }
    }

    private func countBadge(_ count: Int, fill: Color, foreground: Color) -> some View {
        Text(verbatim: count > 99 ? "99+" : String(count))
            .font(.caption2.weight(.bold))
            .monospacedDigit()
            .foregroundStyle(foreground)
            .padding(.horizontal, count > 9 ? 5 : 4)
            .frame(minWidth: 16, minHeight: 16)
            .background(fill, in: Capsule())
            .accessibilityHidden(true)
    }

    private func dotBadge(color: Color) -> some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            .accessibilityHidden(true)
    }

    private func label(for tab: MobileTab) -> String {
        switch tab {
        case .ada:
            adaLabel
        case .conversations:
            isZh ? "对话" : "Chats"
        case .workbench:
            isZh ? "工作台" : "Work"
        case .notes:
            isZh ? "笔记" : "Notes"
        case .library:
            isZh ? "资料库" : "Library"
        case let .pinnedSpace(spaceID):
            spaceID
        }
    }

    private func accessibilityValue(for tab: MobileTab) -> Text {
        switch tab {
        case .ada:
            if personalUnread > 0 {
                return Text("\(personalUnread) 条未读消息")
            } else if personalWorking {
                return Text("正在回答")
            } else {
                return Text("")
            }
        case .workbench:
            if pendingAttention > 0 {
                return Text("有 \(pendingAttention) 项待你处理")
            }
            return Text("")
        case .notes:
            if hasPendingRecording {
                return Text("待恢复录音")
            }
            return Text("")
        case .conversations, .library, .pinnedSpace:
            return Text("")
        }
    }
}
