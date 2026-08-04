import { describe, it, expect } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { sanitizeToolUseResultPairing } from '../session-transcript-repair.js';
import { stripToolMessages } from '../strip-tool-messages.js';
import {
  tryApplySessionTranscriptHygiene,
  tryApplySessionTranscriptHygieneForPersistence,
} from '../transcript-hygiene.js';

function thinkingBlockCount(messages: AgentMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const c of m.content) {
      if (c && typeof c === 'object' && (c as { type?: string }).type === 'thinking') {
        n++;
      }
    }
  }
  return n;
}

describe('transcript hygiene', () => {
  it('repairToolUseResultPairing inserts synthetic toolResult for missing id', () => {
    const assistant: AgentMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'toolCall', id: 'call-1', name: 'bash', arguments: '{}' },
      ],
      timestamp: Date.now(),
    };
    const messages: AgentMessage[] = [assistant];
    const repaired = sanitizeToolUseResultPairing(messages);
    expect(repaired.length).toBeGreaterThan(1);
    const tr = repaired.find((m) => m.role === 'toolResult');
    expect(tr?.role).toBe('toolResult');
    expect((tr as { toolCallId?: string }).toolCallId).toBe('call-1');
  });

  it('stripToolMessages removes tool rows', () => {
    const raw = [
      { role: 'user', content: 'hi' },
      { role: 'toolResult', toolCallId: 'x', content: 'out' },
    ];
    const stripped = stripToolMessages(raw);
    expect(stripped).toHaveLength(1);
  });

  it('repairs missing tool results for OpenAI-compatible providers at send time', () => {
    const assistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: {} }],
      stopReason: 'toolUse',
      timestamp: 1,
      api: 'openai-completions',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AgentMessage;
    const model = { api: 'openai-completions', provider: 'deepseek', id: 'deepseek-v4-flash' } as Model<Api>;

    const repaired = tryApplySessionTranscriptHygiene([assistant], model);

    expect(repaired).toHaveLength(2);
    expect(repaired[0]).toMatchObject({ role: 'assistant', content: [expect.objectContaining({ id: 'call1' })] });
    expect(repaired[1]).toMatchObject({ role: 'toolResult', toolCallId: 'call1', isError: true });
  });

  it('repairs a delayed tool result that was persisted after a later assistant turn', () => {
    const assistant = (id: string) => ({
      role: 'assistant',
      content: [{ type: 'toolCall', id, name: 'exec_command', arguments: {} }],
      stopReason: 'toolUse',
      timestamp: 1,
    }) as AgentMessage;
    const result = (id: string) => ({
      role: 'toolResult', toolCallId: id, toolName: 'exec_command',
      content: [{ type: 'text', text: 'done' }], isError: false, timestamp: 2,
    }) as AgentMessage;
    const model = { api: 'openai-completions', provider: 'deepseek', id: 'deepseek-v4-flash' } as Model<Api>;

    const repaired = tryApplySessionTranscriptHygiene([
      assistant('call_a'),
      { role: 'user', content: 'next', timestamp: 2 } as AgentMessage,
      assistant('call_b'),
      result('call_a'),
      result('call_b'),
    ], model);

    expect(repaired.map((message) => message.role)).toEqual([
      'assistant', 'toolResult', 'user', 'assistant', 'toolResult',
    ]);
    expect(repaired[1]).toMatchObject({ toolCallId: 'calla' });
    expect(repaired[4]).toMatchObject({ toolCallId: 'callb' });
  });

  it('persistence hygiene keeps thinking blocks on disk (send-time hygiene may still drop them)', () => {
    const assistant: AgentMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'plan step 1' },
        { type: 'text', text: 'answer' },
      ],
      timestamp: 1,
    };
    const model = {
      api: 'openai-completions',
      provider: 'github-copilot',
      id: 'gpt-4',
    } as Model<Api>;

    const persisted = tryApplySessionTranscriptHygieneForPersistence([assistant], model);
    const sendTime = tryApplySessionTranscriptHygiene([assistant], model);

    expect(thinkingBlockCount(persisted)).toBe(1);
    expect(thinkingBlockCount(sendTime)).toBeLessThanOrEqual(thinkingBlockCount(persisted));
  });
});
