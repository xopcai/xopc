import Foundation

extension GatewayClient {
    func fetchInputState(conversationID: String) async throws -> InputState {
        let envelope: GatewayEnvelope<InputState> = try await request(
            path: "/api/sessions/\(conversationID)/input-state"
        )
        guard envelope.isSuccessful, let state = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法读取待处理消息")
        }
        return state
    }

    func cancelQueuedInput(conversationID: String, input: QueuedInput) async throws -> InputState {
        let envelope: GatewayEnvelope<InputState> = try await request(
            path: "/api/sessions/\(conversationID)/inputs/\(input.id)",
            queryItems: [URLQueryItem(name: "version", value: String(input.version))],
            method: "DELETE"
        )
        guard envelope.isSuccessful, let state = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法取消待处理消息")
        }
        return state
    }

    func updateQueuedInput(
        conversationID: String,
        input: QueuedInput,
        content: String
    ) async throws -> InputState {
        let body = try encoder.encode(QueuedInputUpdateCommand(version: input.version, content: content))
        let envelope: GatewayEnvelope<InputState> = try await request(
            path: "/api/sessions/\(conversationID)/inputs/\(input.id)",
            method: "PATCH",
            body: body
        )
        guard envelope.isSuccessful, let state = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法更新待处理消息")
        }
        return state
    }

    func fetchClarification(conversationID: String) async throws -> ClarificationRequest? {
        let envelope: GatewayEnvelope<ClarificationSnapshot> = try await request(
            path: "/api/sessions/\(conversationID)/clarification"
        )
        guard envelope.isSuccessful, let snapshot = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法读取澄清请求")
        }
        return snapshot.clarification?.isOpen == true ? snapshot.clarification : nil
    }

    func respondToClarification(
        _ clarification: ClarificationRequest,
        action: String,
        answer: String?
    ) async throws {
        let body = try encoder.encode(ClarificationResponseCommand(
            action: action,
            answer: answer,
            expectedVersion: clarification.version,
            idempotencyKey: UUID().uuidString.lowercased()
        ))
        let envelope: GatewayEnvelope<IgnoredResponse> = try await request(
            path: "/api/clarifications/\(clarification.id)/responses",
            method: "POST",
            body: body
        )
        guard envelope.isSuccessful else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法提交澄清回答")
        }
    }

    func fetchModels(agentID: String) async throws -> ChatModelCatalog {
        let envelope: GatewayEnvelope<ChatModelCatalog> = try await request(
            path: "/api/models",
            queryItems: [URLQueryItem(name: "agentId", value: agentID)]
        )
        guard envelope.isSuccessful, let catalog = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法读取模型列表")
        }
        return catalog
    }

    func fetchAgentConfiguration(conversationID: String) async throws -> SessionAgentConfiguration {
        let envelope: GatewayEnvelope<SessionAgentConfiguration> = try await request(
            path: "/api/sessions/\(conversationID)/agent-config"
        )
        guard envelope.isSuccessful, let configuration = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法读取会话配置")
        }
        return configuration
    }

    func updateAgentConfiguration(
        conversationID: String,
        model: String,
        thinkingLevel: String
    ) async throws {
        let body = try encoder.encode(AgentConfigurationCommand(model: model, thinkingLevel: thinkingLevel))
        let envelope: GatewayEnvelope<SessionAgentConfiguration> = try await request(
            path: "/api/sessions/\(conversationID)/agent-config",
            method: "PATCH",
            body: body
        )
        guard envelope.isSuccessful else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法更新会话配置")
        }
    }

    func fetchProjectEnvironmentOptions(projectID: String) async throws -> ProjectEnvironmentOptions {
        let response: ProjectEnvironmentOptionsResponse = try await request(
            path: "/api/projects/\(projectID)/environment-options"
        )
        guard response.ok else { throw GatewayClientError.invalidResponse }
        return response.options
    }

    func listHostDirectories(path: String) async throws -> HostDirectories {
        let envelope: GatewayEnvelope<HostDirectories> = try await request(
            path: "/api/host/fs/list",
            queryItems: path.isEmpty ? [] : [URLQueryItem(name: "path", value: path)]
        )
        guard envelope.isSuccessful, let directories = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法读取工作目录")
        }
        return directories
    }

    func setSessionWorkingDirectory(conversationID: String, path: String) async throws {
        let body = try encoder.encode(WorkingDirectoryCommand(workingDirectory: path))
        let envelope: GatewayEnvelope<SessionAgentConfiguration> = try await request(
            path: "/api/sessions/\(conversationID)/agent-config", method: "PATCH", body: body
        )
        guard envelope.isSuccessful else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法更新工作目录")
        }
    }

    func renameConversation(id: String, name: String) async throws {
        let body = try encoder.encode(RenameConversationCommand(name: name))
        let _: IgnoredResponse = try await request(
            path: "/api/sessions/\(id)/rename",
            method: "POST",
            body: body
        )
    }

    func mutateConversation(id: String, action: ConversationMutation) async throws {
        let _: IgnoredResponse = try await request(
            path: "/api/sessions/\(id)/\(action.rawValue)",
            method: "POST",
            body: encoder.encode(EmptyCommand())
        )
    }

    func deleteConversation(id: String) async throws {
        let _: IgnoredResponse = try await request(path: "/api/sessions/\(id)", method: "DELETE")
    }
}
