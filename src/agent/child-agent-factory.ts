import { Agent, type AgentEvent, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { Config } from '../config/schema.js';
import type { MessageBus } from '../infra/bus/index.js';
import { resolveProviderApiKeySync } from '../auth/sync-provider-auth.js';
import { getApiKeySync } from '../providers/index.js';
import { createExtensionAwareStreamFn } from '../providers/extension-stream-bridge.js';
import { createLogger } from '../utils/logger.js';

import { extractTextContent } from './context/workspace.js';
import {
  resolveAgentTurnTimeoutMs,
  runAgentTurnWithTimeout,
} from './orchestration/run-agent-turn-with-timeout.js';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolExecutorConfig } from './tools/executor.js';
// `AgentToolsFactory` is NOT imported here on purpose — `tools/factory.js`
// constructs the delegate tool, which would create a factory ↔ delegate-tool
// ↔ child-agent-factory cycle. Instead, the caller supplies a
// `buildChildTools()` callback that produces the already-constructed child
// tool set (see `DelegateChildHandleOptions.buildChildTools`).

const log = createLogger('delegate-child');

export function buildChildSystemPrompt(goal: string, context?: string, workspace?: string): string {
  const parts = [
    'You are a focused sub-agent working on a specific delegated task.',
    '',
    `YOUR TASK:\n${goal}`,
  ];

  if (context?.trim()) {
    parts.push(`\nCONTEXT:\n${context.trim()}`);
  }

  if (workspace?.trim()) {
    parts.push(`\nWORKSPACE: ${workspace.trim()}`);
  }

  parts.push(
    '\nComplete this task using only the tools available to you. ' +
      'When finished, reply with a clear, concise summary covering:\n' +
      '- What you did\n' +
      '- What you found or accomplished\n' +
      '- Files created or modified\n' +
      '- Issues encountered\n\n' +
      'Your final reply is returned to the parent agent — be thorough but compact.',
  );

  return parts.join('\n');
}

export interface BuildChildToolsOptions {
  workspace: string;
  bus: MessageBus;
  model: Model<Api>;
  getConfig: () => Config | undefined;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
}

export interface DelegateChildProgressHooks {
  mode: 'steps' | 'full';
  onProgress: (event: {
    type: 'tool_start' | 'tool_end' | 'iteration' | 'text_delta' | 'thinking_delta';
    toolCallId?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    isError?: boolean;
    count?: number;
    max?: number;
    delta?: string;
  }) => void;
}

export interface DelegateChildHandleOptions {
  workspace: string;
  goal: string;
  context?: string;
  allowedToolNames: string[];
  maxIterations: number;
  model: Model<Api>;
  bus: MessageBus;
  getConfig: () => Config | undefined;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  /**
   * Construct the child agent's tool set. Injected by the caller (delegate-tool)
   * so this module does not import `tools/factory.js` (which would form a
   * factory ↔ delegate-tool ↔ child-agent-factory cycle).
   */
  buildChildTools: (opts: BuildChildToolsOptions) => AgentTool<any, any>[];
  /** Optional live progress for workflow subagents. */
  progressHooks?: DelegateChildProgressHooks;
}

export interface DelegateChildRunResult {
  summary: string;
  toolIterations: number;
}

export interface DelegateChildHandle {
  run(): Promise<DelegateChildRunResult>;
  abort(): void;
}

/**
 * Build an isolated tool factory (no extensions, no session memory hooks) and a child {@link Agent}.
 */
