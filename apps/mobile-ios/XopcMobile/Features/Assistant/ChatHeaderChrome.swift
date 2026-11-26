import SwiftUI

struct ChatContextStripModel: Equatable, Sendable {
    let icon: String
    let projectTitle: String?
    let taskText: String?
    let environmentTag: String?
    let needsAttention: Bool
    let isTaskActive: Bool

    var accessibilitySummary: String {
        [projectTitle, taskText, environmentTag]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}

struct ChatContextStripInput: Sendable {
    let projectTitle: String?
    let taskTitle: String?
    let taskPhase: String?
    let delegatedTaskCount: Int
    let delegatedTasks: [ContextDelegatedTask]?
    let environmentKind: String?
    let branch: String?
    let locale: Locale
}

enum ChatHeaderPresentation {
    private static let attentionStates: Set<String> = [
        "review", "failed", "blocked", "needsuser", "needs_user", "waiting_for_user"
    ]
    private static let activeStates: Set<String> = [
        "running", "active", "in_progress", "verifying", "queued", "allocating"
    ]
    private static let phaseLabels: [String: (zh: String, en: String)] = [
        "review": ("待验收", "Review"),
        "failed": ("失败", "Failed"),
        "blocked": ("受阻", "Blocked"),
        "needsuser": ("待处理", "Needs you"),
        "needs_user": ("待处理", "Needs you"),
        "waiting_for_user": ("待处理", "Needs you"),
        "running": ("进行中", "Active"),
        "active": ("进行中", "Active"),
        "in_progress": ("进行中", "Active"),
        "verifying": ("验证中", "Verifying"),
        "queued": ("排队中", "Queued"),
        "ready": ("待开始", "Ready"),
        "backlog": ("待规划", "Backlog"),
        "captured": ("待规划", "Backlog"),
        "waiting": ("等待中", "Waiting"),
        "paused": ("已暂停", "Paused"),
        "completed": ("已完成", "Done"),
        "done": ("已完成", "Done"),
        "closed": ("已结束", "Closed"),
        "ended": ("已结束", "Closed"),
        "cancelled": ("已取消", "Cancelled")
    ]
    private static let thinkingLabels: [String: (zh: String, en: String)] = [
        "minimal": ("极低", "Min"),
        "low": ("低", "Low"),
        "medium": ("中", "Med"),
        "high": ("高", "High"),
        "xhigh": ("极高", "XHigh"),
        "max": ("最高", "Max")
    ]

    static func shortThinkingLabel(_ level: String, isZh: Bool) -> String? {
        let normalized = level.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty, normalized != "off", normalized != "none" else { return nil }
        if let entry = thinkingLabels[normalized] {
            return isZh ? entry.zh : entry.en
        }
        return level.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func modelSubtitle(
        modelName: String?,
        thinkingMode: String?,
        thinkingLevel: String,
        isFastEnabled: Bool,
        locale: Locale
    ) -> String? {
        let trimmed = modelName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return nil }
        let isZh = locale.language.languageCode?.identifier == "zh"
        var parts = [trimmed]
        if thinkingMode == nil || thinkingMode == "levels" || thinkingMode == "toggle",
           let effort = shortThinkingLabel(thinkingLevel, isZh: isZh)
        {
            parts.append(effort)
        }
        var result = parts.joined(separator: " · ")
        if isFastEnabled {
            result += " ⚡"
        }
        return result
    }

    static func localizedTaskPhase(_ phase: String?, isZh: Bool) -> String? {
        guard let raw = phase?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
              let entry = phaseLabels[raw.lowercased()]
        else { return nil }
        return isZh ? entry.zh : entry.en
    }

    static func contextStrip(_ input: ChatContextStripInput) -> ChatContextStripModel? {
        let project = input.projectTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedProject = project?.isEmpty == false ? project : nil
        let task = input.taskTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedTask = task?.isEmpty == false ? task : nil
        let effectiveDelegatedCount = max(input.delegatedTaskCount, input.delegatedTasks?.count ?? 0)
        guard normalizedProject != nil || normalizedTask != nil || effectiveDelegatedCount > 0 else {
            return nil
        }

        let isZh = input.locale.language.languageCode?.identifier == "zh"
        let taskSummary = resolveTaskSummary(
            taskTitle: normalizedTask,
            taskPhase: input.taskPhase,
            delegatedCount: effectiveDelegatedCount,
            delegatedTasks: input.delegatedTasks ?? [],
            isZh: isZh
        )
        let environmentTag = taskSummary.text == nil && normalizedProject != nil
            ? formatEnvironmentTag(kind: input.environmentKind, branch: input.branch)
            : nil

        return ChatContextStripModel(
            icon: normalizedProject != nil ? "folder" : "checkmark.circle",
            projectTitle: normalizedProject,
            taskText: taskSummary.text,
            environmentTag: environmentTag,
            needsAttention: taskSummary.needsAttention,
            isTaskActive: taskSummary.isActive
        )
    }

