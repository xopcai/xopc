import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { taskResearchEvidence } from '../../tasks/task-research-result.js';
import { parseResultReferenceId } from '@xopcai/gateway-contract';

import { getTaskHandoff, assertTaskHandoffAccess, readTaskHandoffSource, materializeTaskHandoffFile, assertTaskHandoffExecutorAccess } from '../../tasks/task-handoff.js';
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
  section: Type.Optional(Type.Union([Type.Literal('collaboration'), Type.Literal('task'), Type.Literal('brief'), Type.Literal('handoff'), Type.Literal('source'), Type.Literal('evidence')])),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  materialize: Type.Optional(Type.Boolean()),
  sourceIndex: Type.Optional(Type.Integer({ minimum: 0 })),
  toolCallId: Type.Optional(Type.String({ minLength: 1 })),
  query: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  revision: Type.Optional(Type.String()),
  cursor: Type.Optional(Type.String()),
  sectionId: Type.Optional(Type.String()),
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
    description: 'Coordinate the current Task with its originating conversation. get section brief reads the full task body in 4000-character pages (offset/nextOffset); section handoff lists the host-captured original request and selected versioned sources, Read the CURRENT handoff first; source indices can change across work revisions. Only entries marked materializable support materialize=true, with an explicit sourceIndex. section source with materialize=true copies a selected pinned workspace file OR published result artifact into your Task input directory; use the returned executionInputRoot as cwd and readOnlyPath as input, never the owner workspace path. Result body text uses read; materialize requires an exact artifact source. The returned copies are read-only: write revised outputs elsewhere and publish those new files. It grants no wider root access. Otherwise section source reads one sourceIndex (query for result search, revision for pinned extracted text). section evidence lists real successful tool reads, or reads a toolCallId in 4000-character pages. Evidence excerpts must cite that original toolCallId. get with section task reads constraints and waits; default get reads complete ordered messages (afterSequence/limit) or one entryId. post progress for meaningful changes; post question then stop this turn until answered. Initial handoff and source/tool IDs require no ack. Before continuing, post ack only for a user/main_agent collaboration entry of kind answer or instruction, with causationId equal to that entry ID and explain how the result will incorporate it. Confirmation is receipt and intent, not completed verification. Reuse the same Task and executor. Account authorization stays in the main connection UI; answers and instructions cannot change the selected connector/account or permit writes. Preserve idempotencyKey on retries.',
    mutatesWorkspace: true, mutationScope: 'external', requiresExclusiveWorkspaceLock: false,
    async execute(toolCallId, input, signal) {
      const conversationId = getEmbeddedExecutionSession() ?? deps.getCurrentConversationId?.();
      const active = conversationId ? new TaskConversationRepository().resolveActiveExecutionSession(conversationId) : undefined;
      if (!active || (deps.getCurrentAgentId?.() && active.agentId !== deps.getCurrentAgentId())) throw new Error('No active Task execution');
      const request = personalRequestForExecution(conversationId!);
      if ((!request && getSessionMetadata(conversationId!)?.customData?.personalReadRequestId)
        || (request && ['cancelled', 'completed', 'failed'].includes(request.state))) throw new Error('Personal request is no longer active');
      if (input.command === 'get') {
        const page = (text: string) => {
          const offset = input.offset ?? 0;
          return { text: text.slice(offset, offset + 4000), offset, totalChars: text.length,
            ...(offset + 4000 < text.length ? { nextOffset: offset + 4000 } : {}) };
        };
        const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
        if (input.section === 'brief') return reply(page(new TaskRepository().require(active.taskId).body ?? ''));
        if (input.section === 'handoff') {
          const handoff = getTaskHandoff(active.taskId);
          if (!handoff) return reply({ available: false });
          assertTaskHandoffAccess(handoff);
          return reply({ ...handoff, originalRequest: page(handoff.originalRequest ?? ''), interpretation: undefined,
            sources: handoff.sources.map(({ text: _text, ...source }, sourceIndex) => ({ ...source, sourceIndex,
              materializable: source.kind === 'file' && source.representation !== 'directory' || source.kind === 'result' && parseResultReferenceId(source.sourceId)?.sourceId !== 'body',
              sourceIndexScope: 'current_handoff_only' })) });
        }
        if (input.section === 'source') {
          assertTaskHandoffExecutorAccess(active.taskId, active.agentId!);
          if (input.materialize) {
            if (input.sourceIndex === undefined) throw new Error('Materialization requires sourceIndex from the CURRENT handoff manifest. Never reuse indices from earlier runs');
            const config = deps.getConfig?.(); const workspace = deps.getWorkspace?.();
            if (!config || !workspace) throw new Error('Execution workspace is unavailable');
            const source = await materializeTaskHandoffFile(active.taskId, input.sourceIndex ?? 0, workspace, config);
            return { ...reply(source), details: { taskSourceRead: { taskId: active.taskId, sourceIndex: input.sourceIndex ?? 0, materialized: true } } };
          }
          const source = await readTaskHandoffSource(active.taskId, input.sourceIndex ?? 0,
            { command: input.query ? 'search' : 'read', offset: input.offset, limit: 4000, query: input.query, revision: input.revision, cursor: input.cursor, sectionId: input.sectionId }, deps.getConfig?.());
          const plain = 'text' in source && typeof source.text === 'string' ? [source.text]
            : 'items' in source && Array.isArray(source.items) ? source.items.map(item => item.text) : [];
          return { content: [...reply(source).content, ...plain.map(text => ({ type: 'text' as const, text }))], details: plain.length ? { taskSourceRead: { taskId: active.taskId, sourceIndex: input.sourceIndex ?? 0 } } : {} };
        }
        if (input.section === 'evidence') {
          const { tools } = taskResearchEvidence(conversationId!);
          if (input.toolCallId) {
            const tool = tools.find(item => item.toolCallId === input.toolCallId);
            if (!tool) throw new Error('Successful evidence read not found in this execution');
            return reply({ toolCallId: tool.toolCallId, toolName: tool.toolName, ...page(tool.body) });
          }
          const offset = input.offset ?? 0;
          const items = tools.slice(offset, offset + 10).map(tool => ({ toolCallId: tool.toolCallId, toolName: tool.toolName,
            totalChars: tool.body.length, observedAt: tool.observedAt }));
          return reply({ items, ...(offset + 10 < tools.length ? { nextOffset: offset + 10 } : {}) });
        }
        if (input.section === 'task') {
          const model = new TaskReadModelProjector().project(new TaskRepository().require(active.taskId));
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...model, task: { ...model.task, body: page(model.task.body ?? '') }, waits: new TaskRunRepository().listActiveWaits(active.taskId) }) }], details: {} };
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
