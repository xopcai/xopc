import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import { ExternalToolService } from '../service.js';
import type {
  ExternalToolDescriptor,
  ExternalToolProvider,
  ExternalToolSearchHit,
  ExternalToolSource,
} from '../types.js';

function provider(params: {
  source: ExternalToolSource;
  hits?: ExternalToolSearchHit[];
  descriptor?: ExternalToolDescriptor;
  execute?: ExternalToolProvider['execute'];
}): ExternalToolProvider {
  return {
    source: params.source,
    search: vi.fn(async () => params.hits ?? []),
    describe: vi.fn(async (toolRef) => (
      params.descriptor?.toolRef === toolRef ? params.descriptor : undefined
    )),
    execute: params.execute ?? vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    } as AgentToolResult<Record<string, unknown>>)),
  };
}

const descriptor: ExternalToolDescriptor = {
  toolRef: 'extension:demo:add',
  source: 'extension',
  namespace: 'demo',
  title: 'add',
  summary: 'Add two values',
  description: 'Add two values.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  },
};

describe('ExternalToolService', () => {
  it('federates, ranks, limits, and isolates unavailable providers', async () => {
    const service = new ExternalToolService([
      provider({ source: 'extension', hits: [descriptor] }),
      {
        ...provider({ source: 'mcp' }),
        search: vi.fn(async () => { throw new Error('offline'); }),
      },
    ]);

    await expect(service.search({ query: 'add values', limit: 1 })).resolves.toEqual({
      tools: [{
        toolRef: descriptor.toolRef,
        source: descriptor.source,
        namespace: descriptor.namespace,
        title: descriptor.title,
        summary: descriptor.summary,
      }],
      unavailableSources: ['mcp'],
    });
  });

  it('requires the described revision and validates arguments before execution', async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'done' }],
      details: {},
    }));
    const service = new ExternalToolService([
      provider({ source: 'extension', descriptor, execute }),
    ]);
    const described = await service.describe([descriptor.toolRef]);
    const revision = described.tools[0]?.revision;
    expect(revision).toMatch(/^[a-f0-9]{16}$/);

    await expect(service.execute({
      toolRef: descriptor.toolRef,
      revision: 'stale',
      arguments: { value: 1 },
      context: { toolCallId: 'call-1' },
    })).rejects.toThrow('Tool contract changed');
    await expect(service.execute({
      toolRef: descriptor.toolRef,
      revision: revision!,
      arguments: { value: 'wrong' },
      context: { toolCallId: 'call-2' },
    })).rejects.toThrow('Arguments do not match');

    await expect(service.execute({
      toolRef: descriptor.toolRef,
      revision: revision!,
      arguments: { value: 2 },
      context: { toolCallId: 'call-3' },
    })).resolves.toMatchObject({ content: [{ text: 'done' }] });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('bounds describe calls', async () => {
    const service = new ExternalToolService([provider({ source: 'extension', descriptor })]);
    await expect(service.describe([])).rejects.toThrow('Describe between 1 and 3');
    await expect(service.describe(['a', 'b', 'c', 'd'])).rejects.toThrow('Describe between 1 and 3');
  });
});
