import Foundation
import SwiftUI
import Testing
import UIKit
@testable import XopcMobile

struct ChatRenderingTests {
    @Test func slashPaletteOnlyReplacesTheTokenAtTheCaret() {
        var draft = "📝 先写 /meet 然后补充"
        let caret = "📝 先写 /meet".utf16.count
        let token = ComposerPaletteToken.atCaret(in: draft, utf16Offset: caret)
        #expect(token?.query == "meet")
        if let token {
            draft.replaceSubrange(token.range, with: "/skill:meeting ")
        }
        #expect(draft == "📝 先写 /skill:meeting  然后补充")
        #expect(ComposerPaletteToken.atCaret(in: "https://file", utf16Offset: nil) == nil)
        #expect(ComposerPaletteToken.atCaret(in: "/skill:meeting", utf16Offset: nil) == nil)
        #expect(ComposerPaletteToken.atCaret(in: "/", utf16Offset: nil)?.query == "")
        let exact = ComposerPaletteItem(id: "command:help", title: "help", detail: "Show help", token: "/help", aliases: [])
        let substring = ComposerPaletteItem(id: "skill:helper-bot", title: "My helper", detail: "Assists", token: "/skill:helper-bot ", aliases: [])
        let skillPrefix = ComposerPaletteItem(id: "skill:meeting", title: "纪要", detail: "Meeting notes", token: "/skill:meeting ", aliases: ["meeting"])
        #expect((exact.rank(for: "help") ?? 999) < (substring.rank(for: "help") ?? 999))
        #expect(skillPrefix.rank(for: "skill") == nil)
        #expect(skillPrefix.rank(for: "notes") == 100)
    }

