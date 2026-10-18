import Foundation
import Testing
@testable import XopcMobile

struct ChatRenderingTests {
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
        let source = #"{"id":"a","role":"assistant","content":[{"type":"text","text":"Checking","presentation":"narration"},{"type":"text","text":"Draft","presentation":"pending"},{"type":"text","text":"Result","presentation":"answer"}],"deliveries":[{"operation":"started","primary":{"kind":"task","id":"t","title":"Research","capabilities":["open"]}}]}"#
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
        #expect(ChatMessageLink.resolve("/workflows/runs/r") == .route(page: "workflows", itemID: "r"))
        #expect(ChatMessageLink.resolve("/automations?automation=a") == .route(page: "automations", itemID: "a"))
        #expect(ChatMessageLink.resolve("#/automations?automation=a") == .route(page: "automations", itemID: "a"))
        #expect(ChatMessageLink.resolve("xopc://workspace/file?path=docs%2F%E4%B8%AD%E6%96%87.md") == .workspaceFile(path: "docs/中文.md"))
        #expect(ChatMessageLink.resolve("xopc://workspace/file?path=../secrets") == nil)
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
