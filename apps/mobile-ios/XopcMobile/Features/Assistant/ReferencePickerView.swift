import SwiftUI

struct ReferencePickerView: View {
    let gateway: any GatewayServing
    let selectedReferences: [ContextReference]
    let conversationID: String?
    let onSelect: (ContextReference) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var kind: ContextReferenceKind
    @State private var query = ""
    @State private var items: [ReferenceItem] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

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
            Group {
                if isLoading, items.isEmpty {
                    ProgressView("正在读取引用…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, items.isEmpty {
                    ContentUnavailableView {
                        Label("无法读取引用", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { reload() }
                    }
                } else if items.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    List(items) { item in
                        Button {
                            onSelect(item.reference)
                            dismiss()
                        } label: {
                            ReferenceRow(item: item, isSelected: selectedIDs.contains(item.reference.id))
                        }
                        .buttonStyle(.plain)
                        .disabled(selectedIDs.contains(item.reference.id))
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("添加引用")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "搜索\(kind.title)")
            .safeAreaInset(edge: .top) {
                Picker("引用类型", selection: $kind) {
                    ForEach(availableKinds, id: \.self) { item in
                        Text(item.title).tag(item)
                    }
                }
                .pickerStyle(.segmented)
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
                if !query.isEmpty {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                }
                await load()
            }
        }
    }

    private var selectedIDs: Set<String> {
        Set(selectedReferences.map(\.id))
    }

    private var availableKinds: [ContextReferenceKind] {
        conversationID == nil ? [.note, .task] : ContextReferenceKind.allCases
    }

    private func reload() {
        Task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            items = try await gateway.searchReferences(
                kind: kind,
                query: query,
                conversationID: conversationID
            )
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
            items = []
        }
    }
}

private struct ReferenceRow: View {
    let item: ReferenceItem
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.kind.systemImage)
                .foregroundStyle(.blue)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.primary)
                if !item.description.isEmpty {
                    Text(item.description)
                        .font(.caption)
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

private struct SearchKey: Equatable {
    let kind: ContextReferenceKind
    let query: String
}
