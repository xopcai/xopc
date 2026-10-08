import Foundation

protocol GatewayServing: Sendable {
    func fetchAgents() async throws -> AgentCatalog
    func fetchConversations(search: String, offset: Int) async throws -> ConversationPage
    func fetchHistory(conversationID: String) async throws -> ConversationHistory
    func fetchContext(conversationID: String) async throws -> ConversationContextSummary
    func fetchModels(agentID: String) async throws -> ChatModelCatalog
    func fetchAgentConfiguration(conversationID: String) async throws -> SessionAgentConfiguration
    func updateAgentConfiguration(conversationID: String, model: String, thinkingLevel: String) async throws
    func fetchClarification(conversationID: String) async throws -> ClarificationRequest?
    func respondToClarification(_ clarification: ClarificationRequest, action: String, answer: String?) async throws
    func fetchInputState(conversationID: String) async throws -> InputState
    func searchReferences(
        kind: ContextReferenceKind,
        query: String,
        conversationID: String?
    ) async throws -> [ReferenceItem]
    func updateQueuedInput(conversationID: String, input: QueuedInput, content: String) async throws -> InputState
    func cancelQueuedInput(conversationID: String, input: QueuedInput) async throws -> InputState
    func sendMessage(
        _ text: String,
        attachments: [MessageAttachment],
        references: [ContextReference],
        delivery: MessageDelivery,
        to conversation: ConversationSelection
    ) async throws -> SessionCommandResult
    func fetchActiveRun(conversationID: String) async throws -> ActiveRun
    func abort(runID: String) async throws
    func streamRun(runID: String) -> AsyncThrowingStream<RunStreamEvent, Error>
    func streamTaskResults(conversationID: String) -> AsyncThrowingStream<RunStreamEvent, Error>
    func renameConversation(id: String, name: String) async throws
    func mutateConversation(id: String, action: ConversationMutation) async throws
    func deleteConversation(id: String) async throws
}

extension GatewayServing {
    func streamTaskResults(conversationID: String) -> AsyncThrowingStream<RunStreamEvent, Error> {
        AsyncThrowingStream { $0.finish() }
    }
}

extension GatewayClient {
    func searchReferences(
        kind: ContextReferenceKind,
        query: String,
        conversationID: String?
    ) async throws -> [ReferenceItem] {
        switch kind {
        case .note: try await searchNotes(query: query)
        case .task: try await searchTasks(query: query)
        case .file: try await searchFiles(query: query, conversationID: conversationID)
        }
    }

    private func searchNotes(query: String) async throws -> [ReferenceItem] {
        let response: NoteReferencePage = try await request(
            path: "/api/notes",
            queryItems: [
                URLQueryItem(name: "limit", value: "50"),
                URLQueryItem(name: "sortBy", value: "updatedAt"),
                URLQueryItem(name: "sortOrder", value: "desc"),
                URLQueryItem(name: "search", value: query)
            ]
        )
        return response.items.compactMap { note in
            guard note.status != "trashed" else { return nil }
            return ReferenceItem(
                kind: .note,
                id: note.id,
                title: note.title.nonEmpty ?? note.snippet.nonEmpty ?? "未命名笔记",
                description: note.snippet ?? "",
                version: String(note.updatedAt)
            )
        }
    }

    private func searchTasks(query: String) async throws -> [ReferenceItem] {
        let response: TaskReferencePage = try await request(
            path: "/api/tasks",
            queryItems: [URLQueryItem(name: "search", value: query)]
        )
        return response.items.map { item in
            ReferenceItem(
                kind: .task,
                id: item.task.id,
                title: item.task.title,
                description: item.task.body ?? "",
                version: String(item.task.version)
            )
        }
    }

