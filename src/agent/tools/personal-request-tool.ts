import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { personalCapabilities } from '../../personal-agent/capability-service.js';
import { getPersonalRequest, listPersonalRequests } from '../../personal-agent/request-repository.js';
import { cancelPersonalRequest, personalRequestSnapshot, publishPersonalRequest, submitPersonalRequest } from '../../personal-agent/request-service.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import type { XopcUseToolDeps } from './xopc-use-tool.js';

const CapabilitySchema = Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }), accountId: Type.Optional(Type.String()) });
const RequestSchema = Type.Object({
  command: Type.Union(['submit', 'get', 'list', 'cancel'].map(command => Type.Literal(command))),
  requestId: Type.Optional(Type.String()),
  connectorId: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  accountId: Type.Optional(Type.String()),
  objective: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  timeRange: Type.Optional(Type.Object({ from: Type.String(), to: Type.String(), timezone: Type.String(), expression: Type.String() })),
});
export function createPersonalRequestTools(deps: XopcUseToolDeps): AgentTool[] {
  const conversation = () => {
    const id = deps.getCurrentConversationId?.();
    if (!id || !isPersonalConversation(id)) throw new Error('Personal conversation is required');
    return id;
  };
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
  const capabilityTool: AgentTool<typeof CapabilitySchema> = {
    name: 'personal_capability', label: 'Connected app availability', parameters: CapabilitySchema,
    description: 'Check connected-app capabilities, account connection state and specialist Agents locally. For Gmail or other supported apps, check here before delegating. ready is a local preflight; the worker still validates live tools. No remote search or authorization is performed.',
    async execute(_id, input) { return result(personalCapabilities(conversation(), input.query, input.accountId)); },
  };
  const requestTool: AgentTool<typeof RequestSchema> = {
    name: 'personal_request', label: 'Connected app request', parameters: RequestSchema,
    description: 'Submit a read-only connected-app request using exact connectorId and agentId from personal_capability. Preserves the objective, displays connection or account selection in this main chat, and starts a specialist Task automatically once connected. Return quickly after submission. Never claim data was read until the Task result arrives. Resolve absolute query dates and include timeRange. If mail has no user-specified range, the host returns an explicit last-7-days default; mention that range in your confirmation. Use get/list for status, cancel only when the user requests it.',
    async execute(toolCallId, input) {
      const conversationId = conversation();
      if (input.command === 'list') return result(listPersonalRequests(conversationId).map(personalRequestSnapshot));
      if (input.command === 'submit') {
        if (!input.objective?.trim() || !input.connectorId || !input.agentId) throw new Error('objective, connectorId and agentId are required');
        const request = submitPersonalRequest({ conversationId, connectorId: input.connectorId, agentId: input.agentId,
          accountId: input.accountId, objective: input.objective.trim(), timeRange: input.timeRange,
          idempotencyKey: input.idempotencyKey ?? toolCallId });
        publishPersonalRequest(request);
        deps.dispatchTaskRuns?.();
        return result(personalRequestSnapshot(request));
      }
      const request = input.requestId ? getPersonalRequest(input.requestId) : undefined;
      if (!request || request.conversationId !== conversationId) throw new Error('Request does not belong to this conversation');
      if (input.command === 'cancel') {
        const cancelled = cancelPersonalRequest(request);
        publishPersonalRequest(cancelled);
        return result({ ...cancelled, executionStopConfirmed: false });
      }
      return result(personalRequestSnapshot(request));
    },
  };
  return [capabilityTool, requestTool];
}