export function createDelegateChildHandle(options: DelegateChildHandleOptions): DelegateChildHandle {
  const allTools = options.buildChildTools({
    workspace: options.workspace,
    bus: options.bus,
    model: options.model,
    getConfig: options.getConfig,
    toolExecutorConfig: options.toolExecutorConfig,
  });

  const allow = new Set(options.allowedToolNames);
  const filteredTools = allTools.filter((t) => allow.has(t.name));

  if (filteredTools.length === 0) {
    return {
      async run() {
        return {
          summary: 'No tools matched the allowlist after factory registration.',
          toolIterations: 0,
        };
      },
      abort() {},
    };
  }

  let toolIterations = 0;
  let aborted = false;
  const progress = options.progressHooks;

  const agent = new Agent({
    initialState: {
      systemPrompt: buildChildSystemPrompt(options.goal, options.context, options.workspace),
      model: options.model,
      thinkingLevel: 'low' as ThinkingLevel,
      tools: filteredTools,
      messages: [],
    },
    streamFn: createExtensionAwareStreamFn(),
    getApiKey: (provider: string) =>
      resolveProviderApiKeySync(provider) ?? getApiKeySync(provider) ?? '',
    beforeToolCall: async ({ toolCall, args }) => {
      if (aborted) {
        return { block: true, reason: 'Sub-agent aborted.' };
      }
      if (toolIterations >= options.maxIterations) {
        return {
          block: true,
          reason: `Sub-agent reached max tool iterations (${options.maxIterations}).`,
        };
      }
      progress?.onProgress({
        type: 'tool_start',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: (args ?? {}) as Record<string, unknown>,
      });
      return undefined;
    },
    afterToolCall: async ({ toolCall, isError }) => {
      toolIterations += 1;
      progress?.onProgress({
        type: 'iteration',
        count: toolIterations,
        max: options.maxIterations,
      });
      progress?.onProgress({
        type: 'tool_end',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        isError: Boolean(isError),
      });
      return undefined;
    },
  });

  const userText = options.context?.trim()
    ? `${options.goal}\n\nAdditional context:\n${options.context.trim()}`
    : options.goal;

  return {
    async run(): Promise<DelegateChildRunResult> {
      toolIterations = 0;
      aborted = false;
      const unsub =
        progress?.mode === 'full'
          ? agent.subscribe((ev: AgentEvent) => {
              if (ev.type === 'message_update') {
                const u = ev as Extract<AgentEvent, { type: 'message_update' }>;
                const delta = u.assistantMessageEvent;
                if (delta?.type === 'text_delta' && typeof delta.delta === 'string' && delta.delta) {
                  progress.onProgress({ type: 'text_delta', delta: delta.delta });
                }
                if (delta?.type === 'thinking_delta' && typeof delta.delta === 'string' && delta.delta) {
                  progress.onProgress({ type: 'thinking_delta', delta: delta.delta });
                }
              }
            })
          : undefined;
      try {
        await runAgentTurnWithTimeout(
          agent,
          async () => {
            await agent.prompt(userText);
            await agent.waitForIdle();
          },
          resolveAgentTurnTimeoutMs(options.getConfig()),
        );

        const messages = agent.state.messages;
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.role === 'assistant') {
            const content: unknown = msg.content;
            if (typeof content === 'string') {
              return { summary: content.trim() || '(empty assistant message)', toolIterations };
            }
            if (Array.isArray(content)) {
              const text = extractTextContent(content as Array<{ type: string; text?: string }>);
              return {
                summary: text.trim() || '(empty assistant message)',
                toolIterations,
              };
            }
          }
        }

        return {
          summary: aborted
            ? 'Sub-agent was aborted before producing a result.'
            : 'Sub-agent completed but produced no assistant text.',
          toolIterations,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const m = options.model as { model?: string; id?: string };
        const modelId = m?.model ?? m?.id;
        log.warn(
          {
            err: e,
            errorMessage: msg,
            goalPreview: options.goal.slice(0, 120),
            maxIterations: options.maxIterations,
            allowedToolCount: options.allowedToolNames.length,
            modelId,
          },
          `Delegate child run failed: ${msg}`,
        );
        return {
          summary: `Sub-agent error: ${msg}`,
          toolIterations,
        };
      } finally {
        unsub?.();
      }
    },

    abort(): void {
      aborted = true;
      agent.abort();
    },
  };
}
