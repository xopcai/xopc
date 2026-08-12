import { Agent, type AgentMessage, type AgentTool, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';

import { isAssistantTurnAborted, isAssistantTurnFailed } from '../../agent/orchestration/llm-turn-retry.js';
import { runAgentTurnWithTimeout } from '../../agent/orchestration/run-agent-turn-with-timeout.js';
import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import type { Config } from '../../config/schema.js';
import { getApiKeySync, getDefaultModelSync, resolveModel } from '../../providers/index.js';
import { createExtensionAwareStreamFn } from '../../providers/extension-stream-bridge.js';

import type { ProactiveAgentExecutor } from './types.js';

const MAX_TOOL_CALLS = 6;
const AGENT_TIMEOUT_MS = 90_000;

function assistantText(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (Array.isArray(message.content)) {
      return message.content.flatMap((block) => block && typeof block === 'object'
        && (block as { type?: unknown }).type === 'text'
        ? [String((block as { text?: unknown }).text ?? '')]
        : []).join('').trim();
    }
  }
  return '';
}

function inspectionTool(context: Record<string, unknown>): AgentTool<any, Record<string, unknown>> {
  return {
    name: 'inspect_authorized_context',
    label: 'Inspect authorized work context',
    description: 'Read one authorized evidence section. This tool cannot write or trigger any action.',
    parameters: Type.Object({
      section: Type.String({ description: 'A top-level section name from the availableSections list.' }),
    }),
    async execute(_toolCallId, args) {
      const values = args as Record<string, unknown>;
      const section = typeof values.section === 'string' ? values.section : '';
      if (!Object.prototype.hasOwnProperty.call(context, section)) {
        return { content: [{ type: 'text', text: `Unknown section. Available: ${Object.keys(context).join(', ')}` }], details: { found: false } };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ section, evidence: context[section] }, null, 2).slice(0, 60_000) }],
        details: { found: true, section },
      };
    },
  };
}

/** Runs an isolated, read-only agent over only the context authorized by the signal batch. */
export class ReadonlyProactiveAgentExecutor implements ProactiveAgentExecutor {
  constructor(private readonly config: () => Config | undefined) {}

  async execute(input: {
    systemPrompt: string;
    userPrompt: string;
    authorizedContext: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<{ text: string; modelRef: string }> {
    const model = resolveModel(getDefaultModelSync(this.config())) as Model<Api>;
    let toolCalls = 0;
    const agent = new Agent({
      initialState: {
        systemPrompt: `${input.systemPrompt}\n\nYou are an autonomous background analysis agent. You MUST inspect relevant authorized context with the provided read-only tool before reaching a conclusion. You have no mutation, messaging, shell, network, or filesystem tools.`,
        model,
        thinkingLevel: 'low' as ThinkingLevel,
        tools: [inspectionTool(input.authorizedContext)],
        messages: [],
      },
      streamFn: createExtensionAwareStreamFn(),
      getApiKey: (provider: string) => resolveProviderApiKeySync(provider) ?? getApiKeySync(provider) ?? '',
      beforeToolCall: async () => {
        if (toolCalls >= MAX_TOOL_CALLS) return { block: true, reason: `Maximum inspection calls reached (${MAX_TOOL_CALLS}).` };
        return undefined;
      },
      afterToolCall: async () => { toolCalls += 1; return undefined; },
    });
    const abort = () => agent.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    try {
      const sections = Object.keys(input.authorizedContext);
      await runAgentTurnWithTimeout(agent, async () => {
        await agent.prompt(`${input.userPrompt}\n\nAvailable authorized evidence sections: ${sections.join(', ') || '(none)'}.`);
        await agent.waitForIdle();
      }, AGENT_TIMEOUT_MS);
      if (isAssistantTurnAborted(agent)) throw new Error('Proactive agent execution aborted');
      if (isAssistantTurnFailed(agent)) throw new Error('Proactive agent execution failed');
      const text = assistantText(agent.state.messages);
      if (!text) throw new Error('Proactive agent returned empty output');
      if (toolCalls === 0) throw new Error('Proactive agent did not inspect authorized evidence');
      return { text, modelRef: `${model.provider}/${model.id}` };
    } finally {
      input.signal?.removeEventListener('abort', abort);
    }
  }
}
