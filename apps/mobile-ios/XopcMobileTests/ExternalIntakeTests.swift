import Foundation
import Testing
@testable import XopcMobile

struct ExternalIntakeTests {
    @Test func capturesBytesAndKeepsExistingDraftAcrossRestartAndReplay() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("original file.txt")
        try Data("original bytes".utf8).write(to: source)
        let intake = ExternalIntakeStore(baseDirectory: root)
        let batch = try intake.capture([source])
        try Data("changed".utf8).write(to: source)
        let recovered = try #require(intake.pending().first)
        #expect(recovered.id == batch.id)
        #expect(try intake.data(recovered.files[0], in: recovered) == Data("original bytes".utf8))
        let ref = ContextReference(kind: .note, sourceId: "note", expectedVersion: "1", title: "Reference")
        let original = SavedComposerDraft(text: "my question", references: [ref])
        let combined = try original.addingExternalFiles(recovered, store: intake)
        #expect(combined.text == original.text)
        #expect(combined.references == [ref])
        #expect(combined.attachments.count == 1)
        let drafts = ComposerDraftStore(baseDirectory: root)
        try drafts.save(combined, scope: "account:conversation")
        let restored = try drafts.read("account:conversation")
        #expect(try restored.addingExternalFiles(recovered, store: intake) == combined)
        #expect(try drafts.read("other-account:conversation").attachments.isEmpty)
        let configuration = try GatewayConfiguration(baseURL: #require(URL(string: "https://example.test")), token: "token", localIdentity: "stable-profile")
        let selection = ConversationSelection.draft(agentId: "agent", id: UUID().uuidString.lowercased())
        try drafts.saveSelection(selection, configuration: configuration)
        #expect(try drafts.readSelection(configuration: configuration) == selection)
        try intake.remove(recovered.id)
        #expect(try intake.pending().isEmpty)
    }

    @Test func stableProfileScopeSurvivesTokenAndRouteRefresh() throws {
        let first = try GatewayConfiguration(baseURL: #require(URL(string: "https://first.example")), token: "old", localIdentity: "profile-a")
        let refreshed = try GatewayConfiguration(baseURL: #require(URL(string: "https://second.example")), token: "new", localIdentity: "profile-a")
        let other = GatewayConfiguration(baseURL: first.baseURL, token: "old", localIdentity: "profile-b")
        #expect(ComposerDraftStore.accountScope(first) == ComposerDraftStore.accountScope(refreshed))
        #expect(ComposerDraftStore.accountScope(first) != ComposerDraftStore.accountScope(other))
    }

    @Test func rejectsDirectoriesAndEmptyFilesWithVisibleErrors() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("empty.txt")
        try Data().write(to: source)
        let store = ExternalIntakeStore(baseDirectory: root)
        let batch = try store.capture([source, root])
        #expect(batch.files.isEmpty)
        #expect(batch.errors.count == 2)
    }
}
