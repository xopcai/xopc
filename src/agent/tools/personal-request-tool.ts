import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { personalCapabilities } from '../../personal-agent/capability-service.js';
import { getPersonalRequest, listPersonalRequests } from '../../personal-agent/request-repository.js';
import { cancelPersonalRequest, personalRequestSnapshot, publishPersonalRequest, submitPersonalRequest } from '../../personal-agent/request-service.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { cancelPersonalTask } from '../../personal-agent/task-cancel.js';
import { TaskAllocationRepository } from '../../tasks/task-allocation-repository.js';
import { boundedPersonalResult } from './personal-result-budget.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import type { XopcUseToolDeps } from './xopc-use-tool.js';

const CapabilitySchema = Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }), accountId: Type.Optional(Type.String()) });
const RequestSchema = Type.Object({
  command: Type.Union(['submit', 'get', 'list', 'cancel'].map(command => Type.Literal(command))),
  requestId: Type.Optional(Type.String()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  connectorId: Type.Optional(Type.String()),
  accountId: Type.Optional(Type.String()),
  objective: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  timeRange: Type.Optional(Type.Object({ from: Type.String(), to: Type.String(), timezone: Type.String(), expression: Type.String() })),
}, { additionalProperties: false, anyOf: [
  { properties: { command: { const: 'submit' } }, required: ['objective', 'connectorId'] },
  { properties: { command: { const: 'list' } } },
  { properties: { command: { enum: ['get', 'cancel'] } }, required: ['requestId'] },
] });
export function createPersonalRequestTools(deps: XopcUseToolDeps): AgentTool[] {
  const conversation = () => {
    const id = deps.getCurrentConversationId?.();
    if (!id || !isPersonalConversation(id)) throw new Error('Personal conversation is required');
    return id;
  };
  const snapshot = (request: Parameters<typeof personalRequestSnapshot>[0]) => {
    const value = personalRequestSnapshot(request);
    return { ...value, executorAgentId: value.parameters.allocate && value.executorAgentId === 'task-router' ? undefined : value.executorAgentId,
      ...(value.taskId ? { allocation: new TaskAllocationRepository().summary(value.taskId) } : {}) };
  };
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
  const capabilityTool: AgentTool<typeof CapabilitySchema> = {
    name: 'personal_capability', label: 'Connected app availability', parameters: CapabilitySchema,
    description: 'Check connected-app capabilities, account connection state and specialist Agents locally. The background Task Router selects an executor within account permissions; do not compare executor profiles in the main conversation. For Gmail or other supported apps, check here before delegating. ready is a local preflight; the worker still validates live tools. No remote search or authorization is performed.',
    async execute(_id, input) { return result(personalCapabilities(conversation(), input.query, input.accountId).map(({ executorProfiles: _profiles, executorAgentIds, accounts, ...capability }) => ({ ...capability, eligibleExecutorCount: executorAgentIds.length, accounts: accounts.map(({ executorAgentIds: _ids, ...account }) => account) }))); },
  };
  const requestTool: AgentTool<typeof RequestSchema> = {
    name: 'personal_request', label: 'Connected app request', parameters: RequestSchema,
    description: 'Submit a read-only connected-app request using the exact connectorId from personal_capability. The background Task Router chooses an executor after account authorization. Preserves the objective, displays connection or account selection in this main chat, and starts a specialist Task automatically once connected. Return quickly after submission. Never claim data was read until the Task result arrives. Resolve absolute query dates and include timeRange. If mail has no user-specified range, the host returns an explicit last-7-days default; mention that range in your confirmation. Use paginated get/list for status without polling; preserve idempotencyKey on uncertain retries; cancel only when the user requests it.',
    async execute(toolCallId, input) {
      const conversationId = conversation();
      if (input.command === 'list') {
        const offset = input.offset ?? 0;
        const items = listPersonalRequests(conversationId, input.limit ?? 10, offset).map(request => {
          const { result: _result, ...summary } = snapshot(request); return summary;
        });
        const total = (getSqliteDatabase().prepare('SELECT count(*) AS count FROM personal_requests WHERE conversation_id = ?').get(conversationId) as { count: number }).count;
        return result(boundedPersonalResult({ items, total, offset }));
      }
      if (input.command === 'submit') {
        if (!input.objective?.trim() || !input.connectorId ) throw new Error('objective and connectorId are required');
        const request = submitPersonalRequest({ conversationId, connectorId: input.connectorId,
          accountId: input.accountId, objective: input.objective.trim(), timeRange: input.timeRange,
          idempotencyKey: input.idempotencyKey ?? toolCallId });
        publishPersonalRequest(request);
        deps.dispatchTaskRuns?.();
        return result(boundedPersonalResult(snapshot(request)));
      }
      const request = input.requestId ? getPersonalRequest(input.requestId) : undefined;
      if (!request || request.conversationId !== conversationId) throw new Error('Request does not belong to this conversation');
      if (input.command === 'cancel') {
        if (['completed', 'failed'].includes(personalRequestSnapshot(request).state)) return result(boundedPersonalResult(snapshot(request)));
        if (request.state === 'cancelled') {
          const stop = request.taskId ? await cancelPersonalTask(request.taskId, conversationId, input.idempotencyKey ?? toolCallId) : { executionStopConfirmed: true };
          return result({ ...snapshot(request), executionStopConfirmed: stop.executionStopConfirmed });
        }
        const stop = request.taskId ? await cancelPersonalTask(request.taskId, conversationId, input.idempotencyKey ?? toolCallId) : { executionStopConfirmed: true };
        const cancelled = cancelPersonalRequest(request);
        publishPersonalRequest(cancelled);
        return result({ ...cancelled, executionStopConfirmed: stop.executionStopConfirmed });
      }
      return result(boundedPersonalResult(snapshot(request)));
    },
  };
  return [capabilityTool, requestTool];
}
