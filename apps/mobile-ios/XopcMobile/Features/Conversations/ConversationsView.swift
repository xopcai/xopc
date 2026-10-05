import SwiftUI

struct ConversationsView: View {
    let configuration: GatewayConfiguration
    let onSelect: (ConversationSummary) -> Void
    let onStartNew: () -> Void
    let onOpenSettings: () -> Void

    @Environment(\.locale) private var locale

    @State private var state = ConversationsState()
    @State private var renameTarget: ConversationSummary?
    @State private var renameText = ""
    @State private var deleteTarget: ConversationSummary?

    var body: some View {
        VStack(spacing: 0) {
            conversationSearchField
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 12)

            Group {
                if state.isLoading, state.conversations.isEmpty {
                    ProgressView("正在读取对话…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage = state.errorMessage, state.conversations.isEmpty {
                    ContentUnavailableView {
                        Label("无法读取对话", systemImage: "network.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("连接设置", action: onOpenSettings)
                        Button("重试") { reload() }
                    }
                } else if state.visibleConversations.isEmpty {
                    ContentUnavailableView.search(text: state.searchText)
                } else {
                    List {
                        ForEach(ConversationDateSection.group(state.visibleConversations, locale: locale)) { section in
                            Section {
                                ForEach(section.conversations) { conversation in
                                    conversationButton(for: conversation)
                                }
                            } header: {
                                Text(section.title)
                            }
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Color(uiColor: .systemGroupedBackground))
                    .refreshable {
                        await state.load(using: GatewayClient(configuration: configuration))
                    }
                }
            }
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("对话")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("新建对话", systemImage: "plus", action: onStartNew)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: onOpenSettings) {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("连接设置")
            }
        }
        .task(id: configuration) {
            await state.load(using: GatewayClient(configuration: configuration))
        }
        .alert("重命名对话", isPresented: renamePresented) {
            TextField("对话名称", text: $renameText)
            Button("取消", role: .cancel) { renameTarget = nil }
            Button("保存") { rename() }
                .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .alert("删除对话？", isPresented: deletePresented) {
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button("删除", role: .destructive) { deleteConversation() }
        } message: {
            Text("这会永久删除对话及其历史记录。")
        }
    }

    private var conversationSearchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField("搜索对话", text: $state.searchText)
                .textFieldStyle(.plain)
                .submitLabel(.search)
                .accessibilityIdentifier("conversations-search-field")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
    }

    private func conversationButton(for conversation: ConversationSummary) -> some View {
        Button {
            onSelect(conversation)
        } label: {
            ConversationRow(conversation: conversation)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 4, trailing: 20))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .disabled(state.operatingConversationID != nil)
        .swipeActions(edge: .trailing) {
            Button("删除", role: .destructive) { deleteTarget = conversation }
            Button("归档") { archive(conversation) }.tint(.orange)
        }
        .contextMenu {
            Button("重命名", systemImage: "pencil") {
                renameText = conversation.displayName
                renameTarget = conversation
            }
            Button { togglePin(conversation) } label: {
                Label {
                    Text(conversation.status == "pinned"
                        ? LocalizedStringResource("取消置顶")
                        : LocalizedStringResource("置顶"))
                } icon: {
                    Image(systemName: conversation.status == "pinned" ? "pin.slash" : "pin")
                }
            }
            Button("归档", systemImage: "archivebox") { archive(conversation) }
        }
    }

    private func reload() {
        Task {
            await state.load(using: GatewayClient(configuration: configuration))
        }
    }

    private var renamePresented: Binding<Bool> {
        Binding(
            get: { renameTarget != nil },
            set: {
                if !$0 {
                    renameTarget = nil
                }
            }
        )
    }

    private var deletePresented: Binding<Bool> {
        Binding(
            get: { deleteTarget != nil },
            set: {
                if !$0 {
                    deleteTarget = nil
                }
            }
        )
    }

    private func rename() {
        guard let target = renameTarget else { return }
        renameTarget = nil
        Task {
            await state.rename(target, to: renameText, using: GatewayClient(configuration: configuration))
        }
    }

    private func archive(_ conversation: ConversationSummary) {
        Task {
            await state.archive(conversation, using: GatewayClient(configuration: configuration))
        }
    }

    private func togglePin(_ conversation: ConversationSummary) {
        Task {
            await state.togglePin(conversation, using: GatewayClient(configuration: configuration))
        }
    }

    private func deleteConversation() {
        guard let target = deleteTarget else { return }
        deleteTarget = nil
        Task {
            await state.delete(target, using: GatewayClient(configuration: configuration))
        }
    }
}

struct ConversationDateSection: Identifiable {
    let id: Date
    let title: String
    let conversations: [ConversationSummary]

    static func group(
        _ conversations: [ConversationSummary],
        now: Date = .now,
        calendar: Calendar = .current,
        locale: Locale = .current,
        bundle: Bundle = .main
    ) -> [ConversationDateSection] {
        let standard = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let unknownDate = Date.distantPast
        var groups: [Date: [ConversationSummary]] = [:]
        for conversation in conversations {
            let date = fractional.date(from: conversation.updatedAt)
                ?? standard.date(from: conversation.updatedAt)
                ?? unknownDate
            groups[calendar.startOfDay(for: date), default: []].append(conversation)
        }
        return groups.keys.sorted(by: >).map { day in
            let title: String
            let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now))
            if day == calendar.startOfDay(for: now) {
                title = AppLocalization.string("今天", locale: locale, bundle: bundle)
            } else if day == yesterday {
                title = AppLocalization.string("昨天", locale: locale, bundle: bundle)
            } else if day == calendar.startOfDay(for: unknownDate) {
                title = AppLocalization.string("日期未知", locale: locale, bundle: bundle)
            } else {
                title = day.formatted(.dateTime.year().month().day().locale(locale))
            }
            return ConversationDateSection(id: day, title: title, conversations: groups[day] ?? [])
        }
    }
}

private struct ConversationRow: View {
    let conversation: ConversationSummary

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: conversation.status == "pinned" ? "pin.fill" : "bubble.left")
                .foregroundStyle(conversation.status == "pinned" ? .blue : .secondary)
                .frame(width: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(conversation.displayName)
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(conversation.agentId) · \(conversation.messageCount) 条消息 · \(String(conversation.updatedAt.prefix(10)))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 6)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("打开对话")
    }
}

#Preview {
    NavigationStack {
        ConversationsView(configuration: .local, onSelect: { _ in }, onStartNew: {}, onOpenSettings: {})
    }
}
