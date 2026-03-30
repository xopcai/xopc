import { describe, it, expect } from 'vitest';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { Api, Model } from '@mariozechner/pi-ai';
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

describe('transcript hygiene (OpenClaw-aligned)', () => {
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
