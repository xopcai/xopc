import SwiftUI

struct ReferencePickerView: View {
    let gateway: any GatewayServing
    let selectedReferences: [ContextReference]
    let conversationID: String?
    let onSelect: (ContextReference) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var kind: ContextReferenceKind
    @State private var pagerProgress = PageScrollProgress()
    @State private var query = ""
    @State private var results: [SearchKey: ReferenceResults] = [:]

    private enum ReferenceResults {
        case loaded([ReferenceItem])
        case failed
    }

    init(
        gateway: any GatewayServing,
        selectedReferences: [ContextReference],
        initialKind: ContextReferenceKind,
        conversationID: String?,
        onSelect: @escaping (ContextReference) -> Void
    ) {
        self.gateway = gateway
        self.selectedReferences = selectedReferences
        self.conversationID = conversationID
        self.onSelect = onSelect
        _kind = State(initialValue: initialKind)
    }

    var body: some View {
        NavigationStack {
            MobilePagePager(pages: availableKinds, selection: $kind, progress: pagerProgress) { page in
                referenceList(page)
            }
            .navigationTitle("添加引用")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: searchPrompt)
            .safeAreaInset(edge: .top) {
                SegmentedTabs(options: availableKinds.map { item in
                    SegmentOption(id: item, title: item.title, accessibilityID: "reference-tab-\(item.rawValue)")
                }, selected: kind, label: "引用类型", swipeToSelect: true, pagerProgress: pagerProgress) { next in
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.23)) { kind = next }
                }
                    .accessibilityIdentifier("reference-tabs")
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .background(.bar)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
            .task(id: SearchKey(kind: kind, query: query)) {
                let key = SearchKey(kind: kind, query: query)
                results = results.filter { $0.key.query == key.query }
                if !key.query.isEmpty {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                }
                await load(key)
            }
        }
    }

    private var selectedIDs: Set<String> {
        Set(selectedReferences.map(\.id))
    }

    private var searchPrompt: Text {
        let format = AppLocalization.string("搜索%@", locale: locale)
        let kindTitle = AppLocalization.resolve(kind.title, locale: locale)
        return Text(verbatim: String(format: format, locale: locale, kindTitle))
    }

    private var availableKinds: [ContextReferenceKind] {
        conversationID == nil ? [.note, .task] : ContextReferenceKind.allCases
    }

    @ViewBuilder private func referenceList(_ page: ContextReferenceKind) -> some View {
        let key = SearchKey(kind: page, query: query)
        switch results[key] {
        case nil:
            ProgressView("正在读取引用…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed:
            ContentUnavailableView {
                Label("无法读取引用", systemImage: "exclamationmark.triangle")
            } actions: {
                Button("重试") { Task { await load(key) } }
            }
        case let .loaded(items) where items.isEmpty:
            ContentUnavailableView.search(text: query)
        case let .loaded(items):
            List(items) { item in
                Button {
                    onSelect(item.reference)
                    dismiss()
                } label: {
                    ReferenceRow(item: item, isSelected: selectedIDs.contains(item.reference.id))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("reference-item-\(item.kind.rawValue)-\(item.id)")
                .disabled(selectedIDs.contains(item.reference.id))
            }
            .listStyle(.plain)
        }
    }

    private func load(_ key: SearchKey) async {
        do {
            let items = try await gateway.searchReferences(kind: key.kind, query: key.query, conversationID: conversationID)
            guard !Task.isCancelled, key.query == query else { return }
            results[key] = .loaded(items)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, key.query == query else { return }
            results[key] = .failed
        }
    }
}

private struct ReferenceRow: View {
    let item: ReferenceItem
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.kind.systemImage)
                .foregroundStyle(.tint)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .mobileTextStyle(.rowTitle)
                    .foregroundStyle(.primary)
                if !item.description.isEmpty {
                    Text(item.description)
                        .mobileTextStyle(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            if isSelected {
                Image(systemName: "checkmark")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("已添加")
            }
        }
        .contentShape(.rect)
        .padding(.vertical, 4)
    }
}

private struct SearchKey: Hashable {
    let kind: ContextReferenceKind
    let query: String
}
