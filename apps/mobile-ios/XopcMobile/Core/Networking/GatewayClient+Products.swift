import CryptoKit
import Foundation

// swiftlint:disable file_length

private struct SpeechRequest: Encodable {
    let text: String
    let language: String
}

private struct MessageNoteCapture: Encodable {
    let text: String
    let channel = "app"
    let platform = "ios"
}

extension GatewayClient {
    func fetchHome(locale: String) async throws -> HomeSnapshot {
        try await request(path: "/api/home", queryItems: [URLQueryItem(name: "locale", value: locale)])
    }

    func performHomeAction(_ action: HomeAction) async throws {
        guard let command = action.command else {
            throw GatewayClientError.server("不支持的进展操作")
        }
        let path: String
        switch action.type {
        case "connector_decision": path = "/api/home/decisions/respond"
        case "retry_run": path = "/api/home/attention/retry"
        case "acknowledge_run": path = "/api/home/attention/acknowledge"
        default: throw GatewayClientError.server("不支持的进展操作")
        }
        let body = try encoder.encode(command)
        let result: HomeActionResult = try await request(path: path, method: "POST", body: body)
        guard result.ok else { throw GatewayClientError.server("进展操作未完成") }
    }

    func fetchNotes(search: String = "", status: String = "", projectID: String? = nil) async throws -> NotePage {
        var query = [
            URLQueryItem(name: "limit", value: "100"),
            URLQueryItem(name: "sortBy", value: "updatedAt"),
            URLQueryItem(name: "sortOrder", value: "desc")
        ]
        if !search.isEmpty {
            query.append(URLQueryItem(name: "search", value: search))
        }
        if !status.isEmpty {
            query.append(URLQueryItem(name: "status", value: status))
        }
        if let projectID {
            query.append(URLQueryItem(name: "projectId", value: projectID))
        }
        return try await request(path: "/api/notes", queryItems: query)
    }

    func fetchNote(id: String) async throws -> NoteDetail {
        let response: NoteDetailEnvelope = try await request(path: "/api/notes/\(id)")
        return response.note
    }

    func createNote(title: String, markdown: String, kind: String = "thought", projectID: String? = nil) async throws -> NoteDetail {
        let body = try encoder.encode(NoteMutation(title: title, markdown: markdown, kind: kind, platform: "ios", projectId: projectID))
        let response: NoteDetailEnvelope = try await request(path: "/api/notes", method: "POST", body: body)
        return response.note
    }

    func saveMessageAsNote(_ text: String) async throws -> NoteDetail {
        let body = try encoder.encode(MessageNoteCapture(text: text))
        let response: NoteDetailEnvelope = try await request(path: "/api/notes/quick-capture", method: "POST", body: body)
        return response.note
    }

    func updateNote(_ note: NoteDetail, title: String, markdown: String) async throws -> NoteDetail {
        let body = try encoder.encode(NoteUpdateMutation(
            title: title,
            markdown: markdown,
            status: nil,
            pinned: nil,
            expectedRevision: note.remoteVersion
        ))
        let response: NoteDetailEnvelope = try await request(path: "/api/notes/\(note.id)", method: "PATCH", body: body)
        return response.note
    }

    func updateNoteState(_ note: NoteDetail, status: String? = nil, pinned: Bool? = nil) async throws -> NoteDetail {
        let body = try encoder.encode(NoteUpdateMutation(
            title: nil,
            markdown: nil,
            status: status,
            pinned: pinned,
            expectedRevision: note.remoteVersion
        ))
        let response: NoteDetailEnvelope = try await request(
            path: "/api/notes/\(note.id)",
            method: "PATCH",
            body: body
        )
        return response.note
    }

    func fetchNoteAttachment(noteID: String, attachmentID: String) async throws -> Data {
        try await requestData(path: "/api/notes/\(noteID)/media/\(attachmentID)")
    }