    private struct TaskSummary {
        let text: String?
        let needsAttention: Bool
        let isActive: Bool
    }

    private static func resolveTaskSummary(
        taskTitle: String?,
        taskPhase: String?,
        delegatedCount: Int,
        delegatedTasks: [ContextDelegatedTask],
        isZh: Bool
    ) -> TaskSummary {
        if let taskTitle {
            let phaseText = localizedTaskPhase(taskPhase, isZh: isZh)
            let lower = taskPhase?.lowercased() ?? ""
            return TaskSummary(
                text: phaseText.map { "\(taskTitle) · \($0)" } ?? taskTitle,
                needsAttention: attentionStates.contains(lower),
                isActive: activeStates.contains(lower)
            )
        }
        guard delegatedCount > 0 else { return TaskSummary(text: nil, needsAttention: false, isActive: false) }
        let attentionCount = delegatedTasks.filter {
            attentionStates.contains($0.phase.lowercased())
                || ($0.runStatus.map { attentionStates.contains($0.lowercased()) } ?? false)
        }.count
        let activeCount = delegatedTasks.filter {
            activeStates.contains($0.phase.lowercased())
                || ($0.runStatus.map { activeStates.contains($0.lowercased()) } ?? false)
        }.count
        let text: String = if attentionCount > 0 {
            isZh ? "\(delegatedCount) 项任务 · \(attentionCount) 待处理"
                : "\(delegatedCount) tasks · \(attentionCount) needs you"
        } else {
            isZh ? "\(delegatedCount) 项派出任务"
                : "\(delegatedCount) \(delegatedCount == 1 ? "task" : "tasks")"
        }
        return TaskSummary(text: text, needsAttention: attentionCount > 0, isActive: activeCount > 0)
    }

    private static func formatEnvironmentTag(kind: String?, branch: String?) -> String? {
        let trimmedBranch = branch?.trimmingCharacters(in: .whitespacesAndNewlines)
        if kind == "managed_worktree" {
            return trimmedBranch?.isEmpty == false ? "Worktree · \(trimmedBranch!)" : "Worktree"
        }
        return trimmedBranch?.isEmpty == false ? trimmedBranch : nil
    }

    static func shouldShowRuntimeBadge(agentName: String, badge: String?) -> Bool {
        guard let badge, !badge.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return !agentName.localizedCaseInsensitiveContains(badge)
    }
}

struct ChatHeaderIdentityButton: View {
    let configuration: GatewayConfiguration
    let agent: AgentSummary?
    let agentName: String
    let modelSubtitle: String?
    let isActive: Bool
    let action: () -> Void

    @Environment(\.mobileTheme) private var mobileTheme

