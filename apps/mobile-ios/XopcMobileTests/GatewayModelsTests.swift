import Foundation
import Security
import Testing
@testable import XopcMobile

// swiftlint:disable:next type_body_length
struct GatewayModelsTests {
    @Test func decodesSessionContextRelations() throws {
        let summary = try JSONDecoder().decode(ConversationContextResponse.self, from: Data(#"""
        {"summary":{"conversationId":"session-1","work":{"project":{"id":"project-1","title":"Project"},
          "delegatedTasks":[{"id":"task-1","title":"Review","phase":"active","runStatus":"running"}],
          "delegatedTaskCount":1},"sources":[{"kind":"note","id":"note-1","title":"Plan",
          "origins":[{"kind":"session"},{"kind":"recent"}]}],"sourcesHasMore":false,
          "unavailableSections":[]}}
        """#.utf8)).summary

        #expect(summary.work.delegatedTaskCount == 1)
        #expect(summary.work.delegatedTasks?.first?.title == "Review")
        #expect(summary.sources.first?.kind == "note")
        #expect(summary.sources.first?.origins?.map(\.kind) == ["session", "recent"])
    }

    @Test @MainActor func storesGatewayCredentialsInSimulatorKeychain() throws {
        let account = "gateway-keychain-e2e-\(UUID().uuidString.lowercased())"
        let store = SystemGatewayTokenStore()
        defer { try? store.save("", account: account) }

        do {
            try store.save("keychain-round-trip", account: account)
        } catch GatewayConfigurationStoreError.keychain(errSecMissingEntitlement) {
            try Test.cancel("Unsigned simulator builds cannot access Keychain")
        }
        #expect(store.load(account: account) == "keychain-round-trip")
        try store.save("keychain-updated", account: account)
        #expect(store.load(account: account) == "keychain-updated")
    }

    @Test func decodesUserUnderstandingDashboardAndDetails() throws {
        let summary = try JSONDecoder().decode(MobileUserSummary.self, from: Data(#"""
        {"profile":{"callName":"小林","role":"设计师","pronouns":"","timezone":"Asia/Shanghai","locale":"zh"},
         "suggestedCallName":"小林","settings":{"memoryEnabled":true,"showMemoryReferences":true,"sensitiveWritePolicy":"confirm"},
         "counts":{"total":2,"explicit":1,"learned":1,"review":1,"workMemory":3},
         "primaryFocus":{"title":"完成原型","desiredOutcome":"可测试"},
         "goals":[{"id":"goal-1","title":"完成原型","desiredOutcome":"可测试","status":"active","targetAt":1791168000000,"isPrimary":true}],
         "recent":[{"id":"assertion-1","statement":"喜欢简洁界面","kind":"preference","status":"active","authority":"user_explicit","confidence":1}],
         "rules":[{"id":"rule-1","statement":"先展示草稿"}]}
        """#.utf8))
        #expect(summary.primaryFocus?.title == "完成原型")
        #expect(summary.goals.first?.targetAt == 1_791_168_000_000)
        #expect(summary.rules?.first?.statement == "先展示草稿")

        let page = try JSONDecoder().decode(MobileUserAssertionPage.self, from: Data(#"""
        {"items":[{"id":"assertion-1","statement":"喜欢简洁界面","kind":"preference","status":"active",
          "authority":"user_explicit","confidence":0.9,"scope":{"type":"global"},"sources":[{"label":"对话"}]}],
         "nextCursor":"next"}
        """#.utf8))
        #expect(page.items.first?.sources?.first?.label == "对话")
        #expect(page.nextCursor == "next")
    }

    @Test func readsGatewayContractPairingInvitation() throws {
        let link = "https://link.xopc.ai/c#BBEREREREUERgREREREREREHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHByIiIiIiIkIigiIiIiIiIiIJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCXDb2IABABtodHRwczovL2dhdGV3YXkuZXhhbXBsZS5jb20"
        let invitation = try GatewayPairingInvitation.parse(link)

        #expect(invitation.pairingID == "11111111-1111-4111-8111-111111111111")
        #expect(invitation.gatewayID == "22222222-2222-4222-8222-222222222222")
        #expect(invitation.origins.map(\.absoluteString) == ["https://gateway.example.com"])
        #expect(invitation.pairingToken.hasPrefix("xopc_pair_11111111-1111-4111-8111-111111111111_"))
        #expect(throws: GatewayPairingError.self) {
            try GatewayPairingInvitation.parse(link.replacingOccurrences(of: "https://link.xopc.ai/c#", with: "http://example.com/#"))
        }
    }

    @Test func signsTheGatewayContractCanonicalPairingBody() throws {
        let body: [String: Any] = [
            "gatewayId": "gateway", "requestId": "request", "pairingToken": "token",
            "timestamp": 123, "nonce": "nonce",
            "device": [
                "displayName": "iPhone", "platform": "ios",
                "publicKeyJwk": ["kty": "EC", "crv": "P-256", "x": "x", "y": "y"]
            ]
        ]
        let message = try GatewayPairingProof.message(action: "request", body: body)

        let expected = "xopc-device-pairing-v3\nPOST\nrequest\n"
            + "{\"device\":{\"displayName\":\"iPhone\",\"platform\":\"ios\",\"publicKeyJwk\":{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"x\",\"y\":\"y\"}},"
            + "\"gatewayId\":\"gateway\",\"nonce\":\"nonce\",\"pairingToken\":\"token\",\"requestId\":\"request\",\"timestamp\":123}"
        #expect(message == expected)
    }

    @Test func decodesFileSpacesForNotesLibrary() throws {
        let data = Data(#"""
        { "spaces": [{
          "id": "workspace", "title": "工作空间", "kind": "workspace",
          "writable": true, "lastActivityAt": 1791168000000
        }] }
        """#.utf8)

        let page = try JSONDecoder().decode(FileSpacesPage.self, from: data)

        #expect(page.spaces.map(\.id) == ["workspace"])
        #expect(page.spaces.first?.writable == true)
    }

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

        #expect(page.items.first?.displayName == AppLocalization.string("新对话", locale: AppLocalization.selectedLocale))
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
}

@MainActor
extension GatewayModelsTests {
    @Test func encodesVersionedQueuedInputUpdate() throws {
        let data = try JSONEncoder().encode(QueuedInputUpdateCommand(version: 7, content: "Updated"))
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect(object["version"] as? Int == 7)
        #expect(object["content"] as? String == "Updated")
    }

    @Test func conversationsSearchAndPaginateOnServer() async {
        let state = ConversationsState()
        await state.load(using: GatewayStub())
        #expect(state.visibleConversations.map(\.id) == ["conversation-1"])
        #expect(state.hasMore)
        await state.loadMore(using: GatewayStub())
        #expect(state.visibleConversations.map(\.id) == ["conversation-1", "conversation-2"])

        state.searchText = "design"
        await state.load(using: GatewayStub())

        #expect(state.visibleConversations.map(\.id) == ["conversation-2"])
        #expect(!state.hasMore)
    }
}
