import Foundation
import Testing
@testable import XopcMobile

struct GatewayModelsTests {
    @Test func decodesAgentCatalogEnvelope() throws {
        let data = Data(#"""
        {
          "ok": true,
          "payload": {
            "defaultId": "main",
            "agents": [{ "id": "main", "name": "Xopc", "description": "Personal assistant" }]
          }
        }
        """#.utf8)

        let envelope = try JSONDecoder().decode(GatewayEnvelope<AgentCatalog>.self, from: data)

        #expect(envelope.isSuccessful)
        #expect(envelope.payload?.defaultId == "main")
        #expect(envelope.payload?.agents.first?.displayName == "Xopc")
    }

    @Test func decodesConversationPage() throws {
        let data = Data(#"""
        {
          "items": [{
            "key": "conversation-1",
            "agentId": "main",
            "status": "active",
            "updatedAt": "2026-10-04T00:00:00Z",
            "messageCount": 2
          }],
          "total": 1,
          "hasMore": false
        }
        """#.utf8)

        let page = try JSONDecoder().decode(ConversationPage.self, from: data)

        #expect(page.items.first?.displayName == "新对话")
        #expect(page.items.first?.id == "conversation-1")
        #expect(page.hasMore == false)
    }

    @Test func separatesAnswerFromThinkingAndToolDetails() throws {
        let data = Data(#"""
        {
          "id": "assistant-1",
          "role": "assistant",
          "content": [
            { "type": "thinking", "thinking": "Inspect the repository" },
            { "type": "toolCall", "id": "tool-1", "name": "search_graph", "status": "done" },
            { "type": "text", "text": "The implementation is ready." }
          ],
          "metadata": {
            "sourceContexts": [{
              "kind": "note",
              "sourceId": "note-1",
              "version": "42",
              "title": "Release plan"
            }]
          }
        }
        """#.utf8)

        let message = try JSONDecoder().decode(WireMessage.self, from: data)

        #expect(message.content.text == "The implementation is ready.")
        #expect(message.content.details.map(\.title) == ["思考过程", "search_graph"])
        #expect(message.metadata?.sourceContexts?.first?.title == "Release plan")
    }

    @Test func executionDetailGroupsPublicStepsWithoutReasoning() throws {
        let data = Data(#"""
        {
          "detail": {
            "turnId": "turn-1",
            "steps": [
              { "id": "thought", "kind": "thinking" },
              { "id": "search-1", "kind": "tool", "category": "search",
                "preview": "first query", "status": "done" },
              { "id": "search-2", "kind": "tool", "category": "search",
                "preview": "second query", "status": "done" },
              { "id": "open-1", "kind": "tool", "category": "fetch",
                "preview": "https://example.com/article", "status": "done" },
              { "id": "failed", "kind": "tool", "category": "fetch",
                "failure": "Unavailable", "status": "error" }
            ]
          }
        }
        """#.utf8)

        let detail = try JSONDecoder().decode(ExecutionDetailEnvelope.self, from: data).detail
        let groups = detail.groups(live: false)

        #expect(detail.turnId == "turn-1")
        #expect(groups.map(\.category) == ["search", "fetch", "fetch"])
        #expect(groups.map(\.steps.count) == [2, 1, 1])
        #expect(groups[0].hasDetails)
        #expect(groups[0].firstPreview == "first query")
        #expect(groups[1].steps[0].previewURL?.host == "example.com")
        #expect(groups[2].status == "error")
    }

    @Test func executionDetailMarksUnfinishedToolStoppedAfterTurn() throws {
        let data = Data(#"""
        { "turnId": "turn-2", "steps": [
          { "id": "tool-1", "kind": "tool", "category": "read", "status": "running" }
        ] }
        """#.utf8)
        let detail = try JSONDecoder().decode(ExecutionDetail.self, from: data)

        #expect(detail.groups(live: false)[0].status == "stopped")
        #expect(detail.groups(live: true)[0].status == "running")
    }

    @MainActor @Test func timelineKeepsTurnIdentityForExecutionLookup() throws {
        let data = Data(#"""
        { "id": "message-1", "turnId": "turn-1", "role": "assistant", "content": "Answer" }
        """#.utf8)
        let wire = try JSONDecoder().decode(WireMessage.self, from: data)

        #expect(AssistantState.timeline(from: [wire]).first?.turnId == "turn-1")
    }

    @Test func markdownBlocksPreserveReadingHierarchy() {
        let source = """
        # Summary

        A **bold** finding with [source](https://example.com).

        1. First item
        2. Second item
        - Bullet
        > Quoted note

        ```swift
        let answer = 42
        ```
        """

        let blocks = MarkdownBlock.parse(source)

        #expect(blocks == [
            .heading(level: 1, text: "Summary"),
            .paragraph("A **bold** finding with [source](https://example.com)."),
            .numbered(number: "1", level: 0, text: "First item"),
            .numbered(number: "2", level: 0, text: "Second item"),
            .bullet(level: 0, text: "Bullet"),
            .quote("Quoted note"),
            .code("let answer = 42")
        ])
    }

    @Test func decodesOpenClarificationSnapshot() throws {
        let data = Data(#"""
        {
          "ok": true,
          "payload": {
            "transcriptId": "transcript-1",
            "revision": 4,
            "serverTime": 1791082800000,
            "clarification": {
              "id": "clarification-1",
              "conversationId": "conversation-1",
              "kind": "input",
              "status": "open",
              "question": "Which environment should I use?",
              "choices": ["Local", "Worktree"],
              "suggestedAnswer": "Local",
              "version": 2
            }
          }
        }
        """#.utf8)

        let envelope = try JSONDecoder().decode(GatewayEnvelope<ClarificationSnapshot>.self, from: data)

        #expect(envelope.payload?.clarification?.isOpen == true)
        #expect(envelope.payload?.clarification?.choices == ["Local", "Worktree"])
        #expect(envelope.payload?.clarification?.version == 2)
    }

    @Test func decodesQueuedInputState() throws {
        let data = Data(#"""
        {
          "ok": true,
          "payload": {
            "conversationId": "conversation-1",
            "revision": 5,
            "activeRunId": "run-1",
            "inputs": [{
              "id": "input-1",
              "content": "Follow up",
              "status": "queued",
              "version": 1,
              "position": 0,
              "requestedDelivery": "next",
              "effectiveDelivery": "next",
              "contextRefs": [{
                "kind": "note",
                "sourceId": "note-1",
                "version": "42",
                "title": "Release plan"
              }]
            }]
          }
        }
        """#.utf8)

        let envelope = try JSONDecoder().decode(GatewayEnvelope<InputState>.self, from: data)

        #expect(envelope.payload?.inputs.first?.isPending == true)
        #expect(envelope.payload?.inputs.first?.content == "Follow up")
        #expect(envelope.payload?.inputs.first?.contextRefs?.first?.title == "Release plan")
    }

    @Test func encodesGatewayAttachmentContract() throws {
        let command = MessageInputCommand(
            content: "",
            attachments: [MessageAttachmentCommand(
                type: "image",
                name: "sample.png",
                mimeType: "image/png",
                size: 3,
                data: "AQID"
            )],
            contextRefs: nil
        )

        let data = try JSONEncoder().encode(command)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let attachments = try #require(object["attachments"] as? [[String: Any]])

        #expect(object["content"] as? String == "")
        #expect(attachments.first?["name"] as? String == "sample.png")
        #expect(attachments.first?["mimeType"] as? String == "image/png")
        #expect(attachments.first?["data"] as? String == "AQID")
    }

    @Test func encodesSteeringDelivery() throws {
        let command = AppendMessageCommand(
            clientMessageId: "client-1",
            expectedTranscriptId: "transcript-1",
            configVersion: 2,
            delivery: MessageDelivery.steer.rawValue,
            input: MessageInputCommand(content: "Adjust the answer", attachments: nil, contextRefs: nil),
            origin: MessageOriginCommand(type: "system", source: "cli")
        )

        let data = try JSONEncoder().encode(command)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect(object["delivery"] as? String == "steer")
    }

    @Test func encodesContextReferenceContract() throws {
        let command = MessageInputCommand(
            content: "Use this context",
            attachments: nil,
            contextRefs: [ContextReferenceCommand(
                kind: "note",
                sourceId: "note-1",
                expectedVersion: "42",
                title: "Release plan"
            )]
        )

        let data = try JSONEncoder().encode(command)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let references = try #require(object["contextRefs"] as? [[String: Any]])

        #expect(references.first?["kind"] as? String == "note")
        #expect(references.first?["sourceId"] as? String == "note-1")
        #expect(references.first?["expectedVersion"] as? String == "42")
    }

    @Test func encodesVersionedQueuedInputUpdate() throws {
        let data = try JSONEncoder().encode(QueuedInputUpdateCommand(version: 7, content: "Updated"))
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect(object["version"] as? Int == 7)
        #expect(object["content"] as? String == "Updated")
    }
}
