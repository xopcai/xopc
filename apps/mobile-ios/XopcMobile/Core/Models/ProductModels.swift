import Foundation

// swiftlint:disable file_length

struct NotePage: Decodable, Sendable {
    let items: [NoteSummary]
    let total: Int
    let hasMore: Bool
}

struct NoteSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String?
    let kind: String
    let status: String
    let createdAt: Int64
    let updatedAt: Int64
    let tags: [String]?
    let snippet: String?
    let voiceAttachmentId: String?
    let voiceDurationSec: Double?
    let attachmentNames: [String]?

    var displayTitle: String {
        title?.trimmedNonEmpty ?? snippet?.trimmedNonEmpty
            ?? AppLocalization.string("未命名笔记", locale: AppLocalization.selectedLocale)
    }
}

struct NoteDetailEnvelope: Decodable, Sendable {
    let note: NoteDetail
}

struct NoteDetail: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let markdown: String
    let kind: String
    let status: String
    let createdAt: Int64
    let updatedAt: Int64
    let tags: [String]?
    let pinned: Bool?
    let remoteVersion: Int?
    let attachments: [NoteAttachment]?
}

struct NoteAttachment: Decodable, Identifiable, Sendable {
    let id: String
    let type: String
    let mimeType: String
    let fileName: String
    let size: Int
    let duration: Double?
    let transcript: String?
}

struct NoteConversationEnvelope: Decodable, Sendable {
    let conversationId: String
}

struct DiscussionCaptureSettings: Decodable, Sendable {
    let consentPolicyVersion: Int
    let consentAcknowledgedAt: Int64?
}

struct DiscussionDetail: Decodable, Sendable {
    let discussion: DiscussionCapture
    let note: NoteDetail
    let transcript: DiscussionTranscript
    let recordingJob: DiscussionRecordingJob?
    var organization: DiscussionOrganizationRecord?
}

struct DiscussionOrganizationRecord: Decodable, Sendable {
    let status: String
    let organization: DiscussionOrganization?
}

struct DiscussionOrganization: Decodable, Sendable {
    let summary: String
    let keyPoints: [String]
    let decisions: [DiscussionFact]
    let actionItems: [DiscussionActionItem]
    let risks: [DiscussionFact]
    let openQuestions: [DiscussionFact]
}

struct DiscussionFact: Decodable, Identifiable, Sendable {
    let id: String
    let text: String
    let ignored: Bool?
}

struct DiscussionActionItem: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let ignored: Bool?
}

struct DiscussionCapture: Decodable, Sendable {
    let id: String
    let noteId: String
    let status: String
    let durationMs: Int64?
    let audioAttachmentId: String?
    let failureStage: String?
    let failureMessage: String?
    let updatedAt: Int64
}

struct DiscussionTranscript: Decodable, Sendable {
    let revision: Int
    let segments: [DiscussionTranscriptSegment]
    let text: String
    let stats: DiscussionTranscriptStats
}

struct DiscussionTranscriptSegment: Decodable, Identifiable, Sendable {
    let sequence: Int
    let status: String
    var startedAtMs: Int64?
    let rawText: String?
    let displayText: String?
    let speakerLabel: String?
    let lastError: String?

    var id: Int {
        sequence
    }
}

struct DiscussionTranscriptStats: Decodable, Sendable {
    let expected: Int?
    let uploaded: Int
    let transcribing: Int
    let confirmed: Int
    let failed: Int
}

struct DiscussionRecordingJob: Decodable, Sendable {
    let state: String
    let error: String?
}

struct HomeSnapshot: Decodable, Sendable {
    let needsUser: [HomeItem]
    let background: [HomeItem]
    let backgroundCount: Int
}

struct HomeItem: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let summary: String
    let statusLabel: String?
    let recommendation: String?
    let openAction: HomeAction?
    let primaryAction: HomeAction?
    let secondaryActions: [HomeAction]?
}

struct HomeAction: Decodable, Identifiable, Sendable {
    let type: String
    let label: String
    let href: String?
    let approvalId: String?
    let decision: String?
    let subjectKind: String?
    let runId: String?