    func synthesizeSpeech(text: String, language: String) async throws -> Data {
        var request = try URLRequest(url: makeURL(path: "/api/voice/speech", queryItems: []))
        request.httpMethod = "POST"
        request.httpBody = try encoder.encode(SpeechRequest(text: text, language: language))
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GatewayClientError.invalidResponse }
        guard (200 ..< 300).contains(http.statusCode) else {
            let payload = try? decoder.decode(GatewayErrorPayload.self, from: data)
            throw GatewayClientError.http(statusCode: http.statusCode, message: payload?.message)
        }
        guard !data.isEmpty else { throw GatewayClientError.invalidResponse }
        return data
    }

    func uploadNoteAttachment(noteID: String, name: String, mimeType: String, data: Data) async throws {
        let boundary = "xopc-\(UUID().uuidString.lowercased())"
        let safeName = name.replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "\r", with: "_")
            .replacingOccurrences(of: "\n", with: "_")
        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n")
        body.append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n")

        var request = try URLRequest(url: makeURL(path: "/api/notes/\(noteID)/media", queryItems: []))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }
        let (responseData, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GatewayClientError.invalidResponse }
        guard (200 ..< 300).contains(http.statusCode) else {
            let payload = try? decoder.decode(GatewayErrorPayload.self, from: responseData)
            throw GatewayClientError.http(statusCode: http.statusCode, message: payload?.message)
        }
    }

    func deleteNote(_ note: NoteDetail) async throws {
        let body = try encoder.encode(RevisionMutation(expectedRevision: note.remoteVersion))
        let _: DeleteEnvelope = try await request(path: "/api/notes/\(note.id)", method: "DELETE", body: body)
    }

    func openNoteConversation(id: String) async throws -> String {
        let body = try encoder.encode(EmptyMutation())
        let response: NoteConversationEnvelope = try await request(path: "/api/notes/\(id)/chat", method: "POST", body: body)
        return response.conversationId
    }

    func fetchTasks(projectID: String? = nil) async throws -> TaskPage {
        var query = [URLQueryItem(name: "limit", value: "100")]
        if let projectID {
            query.append(URLQueryItem(name: "projectId", value: projectID))
        }
        return try await request(path: "/api/tasks", queryItems: query)
    }

    func fetchTask(id: String) async throws -> TaskDetailEnvelope {
        try await request(path: "/api/tasks/\(id)")
    }

    func createProjectTask(projectID: String, objective: String) async throws {
        let body = try encoder.encode(ProjectTaskMutation(
            idempotencyKey: UUID().uuidString.lowercased(), title: objective, projectId: projectID,
            contract: .init(objective: objective), activation: .init(mode: "capture", phase: "backlog")
        ))
        let result: ProjectTaskCreationEnvelope = try await request(path: "/api/tasks", method: "POST", body: body)
        guard result.ok else { throw GatewayClientError.server("任务创建未完成") }
    }

    func commandTask(_ task: TaskRecord, command: String) async throws {
        let executor: TaskCommandMutation.Executor? = if command == "start", let agentID = task.delegateAgentId {
            .init(kind: "agent", agentId: agentID)
        } else {
            nil
        }
        let mutation = TaskCommandMutation(
            idempotencyKey: UUID().uuidString.lowercased(),
            expectedVersion: task.version,
            command: .init(
                type: command,
                executor: executor,
                resolution: command == "close" ? "done" : nil,
                phase: command == "reopen" ? "backlog" : nil
            )
        )
        let body = try encoder.encode(mutation)
        let _: TaskCommandAcknowledgement = try await request(
            path: "/api/tasks/\(task.id)/commands", method: "POST", body: body
        )
    }

    func fetchProjects() async throws -> ProjectPage {
        try await request(path: "/api/projects", queryItems: [URLQueryItem(name: "limit", value: "100")])
    }

    func fetchProject(id: String) async throws -> ProjectRecord {
        let response: ProjectDetailEnvelope = try await request(path: "/api/projects/\(id)")
        return response.project
    }

    func fetchProjectSessions(id: String) async throws -> [ConversationSummary] {
        let response: ProjectSessionsEnvelope = try await request(path: "/api/projects/\(id)/sessions")
        return response.sessions
    }

    func fetchAutomations(projectID: String? = nil) async throws -> [AutomationRecord] {
        let query = projectID.map { [URLQueryItem(name: "projectId", value: $0)] } ?? []
        let response: AutomationPage = try await request(path: "/api/automations", queryItems: query)
        return response.automations
    }

    func fetchAutomationMetrics() async throws -> AutomationMetrics {
        try await request(path: "/api/automations/metrics")
    }

    func fetchAutomation(id: String) async throws -> AutomationRecord {
        let response: AutomationDetailEnvelope = try await request(path: "/api/automations/\(id)")
        return response.automation
    }

    func fetchAutomationRuns(id: String) async throws -> [AutomationRunRecord] {
        let response: AutomationRunsEnvelope = try await request(
            path: "/api/automation-runs",
            queryItems: [
                URLQueryItem(name: "automationId", value: id),
                URLQueryItem(name: "limit", value: "20")
            ]
        )
        return response.runs
    }

    func fetchAutomationRun(id: String) async throws -> AutomationRunRecord {
        let response: AutomationRunDetailEnvelope = try await request(path: "/api/automation-runs/\(id)")
        return response.run
    }

    func fetchAutomationRunEvents(id: String) async throws -> [AutomationRunEvent] {
        let response: AutomationRunEventsEnvelope = try await request(path: "/api/automation-runs/\(id)/events")
        return response.events
    }

    func cancelAutomationRun(id: String) async throws {
        let response: AutomationCancelEnvelope = try await request(
            path: "/api/automation-runs/\(id)/cancel", method: "POST", body: encoder.encode(EmptyMutation())
        )
        guard response.cancelled else { throw GatewayClientError.server("未能取消此次运行") }
    }

    func rerunAutomation(id: String) async throws -> AutomationRunRecord {
        let response: AutomationRunDetailEnvelope = try await request(
            path: "/api/automation-runs/\(id)/rerun", method: "POST", body: encoder.encode(EmptyMutation())
        )
        return response.run
    }

    func createScheduledAutomation(name: String, instruction: String, cron: String, enabled: Bool = true,
                                   projectID: String? = nil) async throws -> AutomationRecord
    {
        let mutation = ScheduledAutomationMutation(
            name: name,
            trigger: .init(kind: "schedule", schedule: .init(kind: "cron", expr: cron)),
            action: .init(kind: "agent", instruction: instruction),
            enabled: enabled,
            conversationMode: "new_session",
            projectId: projectID
        )
        let body = try encoder.encode(mutation)
        let response: AutomationDetailEnvelope = try await request(path: "/api/automations", method: "POST", body: body)
        return response.automation
    }

    func updateScheduledAutomation(_ automation: AutomationRecord, name: String, instruction: String,
                                   cron: String, enabled: Bool) async throws -> AutomationRecord
    {
        let schedule = AutomationSchedule(
            kind: "cron", everyMs: nil, anchorMs: nil, cronExpression: cron,
            timeZone: automation.trigger.schedule?.timeZone, onceAt: nil
        )
        let action = AutomationAction(
            kind: "agent", instruction: instruction, goal: nil,
            agentId: automation.action.agentId, workingDirectory: automation.action.workingDirectory,
            model: automation.action.model, timeoutSeconds: automation.action.timeoutSeconds
        )
        let mutation = ScheduledAutomationUpdateMutation(
            expectedRevision: automation.updatedAtMs, name: name,
            trigger: AutomationTrigger(kind: "schedule", schedule: schedule),
            action: action, enabled: enabled
        )
        let body = try encoder.encode(mutation)
        let response: AutomationDetailEnvelope = try await request(
            path: "/api/automations/\(automation.id)", method: "PATCH", body: body
        )
        return response.automation
    }

    func setAutomation(_ automation: AutomationRecord, enabled: Bool) async throws -> AutomationRecord {
        let action = enabled ? "resume" : "pause"
        let body = try encoder.encode(RevisionMutation(expectedRevision: Int(automation.updatedAtMs)))
        let response: AutomationDetailEnvelope = try await request(
            path: "/api/automations/\(automation.id)/\(action)",
            method: "POST",
            body: body
        )
        return response.automation
    }

    func runAutomation(id: String) async throws -> String {
        let body = try encoder.encode(EmptyMutation())
        let response: AutomationRunEnvelope = try await request(path: "/api/automations/\(id)/run", method: "POST", body: body)
        guard let id = response.run?.id else { throw GatewayClientError.invalidResponse }
        return id
    }

    func fetchDefaultFileSpace() async throws -> FileSpace {
        let response: FileSpaceEnvelope = try await request(path: "/api/files/default-space")
        return response.space
    }

    func fetchFiles(spaceID: String, path: String = "") async throws -> [FileResource] {
        let response: FileResourcePage = try await request(
            path: "/api/files/spaces/\(spaceID)/children",
            queryItems: path.isEmpty ? [] : [URLQueryItem(name: "path", value: path)]
        )
        return response.items
    }

    func searchFiles(query: String) async throws -> [FileResource] {
        let response: FileResourcePage = try await request(
            path: "/api/files/search",
            queryItems: [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: "100")]
        )
        return response.items
    }

    func fetchFileText(id: String) async throws -> String {
        let data = try await requestData(path: "/api/files/\(id)/content")
        guard let value = String(data: data, encoding: .utf8) else {
            throw GatewayClientError.invalidPayload("文件不是 UTF-8 文本")
        }
        return value
    }

    func updateFileText(id: String, content: String, revision: String) async throws -> FileResource {
        let body = try encoder.encode(FileContentMutation(content: content, revision: revision))
        let response: FileResourceEnvelope = try await request(
            path: "/api/files/\(id)/content",
            method: "PUT",
            body: body
        )
        return response.resource
    }

    func uploadFile(spaceID: String, directory: String, name: String, mimeType: String, data: Data) async throws -> FileResource {
        let boundary = "xopc-ios-\(UUID().uuidString.lowercased())"
        let safeName = name.replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "\r", with: "_")
            .replacingOccurrences(of: "\n", with: "_")
        var body = Data()
        body.appendMultipart(name: "directory", value: directory, boundary: boundary)
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n")
        body.append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n")

        var request = try URLRequest(url: makeURL(path: "/api/files/spaces/\(spaceID)/upload", queryItems: []))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }
        let (responseData, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GatewayClientError.invalidResponse }
        guard (200 ..< 300).contains(http.statusCode) else {
            let payload = try? decoder.decode(GatewayErrorPayload.self, from: responseData)
            throw GatewayClientError.http(statusCode: http.statusCode, message: payload?.message)
        }
        return try decoder.decode(FileResourceEnvelope.self, from: responseData).resource
    }

    func downloadFile(_ file: FileResource) async throws -> URL {
        var request = try URLRequest(url: makeURL(path: "/api/files/\(file.id)/content", queryItems: []))
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }
        let (temporaryURL, response) = try await session.download(for: request)
        guard let http = response as? HTTPURLResponse else { throw GatewayClientError.invalidResponse }
        guard (200 ..< 300).contains(http.statusCode) else {
            throw GatewayClientError.http(statusCode: http.statusCode, message: nil)
        }
        let size = try temporaryURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= FileTransferLimit.downloadBytes else { throw FileTransferError.tooLargeForDownload }
        let directory = FileManager.default.temporaryDirectory.appending(path: "xopc-file-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appending(path: URL(fileURLWithPath: file.name).lastPathComponent)
        try FileManager.default.moveItem(at: temporaryURL, to: destination)
        return destination
    }

    func fetchMobileUserSummary() async throws -> MobileUserSummary {
        try await request(path: "/api/user-model/mobile-summary")
    }

    func createVoiceNote(audio: RecordedAudio) async throws -> NoteDetail {
        let boundary = "xopc-ios-\(UUID().uuidString)"
        var body = Data()
        body.appendMultipart(name: "kind", value: "voice", boundary: boundary)
        body.appendMultipart(name: "markdown", value: "", boundary: boundary)
        body.appendMultipart(name: "channel", value: "app", boundary: boundary)
        body.appendMultipart(name: "platform", value: "ios", boundary: boundary)
        body.appendMultipart(name: "duration", value: String(Int(audio.duration)), boundary: boundary)
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(audio.fileName)\"\r\n")
        body.append("Content-Type: \(audio.mimeType)\r\n\r\n")
        body.append(audio.data)
        body.append("\r\n--\(boundary)--\r\n")

        var request = try URLRequest(url: makeURL(path: "/api/notes", queryItems: []))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GatewayClientError.invalidResponse }
        guard (200 ..< 300).contains(http.statusCode) else {
            let payload = try? decoder.decode(GatewayErrorPayload.self, from: data)
            throw GatewayClientError.http(statusCode: http.statusCode, message: payload?.message)
        }
        do { return try decoder.decode(NoteDetailEnvelope.self, from: data).note }
        catch { throw GatewayClientError.invalidPayload(error.localizedDescription) }
    }

    func fetchDiscussionCaptureSettings() async throws -> DiscussionCaptureSettings {
        try await request(path: "/api/discussion-capture/settings")
    }

    func acknowledgeDiscussionConsent(version: Int) async throws {
        let body = try encoder.encode(DiscussionConsentCommand(consentPolicyVersion: version))
        let _: DiscussionCaptureSettings = try await request(
            path: "/api/discussion-capture/settings",
            method: "PUT",
            body: body
        )
    }

    func createDiscussion(
        consentPolicyVersion: Int,
        clientRequestID: String,
        recordedAt: Int64
    ) async throws -> DiscussionDetail {
        let body = try encoder.encode(DiscussionCreateCommand(
            clientRequestId: clientRequestID,
            consentPolicyVersion: consentPolicyVersion,
            source: "mobile",
            recordedAt: recordedAt
        ))
        return try await request(path: "/api/discussions", method: "POST", body: body)
    }

    func uploadDiscussionRecording(id: String, audio: RecordedAudio) async throws {
        let digest = SHA256.hash(data: audio.data).map { String(format: "%02x", $0) }.joined()
        var request = try URLRequest(url: makeURL(
            path: "/api/discussions/\(id)/recording/chunks/0",
            queryItems: []
        ))
        request.httpMethod = "PUT"
        request.httpBody = audio.data
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(digest, forHTTPHeaderField: "x-audio-sha256")
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GatewayClientError.invalidResponse }
        guard (200 ..< 300).contains(http.statusCode) else {
            let payload = try? decoder.decode(GatewayErrorPayload.self, from: data)
            throw GatewayClientError.http(statusCode: http.statusCode, message: payload?.message)
        }
    }

    func sealDiscussion(id: String, audio: RecordedAudio) async throws -> DiscussionRecordingJob {
        let body = try encoder.encode(DiscussionSealCommand(
            lastSequence: -1,
            chunkCount: 1,
            mimeType: audio.mimeType,
            fileName: audio.fileName,
            containerMode: "independent_wav"
        ))
        return try await request(path: "/api/discussions/\(id)/capture/seal", method: "POST", body: body)
    }

    func fetchDiscussion(noteID: String) async throws -> DiscussionDetail {
        try await request(path: "/api/discussions/by-note/\(noteID)")
    }

    func retryDiscussion(id: String) async throws -> DiscussionDetail {
        try await request(path: "/api/discussions/\(id)/retry", method: "POST", body: encoder.encode(EmptyMutation()))
    }
}

