import { describe, expect, it } from 'vitest';

import {
  buildCtxHistoryJsonl,
  buildCtxPluginManifest,
  CTX_HISTORY_SCHEMA_VERSION,
  CTX_PROVIDER_KEY,
  CTX_SOURCE_FORMAT,
  CTX_SOURCE_ID,
  type XopcHistorySession,
} from '../format.js';

function parseJsonl(contents: string): Array<Record<string, unknown>> {
  return contents.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

function sessionWithEntries(payloads: unknown[]): XopcHistorySession {
  return {
    sessionId: 'session-1',
    status: 'active',
    createdAt: Date.parse('2026-08-01T10:00:00Z'),
    archivedAt: null,
    cwd: '/workspace/xopc',
    agentId: 'main',
    sessionType: 'chat',
    entries: payloads.map((payload, index) => ({
      entryId: `entry-${index + 1}`,
      seq: index + 1,
      createdAt: Date.parse(`2026-08-01T10:00:${String(index + 1).padStart(2, '0')}Z`),
      payloadJson: JSON.stringify(payload),
    })),
  };
}

describe('ctx history format', () => {
  it('exports visible conversation, tool, command, and summary events without hidden context or reasoning', () => {
    const history = buildCtxHistoryJsonl([sessionWithEntries([
      { role: 'user', content: 'ship the exporter' },
      { kind: 'context', text: 'private injected context' },
      { role: 'system', content: 'private system prompt' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'private chain of thought' },
          { type: 'text', text: 'I will implement it.' },
          { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'README.md' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read_file',
        content: [{ type: 'text', text: 'file contents' }],
        isError: false,
      },
      { role: 'bashExecution', command: 'pnpm test', output: 'all tests passed', exitCode: 0 },
      { role: 'custom', display: false, content: 'hidden extension message' },
      {
        type: 'compaction',
        summary: 'The exporter design is settled.',
        messages: [{ role: 'user', content: 'private compacted content' }],
      },
    ])]);
    const records = parseJsonl(history.contents);
    const events = records.filter((record) => record.record_type === 'event');
    const serialized = JSON.stringify(records);

    expect(records[0]).toEqual({
      record_type: 'manifest',
      schema_version: CTX_HISTORY_SCHEMA_VERSION,
      producer: 'xopc',
    });
    expect(records[1]).toEqual({
      record_type: 'source',
      source_id: CTX_SOURCE_ID,
      provider_key: CTX_PROVIDER_KEY,
      source_format: CTX_SOURCE_FORMAT,
    });
    expect(events.map((event) => event.event_type)).toEqual([
      'message',
      'message',
      'tool_call',
      'tool_output',
      'command_started',
      'command_output',
      'command_finished',
      'summary',
    ]);
    expect(serialized).toContain('ship the exporter');
    expect(serialized).toContain('read_file');
    expect(serialized).toContain('all tests passed');
    expect(serialized).toContain('The exporter design is settled.');
    expect(serialized).not.toContain('private injected context');
    expect(serialized).not.toContain('private system prompt');
    expect(serialized).not.toContain('private chain of thought');
    expect(serialized).not.toContain('hidden extension message');
    expect(serialized).not.toContain('private compacted content');
    expect(new Set(events.map((event) => event.event_id)).size).toBe(events.length);
    expect(events.map((event) => event.event_index)).toEqual([
      65_536,
      262_144,
      262_145,
      327_680,
      393_216,
      393_217,
      393_218,
      524_288,
    ]);
  });

  it('chunks large UTF-8 text while keeping every physical line below the ctx limit', () => {
    const text = '🙂'.repeat(300_000);
    const history = buildCtxHistoryJsonl([sessionWithEntries([{ role: 'user', content: text }])]);
    const records = parseJsonl(history.contents);
    const events = records.filter((record) => record.record_type === 'event');
    const restored = events
      .map((event) => (event.payload as { text: string }).text)
      .join('');

    expect(events).toHaveLength(2);
    expect(restored).toBe(text);
    for (const line of history.contents.trimEnd().split('\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(16 * 1024 * 1024);
    }
  });

  it('builds a relative, provider-owned ctx plugin manifest', () => {
    expect(JSON.parse(buildCtxPluginManifest())).toEqual({
      schema_version: 1,
      name: 'xopc',
      display_name: 'XOPC history',
      version: '1.0.0',
      history_sources: [{
        id: 'default',
        provider_key: 'xopc',
        source_id: 'default',
        source_format: 'xopc-session-history-v1',
        path: 'history.jsonl',
        enabled: true,
        refresh: 'manual',
      }],
    });
  });
});
