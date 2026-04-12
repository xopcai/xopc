import { Agent, type ThinkingLevel } from '@mariozechner/pi-agent-core';
import type { Api, Model } from '@mariozechner/pi-ai';

import type { Config } from '../config/schema.js';
import type { MessageBus } from '../infra/bus/index.js';
import { resolveProviderApiKeySync } from '../auth/sync-provider-auth.js';
import { getApiKeySync } from '../providers/index.js';
import { createLogger } from '../utils/logger.js';

import { extractTextContent } from './context/workspace.js';
import {
  resolveAgentTurnTimeoutMs,
  runAgentTurnWithTimeout,
} from './orchestration/run-agent-turn-with-timeout.js';
import type { ToolExecutorConfig } from './tools/executor.js';
import { AgentToolsFactory } from './tools/factory.js';

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
  const childFactory = new AgentToolsFactory({
    workspace: options.workspace,
    bus: options.bus,
    getCurrentContext: () => null,
    getConfig: options.getConfig,
    getPrimaryModel: () => options.model,
    toolExecutorConfig: options.toolExecutorConfig,
  });

  const allTools = childFactory.createAllTools({
    workspace: options.workspace,
    getPrimaryModel: () => options.model,
    disabledTools: new Set(['extensions']),
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

  const agent = new Agent({
    initialState: {
      systemPrompt: buildChildSystemPrompt(options.goal, options.context, options.workspace),
      model: options.model,
      thinkingLevel: 'low' as ThinkingLevel,
      tools: filteredTools,
      messages: [],
    },
    getApiKey: (provider: string) =>
      resolveProviderApiKeySync(provider) ?? getApiKeySync(provider) ?? '',
    beforeToolCall: async () => {
      if (aborted) {
        return { block: true, reason: 'Sub-agent aborted.' };
      }
      if (toolIterations >= options.maxIterations) {
        return {
          block: true,
          reason: `Sub-agent reached max tool iterations (${options.maxIterations}).`,
        };
      }
      return undefined;
    },
    afterToolCall: async () => {
      toolIterations += 1;
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
        log.warn({ err: msg }, 'Delegate child run failed');
        return {
          summary: `Sub-agent error: ${msg}`,
          toolIterations,
        };
      }
    },

    abort(): void {
      aborted = true;
      agent.abort();
    },
  };
}
