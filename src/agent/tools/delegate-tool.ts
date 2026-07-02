import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import {
  createDelegateChildHandle,
  type BuildChildToolsOptions,
  type DelegateChildHandleOptions,
} from '../child-agent-factory.js';

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
  'automation',
  'skills_list',
  'skill_view',
  'skill_manage',
  'bundle-mcp',
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
  getSubagentModel: () => import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>;
  bus: import('../../infra/bus/index.js').MessageBus;
  getConfig: () => import('../../config/schema.js').Config | undefined;
  getCurrentContext?: () => { sessionKey?: string; channel?: string; accountId?: string; to?: string; threadId?: string | number } | null;
  hookRunner?: import('../../extensions/index.js').ExtensionHookRunner;
  toolExecutorConfig?: Partial<import('./executor.js').ToolExecutorConfig>;
  /**
   * Construct the child agent's tool set. Injected by `AgentToolsFactory` so
   * the child-agent-factory module does not import `tools/factory.ts`
   * (which would form a factory ↔ delegate-tool ↔ child-agent-factory cycle).
   */
  buildChildTools: (opts: BuildChildToolsOptions) => AgentTool<any, any>[];
}

type DelegateTaskParams = {
  goal: string;
  context?: string;
  toolset?: string[];
  maxIterations?: number;
};

export function createDelegateTool(deps: DelegateToolDeps): AgentTool {
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
      params: any,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ summary: string; iterations: number }>> {
      const p = params as DelegateTaskParams;
      const maxIterations = p.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      if (!Number.isFinite(maxIterations) || maxIterations < 1 || maxIterations > 200) {
        return {
          content: [{ type: 'text', text: 'Invalid maxIterations (use 1–200).' }],
          details: { summary: '', iterations: 0 },
        };
      }

      const requested = p.toolset ?? [...DEFAULT_DELEGATE_TOOLS];
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
        goal: p.goal,
        context: p.context,
        allowedToolNames: allowedNames,
        maxIterations,
        model,
        bus: deps.bus,
        getConfig: deps.getConfig,
        toolExecutorConfig: deps.toolExecutorConfig,
        buildChildTools: deps.buildChildTools,
      };

      // Sub-agent lifecycle hook (parity surface for channel thread bindings).
      const ctx = deps.getCurrentContext?.() ?? null;
      const parentSessionKey = ctx?.sessionKey;
      let childSessionKey: string | undefined;
      try {
        if (deps.hookRunner && parentSessionKey) {
          const { parseSessionKey, buildSessionKey } = await import('../../routing/session-key.js');
          const parsed = parseSessionKey(parentSessionKey);
          if (parsed) {
            childSessionKey = buildSessionKey({
              agentId: 'subagent',
              source: parsed.agentId,
              accountId: parsed.accountId,
              peerKind: parsed.peerKind,
              peerId: parsed.peerId,
              threadId: parsed.threadId,
              scopeId: parsed.scopeId,
            });
          }
          if (childSessionKey) {
            const hookResult = await (deps.hookRunner as any).runHooksWithResult(
              'subagent_spawning',
              {
                childSessionKey,
                requester: {
                  channel: ctx?.channel,
                  accountId: ctx?.accountId,
                  to: (ctx as any)?.to,
                  threadId: (ctx as any)?.threadId,
                },
                threadRequested: true,
                agentId: 'subagent',
                label: 'delegate_task',
              },
              { sessionKey: parentSessionKey, agentId: ctx?.channel },
            );
            const r = hookResult as any;
            if (r && r.status === 'error') {
              return {
                content: [{ type: 'text', text: `delegate_task: ${String(r.error || 'subagent spawn blocked')}` }],
                details: { summary: '', iterations: 0 },
              };
            }
          }
        }
      } catch {
        // Hooks are best-effort.
      }

      const child = createDelegateChildHandle(childOptions);

      if (signal) {
        signal.addEventListener('abort', () => child.abort(), { once: true });
      }

      try {
        const { summary, toolIterations } = await child.run();
        try {
          if (deps.hookRunner && childSessionKey) {
            await (deps.hookRunner as any).runHooks(
              'subagent_ended',
              { targetSessionKey: childSessionKey, accountId: ctx?.accountId },
              { sessionKey: parentSessionKey },
            );
          }
        } catch {
          // best-effort
        }
        return {
          content: [{ type: 'text', text: `Sub-agent completed:\n\n${summary}` }],
          details: { summary, iterations: toolIterations },
        };
      } catch (error) {
        child.abort();
        try {
          if (deps.hookRunner && childSessionKey) {
            await (deps.hookRunner as any).runHooks(
              'subagent_ended',
              { targetSessionKey: childSessionKey, accountId: ctx?.accountId },
              { sessionKey: parentSessionKey },
            );
          }
        } catch {
          // best-effort
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Sub-agent failed: ${message}` }],
          details: { summary: '', iterations: 0 },
        };
      }
    },
  } as any;
}