    private var runtimeBadge: String? {
        guard let badge = agent?.externalRuntimeBadge,
              ChatHeaderPresentation.shouldShowRuntimeBadge(agentName: agentName, badge: badge)
        else { return nil }
        return badge
    }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 1) {
                HStack(spacing: 5) {
                    ConfiguredAgentAvatar(
                        configuration: configuration,
                        agent: agent,
                        size: 18,
                        active: isActive,
                        resolveUnconfigured: false
                    )
                    Text(verbatim: agentName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(mobileTheme.foreground)
                        .lineLimit(1)
                    if let runtimeBadge {
                        AgentRuntimeBadge(label: runtimeBadge)
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(mobileTheme.secondary)
                        .accessibilityHidden(true)
                }
                if let modelSubtitle, !modelSubtitle.isEmpty {
                    Text(verbatim: modelSubtitle)
                        .font(.caption2)
                        .foregroundStyle(mobileTheme.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(MobilePressStyle(radius: mobileTheme.corner(18), restingBackground: mobileTheme.card))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: [agentName, modelSubtitle].compactMap { $0 }.joined(separator: "，")))
        .accessibilityIdentifier("chat-header-identity")
    }
}

struct ChatContextStripButton: View {
    let model: ChatContextStripModel
    let action: () -> Void

    @Environment(\.mobileTheme) private var mobileTheme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: model.icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(mobileTheme.secondary)
                    .accessibilityHidden(true)
                if let projectTitle = model.projectTitle {
                    Text(verbatim: projectTitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(mobileTheme.foreground)
                        .lineLimit(1)
                        .layoutPriority(model.taskText == nil ? 1 : 0.6)
                }
                if let taskText = model.taskText {
                    if model.projectTitle != nil {
                        Text(verbatim: "·")
                            .font(.caption)
                            .foregroundStyle(mobileTheme.secondary.opacity(0.65))
                            .accessibilityHidden(true)
                    }
                    if model.needsAttention || model.isTaskActive {
                        Circle()
                            .fill(model.needsAttention ? mobileTheme.onAttention : mobileTheme.action)
                            .frame(width: 6, height: 6)
                            .accessibilityHidden(true)
                    }
                    Text(verbatim: taskText)
                        .font(.caption.weight(model.needsAttention ? .medium : .regular))
                        .foregroundStyle(model.needsAttention ? mobileTheme.onAttention : mobileTheme.secondary)
                        .lineLimit(1)
                        .layoutPriority(1)
                } else if let environmentTag = model.environmentTag {
                    Text(verbatim: "·")
                        .font(.caption)
                        .foregroundStyle(mobileTheme.secondary.opacity(0.65))
                        .accessibilityHidden(true)
                    Text(verbatim: environmentTag)
                        .font(.caption)
                        .foregroundStyle(mobileTheme.secondary)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(mobileTheme.secondary.opacity(0.65))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(minHeight: 34)
            .contentShape(.rect)
        }
        .buttonStyle(MobilePressStyle(
            radius: mobileTheme.corner(14),
            restingBackground: model.needsAttention ? mobileTheme.attention : mobileTheme.card
        ))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
        .accessibilityIdentifier("chat-context-bar")
    }
}

struct DraftQuickSetupChips: View {
    let configuration: GatewayConfiguration
    let agent: AgentSummary?
    let agentName: String
    let modelLabel: String?
    let projectTitle: String?
    let onSelectAgent: () -> Void
    let onSelectModel: () -> Void
    let onSelectProject: () -> Void

    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.locale) private var locale

    private var isZh: Bool {
        locale.language.languageCode?.identifier == "zh"
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button(action: onSelectAgent) {
                    HStack(spacing: 6) {
                        ConfiguredAgentAvatar(
                            configuration: configuration,
                            agent: agent,
                            size: 16,
                            active: false,
                            resolveUnconfigured: false
                        )
                        Text(verbatim: agentName)
                            .lineLimit(1)
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(mobileTheme.foreground)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                }
                .buttonStyle(MobilePressStyle(radius: mobileTheme.corner(16), restingBackground: mobileTheme.card))
                .accessibilityIdentifier("chat-welcome-agent")

                Button(action: onSelectModel) {
                    HStack(spacing: 5) {
                        Image(systemName: "waveform")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(mobileTheme.secondary)
                            .accessibilityHidden(true)
                        Text(verbatim: modelLabel ?? (isZh ? "默认模型" : "Default model"))
                            .lineLimit(1)
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(mobileTheme.foreground)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                }
                .buttonStyle(MobilePressStyle(radius: mobileTheme.corner(16), restingBackground: mobileTheme.card))
                .accessibilityIdentifier("chat-welcome-model")

                Button(action: onSelectProject) {
                    HStack(spacing: 5) {
                        Image(systemName: projectTitle == nil ? "folder.badge.plus" : "folder")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(projectTitle == nil ? mobileTheme.secondary : mobileTheme.action)
                            .accessibilityHidden(true)
                        Text(verbatim: projectTitle ?? (isZh ? "关联项目" : "Project"))
                            .lineLimit(1)
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(mobileTheme.foreground)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                }
                .buttonStyle(MobilePressStyle(radius: mobileTheme.corner(16), restingBackground: mobileTheme.card))
                .accessibilityIdentifier("chat-welcome-project")
            }
            .padding(.horizontal, 4)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat-draft-quick-actions")
    }
}
