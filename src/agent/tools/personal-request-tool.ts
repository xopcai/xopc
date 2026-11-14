import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';

import { personalCapabilities } from '../../personal-agent/capability-service.js';
import { selectionRequestHash } from '../../agent-matching/selection-repository.js';
import { getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getActiveConnectionWait, reviseCurrentConnectionObjective, updateConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { updatePersonalRequest, getPersonalRequest, listPersonalRequestsWithoutTask, type PersonalRequest } from '../../personal-agent/request-repository.js';
import { assertPersonalRequestTimeRange, cancelPersonalRequest, personalRequestSnapshot, publishPersonalRequest, submitPersonalRequest, stopPersonalRequestExecution } from '../../personal-agent/request-service.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { getTaskNotificationPreference, isTaskNotificationPreference, setTaskNotificationPreference, TASK_NOTIFICATION_PREFERENCES } from '../../tasks/task-notification-preference.js';
import { TaskAllocationRepository } from '../../tasks/task-allocation-repository.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import { resolveExactConnectionCandidate } from '../../connectors/connection-candidates.js';
import type { XopcUseToolDeps } from './xopc-use-tool.js';

export const PersonalRequestTimeRangeSchema = Type.Object({
  from: Type.String(), to: Type.String(), timezone: Type.String(), expression: Type.String(),
});

const CapabilitySchema = Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }), accountId: Type.Optional(Type.String()) });
const RequestSchema = Type.Object({
  command: Type.Literal('submit'),
  notificationPreference: Type.Optional(Type.Union(TASK_NOTIFICATION_PREFERENCES.map(value => Type.Literal(value)), {
    description: 'Only for explicit user preferences. final_only suppresses progress; updates enables meaningful milestones; default restores normal behavior.',
  })),
  dueAt: Type.Optional(Type.Integer({ minimum: 0, description: 'User-provided deadline in epoch milliseconds, only on submit.' })),
  connectorId: Type.String({ minLength: 1, description: 'Exact app name (e.g. Gmail, Outlook, Google Drive) or connector ID from personal_capability.' }),
  accountId: Type.Optional(Type.String()),
  description: Type.String({ minLength: 1, maxLength: 16000, description: 'Complete task brief preserving all user requirements, stages, inputs, outputs and constraints. Do not replace exact specifications with a short objective or a reference to an unspecified process.' }),
  acceptancePolicy: Type.Optional(Type.Union([Type.Literal('verified_auto'), Type.Literal('manual')], { description: 'Default automatic verification and completion. Use manual only for an explicit user requirement for human acceptance.' })),
  objective: Type.String({ minLength: 1, maxLength: 4000 }),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  timeRange: Type.Optional(PersonalRequestTimeRangeSchema),
}, { additionalProperties: false });

function compactSnapshot(request: PersonalRequest) {
  const value = personalRequestSnapshot(request);
  return { requestId: value.requestId, taskId: value.taskId, state: value.state, version: value.version,
    connectorId: value.connectorId, accountId: value.accountId,
    executorAgentId: value.parameters.allocate && value.executorAgentId === 'task-router' ? undefined : value.executorAgentId,
    notificationPreference: value.taskId ? getTaskNotificationPreference(value.taskId, value.conversationId) : value.parameters.notificationPreference,
    allocation: value.taskId ? new TaskAllocationRepository().summary(value.taskId) : undefined,
    parameters: { timeRange: value.parameters.timeRange } };
}
function result(value: unknown): AgentToolResult<Record<string, never>> {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], details: {} };
}

export function listUnallocatedPersonalRequests(conversationId: string, limit: number, offset: number, query?: string) {
  const { total, items } = listPersonalRequestsWithoutTask(conversationId, limit, offset, query);
  return { total, items: items.map(request => ({
    requestId: request.requestId, title: request.objective, connectorId: request.connectorId,
    state: request.state, updatedAt: request.updatedAt,
  })) };
}

