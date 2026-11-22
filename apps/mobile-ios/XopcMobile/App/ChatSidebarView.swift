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
    let isPresented: Bool
    let onClose: () -> Void
    let onNavigate: (HomeDestination) -> Void
    let onPersonal: () -> Void
    let onConversation: (ConversationSummary) -> Void
    let onNew: () -> Void
    let onRetry: () -> Void
    let onLoadMore: () -> Void
    let onRename: (ConversationSummary, String) async throws -> Void
    let onPin: (ConversationSummary) async throws -> Void
    let onDelete: ([String]) async -> Set<String>

    @State private var selection: Set<String>?
    @State private var renameTarget: ConversationSummary?
    @State private var renameText = ""
    @State private var renamePresented = false
    @State private var deleteTargets: [String] = []
    @State private var deletePresented = false
    @State private var busy = false
    @State private var mutationFailed = false

    private var visibleRecents: [ConversationSummary] {
        recent.filter { $0.id != personal?.conversationId && $0.isRecentSidebarCandidate }
            .sorted {
                ($0.status == "pinned") == ($1.status == "pinned")
                    ? $0.updatedAt > $1.updatedAt : $0.status == "pinned"
            }
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                if let selection {
                    Text("已选 \(selection.count) 项").font(.headline).lineLimit(1)
                } else {
                    Image("LaunchLogo").resizable().scaledToFit().frame(width: 30, height: 30)
                        .accessibilityHidden(true)
                    Text(verbatim: "xopc").font(.title2.bold())
                }
                Spacer()
                circleButton(selection == nil ? "关闭导航" : "取消", icon: Image(systemName: "xmark"), action: dismiss)
                    .disabled(busy)
                    .accessibilityIdentifier("chat-sidebar-close")
            }
            .padding(.leading, 10)
            if mutationFailed {
                Text("操作失败").font(.footnote).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("chat-sidebar-action-error")
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    Group {
                        row("搜索对话", symbol: "magnifyingglass") { onNavigate(.conversationSearch) }
                            .background(mobileTheme.input, in: .rect(cornerRadius: mobileTheme.corner(20)))
                            .padding(.bottom, 4)
                            .accessibilityIdentifier("chat-sidebar-search")
                        personalRow
                        row("工作台", symbol: "square.grid.2x2", badge: attention) { onNavigate(.progress) }
                            .accessibilityIdentifier("chat-sidebar-workbench")
                        row("自动化", symbol: "clock") { onNavigate(.automations) }
                            .accessibilityIdentifier("chat-sidebar-automations")
                        row("笔记", symbol: "note.text") { onNavigate(.notes) }
                            .accessibilityIdentifier("chat-sidebar-notes")
                        row("资料库", symbol: "doc") { onNavigate(.library) }
                            .accessibilityIdentifier("chat-sidebar-library")
                        row("capability_title", symbol: "puzzlepiece") { onNavigate(.capabilities) }
                            .accessibilityIdentifier("chat-sidebar-capabilities")
                    }
                    .disabled(selection != nil || busy)
                    ForEach(visibleRecents) { item in
                        conversationRow(item)
                    }
                    pagination
                }
                .padding(.bottom, 6)
            }
            .scrollIndicators(.hidden)
            .accessibilityIdentifier("chat-sidebar-list")
            if let selection {
                Button(role: .destructive) { confirmDelete(Array(selection)) } label: {
                    Label("删除", systemImage: "trash")
                        .frame(maxWidth: .infinity, minHeight: 46)
                }
                .buttonStyle(.bordered)
                .disabled(selection.isEmpty || busy)
                .accessibilityIdentifier("chat-sidebar-batch-delete")
            } else {
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
                .disabled(busy)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(mobileTheme.panel.ignoresSafeArea(edges: .vertical))
        .accessibilityAction(.escape, dismiss)
        .onChange(of: isPresented) {
            if !isPresented, !busy {
                selection = nil
                mutationFailed = false
            }
        }
        .alert("重命名对话", isPresented: $renamePresented) {
            TextField("对话名称", text: $renameText)
                .accessibilityIdentifier("chat-sidebar-rename-input")
            Button("取消", role: .cancel) { renameTarget = nil }
            Button("保存") { saveRename() }
                .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .alert("删除对话？", isPresented: $deletePresented) {
            Button("取消", role: .cancel) { deleteTargets = [] }
            Button("删除", role: .destructive) { delete() }
        } message: {
            if deleteTargets.count == 1 {
                Text("这会永久删除对话及其历史记录。")
            } else {
                Text("这会永久删除所选的 \(deleteTargets.count) 个对话及其历史记录。")
            }
        }
    }
}

extension ChatSidebarView {
    private func conversationRow(_ item: ConversationSummary) -> some View {
        let selected = selection?.contains(item.id) ?? (selectedID == item.id)
        return Button {
            if var selection {
                if !selection.insert(item.id).inserted {
                    selection.remove(item.id)
                }
                self.selection = selection
            } else {
                onConversation(item)
            }
        } label: {
            HStack(spacing: 8) {
                if selection != nil {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? mobileTheme.action : Color.secondary)
                        .accessibilityHidden(true)
                }
                Text(verbatim: item.displayName).lineLimit(1)
                Spacer(minLength: 0)
                if item.status == "pinned" {
                    Image(systemName: "pin").font(.footnote).foregroundStyle(.secondary)
                        .accessibilityLabel("已置顶")
                }
            }
            .frame(minHeight: 44)
            .padding(.horizontal, 10)
            .background(selected ? mobileTheme.card : .clear, in: .rect(cornerRadius: mobileTheme.corner(12)))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("chat-sidebar-session-\(item.id)")
        .contextMenu {
            conversationMenu(item)
        }
    }

    @ViewBuilder
    private func conversationMenu(_ item: ConversationSummary) -> some View {
        if selection == nil, !busy {
            Button("重命名", systemImage: "pencil") {
                renameTarget = item
                renameText = item.displayName
                renamePresented = true
            }
            Button {
                runMutation { try await onPin(item) }
            } label: {
                if item.status == "pinned" {
                    Label("取消置顶", systemImage: "pin.slash")
                } else {
                    Label("置顶", systemImage: "pin")
                }
            }
            Button("多选", systemImage: "list.bullet") {
                selection = [item.id]
                mutationFailed = false
            }
            Button("删除", systemImage: "trash", role: .destructive) { confirmDelete([item.id]) }
        }
    }

    private func dismiss() {
        guard !busy else { return }
        if selection != nil {
            selection = nil
            mutationFailed = false
        } else {
            onClose()
        }
    }

    private func saveRename() {
        guard let item = renameTarget else { return }
        let name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        renameTarget = nil
        runMutation { try await onRename(item, name) }
    }

    private func runMutation(_ operation: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        mutationFailed = false
        Task {
            defer { busy = false }
            do { try await operation() } catch { mutationFailed = !(error is CancellationError) }
        }
    }

    private func confirmDelete(_ ids: [String]) {
        guard !busy, !ids.isEmpty else { return }
        deleteTargets = ids
        deletePresented = true
    }

    private func delete() {
        let ids = deleteTargets
        deleteTargets = []
        runMutation {
            let failures = await onDelete(ids)
            if selection != nil {
                selection = failures.isEmpty ? nil : failures
            }
            mutationFailed = !failures.isEmpty
        }
    }
}

extension ChatSidebarView {
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
                .task(id: isPresented) {
                    if isPresented {
                        onLoadMore()
                    }
                }
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
                                     animation: reduceMotion ? nil : .easeOut(duration: 0.22),
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
