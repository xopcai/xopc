import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { describe, expect, it } from 'vitest';

import {
  buildSessionContextForLlm,
  isTranscriptContextEntry,
  mergeLlmMessagesPreservingContextRows,
  transcriptRowsFromJsonArray,
} from '../session-context-for-llm.js';

describe('session-context-for-llm', () => {
  it('buildSessionContextForLlm drops kind: context', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'x' }] } as AgentMessage;
    const rows = [u, { kind: 'context', text: 'note' } as const];
    expect(buildSessionContextForLlm(rows)).toEqual([u]);
  });

  it('isTranscriptContextEntry', () => {
    expect(isTranscriptContextEntry({ kind: 'context' })).toBe(true);
    expect(isTranscriptContextEntry({ role: 'user', content: 'a' })).toBe(false);
  });

  it('mergeLlmMessagesPreservingContextRows keeps context slots in order', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'u' }] } as AgentMessage;
    const a = { role: 'assistant', content: [{ type: 'text', text: 'a' }] } as AgentMessage;
    const prev = [
      u,
      { kind: 'context', text: 'between' } as const,
      a,
    ];
    const u2 = { role: 'user', content: [{ type: 'text', text: 'u2' }] } as AgentMessage;
    const a2 = { role: 'assistant', content: [{ type: 'text', text: 'a2' }] } as AgentMessage;
    const merged = mergeLlmMessagesPreservingContextRows(prev, [u2, a2]);
    expect(merged).toEqual([u2, { kind: 'context', text: 'between' }, a2]);
  });

  it('transcriptRowsFromJsonArray accepts mixed rows', () => {
    const rows = transcriptRowsFromJsonArray([
      { role: 'user', content: 'h' },
      { kind: 'context', text: 't' },
      { foo: 'skip' },
    ] as unknown[]);
    expect(rows).toHaveLength(2);
  });
});