export async function coordinatePersonalRequest(
  request: PersonalRequest,
  input: { command: string; instruction?: string; notificationPreference?: PersonalRequest['parameters']['notificationPreference']; timeRange?: PersonalRequest['parameters']['timeRange'] },
  coordinateTask: (taskId: string, instruction?: string) => Promise<AgentToolResult<Record<string, never>>>,
): Promise<AgentToolResult<Record<string, never>>> {
  const { conversationId } = request;
  if (input.timeRange !== undefined && input.command !== 'instruct') {
    throw new Error('timeRange is supported only on instruct for a connected-app request');
  }
  if (input.command === 'notifications') {
    if (!input.notificationPreference) throw new Error('notificationPreference is required');
    if (readCurrentTranscriptId(getSqliteDatabase(), conversationId) !== request.transcriptId) throw new Error('SESSION_CHANGED');
    if (request.taskId) {
      setTaskNotificationPreference(request.taskId, conversationId, input.notificationPreference);
      return result(compactSnapshot(request));
    }
    return result(compactSnapshot(updatePersonalRequest(request, { parameters: {
      ...request.parameters, notificationPreference: input.notificationPreference,
    } })));
  }
  if (input.command === 'cancel') {
    if (['completed', 'failed'].includes(personalRequestSnapshot(request).state)) return result(compactSnapshot(request));
    const cancelled = cancelPersonalRequest(request);
    const stop = stopPersonalRequestExecution(cancelled);
    publishPersonalRequest(cancelled);
    return result({ ...compactSnapshot(cancelled), status: cancelled.state, executionStopConfirmed: stop.executionStopConfirmed });
  }
  if (input.command === 'get' && !request.taskId) {
    return result({ ok: true, ...compactSnapshot(request), objective: request.objective });
  }
  if (input.command === 'instruct' && input.timeRange) assertPersonalRequestTimeRange(input.timeRange);
  if ((input.command === 'instruct' || input.command === 'answer') && !input.instruction?.trim()) throw new Error('instruction is required');
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
      return result({ ok: true, ...compactSnapshot(getPersonalRequest(request.requestId)!), instructionStatus: 'saved',
        guidance: 'Account authorization is still required. The existing Request will create its Task with this requirement after authorization.' });
    }
  }
  if (!request.taskId) throw new Error('No Task yet; complete account authorization in the main connection UI');
  const coordinated = await coordinateTask(request.taskId, instruction);
  if (input.command === 'get') {
    return result({ ...JSON.parse((coordinated.content[0] as { text: string }).text), ...compactSnapshot(request) });
  }
  if (input.command === 'instruct' && input.timeRange && JSON.parse((coordinated.content[0] as { text: string }).text).ok === true) {
    runSqliteWriteTransaction(() => {
      const current = getPersonalRequest(request.requestId)!;
      updatePersonalRequest(current, { parameters: { ...current.parameters, timeRange: input.timeRange } });
      const wait = getActiveConnectionWait(conversationId);
      if (wait && wait.id === current.connectionWaitId) updateConnectionWait({ ...wait,
        checkpoint: { ...wait.checkpoint, timeRange: input.timeRange } }, wait.version);
    });
  }
  return coordinated;
}

export function createPersonalRequestTools(deps: XopcUseToolDeps): AgentTool[] {
  const conversation = () => {
    const id = deps.getCurrentConversationId?.();
    if (!id || !isPersonalConversation(id)) throw new Error('Personal conversation is required');
    return id;
  };
  const capabilityTool: AgentTool<typeof CapabilitySchema> = {
    name: 'personal_capability', label: 'Check app connections', parameters: CapabilitySchema,
    description: 'Look up supported app connectors and check their capabilities, eligible accounts, and connection status. Use for questions such as “Is my Gmail account connected?” or to identify an unclear app. This lookup reads local connection state. To read data from a clearly identified app, submit directly with personal_request.',
    async execute(_id, input: Static<typeof CapabilitySchema>) { return result(personalCapabilities(conversation(), input.query, input.accountId).map(({ executorProfiles: _profiles, executorAgentIds, accounts, ...capability }) => ({ ...capability, eligibleExecutorCount: executorAgentIds.length, accounts: accounts.map(({ executorAgentIds: _ids, ...account }) => account) }))); },
  };
  const requestTool: AgentTool<typeof RequestSchema> = {
    name: 'personal_request', label: 'Connected app request', parameters: RequestSchema,
    description: 'Submit a new read-only connected-app request with the exact app name or connector ID, short objective, full brief and any absolute time range. The host validates access, shows account selection or authorization when needed, and continues automatically. For mail without a requested range, report the last-7-days default if returned. Report the confirmed submission state and use personal_task with the returned requestId or taskId for follow-up.',
    async execute(toolCallId, input: Static<typeof RequestSchema>) {
      const conversationId = conversation();
      if (input.command !== 'submit') throw new Error('Use personal_task to manage an existing request');
      if (input.notificationPreference !== undefined && !isTaskNotificationPreference(input.notificationPreference)) {
        throw new Error('Invalid Request notification preference');
      }
      const objective = input.objective?.trim();
      const description = input.description?.trim();
      if (!objective || !description) throw new Error('objective and a complete description are required');
      const connectorId = resolveExactConnectionCandidate(input.connectorId ?? '');
      const submission = { objective, description, connectorId, accountId: input.accountId, timeRange: input.timeRange,
        acceptancePolicy: input.acceptancePolicy, notificationPreference: input.notificationPreference, dueAt: input.dueAt };
      const inputId = getSessionInputState(conversationId).activeInputId ?? toolCallId;
      const request = submitPersonalRequest({ conversationId, ...submission,
        idempotencyKey: input.idempotencyKey ?? `personal-request-submit:${selectionRequestHash({ inputId, ...submission })}` });
      publishPersonalRequest(request);
      deps.dispatchTaskRuns?.();
      return result({ ...compactSnapshot(request), guidance: request.state === 'waiting_connection'
        ? 'The objective is saved. The host presents the required connection or account selection and continues automatically afterward. Stop this turn; do not ask the user to confirm the read or reply continue.'
        : 'The request was accepted. No further user confirmation is needed. Report the returned state accurately, do not submit a duplicate, and wait for delivery without polling.' });
    },
  };
  return [capabilityTool, requestTool];
}
