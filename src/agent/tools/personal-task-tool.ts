import { randomUUID } from 'node:crypto';

import { appendProductDeliveryText } from '@xopcai/gateway-contract';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';

import { assessSpecialist, matchSpecialists, type MatchingContext } from '../../agent-matching/service.js';
import { normalizeSpecialistRequirements, type SpecialistTaskRequirements } from '../../agent-matching/schema.js';
import { assertSpecialistEligible, createSelectedTask } from '../../agent-matching/delegation-service.js';
import { AgentSelectionRepository, selectionRequestHash } from '../../agent-matching/selection-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';
import { getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
export { getAvailablePersonalAgentTools, personalAgentModelAvailability } from '../../personal-agent/specialist-capabilities.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import { PERSONAL_WORKER_RESULT_GUIDANCE } from '../../personal-agent/communication.js';
import { getPersonalRequest } from '../../personal-agent/request-repository.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskAllocationRepository } from '../../tasks/task-allocation-repository.js';
import { cancelPersonalTask } from '../../personal-agent/task-cancel.js';
import { boundedPersonalResult } from './personal-result-budget.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskCollaborationRepository } from '../../tasks/task-collaboration-repository.js';
import { TaskOriginRepository } from '../../tasks/task-origin-repository.js';
import { createXopcUseTool, type XopcUseToolDeps } from './xopc-use-tool.js';

const PersonalTaskSchema = Type.Object({
  command: Type.Union([Type.Literal('retry_allocation'), Type.Literal('submit'), Type.Literal('agents'), Type.Literal('match'), Type.Literal('selection'), Type.Literal('create'), Type.Literal('list'), Type.Literal('get'), Type.Literal('collaboration'), Type.Literal('entry'), Type.Literal('instruct'), Type.Literal('answer'), Type.Literal('cancel')]),
  requirements: Type.Optional(Type.Object({
    version: Type.Optional(Type.Literal(1)), summary: Type.String({ maxLength: 300 }),
    domain: Type.Optional(Type.String()), taskType: Type.Optional(Type.String()),
    inputKinds: Type.Optional(Type.Array(Type.String())), outputKinds: Type.Optional(Type.Array(Type.String())),
    requiredTools: Type.Optional(Type.Array(Type.String())), requiredSkills: Type.Optional(Type.Array(Type.String())),
    requestedAgentId: Type.Optional(Type.String({ minLength: 1, description: 'Only an executor explicitly named by the human user. Omit this field when the background router should choose; never infer it from the specialist directory.' })),
  })),
  selectionReason: Type.Optional(Type.String({ maxLength: 500 })),
  selectionSource: Type.Optional(Type.Union([Type.Literal('snapshot'), Type.Literal('match'), Type.Literal('explicit')])),
  previousSelectionId: Type.Optional(Type.String()),
  matchId: Type.Optional(Type.String()),
  requestId: Type.Optional(Type.String()),
  cursor: Type.Optional(Type.String()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  title: Type.Optional(Type.String({ description: 'Short task title, ideally under 60 characters. Do not put the full instructions here.' })),
  objective: Type.Optional(Type.String({ minLength: 1, description: 'One-sentence outcome for a new delegated Task.' })),
  description: Type.Optional(Type.String({ minLength: 1, description: 'Complete Markdown brief preserving the user request, input references, and delivery expectations. Optional structured fields need not repeat it.' })),
  agentId: Type.Optional(Type.String({ description: 'Specialist Agent ID. Never use your own ID.' })),
  taskId: Type.Optional(Type.String()),
  instruction: Type.Optional(Type.String({ description: 'The user’s new direction for this delegated Task.' })),
  entryId: Type.Optional(Type.String({ description: 'Read one complete collaboration entry, including its question or instruction body.' })),
  afterSequence: Type.Optional(Type.Integer({ minimum: 0 })),
  bodyOffset: Type.Optional(Type.Integer({ minimum: 0, description: 'Character offset for an entry body; follow nextBodyOffset until absent.' })),
  section: Type.Optional(Type.Union(['task', 'waits', 'runs', 'receipts', 'context', 'conversation', 'sessions', 'authorityGrants', 'dependencies', 'dependents', 'criterionReviews'].map(value => Type.Literal(value)))),
  questionId: Type.Optional(Type.String({ description: 'Collaboration question ID to answer.' })),
  expectedOutputs: Type.Optional(Type.Array(Type.String())),
  acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
  constraints: Type.Optional(Type.Array(Type.String())),
  requiredSkills: Type.Optional(Type.Array(Type.String({ minLength: 1, description: 'Only Skill names explicitly requested by the user. Forward them to the background router for validation; omit otherwise.' }))),
  requiredTools: Type.Optional(Type.Array(Type.String({ description: 'Tool names needed for this Task. Use names returned by agents; omit when matching by role or expertise.' }))),
  idempotencyKey: Type.Optional(Type.String()),
});

// Keep historical commands executable for internal replay callers, without advertising executor selection to the personal model.
const PersonalTaskModelSchema = Type.Object({
  ...Type.Omit(PersonalTaskSchema, ['agentId', 'selectionReason', 'selectionSource', 'previousSelectionId', 'matchId', 'cursor', 'requiredTools', 'acceptanceCriteria']).properties,
  requirements: Type.Optional(Type.Omit(PersonalTaskSchema.properties.requirements, ['requiredTools', 'requiredSkills'], { additionalProperties: false })),
  command: Type.Union((['submit', 'list', 'get', 'collaboration', 'entry', 'instruct', 'answer', 'retry_allocation', 'selection', 'cancel'] as const).map(command => Type.Literal(command))),
}, { additionalProperties: false, anyOf: [
  { properties: { command: { const: 'submit' } }, required: ['objective', 'description'] },
  { properties: { command: { enum: ['list', 'selection'] } } },
  { properties: { command: { enum: ['get', 'collaboration', 'retry_allocation', 'cancel'] } }, required: ['taskId'] },
  { properties: { command: { const: 'entry' } }, required: ['taskId', 'entryId'] },
  { properties: { command: { const: 'instruct' } }, required: ['taskId', 'instruction'] },
  { properties: { command: { const: 'answer' } }, required: ['taskId', 'instruction', 'questionId'] },
] });

export interface PersonalTaskToolDeps extends XopcUseToolDeps {
  getAgentToolAvailability?: MatchingContext['getAgentToolAvailability'];
  getAgentSkillAvailability?: (agentId: string) => {
    skills: Array<{ name: string; availableForCurrentAgent: boolean; unavailableReason?: string | null }>;
  };
}

const MAX_PERSONAL_TASK_TITLE = 60;
export function buildPersonalTaskBrief(input: { title?: string; objective: string; description?: string }): {
  title: string; objective: string; body?: string;
} {
  const fullObjective = input.objective.trim();
  const titleSource = (input.title?.trim() || fullObjective).replace(/\s+/g, ' ');
  const firstClause = titleSource.split(/[。！？\n]|(?<=[.!?])\s/)[0]?.trim() || titleSource;
  const title = firstClause.length > MAX_PERSONAL_TASK_TITLE
    ? `${firstClause.slice(0, MAX_PERSONAL_TASK_TITLE - 1).trimEnd()}…`
    : firstClause;
  const objective = fullObjective.length > 120 ? title : fullObjective;
  const description = input.description?.trim();
  const body = fullObjective !== objective
    ? [fullObjective, description].filter(Boolean).join('\n\n')
    : description;
  return { title, objective, body: [body, PERSONAL_WORKER_RESULT_GUIDANCE].filter(Boolean).join('\n\n') };
}

/** A narrow Task surface for the fast personal conversation. */
export function createPersonalTaskTool(deps: PersonalTaskToolDeps): AgentTool<typeof PersonalTaskModelSchema, Record<string, never>> {
  const productTool = createXopcUseTool(deps);
  const matches = new Map<string, { conversationId: string; requirements: SpecialistTaskRequirements; result: ReturnType<typeof matchSpecialists> }>();
  return {
    name: 'personal_task',
    label: 'Personal Task',
    description: 'Submit objective and a concise complete description, then return after local persistence. Preserve the user request and source references without inventing an execution plan or extra requirements. Omit optional structured fields when they merely repeat the description. Describe required capabilities in the brief; the background Task Router selects one executor and checks its tools. Do not read input files, select Agents or invent tool names before submit. Set requirements.requestedAgentId only for an executor explicitly named by the user, using their ID or display name; preserve explicitly requested requiredSkills. get reads Task state, waits, runs, receipts and context; use section and limit/offset for complete paginated details. collaboration reads ordered message previews with afterSequence; entry reads exact message bodies using entryId and nextBodyOffset. Read full questions before answering. Delivery pending means saved, delivered means sent, confirmed means the executor acknowledged it; confirmation alone is not verified completion. get/list inspect existing Tasks with limit/offset; cancel stops a Task on explicit user instruction and reports execution stop confirmation; instruct/answer send context; retry_allocation retries selection before execution; selection explains assignment. Status and results return automatically. Preserve idempotencyKey on uncertain retries. Report only confirmed states.',
    parameters: PersonalTaskModelSchema,
    mutatesWorkspace: true,
    mutationScope: 'external',
    requiresExclusiveWorkspaceLock: false,
    finalGuardRelevant: true,
    async execute(toolCallId, modelInput, signal) {
      const input: Static<typeof PersonalTaskSchema> = modelInput;
      const conversationId = deps.getCurrentConversationId?.();
      const ownAgentId = deps.getCurrentAgentId?.();
      if (!conversationId || !ownAgentId || !isPersonalConversation(conversationId)) {
        throw new Error('Personal conversation context is unavailable');
      }
      const requirements = normalizeSpecialistRequirements({
        ...input.requirements,
        requestedAgentId: input.requirements?.requestedAgentId?.trim() || undefined,
        version: 1,
        summary: input.requirements?.summary ?? (input.objective?.trim() || 'Specialist discovery').slice(0, 300),
        requiredTools: [...(input.requirements?.requiredTools ?? []), ...(input.requiredTools ?? [])],
        requiredSkills: [...(input.requirements?.requiredSkills ?? []), ...(input.requiredSkills ?? [])],
      });
      const context: MatchingContext = {
        ownAgentId, getConfig: deps.getConfig, getAgentSkillAvailability: deps.getAgentSkillAvailability,
        getAgentToolAvailability: deps.getAgentToolAvailability,
        legacyToolPolicyOnly: !input.requirements,
      };
      if (input.command === 'match' || input.command === 'agents') {
        if (input.command === 'agents' && requirements.requiredSkills?.length && !deps.getAgentSkillAvailability)
          throw new Error('Specialist Skill availability cannot be verified');
        const result = matchSpecialists(requirements, context, { cursor: input.cursor, limit: input.command === 'agents' ? 50 : 10 });
        if (input.command === 'agents') {
          let cursor = result.nextCursor;
          while (cursor) {
            const page = matchSpecialists(requirements, context, { cursor, limit: 50 });
            result.candidates.push(...page.candidates);
            cursor = page.nextCursor;
          }
        }
        const matchId = input.command === 'match' ? randomUUID() : undefined;
        if (matchId) {
          if (matches.size >= 20) matches.delete(matches.keys().next().value!);
          matches.set(matchId, { conversationId, requirements, result });
        }
        // Keep the legacy array response while match exposes evidence and pagination.
        const payload = input.command === 'agents' ? result.candidates.filter(agent =>
          !agent.checks.some(check => check.condition === 'identity' && check.state === 'blocked')
          && (requirements.requiredTools ?? []).every(tool => agent.availableTools.includes(tool))
          && (requirements.requiredSkills?.length ?? 0) === agent.verifiedSkills.length) : { ...result, matchId };
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], details: {} };
      }
      if (input.command === 'selection') {
        const owns = input.taskId ? new TaskOriginRepository().owns(input.taskId, conversationId)
          : input.requestId ? getPersonalRequest(input.requestId)?.conversationId === conversationId : true;
        if (!owns) throw new Error('Task or Request does not belong to this personal conversation');
        const offset = input.offset ?? 0;
        const limit = input.limit ?? 10;
        const rows = new AgentSelectionRepository().list(conversationId, { taskId: input.taskId, requestId: input.requestId, offset, limit: limit + 1 });
        const items = rows.slice(0, limit).map(({ candidates: _candidates, assessment, ...record }) =>
          ({ ...record, executor: { id: assessment.id, name: assessment.name } }));
        return { content: [{ type: 'text', text: JSON.stringify(boundedPersonalResult({ items, offset,
          ...(rows.length > limit ? { nextOffset: offset + items.length } : {}) })) }], details: {} };
      }
      let selectedProductTool = productTool;
      let pendingSelection: Parameters<AgentSelectionRepository['create']>[0] | undefined;
      let command: string = input.command;
      let args: Record<string, unknown> = {};
      if (command === 'submit') {
        const objective = input.objective?.trim();
        if (!objective || !input.description?.trim()) throw new Error('objective and a complete description are required');
        if (input.agentId) throw new Error('Use requirements.requestedAgentId for an explicitly requested executor');
        const brief = buildPersonalTaskBrief({ title: input.title, objective, description: input.description });
        const inputId = getSessionInputState(conversationId).activeInputId;
        const submissionKey = input.idempotencyKey?.trim() || selectionRequestHash({
          sourceInput: inputId ?? toolCallId, brief, requirements,
          expectedOutputs: input.expectedOutputs, acceptanceCriteria: input.acceptanceCriteria, constraints: input.constraints,
        });
        command = 'create';
        args = { ...brief, createMode: 'allocate', requirements, includeConversationContext: false,
          expectedOutputs: input.expectedOutputs, acceptanceCriteria: input.acceptanceCriteria,
          constraints: input.constraints, idempotencyKey: `personal-submit:${conversationId}:${selectionRequestHash(submissionKey)}` };
        if (requirements.requiredSkills?.length) args.body = `${brief.body}\n\nRequired Skills: ${requirements.requiredSkills.join(', ')}. Read and follow these Skills before execution.`;
      } else if (command === 'create') {
        const objective = input.objective?.trim();
        const agentId = input.agentId?.trim();
        if (!objective || !agentId) throw new Error('objective and specialist agentId are required');
        if (agentId === ownAgentId || agentId.startsWith('personal-')) throw new Error('Delegate to a specialist Agent, not a personal Agent');
        const key = input.idempotencyKey?.trim() || randomUUID();
        const { requiredTools: _tools, requiredSkills: _skills, requirements: _requirements, ...requestInput } = input;
        const requestHash = selectionRequestHash({ ...requestInput, idempotencyKey: key, requirements });
        const previous = new AgentSelectionRepository().find(conversationId, key);
        if (previous && previous.requestHash !== requestHash) throw new Error('Idempotency key was reused with different input');
        if (previous?.status === 'rejected') assertSpecialistEligible(previous.assessment);
        const matched = input.matchId ? matches.get(input.matchId) : undefined;
        if (!previous && input.matchId && (!matched || matched.conversationId !== conversationId)) throw new Error('Matching snapshot expired; match again');
        if (!previous && matched && (selectionRequestHash(matched.requirements) !== selectionRequestHash(requirements)
          || !matched.result.candidates.some(candidate => candidate.id === agentId)))
          throw new Error('Selection must preserve matched requirements and select a displayed candidate');
        // A committed attempt wins over current availability on an uncertain retry.
        let assessment = previous?.assessment;
        if (!assessment) {
          assessment = assessSpecialist(agentId, requirements, context);
          if (assessment.eligibility !== 'eligible' && getSessionMetadata(conversationId)) {
            new AgentSelectionRepository().create({ conversationId, key,
              requestHash, requirements, assessment,
              source: input.selectionSource ?? 'legacy', reason: input.selectionReason,
              previousSelectionId: input.previousSelectionId, status: 'rejected' });
          }
          assertSpecialistEligible(assessment);
        }
        const requiredSkills = assessment.verifiedSkills;
        if (!previous) pendingSelection = { conversationId, key, requestHash, requirements, assessment,
          source: requirements.requestedAgentId ? 'explicit' : matched ? 'match' : input.selectionSource === 'match' ? 'snapshot' : input.selectionSource ?? 'legacy',
          reason: input.selectionReason, previousSelectionId: input.previousSelectionId, status: 'start_failed' };
        selectedProductTool = createXopcUseTool({ ...deps,
          createTask: (taskInput, actor) => createSelectedTask(taskInput, actor, {
            conversationId, requirements, context, requestHash,
            candidates: matched?.result.candidates.map(({ id, revision, eligibility, checks, matched: tags, missing }) =>
              ({ id, revision, eligibility, checks, matched: tags, missing })), reason: input.selectionReason,
            source: requirements.requestedAgentId ? 'explicit' : matched ? 'match' : input.selectionSource === 'match' ? 'snapshot' : input.selectionSource ?? (input.requirements ? 'snapshot' : 'legacy'),
            previousSelectionId: input.previousSelectionId,
          }),
        });
        const brief = buildPersonalTaskBrief({ title: input.title, objective, description: input.description });
        args = {
          ...brief,
          body: [brief.body, requiredSkills.length
            ? `## Required Skills\n\n${requiredSkills.map(name => `- ${name}`).join('\n')}\n\nRead and follow these Skills before performing the task. Report any availability failure; do not claim a Skill was used without actually following it.`
            : undefined].filter(Boolean).join('\n\n'),
          agentId, createMode: 'start',
          includeConversationContext: false,
          expectedOutputs: input.expectedOutputs,
          acceptanceCriteria: input.acceptanceCriteria,
          constraints: input.constraints,
          idempotencyKey: key,
        };
      } else if (command === 'list') {
        command = 'delegated_tasks';
        args = { limit: input.limit ?? 10, offset: input.offset ?? 0 };
      } else {
        const taskId = input.taskId?.trim();
        if (!taskId) throw new Error('taskId is required');
        if (!new TaskOriginRepository().owns(taskId, conversationId)) {
          throw new Error('Task does not belong to this personal conversation');
        }
        if (command === 'collaboration' || command === 'entry') {
          const board = new TaskCollaborationRepository();
          if (command === 'entry') {
            const entry = input.entryId ? board.get(input.entryId) : undefined;
            if (!entry || entry.taskId !== taskId) throw new Error('Entry does not belong to this Task');
            const offset = input.bodyOffset ?? 0;
            const body = entry.body.slice(offset, offset + 4000);
            const payload = { ok: true, entry: { ...entry, body }, bodyOffset: offset, bodyLength: entry.body.length,
              ...(offset + body.length < entry.body.length ? { nextBodyOffset: offset + body.length } : {}) };
            return { content: [{ type: 'text', text: JSON.stringify(payload) }], details: {} };
          }
          const limit = input.limit ?? 10;
          const entries = board.list(taskId, input.afterSequence ?? 0, limit + 1);
          const items = entries.slice(0, limit).map(entry => ({ ...entry, body: entry.body.slice(0, 600),
            bodyLength: entry.body.length, ...(entry.body.length > 600 ? { excerpt: true, readEntryId: entry.id } : {}) }));
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, items,
            ...(entries.length > limit ? { nextAfterSequence: items.at(-1)?.sequence } : {}) }) }], details: {} };
        }
        if (command === 'cancel') {
          const result = await cancelPersonalTask(taskId, conversationId, input.idempotencyKey ?? toolCallId);
          deps.dispatchTaskRuns?.();
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
        }
        if (command === 'retry_allocation') {
          command = 'command';
          args = { taskId, type: 'retry_allocation', expectedVersion: new TaskRepository().require(taskId).version };
        } else if (command === 'instruct' || command === 'answer') {
          const body = input.instruction?.trim();
          if (!body) throw new Error('instruction is required');
          if (command === 'answer' && !input.questionId?.trim()) throw new Error('questionId is required');
          command = 'collaboration_post';
          args = { taskId, kind: input.command === 'answer' ? 'answer' : 'instruction', body,
            idempotencyKey: input.idempotencyKey?.trim() || `personal-collaboration:${selectionRequestHash({ inputId: getSessionInputState(conversationId).activeInputId ?? toolCallId, taskId, kind: input.command, body, questionId: input.questionId })}`,
            ...(input.command === 'answer' ? { causationId: input.questionId!.trim() } : {}) };
        } else {
          args = { taskId };
        }
      }
      try {
        const result = await selectedProductTool.execute(toolCallId, { mode: 'task', command, args }, signal, undefined as never);
        if ((input.command === 'answer' || input.command === 'instruct') && input.taskId && result.details.result && (result.details.result as { ok?: boolean }).ok !== false) {
          const allocation = new TaskAllocationRepository().get(input.taskId);
          if (allocation && ['blocked', 'failed'].includes(allocation.status)) {
            new TaskApplicationService().execute({ taskId: input.taskId, expectedVersion: new TaskRepository().require(input.taskId).version,
              idempotencyKey: `allocation-answer:${toolCallId}`, command: { type: 'retry_allocation' }, actor: { kind: 'agent', id: ownAgentId } });
            deps.dispatchTaskRuns?.();
          }
        }
        const payload = result.details.result as Record<string, unknown> | undefined;
        if (payload?.ok === true && input.command === 'submit') {
          const task = payload.task as Record<string, unknown>;
          const confirmation = { ok: true, task: { id: task.id, title: task.title, phase: task.phase, version: task.version },
            operationalState: payload.operationalState, allocation: payload.allocation, runId: payload.runId };
          return { content: [{ type: 'text', text: appendProductDeliveryText(JSON.stringify(confirmation, null, 2), result.details.delivery) }], details: {} };
        }
        if (payload && input.command === 'get') {
          const offset = input.offset ?? 0;
          const limit = input.limit ?? 10;
          const read: Record<string, unknown> = input.section ? { ok: payload.ok, [input.section]: payload[input.section] } : { ...payload };
          const pagination: Record<string, unknown> = {};
          for (const key of ['waits', 'runs', 'receipts', 'context', 'sessions', 'authorityGrants', 'dependencies', 'dependents', 'criterionReviews']) {
            const value = read[key];
            if (!Array.isArray(value)) continue;
            read[key] = value.slice(offset, offset + limit);
            pagination[key] = { total: value.length, offset, ...(offset + limit < value.length ? { nextOffset: offset + limit } : {}) };
          }
          if (!input.section) {
            const board = new TaskCollaborationRepository();
            read.collaboration = board.recent(input.taskId!, undefined, 10).map(entry => ({ ...entry,
              body: entry.body.slice(0, 600), bodyLength: entry.body.length,
              ...(entry.body.length > 600 ? { excerpt: true, readEntryId: entry.id } : {}) }));
            read.allocation = new TaskAllocationRepository().summary(input.taskId!);
            read.guidance = 'Read entry for complete question/instruction bodies; collaboration with afterSequence pages the whole board. get(section, offset) pages state details. pending is saved, delivered is sent, confirmed is acknowledged; verification and Task acceptance are separate.';
          }
          return { content: [{ type: 'text', text: JSON.stringify({ ...read, pagination }) }], details: {} };
        }
        if (payload && input.command === 'list') {
          return { content: [{ type: 'text', text: JSON.stringify(boundedPersonalResult({ ...payload, offset: input.offset ?? 0 })) }], details: {} };
        }
        return { content: result.content, details: {} };
      } catch (error) {
        // A committed selection is authoritative even if post-commit dispatch failed.
        if (pendingSelection && !new AgentSelectionRepository().find(conversationId, pendingSelection.key)) {
          const repository = new AgentSelectionRepository();
          const record = repository.create(pendingSelection);
          repository.link(record.id, { status: 'start_failed', reasonCode: 'creation_exception' });
        }
        throw error;
      }
    },
  } as AgentTool<typeof PersonalTaskModelSchema, Record<string, never>>;
}
