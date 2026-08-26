import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import {
  buildCompactionUnits,
  extractExactIdentifiers,
  planCompactionChunks,
  serializeMessageForCompaction,
} from '../compaction-planner.js';

const assistantToolCall = {
  role: 'assistant',
  content: [{
    type: 'toolCall',
    id: 'call-42',
    name: 'read_file',
    arguments: { path: '/tmp/project/AGENTS.md' },
  }],
  timestamp: 2,
} as AgentMessage;

const toolResult = {
  role: 'toolResult',
  toolCallId: 'call-42',
  toolName: 'read_file',
  content: [{ type: 'text', text: 'file contents' }],
  details: { bytes: 13 },
  isError: false,
  timestamp: 3,
} as AgentMessage;

describe('compaction planner', () => {
  it('keeps an assistant tool call and matching result in one atomic unit', () => {
    const messages = [
      { role: 'user', content: 'Read the file', timestamp: 1 },
      assistantToolCall,
      toolResult,
      { role: 'assistant', content: 'Done', timestamp: 4 },
    ] as AgentMessage[];

    const units = buildCompactionUnits(messages);

    expect(units).toHaveLength(3);
    expect(units[1]?.messages).toEqual([assistantToolCall, toolResult]);
    expect(units[1]?.text).toContain('read_file');
    expect(units[1]?.text).toContain('/tmp/project/AGENTS.md');
    expect(units[1]?.text).toContain('status: success');
  });

  it('never splits an atomic tool unit across chunks', () => {
    const chunks = planCompactionChunks([
      { role: 'user', content: 'x'.repeat(800), timestamp: 1 } as AgentMessage,
      assistantToolCall,
      toolResult,
      { role: 'user', content: 'y'.repeat(800), timestamp: 4 } as AgentMessage,
    ], 250);

    const chunkWithCall = chunks.find((chunk) => chunk.text.includes('call-42'));
    expect(chunkWithCall?.text).toContain('file contents');
    expect(chunks.filter((chunk) => chunk.text.includes('call-42'))).toHaveLength(1);
  });

  it('keeps media metadata without embedding raw binary data', () => {
    const serialized = serializeMessageForCompaction({
      role: 'user',
      content: [{ type: 'image', mimeType: 'image/png', data: 'secret-binary-data' }],
      timestamp: 1,
    } as AgentMessage);

    expect(serialized).toContain('[image content]');
    expect(serialized).toContain('image/png');
    expect(serialized).not.toContain('secret-binary-data');
  });

  it('does not mistake slash-separated technical terms for paths', () => {
    const messages = [{
      role: 'user',
      content: [
        'Q/K/V FP16/BF16/INT8 FP16/BF16 token/s Key/Value',
        'q4/k4/v4 k4/v4 Prompt/KV PR/commit',
        '/run/123/logs release/1.2 src/agent/service.ts',
        'https://example.com/run/123',
      ].join(' '),
      timestamp: 1,
    }] as AgentMessage[];

    expect(extractExactIdentifiers(messages)).toEqual([
      '/run/123/logs',
      'release/1.2',
      'src/agent/service.ts',
      'https://example.com/run/123',
    ]);
  });
});
