import Foundation
import Testing
@testable import XopcMobile

struct ProjectCreationTests {
    @Test func projectCreationPayloadsKeepTheirProjectAssociation() throws {
        let note = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NoteMutation(
            title: "计划", markdown: "正文", kind: "thought", platform: "ios", projectId: "project-1"
        ))) as? [String: Any]
        #expect(note?["projectId"] as? String == "project-1")

        let task = ProjectTaskMutation(
            idempotencyKey: "request-1", title: "完成迁移", projectId: "project-1",
            contract: .init(objective: "完成迁移"), activation: .init(mode: "capture", phase: "backlog")
        )
        let body = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(task)) as? [String: Any])
        #expect(body["projectId"] as? String == "project-1")
        #expect(body["idempotencyKey"] as? String == "request-1")
        #expect((body["contract"] as? [String: Any])?["objective"] as? String == "完成迁移")
        #expect((body["activation"] as? [String: Any])?["mode"] as? String == "capture")
    }

    @Test func taskUpdateCarriesRevisionAndEditableFields() throws {
        let data = try JSONEncoder().encode(TaskUpdateMutation(
            expectedVersion: 7, title: "新标题", body: "新说明", priority: "high"
        ))
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["expectedVersion"] as? Int == 7)
        #expect(body["title"] as? String == "新标题")
        #expect(body["body"] as? String == "新说明")
        #expect(body["priority"] as? String == "high")
    }
}
