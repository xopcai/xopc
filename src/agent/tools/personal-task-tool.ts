import { randomUUID } from 'node:crypto';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { resolveEffectiveAgentConfig } from '../../agent-config/index.js';
import { resolveEffectiveAgentConfigForAgent } from '../../config/agent-profile.js';
import { getAvailablePersonalAgentTools, personalAgentModelAvailability } from '../../personal-agent/specialist-capabilities.js';
export { getAvailablePersonalAgentTools, personalAgentModelAvailability } from '../../personal-agent/specialist-capabilities.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import { PERSONAL_WORKER_RESULT_GUIDANCE } from '../../personal-agent/communication.js';
import { TaskOriginRepository } from '../../tasks/task-origin-repository.js';
import { createXopcUseTool, type XopcUseToolDeps } from './xopc-use-tool.js';

const PersonalTaskSchema = Type.Object({
  command: Type.Union([Type.Literal('agents'), Type.Literal('create'), Type.Literal('list'), Type.Literal('get'), Type.Literal('instruct'), Type.Literal('answer')]),
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
  getAgentSkillAvailability?: (agentId: string) => {
    skills: Array<{ name: string; availableForCurrentAgent: boolean; unavailableReason?: string | null }>;
  };
}

class PersonalSkillUnavailableError extends Error {}

function resolveRequiredSkills(deps: PersonalTaskToolDeps, agentId: string, requested: string[]): string[] {
  if (requested.length === 0) return [];
  if (!deps.getAgentSkillAvailability) throw new Error('Specialist Skill availability cannot be verified');
  const skills = deps.getAgentSkillAvailability(agentId).skills;
  return [...new Set(requested.map(name => name.trim().toLowerCase()))].map(name => {
    const skill = skills.find(item => item.name.toLowerCase() === name);
    if (!skill?.availableForCurrentAgent) {
      throw new PersonalSkillUnavailableError(`Agent ${agentId} cannot use required Skill ${name}: ${skill?.unavailableReason ?? 'not-installed'}. Do not substitute the requested Skill without the user’s direction.`);
    }
    return skill.name;
  });
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
  return {
    name: 'personal_task',
    label: 'Personal Task',
    description: 'Find specialist Agents by role, availableTools, and model.available; delegate work, inspect Tasks, send instructions, or answer worker questions. Choose an Agent whose model.available is true. Before saying you cannot do a request, inspect another Agent. If a candidate fails, retry alternatives within the user’s authorization only when the user has not required a particular Agent or Skill. For explicitly requested Skills, use requiredSkills in agents and create; creation validates availability and includes them in the worker brief. agents can filter by requiredTools or requiredSkills; if none match, inspect unfiltered Agents. Return to the user quickly after creation.',
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
      if (input.command === 'agents') {
        const requiredTools = input.requiredTools ?? [];
        if (input.requiredSkills?.length && !deps.getAgentSkillAvailability) throw new Error('Specialist Skill availability cannot be verified');
        const repository = new AgentCatalogRepository();
        const catalog = repository.snapshot();
        const agents = catalog.agents
          .filter(agent => agent.enabled !== false && agent.id !== ownAgentId && !agent.id.startsWith('personal-'))
          .map(agent => {
            const config = resolveEffectiveAgentConfig({ defaults: catalog.defaults, agent }).config;
            const availableTools = getAvailablePersonalAgentTools(config, deps);
            let requiredSkills: string[];
            try { requiredSkills = resolveRequiredSkills(deps, agent.id, input.requiredSkills ?? []); }
            catch (error) {
              if (error instanceof PersonalSkillUnavailableError) return null;
              throw error;
            }
            return { ...(requiredSkills.length ? { verifiedSkills: requiredSkills } : {}), id: agent.id, name: agent.profile?.name ?? agent.id,
              description: agent.profile?.description ?? '', availableTools,
              model: personalAgentModelAvailability(config) };
          }).filter(agent => agent !== null && requiredTools.every(tool => agent.availableTools.includes(tool)));
        return { content: [{ type: 'text', text: JSON.stringify(agents) }], details: {} };
      }
      let command: string = input.command;
      let args: Record<string, unknown> = {};
      if (command === 'create') {
        const objective = input.objective?.trim();
        const agentId = input.agentId?.trim();
        if (!objective || !agentId) throw new Error('objective and specialist agentId are required');
        if (agentId === ownAgentId || agentId.startsWith('personal-')) throw new Error('Delegate to a specialist Agent, not a personal Agent');
        const specialist = new AgentCatalogRepository().get(agentId);
        if (!specialist || specialist.enabled === false || specialist.provisioningState !== 'ready') {
          throw new Error(`Specialist Agent is unavailable: ${agentId}`);
        }
        const config = resolveEffectiveAgentConfigForAgent(agentId).config;
        const model = personalAgentModelAvailability(config);
        if (!model.available) throw new Error(`Agent ${agentId} cannot start: ${model.reason}. Find another available Agent.`);
        const availableTools = getAvailablePersonalAgentTools(config, deps);
        const missingTools = (input.requiredTools ?? []).filter(tool => !availableTools.includes(tool));
        if (missingTools.length > 0) {
          throw new Error(`Agent ${agentId} lacks required tools: ${missingTools.join(', ')}. Find another Agent or approach.`);
        }
        const requiredSkills = resolveRequiredSkills(deps, agentId, input.requiredSkills ?? []);
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
          idempotencyKey: input.idempotencyKey?.trim() || randomUUID(),
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
      const result = await productTool.execute(toolCallId, { mode: 'task', command, args }, signal, undefined as never);
      return { content: result.content, details: {} };
    },
  } as AgentTool<typeof PersonalTaskSchema, Record<string, never>>;
}
