import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

import { createDelegateChildHandle, type DelegateChildHandleOptions } from '../child-agent-factory.js';

const DEFAULT_MAX_ITERATIONS = 30;

export const DEFAULT_DELEGATE_TOOLS = [
  'shell',
  'read_file',
  'write_file',
  'edit_file',
  'grep',
  'find',
  'list_dir',
  'web_search',
  'web_fetch',
] as const;

/** Tools never passed to a delegated sub-agent (even if requested). */
export const DELEGATE_BLOCKED_TOOLS = new Set([
  'delegate_task',
  'clarify',
  'curated_memory',
  'send_message',
  'send_media',
  'todo',
  'session_search',
  'memory_search',
  'memory_get',
  'cronjob',
]);

const DelegateTaskSchema = Type.Object({
  goal: Type.String({
    description: 'Clear description of what the sub-agent should accomplish',
  }),
  context: Type.Optional(
    Type.String({
      description: 'Additional context the sub-agent needs (file paths, constraints, etc.)',
    }),
  ),
  toolset: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Tool names the sub-agent may use. Defaults to shell, read_file, write_file, edit_file, grep, find, list_dir, web_search, web_fetch. ' +
        'Dangerous or interactive tools are always removed.',
    }),
  ),
  maxIterations: Type.Optional(
    Type.Number({
      description: 'Maximum tool executions in the sub-agent (default: 30)',
      default: DEFAULT_MAX_ITERATIONS,
    }),
  ),
});

export interface DelegateToolDeps {
  workspace: string;
  getSubagentModel: () => import('@mariozechner/pi-ai').Model<import('@mariozechner/pi-ai').Api>;
  bus: import('../../infra/bus/index.js').MessageBus;
  getConfig: () => import('../../config/schema.js').Config | undefined;
  toolExecutorConfig?: Partial<import('./executor.js').ToolExecutorConfig>;
}

export function createDelegateTool(deps: DelegateToolDeps): AgentTool<
  typeof DelegateTaskSchema,
  { summary: string; iterations: number }
> {
  return {
    name: 'delegate_task',
    label: '🤖 Delegate',
    description:
      'Spawn a sub-agent for an isolated subtask with a fresh conversation (no parent transcript).\n\n' +
      'The sub-agent returns a text summary only — tool traces stay out of your context.\n\n' +
      'WHEN TO USE:\n' +
      '- Independent work (research, multi-file exploration) where you only need the outcome\n' +
      '- Avoiding context bloat from long intermediate tool output\n\n' +
      'WHEN NOT TO USE:\n' +
      '- Tasks that need this chat history or user clarification\n' +
      '- Single trivial steps\n\n' +
      'Sub-agents cannot use clarify, messaging, memory tools, todo, or nested delegate_task.',
    parameters: DelegateTaskSchema,

    async execute(
      _toolCallId: string,
      params: Static<typeof DelegateTaskSchema>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ summary: string; iterations: number }>> {
      const maxIterations = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      if (!Number.isFinite(maxIterations) || maxIterations < 1 || maxIterations > 200) {
        return {
          content: [{ type: 'text', text: 'Invalid maxIterations (use 1–200).' }],
          details: { summary: '', iterations: 0 },
        };
      }

      const requested = params.toolset ?? [...DEFAULT_DELEGATE_TOOLS];
      const allowedNames = [
        ...new Set(
          requested.map((t) => String(t).trim()).filter(Boolean).filter((t) => !DELEGATE_BLOCKED_TOOLS.has(t)),
        ),
      ];

      if (allowedNames.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No allowed tools remain after applying the delegation blocklist. Expand `toolset` with safe tools.',
            },
          ],
          details: { summary: '', iterations: 0 },
        };
      }

      let model: ReturnType<DelegateToolDeps['getSubagentModel']>;
      try {
        model = deps.getSubagentModel();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `delegate_task: ${msg}` }],
          details: { summary: '', iterations: 0 },
        };
      }

      const childOptions: DelegateChildHandleOptions = {
        workspace: deps.workspace,
        goal: params.goal,
        context: params.context,
        allowedToolNames: allowedNames,
        maxIterations,
        model,
        bus: deps.bus,
        getConfig: deps.getConfig,
        toolExecutorConfig: deps.toolExecutorConfig,
      };

      const child = createDelegateChildHandle(childOptions);

      if (signal) {
        signal.addEventListener('abort', () => child.abort(), { once: true });
      }

      try {
        const { summary, toolIterations } = await child.run();
        return {
          content: [{ type: 'text', text: `Sub-agent completed:\n\n${summary}` }],
          details: { summary, iterations: toolIterations },
        };
      } catch (error) {
        child.abort();
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Sub-agent failed: ${message}` }],
          details: { summary: '', iterations: 0 },
        };
      }
    },
  };
}