    @Test func historyUsesAnswerBlocksRatherThanFlattenedTextOrReasoning() throws {
        let messages = try JSONDecoder().decode([WireMessage].self, from: Data(#"""
        [{"id":"intermediate","role":"assistant","content":"working","rawContent":[
            {"type":"text","text":"working","presentation":"narration"}]},
         {"id":"reply","role":"assistant","content":"stale flattened text","rawContent":[
            {"type":"thinking","thinking":"private reasoning"},
            {"type":"text","text":"private draft","presentation":"thinking"},
            {"type":"text","text":"Final answer","presentation":"answer"}]}]
        """#.utf8))

        #expect(AssistantState.timeline(from: messages).map(\.text) == ["Final answer"])
    }

    @Test func generatedMediaKeepsRepliesWithoutText() throws {
        let messages = try JSONDecoder().decode([WireMessage].self, from: Data(#"""
        [{"id":"media","role":"assistant","content":"","generatedMediaIds":["song","video"]},
         {"id":"empty","role":"assistant","content":""}]
        """#.utf8))
        let rows = AssistantState.timeline(from: messages)
        #expect(rows.map(\.id) == ["media"])
        #expect(rows.first?.generatedMediaIds == ["song", "video"])
    }

    @Test func userHistoryProjectsMarkdownWithoutChangingCopyableSource() throws {
        let messages = try JSONDecoder().decode([WireMessage].self, from: Data(#"""
        [{"id":"user","role":"user","content":"## Summary\n\n- **Keep formatting**"}]
        """#.utf8))
        let row = try #require(AssistantState.timeline(from: messages).first)
        #expect(row.text == "## Summary\n\n- **Keep formatting**")
        #expect(row.markdownParts.map(\.block) == [
            .heading(level: 2, text: "Summary"),
            .bullet(level: 0, text: "**Keep formatting**")
        ])
    }

    @MainActor @Test func historicalGeneratedMediaReappearsOnlyWithItsOriginalReply() throws {
        let jobs = try JSONDecoder().decode([GeneratedMediaPayload].self, from: Data(#"""
        [{"id":"old-song","state":"completed","createdAt":1},
         {"id":"failed-song","state":"failed","createdAt":2},
         {"id":"new-song","state":"queued","createdAt":3},
         {"id":"completed-video","state":"completed","createdAt":4},
         {"id":"failed-video","state":"failed","createdAt":5},
         {"id":"draft-video","revision":1,"createdAt":6},
         {"id":"active-video","state":"running","createdAt":7}]
        """#.utf8))
        let cards = jobs.map { GeneratedMediaCard(kind: $0.id.contains("video") ? .video : .music, item: $0) }
        let messages = try JSONDecoder().decode([WireMessage].self, from: Data(#"""
        [{"id":"original","role":"assistant","content":"","generatedMediaIds":["old-song","completed-video"]},
         {"id":"latest","role":"assistant","content":"A newer reply"}]
        """#.utf8))

        let latestPage = GeneratedMediaState.cardsByReply(cards, messages: AssistantState.timeline(from: Array(messages.suffix(1))))
        #expect(latestPage.mapValues { $0.map(\.id) } == ["": ["new-song", "active-video"]])

        let expandedHistory = GeneratedMediaState.cardsByReply(cards, messages: AssistantState.timeline(from: messages))
        #expect(expandedHistory.mapValues { $0.map(\.id) } == [
            "": ["new-song", "active-video"],
            "original": ["old-song", "completed-video"]
        ])
    }

    @Test func publicStagesRemainOrderedUntilTheAnswerStarts() {
        var progress = AssistantRunProgress(runID: "run")
        for index in 1 ... 4 {
            progress.record(id: "stage-\(index)", text: "阶段 \(index)")
        }
        progress.record(id: "stage-4", text: "重放")
        #expect(progress.visibleStages(answerStarted: false).map(\.title) == ["阶段 1", "阶段 2", "阶段 3", "阶段 4"])
        #expect(progress.visibleStages(answerStarted: false).suffix(3).map(\.id) == ["stage-2", "stage-3", "stage-4"])
        #expect(progress.visibleStages(answerStarted: true).isEmpty)
        progress.status = "success"
        #expect(progress.visibleStages(answerStarted: false).isEmpty)
        #expect(progress.stages.count == 4)
    }

    @Test(arguments: ["error", "cancelled", "suspended"])
    func interruptedStagesRemainAvailableUntilANewRun(status: String) {
        var progress = AssistantRunProgress(runID: "run")
        progress.record(id: "stage", text: "正在安装")
        progress.status = status
        #expect(progress.terminalStatus == status)
        #expect(progress.visibleStages(answerStarted: true).map(\.title) == ["正在安装"])
        progress.begin("run")
        #expect(progress.terminalStatus == status)
        progress.begin("next")
        #expect(progress.stages.isEmpty)
        #expect(progress.terminalStatus == nil)
    }

    @Test func historyRecoveryRestoresOnlyPublicStagesOfTheCurrentTurn() throws {
        let history = try JSONDecoder().decode([WireMessage].self, from: Data(#"""
        [{"id":"stage-1","turnId":"run","role":"assistant","content":[
          {"type":"thinking","thinking":"private"},
          {"type":"text","text":"确认连接","presentation":"narration"},
          {"type":"text","text":"Draft","presentation":"pending"}]},
         {"id":"stage-2","turnId":"run","role":"assistant","content":[
          {"type":"text","text":"安装中","presentation":"narration"}]},
         {"id":"old-stage","turnId":"old","role":"assistant","content":[
          {"type":"text","text":"Other turn","presentation":"narration"}]}]
        """#.utf8))
        var progress = AssistantRunProgress(runID: "run")
        progress.record(id: "stage-2", text: "安装中")
        progress.restore(history)
        progress.restore(history)
        #expect(progress.stages.map(\.title) == ["确认连接", "安装中"])
    }

    @MainActor @Test func streamStagesPersistDuringPendingOutputAndOnCancellation() {
        let state = AssistantState()
        state.apply(delta("确认手机连接", offset: 0), runID: "r")
        state.apply(.init(name: "assistant_message_end", sequence: 2, messageId: "answer", delta: nil, offset: nil,
                          status: nil, errorMessage: nil, toolName: nil, stage: nil, presentation: "narration"), runID: "r")
        state.apply(.init(name: "assistant_delta", sequence: 3, messageId: "draft", delta: "Unclassified", offset: 0,
                          status: nil, errorMessage: nil, toolName: nil, stage: nil), runID: "r")
        #expect(state.runProgress.visibleStages(answerStarted: false).map(\.title) == ["确认手机连接"])
        state.apply(.init(name: "run_end", sequence: 4, messageId: nil, delta: nil, offset: nil,
                          status: "cancelled", errorMessage: nil, toolName: nil, stage: nil), runID: "r")
        #expect(state.runProgress.terminalStatus == "cancelled")
        #expect(state.runProgress.stages.count == 1)
        #expect(state.messages.first?.answerConfirmed == false)
    }

    @MainActor @Test func draftsBecomeVisibleOnlyWhenConfirmedAsAnswers() {
        let state = AssistantState()
        state.apply(delta("Checking sources", offset: 0), runID: "r")
        #expect(state.messages.first?.answerConfirmed == false)
        state.apply(.init(name: "assistant_message_end", sequence: 2, messageId: "answer", delta: nil, offset: nil,
                          status: nil, errorMessage: nil, toolName: nil, stage: nil, presentation: "answer"), runID: "r")
        #expect(state.messages.first?.answerConfirmed == true)
        #expect(state.messages.first?.revealAnswer == true)
    }

    @Test func historySeparatesPublicNarrationFromAnswersAndPreservesTaskReceipts() throws {
        let source = #"""
        {"id":"a","role":"assistant","content":[
          {"type":"text","text":"Checking","presentation":"narration"},
          {"type":"text","text":"Draft","presentation":"pending"},
          {"type":"text","text":"Result","presentation":"answer"}
        ],"deliveries":[{"operation":"started","primary":{
          "kind":"task","id":"t","title":"Research","capabilities":["open"]
        }}]}
        """#
        let wire = try JSONDecoder().decode(WireMessage.self, from: Data(source.utf8))
        #expect(wire.content.text == "Result")
        #expect(wire.deliveries?.first?.primary?.id == "t")
    }

    @MainActor @Test func continuousPacketsCommitBeforeTheStreamBecomesQuiet() async throws {
        let state = AssistantState()
        state.apply(delta("字", offset: 0), runID: "r")
        for offset in 1 ..< 10 {
            state.apply(delta("字", offset: offset), runID: "r")
            try await Task.sleep(for: .milliseconds(8))
        }
        #expect((state.messages.first?.text.count ?? 0) > 1)
        state.flushStream()
        #expect(state.messages.first?.text.count == 10)
    }

    @MainActor @Test func publicNarrationMovesIntoActivityAndReplayDoesNotResurrectIt() {
        let state = AssistantState()
        state.apply(delta("Reading files", offset: 0), runID: "r")
        state.apply(.init(name: "assistant_message_end", sequence: 2, messageId: "answer", delta: nil, offset: nil,
                          status: nil, errorMessage: nil, toolName: nil, stage: nil, presentation: "narration"), runID: "r")
        state.apply(delta("Reading files", offset: 0), runID: "r")
        #expect(state.messages.isEmpty)
        #expect(state.executionActivity.last?.title == "Reading files")
    }

    @MainActor @Test func buffersReceivedOffsetsAndFlushesAtTermination() {
        let state = AssistantState()
        state.apply(delta("你😀", offset: 0), runID: "r")
        state.apply(delta("你😀好", offset: 0), runID: "r")
        state.apply(delta("dup", offset: 99), runID: "r")
        #expect(state.messages.first?.text == "你😀")
        state.apply(.init(name: "run_end", sequence: 5, messageId: nil, delta: nil, offset: nil,
                          status: "completed", errorMessage: nil, toolName: nil, stage: nil), runID: "r")
        #expect(state.messages.first?.text == "你😀好")
        #expect(state.messages.first?.id == "answer")
        #expect(state.messages.first?.isPending == false)
    }

    @Test func markdownRetainsPrefixTailAndTableCellIdentity() {
        let initial = MarkdownPart.project(MarkdownBlock.parse("# Title\n\nPartial"), previous: [])
        let next = MarkdownPart.project(MarkdownBlock.parse("# Title\n\nPartial **bold**"), previous: initial)
        #expect(next[0] == initial[0])
        #expect(next[1].id == initial[1].id)
        let table = MarkdownPart.project(MarkdownBlock.parse("| a | b |\n| --- | --- |\n| 1 | 2 |"), previous: [])
        let changed = MarkdownPart.project(MarkdownBlock.parse("| a | b |\n| --- | --- |\n| 1 | 23 |"), previous: table)
        guard case let .table(before, _) = table[0].block, case let .table(after, _) = changed[0].block else {
            Issue.record("Missing table"); return
        }
        #expect(before[1].id == after[1].id)
        #expect(before[1].cells[1].id == after[1].cells[1].id)
        #expect(after[1].cells[1].text == "23")
    }

    @Test func internalRoutesTakePrecedenceOverFilenameSuffixes() {
        #expect(ChatMessageLink.resolve("/notes/report.md") == .route(page: "notes", itemID: "report.md"))
        #expect(ChatMessageLink.resolve("xopc://open?kind=task&id=t") == .route(page: "tasks", itemID: "t"))
        #expect(ChatMessageLink.resolve("#/projects/p") == .route(page: "projects", itemID: "p"))
        #expect(ChatMessageLink.resolve("/workflows/runs/r") == nil)
        #expect(ChatMessageLink.resolve("/automations?automation=a") == .route(page: "automations", itemID: "a"))
        #expect(ChatMessageLink.resolve("#/automations?run=r") == .route(page: "automation-run", itemID: "r"))
        #expect(ChatMessageLink.resolve("xopc://settings/language") == .route(page: "settings", itemID: "language"))
        #expect(ChatMessageLink.resolve("#/settings/appearance") == .route(page: "settings", itemID: "appearance"))
        #expect(ChatMessageLink.resolve("xopc://open?kind=settings&id=notifications") == .route(page: "settings", itemID: "notifications"))
        #expect(ChatMessageLink.resolve("xopc://capabilities/mcp?id=example&url=https%3A%2F%2Fexample.com%2Fmcp")
            == .mcpSetup(name: "example", serverURL: "https://example.com/mcp"))
        #expect(ChatMessageLink.resolve("xopc://capabilities/mcp?id=example&url=http%3A%2F%2Fexample.com") == nil)
        #expect(ChatMessageLink.resolve("xopc://capabilities/mcp?id=example&url=https%3A%2F%2Fuser%40example.com") == nil)
        #expect(ChatMessageLink.resolve("/settings") == .route(page: "settings", itemID: ""))
        #expect(ChatMessageLink.resolve("xopc://settings/%2E%2E") == nil)
        #expect(ChatMessageLink.resolve("https://example.com/settings/language") == nil)
        #expect(ChatMessageLink.resolve("#/automations?automation=a") == .route(page: "automations", itemID: "a"))
        #expect(ChatMessageLink.resolve("xopc://workspace/file?path=docs%2F%E4%B8%AD%E6%96%87.md") == .workspaceFile(path: "docs/中文.md"))
        #expect(ChatMessageLink.resolve("xopc://workspace/file?path=../secrets") == nil)
        #expect(ChatMessageLink.resolve("xopc://workspace/file?path=/etc/passwd") == nil)
        #expect(ChatMessageLink.resolve("xopc://workspace/file?path=docs/./a.md") == nil)
        #expect(ChatMessageLink.resolve("/notes/.") == nil)
        #expect(ChatMessageLink.resolve("xopc-file:.") == nil)
        #expect(ChatMessageLink.resolve("xopc-file:abc?query=1") == nil)
        #expect(ChatMessageLink.resolve("xopc://user@open?kind=note&id=n") == nil)
        #expect(ChatMessageLink.resolve("xopc://open?kind=settings") == .route(page: "settings", itemID: ""))
        #expect(HomeOpenRoute(href: "/tasks/..") == nil)
        #expect(HomeOpenRoute(href: "/tasks/.") == nil)
        #expect(HomeOpenRoute(href: "/automations?run=../admin") == nil)
        #expect(HomeOpenRoute(href: "/automations?run=run-1") == .automationRun("run-1"))
        #expect(ChatImageSource.resolve("xopc-file:..", conversationID: nil) == nil)
        #expect(ChatImageSource.resolve("xopc-file:.", conversationID: nil) == nil)
        #expect(ChatImageSource.resolve("xopc-attachment://notes/n/..", conversationID: nil) == nil)
        #expect(ChatMessageLink.resolve("//example.com/notes/n") == nil)
        #expect(ChatMessageLink.resolve("https://example.com/notes/n") == nil)
        #expect(ChatMessageLink.resolve("https://example.com/workflows/runs/r") == nil)
        #expect(ChatMessageLink.resolve("https://example.com/xopc/workspace/file?path=docs/a.md") == nil)
    }

    private func delta(_ text: String, offset: Int) -> RunStreamEvent {
        .init(name: "assistant_delta", sequence: 1, messageId: "answer", delta: text, offset: offset,
              status: nil, errorMessage: nil, toolName: nil, stage: nil)
    }
}

@MainActor
struct ChatCapsuleLayoutTests {
    @Test func fitsNarrowWidthsWithLongTextAndAccessibilityFonts() {
        for width in [160.0, 240.0, 320.0] {
            for size in [DynamicTypeSize.large, .accessibility3, .accessibility5] {
                let controller = UIHostingController(rootView:
                    ChatResultCapsuleLabel(
                        title: String(repeating: "LongUnbrokenFilename", count: 12) + ".pdf",
                        systemImage: "doc",
                        status: String(repeating: "正在核对结果", count: 8)
                    ).environment(\.dynamicTypeSize, size))
                let fitted = controller.sizeThatFits(in: CGSize(width: width, height: 10000))
                #expect(fitted.width <= width + 1)
                #expect(fitted.height >= 44)
            }
        }
    }
}
