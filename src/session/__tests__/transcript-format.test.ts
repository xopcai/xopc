import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '@mariozechner/pi-agent-core';

import {
  buildTranscriptEnvelope,
  CURRENT_SESSION_TRANSCRIPT_VERSION,
  parseStoredTranscriptJson,
  XOPC_SESSION_TRANSCRIPT_TYPE,
} from '../transcript-format.js';

describe('transcript-format', () => {
  it('parses legacy JSON array', () => {
    const raw = JSON.stringify([{ role: 'user', content: 'hi' }] as AgentMessage[]);
    const { messages, rows, envelope } = parseStoredTranscriptJson(raw);
    expect(envelope).toBeNull();
    expect(messages).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it('parses wrapped v1 document', () => {
    const doc = buildTranscriptEnvelope({
      storedRows: [{ role: 'user', content: 'x' }] as AgentMessage[],
      previous: null,
    });
    const round = parseStoredTranscriptJson(JSON.stringify(doc));
    expect(round.envelope?.id).toBe(doc.id);
    expect(round.messages).toEqual(doc.messages);
  });

  it('strips kind:context from messages (LLM view) but keeps rows', () => {
    const stored: AgentMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'u' }] } as AgentMessage];
    const doc = buildTranscriptEnvelope({
      storedRows: [
        ...stored,
        { kind: 'context', text: 'audit', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      previous: null,
    });
    const round = parseStoredTranscriptJson(JSON.stringify(doc));
    expect(round.rows).toHaveLength(2);
    expect(round.messages).toHaveLength(1);
    expect(round.messages[0].role).toBe('user');
  });

  it('preserves id and merges compactions', () => {
    const first = buildTranscriptEnvelope({
      storedRows: [{ role: 'user', content: 'a' }] as AgentMessage[],
      previous: null,
    });
    const second = buildTranscriptEnvelope({
      storedRows: [{ role: 'user', content: 'a' }] as AgentMessage[],
      previous: first,
      appendCompaction: {
        at: '2026-01-01T00:00:00.000Z',
        summary: 's1',
        firstKeptIndex: 3,
        tokensBefore: 100,
        tokensAfter: 20,
      },
    });
    expect(second.id).toBe(first.id);
    expect(second.compactions).toHaveLength(1);

    const third = buildTranscriptEnvelope({
      storedRows: second.messages,
      previous: second,
      appendCompaction: {
        at: '2026-01-02T00:00:00.000Z',
        summary: 's2',
        firstKeptIndex: 1,
        tokensBefore: 50,
        tokensAfter: 10,
      },
    });
    expect(third.compactions).toHaveLength(2);
  });

  it('filters invalid compaction entries on parse', () => {
    const raw = JSON.stringify({
      type: XOPC_SESSION_TRANSCRIPT_TYPE,
      version: CURRENT_SESSION_TRANSCRIPT_VERSION,
      id: 'test-id-uuid',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      messages: [],
      compactions: [{ at: 1 }, { incomplete: true }],
    });
    const { envelope } = parseStoredTranscriptJson(raw);
    expect(envelope?.compactions).toBeUndefined();
  });
});
