import { describe, it, expect } from 'vitest';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { sanitizeToolUseResultPairing } from '../session-transcript-repair.js';
import { stripToolMessages } from '../strip-tool-messages.js';

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
});
