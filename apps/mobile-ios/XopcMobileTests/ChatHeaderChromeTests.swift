import Foundation
import Testing
@testable import XopcMobile

struct ChatHeaderChromeTests {
    @Test func formatsModelSubtitleWithThinkingAndFastMode() {
        let zhLocale = Locale(identifier: "zh-Hans")
        let enLocale = Locale(identifier: "en-US")

        #expect(ChatHeaderPresentation.modelSubtitle(
            modelName: "Claude Sonnet 4.5",
            thinkingMode: "levels",
            thinkingLevel: "high",
            isFastEnabled: true,
            locale: zhLocale
        ) == "Claude Sonnet 4.5 · 高 ⚡")

        #expect(ChatHeaderPresentation.modelSubtitle(
            modelName: "GPT-5",
            thinkingMode: "levels",
            thinkingLevel: "off",
            isFastEnabled: false,
            locale: enLocale
        ) == "GPT-5")

        #expect(ChatHeaderPresentation.modelSubtitle(
            modelName: "GPT-5",
            thinkingMode: "toggle",
            thinkingLevel: "medium",
            isFastEnabled: false,
            locale: enLocale
        ) == "GPT-5 · Med")

        #expect(ChatHeaderPresentation.modelSubtitle(
            modelName: nil,
            thinkingMode: "levels",
            thinkingLevel: "high",
            isFastEnabled: true,
            locale: zhLocale
        ) == nil)
    }

    @Test func contextStripHidesForCasualChatAndFormatsProjectTask() {
        let zhLocale = Locale(identifier: "zh-Hans")

        #expect(ChatHeaderPresentation.contextStrip(.init(
            projectTitle: nil,
            taskTitle: nil,
            taskPhase: nil,
            delegatedTaskCount: 0,
            delegatedTasks: nil,
            environmentKind: "local_checkout",
            branch: "main",
            locale: zhLocale
        )) == nil)

        let projectTask = ChatHeaderPresentation.contextStrip(.init(
            projectTitle: "xopc",
            taskTitle: "优化顶栏",
            taskPhase: "review",
            delegatedTaskCount: 0,
            delegatedTasks: nil,
            environmentKind: "managed_worktree",
            branch: "feat/header",
            locale: zhLocale
        ))
        #expect(projectTask?.icon == "folder")
        #expect(projectTask?.projectTitle == "xopc")
        #expect(projectTask?.taskText == "优化顶栏 · 待验收")
        #expect(projectTask?.needsAttention == true)
        #expect(projectTask?.environmentTag == nil)
    }

    @Test func contextStripFormatsDelegatedTasksAndWorktree() {
        let zhLocale = Locale(identifier: "zh-Hans")
        let enLocale = Locale(identifier: "en-US")

        let delegated = ChatHeaderPresentation.contextStrip(.init(
            projectTitle: "xopc",
            taskTitle: nil,
            taskPhase: nil,
            delegatedTaskCount: 2,
            delegatedTasks: [
                ContextDelegatedTask(id: "t1", title: "A", phase: "active", runStatus: "running"),
                ContextDelegatedTask(id: "t2", title: "B", phase: "review", runStatus: nil)
            ],
            environmentKind: nil,
            branch: nil,
            locale: zhLocale
        ))
        #expect(delegated?.taskText == "2 项任务 · 1 待处理")
        #expect(delegated?.needsAttention == true)
        #expect(delegated?.isTaskActive == true)

        let worktree = ChatHeaderPresentation.contextStrip(.init(
            projectTitle: "xopc",
            taskTitle: nil,
            taskPhase: nil,
            delegatedTaskCount: 0,
            delegatedTasks: nil,
            environmentKind: "managed_worktree",
            branch: "feat/mobile",
            locale: enLocale
        ))
        #expect(worktree?.projectTitle == "xopc")
        #expect(worktree?.taskText == nil)
        #expect(worktree?.environmentTag == "Worktree · feat/mobile")
    }

    @Test func deduplicatesRuntimeBadgeWhenIncludedInAgentName() {
        #expect(!ChatHeaderPresentation.shouldShowRuntimeBadge(agentName: "Claude Code", badge: "Claude"))
        #expect(ChatHeaderPresentation.shouldShowRuntimeBadge(agentName: "前端专家", badge: "Claude"))
        #expect(!ChatHeaderPresentation.shouldShowRuntimeBadge(agentName: "主助理", badge: nil))
    }

    @Test func splitsModelSubtitleParts() {
        let zhLocale = Locale(identifier: "zh-Hans")
        let parts = ChatHeaderPresentation.modelSubtitleParts(
            modelName: "Claude Sonnet 4.6",
            thinkingMode: "levels",
            thinkingLevel: "medium",
            isFastEnabled: true,
            locale: zhLocale
        )
        #expect(parts == ChatHeaderModelParts(name: "Claude Sonnet 4.6", suffix: "· 中 ⚡"))

        let fastOnly = ChatHeaderPresentation.modelSubtitleParts(
            modelName: "GPT-5.4",
            thinkingMode: "levels",
            thinkingLevel: "off",
            isFastEnabled: true,
            locale: zhLocale
        )
        #expect(fastOnly == ChatHeaderModelParts(name: "GPT-5.4", suffix: "⚡"))
        #expect(fastOnly?.fullText == "GPT-5.4 ⚡")
    }

    @Test func formatsHeaderIdentityByAgentAndDraftState() {
        let parts = ChatHeaderModelParts(name: "Claude Sonnet 4.6", suffix: "· 中 ⚡")

        let defaultTitled = ChatHeaderPresentation.headerIdentity(.init(
            conversationTitle: "重构移动端导航方案", isDraft: false,
            agentID: "main", defaultAgentID: "main", agentName: "主助理",
            runtimeBadge: nil, modelParts: parts
        ))
        #expect(defaultTitled.hasConversationTitle)
        #expect(!defaultTitled.showsAvatarInPrimary)
        #expect(defaultTitled.primaryText == "重构移动端导航方案")
        #expect(defaultTitled.secondaryAgentName == nil)
        #expect(defaultTitled.modelName == "Claude Sonnet 4.6")
        #expect(defaultTitled.modelSuffix == "· 中 ⚡")

        let expertTitled = ChatHeaderPresentation.headerIdentity(.init(
            conversationTitle: "重构移动端导航方案", isDraft: false,
            agentID: "architect", defaultAgentID: "main", agentName: "架构专家",
            runtimeBadge: "Claude", modelParts: parts
        ))
        #expect(expertTitled.hasConversationTitle)
        #expect(!expertTitled.showsAvatarInPrimary)
        #expect(expertTitled.primaryRuntimeBadge == nil)
        #expect(expertTitled.secondaryAgentName == "架构专家")
        #expect(expertTitled.secondaryRuntimeBadge == "Claude")
        #expect(expertTitled.modelName == "Claude Sonnet 4.6")

        let draft = ChatHeaderPresentation.headerIdentity(.init(
            conversationTitle: "新对话", isDraft: true,
            agentID: "architect", defaultAgentID: "main", agentName: "架构专家",
            runtimeBadge: "Claude", modelParts: parts
        ))
        #expect(!draft.hasConversationTitle)
        #expect(draft.showsAvatarInPrimary)
        #expect(draft.primaryText == "架构专家")
        #expect(draft.primaryRuntimeBadge == "Claude")
        #expect(draft.secondaryAgentName == nil)
        #expect(draft.modelName == "Claude Sonnet 4.6")
    }
}
