import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { getEmbeddedExecutionSession } from '../embedded/execution-context.js';
import { personalRequestForExecution } from '../../personal-agent/request-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { TaskCollaborationRepository } from '../../tasks/task-collaboration-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { TaskReadModelProjector } from '../../tasks/task-read-model-projector.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { createXopcUseTool, type XopcUseToolDeps } from './xopc-use-tool.js';

const Schema = Type.Object({
  command: Type.Union([Type.Literal('get'), Type.Literal('post')]),
  section: Type.Optional(Type.Union([Type.Literal('collaboration'), Type.Literal('task')])),
  kind: Type.Optional(Type.Union([Type.Literal('progress'), Type.Literal('question'), Type.Literal('ack')])),
  body: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
  causationId: Type.Optional(Type.String({ minLength: 1 })),
  entryId: Type.Optional(Type.String({ minLength: 1 })),
  afterSequence: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
}, { additionalProperties: false, anyOf: [
  { properties: { command: { const: 'get' } } },
  { properties: { command: { const: 'post' }, kind: { enum: ['progress', 'question'] } }, required: ['kind', 'body'] },
  { properties: { command: { const: 'post' }, kind: { const: 'ack' } }, required: ['kind', 'body', 'causationId'] },
] });

/** Collaboration only: no product mutations, connection selection or external operations. */
export function createTaskCollaborationTool(deps: XopcUseToolDeps): AgentTool<typeof Schema> {
  return { name: 'task_collaboration', label: 'Task collaboration', parameters: Schema,
    description: 'Coordinate the current Task with its Personal owner. get with section task reads the complete brief, constraints and waits; default get reads complete ordered messages (afterSequence/limit) or one entryId. post progress for meaningful changes; post question then stop this turn until answered. Before continuing, post ack with causationId equal to each delivered answer/instruction ID and explain how the result will incorporate it. Confirmation is receipt and intent, not completed verification. Reuse the same Task and executor. Account authorization stays in the main connection UI; answers and instructions cannot change the selected connector/account or permit writes. Preserve idempotencyKey on retries.',
    mutatesWorkspace: true, mutationScope: 'external', requiresExclusiveWorkspaceLock: false,
    async execute(toolCallId, input, signal) {
      const conversationId = getEmbeddedExecutionSession() ?? deps.getCurrentConversationId?.();
      const active = conversationId ? new TaskConversationRepository().resolveActiveExecutionSession(conversationId) : undefined;
      if (!active || (deps.getCurrentAgentId?.() && active.agentId !== deps.getCurrentAgentId())) throw new Error('No active Task execution');
      const request = personalRequestForExecution(conversationId!);
      if ((!request && getSessionMetadata(conversationId!)?.customData?.personalReadRequestId)
        || (request && ['cancelled', 'completed', 'failed'].includes(request.state))) throw new Error('Personal request is no longer active');
      if (input.command === 'get') {
        if (input.section === 'task') {
          const model = new TaskReadModelProjector().project(new TaskRepository().require(active.taskId));
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...model, waits: new TaskRunRepository().listActiveWaits(active.taskId) }) }], details: {} };
        }
        const board = new TaskCollaborationRepository();
        if (input.entryId) {
          const entry = board.get(input.entryId);
          if (entry?.taskId !== active.taskId) throw new Error('Entry does not belong to this Task');
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, entry }) }], details: {} };
        }
        const limit = input.limit ?? 10;
        const rows = board.list(active.taskId, input.afterSequence ?? 0, limit + 1);
        const entries = rows.slice(0, limit);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, entries,
          ...(rows.length > limit ? { nextAfterSequence: entries.at(-1)?.sequence } : {}) }) }], details: {} };
      }
      const result = await createXopcUseTool({ ...deps, getCurrentConversationId: () => conversationId,
        getCurrentAgentId: () => active.agentId }).execute(toolCallId, { mode: 'task', command: 'collaboration_post',
        args: { taskId: active.taskId, kind: input.kind, body: input.body, causationId: input.causationId,
          idempotencyKey: input.idempotencyKey ?? (input.kind === 'ack' ? `ack:${active.agentId}:${input.causationId}` : toolCallId) } }, signal, undefined as never);
      if ((result.details.result as { ok?: boolean; error?: string } | undefined)?.ok === false) {
        throw new Error((result.details.result as { error?: string }).error ?? 'Task collaboration failed');
      }
      return { content: result.content, details: {} };
    } } as AgentTool<typeof Schema>;
}
