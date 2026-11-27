import SwiftUI

struct ChatSidebarView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let onClose: () -> Void
    let onNavigate: (HomeDestination) -> Void
    let onNew: () -> Void

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
                VStack(alignment: .leading, spacing: 14) {
                    row("搜索对话", symbol: "magnifyingglass") { onNavigate(.conversationSearch) }
                        .background(mobileTheme.input, in: .rect(cornerRadius: mobileTheme.corner(20)))
                        .accessibilityIdentifier("chat-sidebar-search")

                    sidebarSection("capability_title") {
                        ForEach(CapabilityCategory.allCases) { category in
                            row(LocalizedStringKey(category.titleKey), symbol: category.symbol) {
                                onNavigate(.capabilities(initialCategory: category.id))
                            }
                            .accessibilityIdentifier("chat-sidebar-capability-\(category.id)")
                        }
                    }

                    sidebarSection("sidebar_section_workspace") {
                        row("自动化", symbol: "clock") { onNavigate(.automations) }
                            .accessibilityIdentifier("chat-sidebar-automations")
                        row("分享中心", symbol: "square.and.arrow.up") { onNavigate(.shareCenter) }
                            .accessibilityIdentifier("chat-sidebar-share-center")
                    }

                    sidebarSection("我的") {
                        row("关于我", symbol: "person.crop.circle") { onNavigate(.aboutYou) }
                            .accessibilityIdentifier("chat-sidebar-about-you")
                        row("目标", symbol: "flag") { onNavigate(.personalGoals) }
                            .accessibilityIdentifier("chat-sidebar-personal-goals")
                    }
                }
                .padding(.bottom, 8)
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
                circleButton("设置", icon: Image(systemName: "gearshape")) { onNavigate(.settings) }
                    .accessibilityIdentifier("chat-sidebar-profile")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(mobileTheme.panel.ignoresSafeArea(edges: .vertical))
        .accessibilityAction(.escape, onClose)
    }

    private func sidebarSection(_ title: LocalizedStringKey, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(mobileTheme.secondary)
                .padding(.horizontal, 10)
                .padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 2) {
                content()
            }
        }
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

    private func row(_ title: LocalizedStringKey, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.body.weight(.medium))
                    .foregroundStyle(mobileTheme.secondary)
                    .frame(width: 24, height: 24)
                    .accessibilityHidden(true)
                Text(title)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 46)
            .padding(.horizontal, 10)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

struct ChatSidebarPresentation<Sidebar: View>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isOpen: Bool
    let canOpenBySwipe: Bool
    let onSetOpen: (Bool) -> Void
    @ViewBuilder let sidebar: () -> Sidebar

    func body(content: Content) -> some View {
        content
            .accessibilityHidden(isOpen)
            .overlay {
                GeometryReader { geometry in
                    let width = min(350, geometry.size.width * 0.84)
                    ChatSidebarLayer(width: width, isOpen: isOpen, canOpenBySwipe: canOpenBySwipe,
                                     animation: MobileMotion.animation(MobileMotion.standardDuration, reduceMotion: reduceMotion),
                                     onSetOpen: onSetOpen, sidebar: sidebar())
                }
                .allowsHitTesting(isOpen)
                .accessibilityHidden(!isOpen)
            }
    }
}

private struct ChatSidebarLayer<Sidebar: View>: View {
    let width: CGFloat
    let isOpen: Bool
    let canOpenBySwipe: Bool
    let animation: Animation?
    let onSetOpen: (Bool) -> Void
    let sidebar: Sidebar

    @State private var mounted = false
    @State private var reveal: CGFloat = 0

    var body: some View {
        Color.clear
            .allowsHitTesting(false)
            .background {
                if canOpenBySwipe {
                    HorizontalSwipeCapture(rightOnly: true, reserveBackEdge: true, reserveTrailingEdge: true,
                                           respectsHorizontalScroll: true, onDrag: { drag($0, opening: true) },
                                           onEnd: { finish($0, velocity: $1, opening: true) })
                }
            }
            .overlay {
                Color.black.opacity(0.4 * reveal)
                    .ignoresSafeArea()
                    .onTapGesture { onSetOpen(false) }
                    .allowsHitTesting(isOpen)
                    .accessibilityHidden(true)
            }
            .overlay(alignment: .leading) {
                if mounted {
                    sidebar
                        .frame(width: width)
                        .background {
                            if isOpen {
                                HorizontalSwipeCapture(leftOnly: true,
                                                       onDrag: { drag($0, opening: false) },
                                                       onEnd: { finish($0, velocity: $1, opening: false) })
                            }
                        }
                        .offset(x: (reveal - 1) * width)
                        .allowsHitTesting(isOpen)
                        .accessibilityHidden(!isOpen)
                }
            }
            .onChange(of: isOpen, initial: true) {
                if isOpen {
                    mounted = true
                }
                settle(open: isOpen)
            }
    }

    private func drag(_ distance: CGFloat, opening: Bool) {
        guard width > 0 else { return }
        if opening {
            mounted = true
        }
        let offset = opening ? distance : width + distance
        reveal = min(1, max(0, offset / width))
    }

    private func finish(_ distance: CGFloat, velocity: CGFloat, opening: Bool) {
        let travel = opening ? distance : -distance
        let speed = opening ? velocity : -velocity
        if travel >= min(width * 0.32, 96) || (travel >= 24 && speed >= 550) {
            onSetOpen(opening)
        } else {
            settle(open: isOpen)
        }
    }

    private func settle(open: Bool) {
        withAnimation(animation) { reveal = open ? 1 : 0 }
    }
}
