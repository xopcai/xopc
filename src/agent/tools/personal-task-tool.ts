import { randomUUID } from 'node:crypto';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { assessSpecialist, matchSpecialists, type MatchingContext } from '../../agent-matching/service.js';
import { normalizeSpecialistRequirements, type SpecialistTaskRequirements } from '../../agent-matching/schema.js';
import { assertSpecialistEligible, createSelectedTask } from '../../agent-matching/delegation-service.js';
import { AgentSelectionRepository, selectionRequestHash } from '../../agent-matching/selection-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';
export { getAvailablePersonalAgentTools, personalAgentModelAvailability } from '../../personal-agent/specialist-capabilities.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import { PERSONAL_WORKER_RESULT_GUIDANCE } from '../../personal-agent/communication.js';
import { getPersonalRequest } from '../../personal-agent/request-repository.js';
import { TaskOriginRepository } from '../../tasks/task-origin-repository.js';
import { createXopcUseTool, type XopcUseToolDeps } from './xopc-use-tool.js';

const PersonalTaskSchema = Type.Object({
  command: Type.Union([Type.Literal('agents'), Type.Literal('match'), Type.Literal('selection'), Type.Literal('create'), Type.Literal('list'), Type.Literal('get'), Type.Literal('instruct'), Type.Literal('answer')]),
  requirements: Type.Optional(Type.Object({
    version: Type.Optional(Type.Literal(1)), summary: Type.String({ maxLength: 300 }),
    domain: Type.Optional(Type.String()), taskType: Type.Optional(Type.String()),
    inputKinds: Type.Optional(Type.Array(Type.String())), outputKinds: Type.Optional(Type.Array(Type.String())),
    requiredTools: Type.Optional(Type.Array(Type.String())), requiredSkills: Type.Optional(Type.Array(Type.String())),
    requestedAgentId: Type.Optional(Type.String()),
  })),
  selectionReason: Type.Optional(Type.String({ maxLength: 500 })),
  selectionSource: Type.Optional(Type.Union([Type.Literal('snapshot'), Type.Literal('match'), Type.Literal('explicit')])),
  previousSelectionId: Type.Optional(Type.String()),
  matchId: Type.Optional(Type.String()),
  requestId: Type.Optional(Type.String()),
  cursor: Type.Optional(Type.String()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  title: Type.Optional(Type.String({ description: 'Short task title, ideally under 60 characters. Do not put the full instructions here.' })),
  objective: Type.Optional(Type.String({ description: 'One-sentence outcome for a new delegated Task.' })),
  description: Type.Optional(Type.String({ description: 'Full task brief in Markdown: background, specific requests, source material, and delivery expectations.' })),
  agentId: Type.Optional(Type.String({ description: 'Specialist Agent ID. Never use your own ID.' })),
  taskId: Type.Optional(Type.String()),
  instruction: Type.Optional(Type.String({ description: 'The user’s new direction for this delegated Task.' })),
  questionId: Type.Optional(Type.String({ description: 'Collaboration question ID to answer.' })),
  expectedOutputs: Type.Optional(Type.Array(Type.String())),
  acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
  constraints: Type.Optional(Type.Array(Type.String())),
  requiredSkills: Type.Optional(Type.Array(Type.String({ minLength: 1, description: 'Canonical Skill names explicitly requested by the user. Verify through agents before creation.' }))),
  requiredTools: Type.Optional(Type.Array(Type.String({ description: 'Tool names needed for this Task. Use names returned by agents; omit when matching by role or expertise.' }))),
  idempotencyKey: Type.Optional(Type.String()),
});

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
export function createPersonalTaskTool(deps: PersonalTaskToolDeps): AgentTool<typeof PersonalTaskSchema, Record<string, never>> {
  const productTool = createXopcUseTool(deps);
  const matches = new Map<string, { conversationId: string; requirements: SpecialistTaskRequirements; result: ReturnType<typeof matchSpecialists> }>();
  return {
    name: 'personal_task',
    label: 'Personal Task',
    description: 'Use match with structured requirements to compare specialist profiles and eligibility evidence. Profiles declare expertise; they never grant access. When the snapshot suffices, create directly with requirements, selectionReason and selectionSource. selection reads a Task’s allocation history. Preserve idempotencyKey on uncertain retries; link alternatives with previousSelectionId. Find specialist Agents by role, availableTools, and model.available; delegate work, inspect Tasks, send instructions, or answer worker questions. Choose an Agent whose model.available is true. Before saying you cannot do a request, inspect another Agent. If a candidate fails, retry alternatives within the user’s authorization only when the user has not required a particular Agent or Skill. For explicitly requested Skills, use requiredSkills in agents and create; creation validates availability and includes them in the worker brief. agents can filter by requiredTools or requiredSkills; if none match, inspect unfiltered Agents. Return to the user quickly after creation.',
    parameters: PersonalTaskSchema,
    mutatesWorkspace: true,
    mutationScope: 'external',
    requiresExclusiveWorkspaceLock: false,
    finalGuardRelevant: true,
    async execute(toolCallId, input, signal) {
      const conversationId = deps.getCurrentConversationId?.();
      const ownAgentId = deps.getCurrentAgentId?.();
      if (!conversationId || !ownAgentId || !isPersonalConversation(conversationId)) {
        throw new Error('Personal conversation context is unavailable');
      }
      const requirements = normalizeSpecialistRequirements({
        ...input.requirements,
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
        return { content: [{ type: 'text', text: JSON.stringify(new AgentSelectionRepository().list(conversationId,
          { taskId: input.taskId, requestId: input.requestId, offset: input.offset })) }], details: {} };
      }
      let selectedProductTool = productTool;
      let pendingSelection: Parameters<AgentSelectionRepository['create']>[0] | undefined;
      let command: string = input.command;
      let args: Record<string, unknown> = {};
      if (command === 'create') {
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
          expectedOutputs: input.expectedOutputs ?? [],
          acceptanceCriteria: input.acceptanceCriteria ?? [],
          constraints: input.constraints ?? [],
          idempotencyKey: key,
        };
      } else if (command === 'list') {
        command = 'delegated_tasks';
        args = { limit: 20 };
      } else {
        const taskId = input.taskId?.trim();
        if (!taskId) throw new Error('taskId is required');
        if (!new TaskOriginRepository().owns(taskId, conversationId)) {
          throw new Error('Task does not belong to this personal conversation');
        }
        if (command === 'instruct' || command === 'answer') {
          const body = input.instruction?.trim();
          if (!body) throw new Error('instruction is required');
          if (command === 'answer' && !input.questionId?.trim()) throw new Error('questionId is required');
          command = 'collaboration_post';
          args = { taskId, kind: input.command === 'answer' ? 'answer' : 'instruction', body,
            ...(input.command === 'answer' ? { causationId: input.questionId!.trim() } : {}) };
        } else {
          args = { taskId };
        }
      }
      try {
        const result = await selectedProductTool.execute(toolCallId, { mode: 'task', command, args }, signal, undefined as never);
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
  } as AgentTool<typeof PersonalTaskSchema, Record<string, never>>;
}
