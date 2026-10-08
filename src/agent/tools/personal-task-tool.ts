import { randomUUID } from 'node:crypto';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { resolveEffectiveAgentConfig, type EffectiveAgentConfig } from '../../agent-config/index.js';
import { resolveEffectiveAgentConfigForAgent } from '../../config/agent-profile.js';
import { isProviderConfiguredSync, resolveModel } from '../../providers/index.js';
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
  requiredTools: Type.Optional(Type.Array(Type.String({ description: 'Tool names needed for this Task. Use names returned by agents; omit when matching by role or expertise.' }))),
  idempotencyKey: Type.Optional(Type.String()),
});

const MAX_PERSONAL_TASK_TITLE = 60;
const DISCOVERY_TOOLS = [
  'web_search', 'web_fetch', 'browser_use', 'read_file', 'write_file', 'exec_command',
  'image', 'image_generate', 'read_media', 'automation', 'workflow', 'xopc_use',
  'xopc_tool_search', 'xopc_tool_describe', 'xopc_tool_execute', 'computer_use', 'send_message', 'text_to_speech',
] as const;

export function getAvailablePersonalAgentTools(config: EffectiveAgentConfig, deps: XopcUseToolDeps): string[] {
  const names = config.toolAllowlist ? [...new Set([...DISCOVERY_TOOLS, ...config.toolAllowlist])] : DISCOVERY_TOOLS;
  return names.filter(name => (name !== 'browser_use' || deps.getConfig?.()?.browser?.enabled !== false)
    && (!config.toolAllowlist || config.toolAllowlist.includes(name)) && config.tools[name]?.mode !== 'deny');
}

export function personalAgentModelAvailability(config: EffectiveAgentConfig): { available: boolean; reason?: string } {
  for (const ref of [config.models.chat.primary, ...config.models.chat.fallbacks]) {
    try {
      const model = resolveModel(ref);
      if (isProviderConfiguredSync(model.provider)) return { available: true };
    } catch { /* Try the next configured model. */ }
  }
  return { available: false, reason: 'No configured chat model resolves to an available provider' };
}

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
export function createPersonalTaskTool(deps: XopcUseToolDeps): AgentTool<typeof PersonalTaskSchema, Record<string, never>> {
  const productTool = createXopcUseTool(deps);
  return {
    name: 'personal_task',
    label: 'Personal Task',
    description: 'Find specialist Agents by role, availableTools, and model.available; delegate work, inspect Tasks, send instructions, or answer worker questions. Choose an Agent whose model.available is true. Before saying you cannot do a request, inspect another Agent. If a candidate fails, try another suitable Agent or approach within the user’s authorization. agents can filter by requiredTools; if none match, inspect unfiltered Agents. Return to the user quickly after creation.',
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
        const catalog = new AgentCatalogRepository().snapshot();
        const agents = catalog.agents
          .filter(agent => agent.enabled !== false && agent.id !== ownAgentId && !agent.id.startsWith('personal-'))
          .map(agent => {
            const config = resolveEffectiveAgentConfig({ defaults: catalog.defaults, agent }).config;
            const availableTools = getAvailablePersonalAgentTools(config, deps);
            return { id: agent.id, name: agent.profile?.name ?? agent.id,
              description: agent.profile?.description ?? '', availableTools,
              model: personalAgentModelAvailability(config) };
          }).filter(agent => requiredTools.every(tool => agent.availableTools.includes(tool)));
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
        const brief = buildPersonalTaskBrief({ title: input.title, objective, description: input.description });
        args = {
          ...brief, agentId, createMode: 'start',
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
