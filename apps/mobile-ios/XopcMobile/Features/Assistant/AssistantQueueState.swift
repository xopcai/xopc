import Foundation

extension AssistantState {
    func queueMessage(
        _ text: String,
        attachments: [MessageAttachment] = [],
        references: [ContextReference] = [],
        delivery: MessageDelivery = .next,
        in conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async -> Bool {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !attachments.isEmpty || !references.isEmpty,
              isRunActive,
              !conversation.isDraft else { return false }
        queueError = nil
        do {
            let result = try await gateway.sendMessage(
                content,
                attachments: attachments,
                references: references,
                delivery: delivery,
                to: conversation
            )
            accept(result.inputState)
            return true
        } catch is CancellationError {
            return false
        } catch {
            queueError = error.localizedDescription
            return false
        }
    }

    func cancelQueuedInput(
        _ input: QueuedInput,
        in conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        guard !isUpdatingQueue else { return }
        isUpdatingQueue = true
        queueError = nil
        defer { isUpdatingQueue = false }
        do {
            let inputState = try await gateway.cancelQueuedInput(
                conversationID: conversation.id,
                input: input
            )
            accept(inputState)
        } catch is CancellationError {
            return
        } catch {
            queueError = error.localizedDescription
            await refreshInputState(for: conversation, using: gateway)
        }
    }

    func updateQueuedInput(
        _ input: QueuedInput,
        content: String,
        in conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        let normalizedContent = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedContent.isEmpty, !isUpdatingQueue else { return }
        isUpdatingQueue = true
        queueError = nil
        defer { isUpdatingQueue = false }
        do {
            let inputState = try await gateway.updateQueuedInput(
                conversationID: conversation.id,
                input: input,
                content: normalizedContent
            )
            accept(inputState)
        } catch is CancellationError {
            return
        } catch {
            queueError = error.localizedDescription
            await refreshInputState(for: conversation, using: gateway)
        }
    }

    func refreshInputState(
        for conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async {
        guard !conversation.isDraft else {
            pendingInputs = []
            return
        }
        do {
            try await accept(gateway.fetchInputState(conversationID: conversation.id))
            queueError = nil
        } catch is CancellationError {
            return
        } catch {
            queueError = error.localizedDescription
        }
    }

    private func accept(_ state: InputState) {
        pendingInputs = state.inputs.filter(\.isPending)
            .sorted { $0.position < $1.position }
    }
}