    private func searchFiles(query: String, conversationID: String?) async throws -> [ReferenceItem] {
        guard let conversationID else {
            throw GatewayClientError.server("发送第一条消息后才能引用会话文件")
        }
        let context: FileSpaceContext = try await request(path: "/api/files/contexts/session/\(conversationID)")
        let response: FileReferencePage = if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            try await request(path: "/api/files/spaces/\(context.space.id)/children")
        } else {
            try await request(path: "/api/files/search", queryItems: [
                URLQueryItem(name: "limit", value: "50"),
                URLQueryItem(name: "spaceId", value: context.space.id),
                URLQueryItem(name: "q", value: query)
            ])
        }
        return response.items.compactMap { file in
            guard file.kind != "directory" else { return nil }
            return ReferenceItem(
                kind: .file,
                id: file.id,
                title: file.name,
                description: file.relativePath,
                version: file.revision
            )
        }
    }
}

private struct NoteReferencePage: Decodable {
    let items: [NoteReferenceRecord]
}

private struct NoteReferenceRecord: Decodable {
    let id: String
    let title: String?
    let status: String
    let snippet: String?
    let updatedAt: Int
}

private struct TaskReferencePage: Decodable {
    let items: [TaskReferenceResult]
}

private struct TaskReferenceResult: Decodable {
    let task: TaskReferenceRecord
}

private struct TaskReferenceRecord: Decodable {
    let id: String
    let title: String
    let body: String?
    let version: Int
}

private struct FileSpaceContext: Decodable {
    let space: FileSpaceRecord
}

private struct FileSpaceRecord: Decodable {
    let id: String
}

private struct FileReferencePage: Decodable {
    let items: [FileReferenceRecord]
}

private struct FileReferenceRecord: Decodable {
    let id: String
    let name: String
    let relativePath: String
    let revision: String
    let kind: String
}

private extension String? {
    var nonEmpty: String? {
        let value = self?.trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }
}

struct GatewayClient: GatewayServing, Sendable {
    let configuration: GatewayConfiguration
    let session: URLSession
    let decoder: JSONDecoder

    init(
        configuration: GatewayConfiguration,
        session: URLSession = .shared
    ) {
        self.configuration = configuration
        self.session = session
        decoder = JSONDecoder()
    }

