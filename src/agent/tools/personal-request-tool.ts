import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { personalCapabilities } from '../../personal-agent/capability-service.js';
import { selectionRequestHash } from '../../agent-matching/selection-repository.js';
import { getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getActiveConnectionWait, reviseCurrentConnectionObjective, updateConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { updatePersonalRequest, getPersonalRequest, listPersonalRequests } from '../../personal-agent/request-repository.js';
import { assertPersonalRequestTimeRange, cancelPersonalRequest, personalRequestSnapshot, publishPersonalRequest, submitPersonalRequest, stopPersonalRequestExecution } from '../../personal-agent/request-service.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { TaskAllocationRepository } from '../../tasks/task-allocation-repository.js';
import { boundedPersonalResult } from './personal-result-budget.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import { createPersonalTaskTool } from './personal-task-tool.js';
import type { XopcUseToolDeps } from './xopc-use-tool.js';

const CapabilitySchema = Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }), accountId: Type.Optional(Type.String()) });
const RequestSchema = Type.Object({
  command: Type.Union(['submit', 'get', 'list', 'cancel', 'answer', 'instruct', 'collaboration', 'entry'].map(command => Type.Literal(command))),
  instruction: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
  questionId: Type.Optional(Type.String({ minLength: 1 })),
  entryId: Type.Optional(Type.String({ minLength: 1 })),
  afterSequence: Type.Optional(Type.Integer({ minimum: 0 })),
  bodyOffset: Type.Optional(Type.Integer({ minimum: 0 })),
  requestId: Type.Optional(Type.String()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  connectorId: Type.Optional(Type.String()),
  accountId: Type.Optional(Type.String()),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 16000, description: 'Complete task brief preserving all user requirements, stages, inputs, outputs and constraints. Do not replace exact specifications with a short objective or a reference to an unspecified process.' })),
  objective: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  timeRange: Type.Optional(Type.Object({ from: Type.String(), to: Type.String(), timezone: Type.String(), expression: Type.String() })),
}, { additionalProperties: false, anyOf: [
  { properties: { command: { const: 'submit' } }, required: ['objective', 'connectorId', 'description'] },
  { properties: { command: { const: 'list' } } },
  { properties: { command: { enum: ['get', 'cancel', 'collaboration'] } }, required: ['requestId'] },
  { properties: { command: { const: 'entry' } }, required: ['requestId', 'entryId'] },
  { properties: { command: { const: 'instruct' } }, required: ['requestId', 'instruction'] },
  { properties: { command: { const: 'answer' } }, required: ['requestId', 'questionId', 'instruction'] },
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
  const compactSnapshot = (request: Parameters<typeof personalRequestSnapshot>[0]) => {
    const value = snapshot(request);
    return { requestId: value.requestId, taskId: value.taskId, state: value.state, version: value.version,
      connectorId: value.connectorId, accountId: value.accountId, executorAgentId: value.executorAgentId,
      ...('allocation' in value ? { allocation: value.allocation } : {}), parameters: { timeRange: value.parameters.timeRange } };
  };
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
  const capabilityTool: AgentTool<typeof CapabilitySchema> = {
    name: 'personal_capability', label: 'Connected app availability', parameters: CapabilitySchema,
    description: 'Check connected-app capabilities, account connection state and specialist Agents locally. The background Task Router selects an executor within account permissions; do not compare executor profiles in the main conversation. For Gmail or other supported apps, check here before delegating. ready is a local preflight; the worker still validates live tools. No remote search or authorization is performed.',
    async execute(_id, input) { return result(personalCapabilities(conversation(), input.query, input.accountId).map(({ executorProfiles: _profiles, executorAgentIds, accounts, ...capability }) => ({ ...capability, eligibleExecutorCount: executorAgentIds.length, accounts: accounts.map(({ executorAgentIds: _ids, ...account }) => account) }))); },
  };
  const requestTool: AgentTool<typeof RequestSchema> = {
    name: 'personal_request', label: 'Connected app request', parameters: RequestSchema,
    description: 'Submit a read-only connected-app request with a short objective and complete description using the exact connectorId from personal_capability. The background Task Router chooses an executor after account authorization. Preserves the objective, displays connection or account selection in this main chat, and starts a specialist Task automatically once connected. Return quickly after submission. Never claim data was read until the Task result arrives. Resolve absolute query dates and include timeRange. If mail has no user-specified range, the host returns an explicit last-7-days default; state that range and proceed without asking for confirmation. get includes complete Task coordination state; collaboration/entry read the same board and full questions. answer forwards the exact questionId; instruct forwards new requirements to the existing Task. Answers and instructions cannot change the connector/account, grant access or allow writes; reconnection stays in the existing connection UI. Saved, delivered, executor-confirmed and verified are distinct states. Use get/list for status without polling; preserve idempotencyKey on uncertain retries; cancel only when the user requests it.',
    async execute(toolCallId, input) {
      const conversationId = conversation();
      if (input.command === 'list') {
        const offset = input.offset ?? 0;
        const items = listPersonalRequests(conversationId, input.limit ?? 10, offset).map(request => {
          const { result: _result, parameters, ...summary } = snapshot(request);
          const { brief: _brief, taskRunId: _taskRunId, cancellationCleanupCompleted: _cleanup, ...queryParameters } = parameters;
          return { ...summary, parameters: queryParameters };
        });
        const total = (getSqliteDatabase().prepare('SELECT count(*) AS count FROM personal_requests WHERE conversation_id = ?').get(conversationId) as { count: number }).count;
        return result(boundedPersonalResult({ items, total, offset }));
      }
      if (input.command === 'submit') {
        if (!input.objective?.trim() || !input.connectorId ) throw new Error('objective and connectorId are required');
        const request = submitPersonalRequest({ conversationId, connectorId: input.connectorId,
          accountId: input.accountId, objective: input.objective.trim(), description: input.description?.trim(), timeRange: input.timeRange,
          idempotencyKey: input.idempotencyKey ?? `personal-request-submit:${selectionRequestHash({ inputId: getSessionInputState(conversationId).activeInputId ?? toolCallId, objective: input.objective.trim(), description: input.description?.trim(), connectorId: input.connectorId, accountId: input.accountId, timeRange: input.timeRange })}` });
        publishPersonalRequest(request);
        deps.dispatchTaskRuns?.();
        return result({ ...compactSnapshot(request), guidance: request.state === 'waiting_connection'
          ? 'The objective is saved. The host presents the required connection or account selection and continues automatically afterward. Stop this turn; do not ask the user to confirm the read or reply continue.'
          : 'The request was accepted. No further user confirmation is needed. Report the returned state accurately, do not submit a duplicate, and wait for delivery without polling.' });
      }
      const request = input.requestId ? getPersonalRequest(input.requestId) : undefined;
      if (!request || request.conversationId !== conversationId) throw new Error('Request does not belong to this conversation');
      if (input.command === 'cancel') {
        if (['completed', 'failed'].includes(personalRequestSnapshot(request).state)) return result(compactSnapshot(request));
        const cancelled = cancelPersonalRequest(request);
        const stop = stopPersonalRequestExecution(cancelled);
        publishPersonalRequest(cancelled);
        return result({ ...compactSnapshot(cancelled), executionStopConfirmed: stop.executionStopConfirmed });
      }
      const taskTool = createPersonalTaskTool({ ...deps,
        getCurrentAgentId: () => deps.getCurrentAgentId?.() ?? getSessionMetadata(conversationId)?.agentId });
      if (input.command === 'instruct' && input.timeRange) assertPersonalRequestTimeRange(input.timeRange);
      const instruction = input.command === 'instruct' && input.timeRange
        ? `${input.instruction}\n\nUpdated absolute query range: ${JSON.stringify(input.timeRange)}` : input.instruction;
      if (input.command === 'answer' || input.command === 'instruct') {
        if (['completed', 'failed', 'cancelled'].includes(personalRequestSnapshot(request).state)) throw new Error('Request is no longer active');
        if (readCurrentTranscriptId(getSqliteDatabase(), conversationId) !== request.transcriptId) throw new Error('SESSION_CHANGED');
        if (!request.taskId && input.command === 'instruct' && request.state === 'waiting_connection') {
          const addition = `\n\nSupplemental requirement:\n${instruction!.trim()}`;
          if (!request.objective.endsWith(addition)) runSqliteWriteTransaction(() => {
            const wait = getActiveConnectionWait(conversationId);
            if (wait?.id !== request.connectionWaitId) throw new Error('Connection objective changed');
            reviseCurrentConnectionObjective(conversationId, request.objective + addition);
            const revised = getActiveConnectionWait(conversationId)!;
            updateConnectionWait({ ...revised, checkpoint: { ...revised.checkpoint, timeRange: input.timeRange ?? request.parameters.timeRange } }, revised.version);
            updatePersonalRequest(request, { objective: request.objective + addition, parameters: { ...request.parameters, ...(input.timeRange ? { timeRange: input.timeRange } : {}) } });
          });
          return result({ ...snapshot(getPersonalRequest(request.requestId)!), instructionStatus: 'saved',
            guidance: 'Account authorization is still required. The existing Request will create its Task with this requirement after authorization.' });
        }
      }
      if (input.command !== 'get' || request.taskId) {
        if (!request.taskId) throw new Error('No Task yet; complete account authorization in the main connection UI');
        const coordinated = await taskTool.execute(toolCallId, { ...input, instruction, taskId: request.taskId } as Parameters<typeof taskTool.execute>[1]);
        if (input.command === 'instruct' && input.timeRange && JSON.parse((coordinated.content[0] as { text: string }).text).ok === true) {
          runSqliteWriteTransaction(() => {
            const current = getPersonalRequest(request.requestId)!;
            updatePersonalRequest(current, { parameters: { ...current.parameters, timeRange: input.timeRange } });
            const wait = getActiveConnectionWait(conversationId);
            if (wait && wait.id === current.connectionWaitId) updateConnectionWait({ ...wait,
              checkpoint: { ...wait.checkpoint, timeRange: input.timeRange } }, wait.version);
          });
        }
        if (input.command !== 'get') return coordinated;
        return result({ ...snapshot(request), coordination: JSON.parse((coordinated.content[0] as { text: string }).text) });
      }
      return result(snapshot(request));
    },
  };
  return [capabilityTool, requestTool];
}
