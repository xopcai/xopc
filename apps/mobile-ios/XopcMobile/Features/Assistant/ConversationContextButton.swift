import SwiftUI

struct ConversationContextButton: View {
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection?
    let state: AssistantState

    @Environment(\.locale) private var locale

    @State private var isPresented = false

    var body: some View {
        Button {
            isPresented = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "scope")
                    .foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 3) {
                    Text("当前上下文")
                        .font(.headline)
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: .rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityHint("查看对话的项目、任务、环境和来源")
        .sheet(isPresented: $isPresented) {
            sheet
        }
    }

    private var sheet: some View {
        NavigationStack {
            ConversationContextView(
                summary: state.contextSummary,
                isLoading: state.isLoadingContext,
                errorMessage: state.contextError,
                isDraft: conversation?.isDraft ?? true,
                onRetry: retry
            )
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { isPresented = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var description: String {
        if let summary = state.contextSummary {
            let scope = summary.work.task?.title ?? summary.work.project?.title
                ?? AppLocalization.string("未关联项目", locale: locale)
            let sourceCount = summary.sources.count + (summary.sourcesHasMore ? 1 : 0)
            return sourceCount == 0 ? scope : AppLocalization.resolve("\(scope) · \(sourceCount) 个来源", locale: locale)
        }
        if let conversation, !conversation.isDraft {
            return AppLocalization.resolve("对话 \(conversation.id.prefix(8)) · 助手 \(conversation.agentId)", locale: locale)
        }
        return AppLocalization.string("尚未关联项目、任务或文件", locale: locale)
    }

    private func retry() {
        guard let conversation else { return }
        Task {
            await state.loadContext(
                for: conversation,
                using: GatewayClient(configuration: configuration)
            )
        }
    }
}