    func fetchAgents() async throws -> AgentCatalog {
        let envelope: GatewayEnvelope<AgentCatalog> = try await request(path: "/api/agents")
        guard envelope.isSuccessful, let catalog = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法读取助手列表")
        }
        return catalog
    }

    func fetchConversations(search: String = "", offset: Int = 0) async throws -> ConversationPage {
        var query = [
            URLQueryItem(name: "limit", value: "50"),
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "channel", value: "webchat"),
            URLQueryItem(name: "sortBy", value: "updatedAt"),
            URLQueryItem(name: "sortOrder", value: "desc")
        ]
        if !search.isEmpty {
            query.append(URLQueryItem(name: "search", value: search))
        }
        return try await request(path: "/api/sessions", queryItems: query)
    }

    func fetchHistory(conversationID: String) async throws -> ConversationHistory {
        try await request(
            path: "/api/sessions/\(conversationID)/history",
            queryItems: [
                URLQueryItem(name: "limit", value: "50")
            ]
        )
    }

    func fetchExecutionDetail(conversationID: String, turnID: String) async throws -> ExecutionDetail {
        let response: ExecutionDetailEnvelope = try await request(
            path: "/api/sessions/\(conversationID)/execution-detail",
            queryItems: [URLQueryItem(name: "turnId", value: turnID)]
        )
        guard response.detail.turnId == turnID else {
            throw GatewayClientError.invalidResponse
        }
        return response.detail
    }

    func fetchContext(conversationID: String) async throws -> ConversationContextSummary {
        let response: ConversationContextResponse = try await request(
            path: "/api/sessions/\(conversationID)/context-summary"
        )
        return response.summary
    }

    func fetchActiveRun(conversationID: String) async throws -> ActiveRun {
        let envelope: GatewayEnvelope<ActiveRun> = try await request(path: "/api/sessions/\(conversationID)/run")
        guard envelope.isSuccessful, let run = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法读取执行状态")
        }
        return run
    }

    func abort(runID: String) async throws {
        let body = try encoder.encode(AbortCommand(runId: runID))
        let envelope: GatewayEnvelope<AbortResult> = try await request(
            path: "/api/agent/abort",
            method: "POST",
            body: body
        )
        guard envelope.isSuccessful else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法停止执行")
        }
    }

    func streamRun(runID: String) -> AsyncThrowingStream<RunStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let clientID = "ios:\(UUID().uuidString.lowercased())"
                    let ticket = try await issueRealtimeTicket(clientID: clientID)
                    let socket = RealtimeRunSocket(
                        configuration: configuration,
                        session: session,
                        ticket: ticket.ticket,
                        clientID: clientID,
                        runID: runID
                    )
                    try await socket.consume(into: continuation)
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func streamTaskResults(conversationID: String) -> AsyncThrowingStream<RunStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let clientID = "ios-results:\(UUID().uuidString.lowercased())"
                    let ticket = try await issueRealtimeTicket(clientID: clientID)
                    let socket = RealtimeRunSocket(configuration: configuration, session: session,
                        ticket: ticket.ticket, clientID: clientID, runID: "", conversationID: conversationID)
                    try await socket.consume(into: continuation)
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func issueRealtimeTicket(clientID: String) async throws -> RealtimeTicket {
        let body = try encoder.encode(RealtimeTicketCommand(
            clientId: clientID,
            clientKind: "mobile",
            protocolVersion: 2
        ))
        let envelope: GatewayEnvelope<RealtimeTicket> = try await request(
            path: "/api/realtime/tickets",
            method: "POST",
            body: body
        )
        guard envelope.isSuccessful, let ticket = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法建立实时连接")
        }
        guard ticket.realtime.minVersion <= 2, ticket.realtime.maxVersion >= 2 else {
            throw GatewayClientError.server("当前 Gateway 与 iOS 客户端的实时协议版本不兼容")
        }
        return ticket
    }

    func request<Response: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        method: String = "GET",
        body: Data? = nil
    ) async throws -> Response {
        let url = try makeURL(path: path, queryItems: queryItems)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.setValue(Locale.preferredLanguages.first, forHTTPHeaderField: "Accept-Language")
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw GatewayClientError.transport
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayClientError.invalidResponse
        }
        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            let body = try? decoder.decode(GatewayErrorPayload.self, from: data)
            throw GatewayClientError.http(
                statusCode: httpResponse.statusCode,
                message: body?.message
            )
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw GatewayClientError.invalidPayload(error.localizedDescription)
        }
    }

    func requestData(
        path: String,
        queryItems: [URLQueryItem] = []
    ) async throws -> Data {
        let url = try makeURL(path: path, queryItems: queryItems)
        var request = URLRequest(url: url)
        request.setValue(Locale.preferredLanguages.first, forHTTPHeaderField: "Accept-Language")
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw GatewayClientError.transport
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayClientError.invalidResponse
        }
        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            let body = try? decoder.decode(GatewayErrorPayload.self, from: data)
            throw GatewayClientError.http(statusCode: httpResponse.statusCode, message: body?.message)
        }
        return data
    }

    var encoder: JSONEncoder {
        JSONEncoder()
    }

    func makeURL(path: String, queryItems: [URLQueryItem]) throws -> URL {
        guard var components = URLComponents(
            url: configuration.baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        ) else {
            throw GatewayClientError.invalidURL
        }
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else {
            throw GatewayClientError.invalidURL
        }
        return url
    }
}

enum GatewayClientError: LocalizedError, Equatable {
    case invalidURL
    case invalidResponse
    case invalidPayload(String)
    case http(statusCode: Int, message: String?)
    case server(String)
    case transport

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            AppLocalization.resolve("Gateway 地址无效")
        case .invalidResponse:
            AppLocalization.resolve("Gateway 返回了无效响应")
        case let .invalidPayload(message):
            AppLocalization.resolve("无法解析 Gateway 响应：\(message)")
        case let .http(statusCode, message):
            message ?? AppLocalization.resolve("Gateway 请求失败（\(statusCode)）")
        case let .server(message):
            NSLocalizedString(message, comment: "Gateway error returned or generated at runtime")
        case .transport:
            AppLocalization.resolve("无法连接 Gateway，请检查地址、网络和服务状态")
        }
    }
}