    var id: String {
        [type, label, href ?? "", approvalId ?? "", decision ?? "", subjectKind ?? "", runId ?? ""]
            .joined(separator: "|")
    }

    var command: HomeActionCommand? {
        if type == "connector_decision", let approvalId,
           decision == "approve" || decision == "deny"
        {
            return HomeActionCommand(kind: "connector_approval", runId: nil, approvalId: approvalId, decision: decision)
        }
        if type == "retry_run" || type == "acknowledge_run", let runId, let subjectKind,
           subjectKind == "automation_run" || subjectKind == "workflow_run"
        {
            return HomeActionCommand(kind: subjectKind, runId: runId, approvalId: nil, decision: nil)
        }
        return nil
    }
}

struct HomeActionCommand: Encodable, Equatable, Sendable {
    let kind: String
    let runId: String?
    let approvalId: String?
    let decision: String?
}

struct TaskPage: Decodable, Sendable {
    let ok: Bool
    let items: [TaskListItem]
    let total: Int
}

struct TaskListItem: Decodable, Identifiable, Hashable, Sendable {
    let task: TaskRecord
    let operationalState: String
    var id: String {
        task.id
    }
}

struct TaskRecord: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let version: Int
    let title: String
    let body: String?
    let phase: String
    let resolution: String?
    let priority: String?
    let projectId: String?
    let delegateAgentId: String?
    let createdAt: Int64
    let updatedAt: Int64
    let closedAt: Int64?
    let contract: TaskContract?
}

struct TaskContract: Decodable, Hashable, Sendable {
    let objective: String?
    let expectedOutputs: [String]?
    let acceptanceCriteria: [String]?
    let constraints: [String]?
}

struct TaskDetailEnvelope: Decodable, Sendable {
    let ok: Bool
    let task: TaskRecord
    let operationalState: String
    let allowedCommands: [String]?
    let runs: [TaskRun]?
    let receipts: [TaskReceipt]?
    let conversation: TaskConversation?
}

struct TaskRun: Decodable, Identifiable, Sendable {
    let id: String
    let status: String
    let attempt: Int
    let conversationId: String?
    let queuedAt: Int64?
    let startedAt: Int64?
    let completedAt: Int64?
}

struct TaskReceipt: Decodable, Identifiable, Sendable {
    let runId: String
    let status: String
    let summary: String?
    let remainingWork: [String]?
    let needsUser: Bool?
    var id: String {
        runId
    }
}

struct TaskConversation: Decodable, Sendable {
    let activeConversationId: String?
}

struct ProjectPage: Decodable, Sendable {
    let ok: Bool
    let items: [ProjectRecord]
    let total: Int
    let hasMore: Bool
}

struct ProjectRecord: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let status: String
    let health: String?
    let description: String?
    let brief: String?
    let defaultAgentId: String?
    let workspaceRoot: String?
    let executionMode: String?
    let updatedAt: Int64
    let sessionCount: Int?
    let taskCount: Int?
    let activeTaskCount: Int?
}

struct ProjectDetailEnvelope: Decodable, Sendable {
    let ok: Bool
    let project: ProjectRecord
}

struct ProjectSessionsEnvelope: Decodable, Sendable {
    let ok: Bool
    let sessions: [ConversationSummary]
}

struct AutomationPage: Decodable, Sendable {
    let automations: [AutomationRecord]
}

struct AutomationMetrics: Decodable, Sendable {
    let nextRun: AutomationNextRun?
}

struct AutomationNextRun: Decodable, Sendable {
    let automationId: String
    let name: String
    let runAtMs: Int64
}

struct AutomationRecord: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let description: String?
    let enabled: Bool
    let trigger: AutomationTrigger
    let action: AutomationAction
    let conversationMode: String?
    let state: AutomationState?
    let createdAtMs: Int64
    let updatedAtMs: Int64
}

