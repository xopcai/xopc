import SwiftUI

struct ConversationContextView: View {
    let summary: ConversationContextSummary?
    let isLoading: Bool
    let errorMessage: String?
    let isDraft: Bool
    let onRetry: () -> Void

    var body: some View {
        List {
            if isDraft {
                ContentUnavailableView(
                    "新对话尚无上下文",
                    systemImage: "scope",
                    description: Text("发送第一条消息后，可在这里查看项目、任务和引用来源。")
                )
            } else if isLoading, summary == nil {
                ProgressView("正在读取上下文…")
                    .frame(maxWidth: .infinity)
            } else if let errorMessage, summary == nil {
                ContentUnavailableView {
                    Label("无法读取上下文", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("重试", action: onRetry)
                }
            } else if let summary {
                workSection(summary)
                environmentSection(summary)
                sourcesSection(summary)
                availabilitySection(summary)
            } else {
                ContentUnavailableView(
                    "上下文尚未就绪",
                    systemImage: "scope",
                    description: Text("关闭后重试，或刷新当前对话。")
                )
            }
        }
        .navigationTitle("当前上下文")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func workSection(_ summary: ConversationContextSummary) -> some View {
        Section("工作范围") {
            ContextRow(
                icon: "folder",
                title: summary.work.project?.title ?? "未关联项目",
                detail: summary.work.project?.id
            )
            if let task = summary.work.task {
                ContextRow(icon: "checkmark.circle", title: task.title, detail: task.phase)
            }
        }
    }

    @ViewBuilder
    private func environmentSection(_ summary: ConversationContextSummary) -> some View {
        if let environment = summary.environment {
            Section("执行环境") {
                ContextRow(
                    icon: environment.kind == "managed_worktree" ? "arrow.triangle.branch" : "desktopcomputer",
                    title: environment.kind == "managed_worktree" ? "Worktree" : "本地目录",
                    detail: environment.rootPath
                )
                if let branch = environment.branch {
                    LabeledContent("分支", value: branch)
                }
                if !environment.available {
                    Label("当前环境不可用", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    private func sourcesSection(_ summary: ConversationContextSummary) -> some View {
        Section("引用来源") {
            if summary.sources.isEmpty {
                Text("尚未添加笔记、任务或文件")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(summary.sources) { source in
                    ContextRow(
                        icon: source.unavailable == true ? "doc.badge.ellipsis" : "doc.text",
                        title: source.title ?? source.id,
                        detail: source.unavailable == true ? "来源不可用" : nil
                    )
                }
                if summary.sourcesHasMore {
                    Text("还有更多来源")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func availabilitySection(_ summary: ConversationContextSummary) -> some View {
        if !summary.unavailableSections.isEmpty {
            Section("部分信息不可用") {
                ForEach(summary.unavailableSections, id: \.self) { section in
                    Text(section)
                }
            }
        }
    }
}

private struct ContextRow: View {
    let icon: String
    let title: String
    let detail: String?

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        } icon: {
            Image(systemName: icon)
                .foregroundStyle(.blue)
        }
    }
}

#Preview {
    NavigationStack {
        ConversationContextView(
            summary: nil,
            isLoading: false,
            errorMessage: nil,
            isDraft: true,
            onRetry: {}
        )
    }
}