private struct HomeActionResult: Decodable {
    let ok: Bool
}

private extension Data {
    mutating func append(_ string: String) {
        append(Data(string.utf8))
    }

    mutating func appendMultipart(name: String, value: String, boundary: String) {
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        append("\(value)\r\n")
    }
}

private struct NoteUpdateMutation: Encodable {
    let title: String?
    let markdown: String?
    let status: String?
    let pinned: Bool?
    let expectedRevision: Int?
}

private struct RevisionMutation: Encodable {
    let expectedRevision: Int?
}

private struct EmptyMutation: Encodable {}

private struct FileContentMutation: Encodable {
    let content: String
    let revision: String
}

private struct DeleteEnvelope: Decodable {
    let deleted: Bool?
    let ok: Bool?
}

private struct AutomationRunEnvelope: Decodable {
    let run: AutomationRunIdentifier?
    let queued: Bool?
}

private struct AutomationRunIdentifier: Decodable {
    let id: String
}

private struct AutomationCancelEnvelope: Decodable {
    let cancelled: Bool
}

private struct ScheduledAutomationMutation: Encodable {
    let name: String
    let trigger: Trigger
    let action: Action
    let enabled: Bool
    let conversationMode: String
    let projectId: String?

    struct Trigger: Encodable {
        let kind: String
        let schedule: Schedule
    }

    struct Schedule: Encodable {
        let kind: String
        let expr: String
    }

    struct Action: Encodable {
        let kind: String
        let instruction: String
    }
}

private struct ScheduledAutomationUpdateMutation: Encodable {
    let expectedRevision: Int64
    let name: String
    let trigger: AutomationTrigger
    let action: AutomationAction
    let enabled: Bool
}

private struct TaskCommandMutation: Encodable {
    let idempotencyKey: String
    let expectedVersion: Int
    let command: Command

    struct Command: Encodable {
        let type: String
        let executor: Executor?
        let resolution: String?
        let phase: String?
    }

    struct Executor: Encodable {
        let kind: String
        let agentId: String
    }
}

private struct TaskCommandAcknowledgement: Decodable {
    let ok: Bool
}

private struct DiscussionConsentCommand: Encodable {
    let consentPolicyVersion: Int
}

private struct DiscussionCreateCommand: Encodable {
    let clientRequestId: String
    let consentPolicyVersion: Int
    let source: String
    let recordedAt: Int64
}

private struct DiscussionSealCommand: Encodable {
    let lastSequence: Int
    let chunkCount: Int
    let mimeType: String
    let fileName: String
    let containerMode: String
}