struct AutomationAction: Codable, Hashable, Sendable {
    let kind: String
    let instruction: String?
    let goal: String?
    let agentId: String?
    let workingDirectory: String?
    let model: String?
    let timeoutSeconds: Int?
}

struct AutomationTrigger: Codable, Hashable, Sendable {
    let kind: String
    let schedule: AutomationSchedule?
}

struct AutomationSchedule: Codable, Hashable, Sendable {
    let kind: String
    let everyMs: Int64?
    let anchorMs: Int64?
    let cronExpression: String?
    let timeZone: String?
    let onceAt: String?

    enum CodingKeys: String, CodingKey {
        case kind, everyMs, anchorMs
        case cronExpression = "expr"
        case timeZone = "tz"
        case onceAt = "at"
    }
}

struct AutomationState: Decodable, Hashable, Sendable {
    let nextRunAtMs: Int64?
    let lastRunAtMs: Int64?
    let lastRunStatus: String?
    let consecutiveFailures: Int?
}

struct AutomationDetailEnvelope: Decodable, Sendable {
    let automation: AutomationRecord
}

struct AutomationRunsEnvelope: Decodable, Sendable {
    let runs: [AutomationRunRecord]
}

struct AutomationRunRecord: Decodable, Identifiable, Sendable {
    let id: String
    let automationId: String
    let automationName: String
    let status: String
    let summary: String?
    let error: String?
    let conversationId: String?
    let workflowRunId: String?
    let createdAtMs: Int64
    let startedAtMs: Int64?
    let endedAtMs: Int64?
    let durationMs: Int64?

    var isActive: Bool {
        ["queued", "running", "cancelling"].contains(status)
    }

    var canRerun: Bool {
        ["failed", "timeout", "cancelled"].contains(status)
    }
}

struct AutomationRunDetailEnvelope: Decodable, Sendable {
    let run: AutomationRunRecord
}

struct AutomationRunEventsEnvelope: Decodable, Sendable {
    let events: [AutomationRunEvent]
}

struct AutomationRunEvent: Decodable, Identifiable, Sendable {
    let id: String
    let message: String
    let createdAtMs: Int64
}

struct FileSpaceEnvelope: Decodable, Sendable {
    let space: FileSpace
}

struct FileSpacesPage: Decodable, Sendable {
    let spaces: [FileSpace]
}

struct FileSpace: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let kind: String
    let writable: Bool
    let lastActivityAt: Int64
}

struct FileResourcePage: Decodable, Sendable {
    let items: [FileResource]
}

struct FileResourceEnvelope: Decodable, Sendable {
    let resource: FileResource
}

struct FileResource: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let spaceId: String
    let name: String
    let relativePath: String
    let parentPath: String
    let kind: String
    let mimeType: String
    let size: Int
    let modifiedAt: Int64
    let revision: String
    let capabilities: [String]
}

struct MobileUserSummary: Decodable, Sendable {
    let profile: MobileUserProfile
    let suggestedCallName: String?
    let settings: MobileUserSettings
    let counts: MobileUserCounts
    let goals: [MobileUserGoal]
    let recent: [MobileUserAssertion]
}

struct MobileUserProfile: Decodable, Sendable {
    let callName: String?
    let role: String?
    let pronouns: String?
    let timezone: String?
    let locale: String?
}

struct MobileUserSettings: Decodable, Sendable {
    let memoryEnabled: Bool
    let showMemoryReferences: Bool
    let sensitiveWritePolicy: String
}

struct MobileUserCounts: Decodable, Sendable {
    let total: Int
    let explicit: Int
    let learned: Int
    let review: Int
    let workMemory: Int
}

struct MobileUserGoal: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let desiredOutcome: String?
    let status: String
    let isPrimary: Bool?
}

struct MobileUserAssertion: Decodable, Identifiable, Sendable {
    let id: String
    let statement: String
    let kind: String
    let status: String
    let confidence: Double?
}

extension Int64 {
    var millisecondsDate: Date {
        Date(timeIntervalSince1970: Double(self) / 1000)
    }
}

private extension String {
    var trimmedNonEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
