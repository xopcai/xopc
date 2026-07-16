import { describe, expect, it, vi } from 'vitest';

import { createCodeIntelligenceTools } from '../tools.js';
import type { CodeIntelligenceRuntimeLike, CodeIntelligenceStatus } from '../types.js';

const status: CodeIntelligenceStatus = {
  state: 'ready',
  workspace: '/tmp/project',
  project: 'tmp-project',
  indexedAt: '2026-07-16T00:00:00.000Z',
  dirtyPaths: [],
  coverage: 'complete',
};

function runtime() {
  return {
    prime: vi.fn(),
    markDirty: vi.fn(),
    supportsTool: vi.fn(() => true),
    callTool: vi.fn(async () => ({ text: 'results', status })),
    getStatus: vi.fn(() => status),
    dispose: vi.fn(),
  } satisfies CodeIntelligenceRuntimeLike;
}

describe('code intelligence tools', () => {
  it('registers the curated read-only surface', () => {
    const rt = runtime();
    expect(createCodeIntelligenceTools({ getRuntime: () => rt }).map((tool) => tool.name)).toEqual([
      'code_search',
      'code_read_symbol',
      'code_trace',
      'code_impact',
      'code_architecture',
    ]);
  });

  it('maps code_search to graph search with project and compact defaults', async () => {
    const rt = runtime();
    const tool = createCodeIntelligenceTools({ getRuntime: () => rt })
      .find((candidate) => candidate.name === 'code_search')!;

    const result = await tool.execute('call-1', { query: 'session reset', limit: 7 } as never);

    expect(rt.callTool).toHaveBeenCalledWith('search_graph', {
      project: 'tmp-project',
      query: 'session reset',
      limit: 7,
    }, undefined);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('freshness=ready');
  });

  it('uses the compatible trace tool aliases', async () => {
    const rt = runtime();
    const tool = createCodeIntelligenceTools({ getRuntime: () => rt })
      .find((candidate) => candidate.name === 'code_trace')!;

    await tool.execute('call-2', { functionName: 'runTurn', direction: 'inbound' } as never);

    expect(rt.callTool).toHaveBeenCalledWith(['trace_path', 'trace_call_path'], expect.objectContaining({
      project: 'tmp-project',
      function_name: 'runTurn',
      direction: 'inbound',
      mode: 'calls',
    }), undefined);
  });

  it('uses HEAD for current-worktree impact and normalizes duplicate files', async () => {
    const rt = runtime();
    rt.callTool.mockResolvedValueOnce({
      text: JSON.stringify({
        changed_files: ['src/a.ts', 'src/a.ts'],
        changed_count: 2,
        impacted_symbols: [{ name: 'a' }, { name: 'b' }],
      }),
      status,
    });
    const tool = createCodeIntelligenceTools({ getRuntime: () => rt })
      .find((candidate) => candidate.name === 'code_impact')!;

    const result = await tool.execute('call-impact', { depth: 2, limit: 1 } as never);

    expect(rt.callTool).toHaveBeenCalledWith('detect_changes', {
      project: 'tmp-project',
      since: 'HEAD',
      depth: 2,
    }, undefined);
    const text = (result.content[0] as { text: string }).text;
    expect(text.match(/src\/a\.ts/g)).toHaveLength(1);
    expect(text).toContain('"changed_count":1');
    expect(text).toContain('"impacted_symbol_count":2');
    expect(text).toContain('"impacted_symbols_truncated":true');
    expect(text).not.toContain('"name":"b"');
  });

  it('returns a direct-source fallback when CBM is unavailable', async () => {
    const rt = runtime();
    rt.callTool.mockRejectedValueOnce(new Error('binary missing'));
    const tool = createCodeIntelligenceTools({ getRuntime: () => rt })[0]!;

    const result = await tool.execute('call-3', { query: 'handler' } as never);

    expect((result.content[0] as { text: string }).text).toContain('Use grep/find/read_file');
  });
});
