import { Value } from '@sinclair/typebox/value';
import { describe, expect, it, vi } from 'vitest';

import { createExternalToolGatewayTools, EXTERNAL_TOOL_NAMES } from '../gateway-tools.js';
import { EXTERNAL_TOOL_SOURCES, type ExternalToolProvider } from '../types.js';

vi.mock('../../../connectors/connection-candidates.js', () => ({
  connectionCandidates: () => [],
  resolveConnectionCandidate: vi.fn(),
}));

describe('external tool discovery gateway', () => {
  const contract = {
    toolRef: 'cli:wecom-workspace:doc.search', source: 'cli' as const,
    namespace: 'wecom-workspace', title: 'doc.search',
    summary: 'Search WeCom documents', description: 'Search WeCom documents',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  };
  const setup = () => {
    const cli: ExternalToolProvider = {
      source: 'cli', search: vi.fn(async () => [contract]),
      describe: vi.fn(async ref => ref === contract.toolRef ? contract : undefined),
      execute: vi.fn(async () => ({ content: [], details: {} })),
    };
    const tools = createExternalToolGatewayTools([cli]);
    return { cli, search: tools.find(tool => tool.name === EXTERNAL_TOOL_NAMES.search)!,
      describe: tools.find(tool => tool.name === EXTERNAL_TOOL_NAMES.describe)! };
  };
  const payload = (result: Awaited<ReturnType<ReturnType<typeof setup>['search']['execute']>>) =>
    JSON.parse((result.content[0] as { text: string }).text);

  it.each([undefined, ['cli']] as const)('discovers and describes WeCom with sources=%j', async sources => {
    const tools = setup();
    const params = { query: 'wecom doc.search', ...(sources ? { sources: [...sources] } : {}) };
    expect(Value.Check(tools.search.parameters, params)).toBe(true);
    const found = payload(await tools.search.execute('search', params));
    expect(found.tools).toHaveLength(1);
    if (!sources) expect(found.searchScope).toBeUndefined();
    expect(found.tools[0].toolRef).toBe(contract.toolRef);
    expect(tools.cli.search).toHaveBeenCalledWith('wecom doc.search');
    const described = payload(await tools.describe.execute('describe', { toolRefs: [found.tools[0].toolRef] }));
    expect(described.tools[0]).toMatchObject({ toolRef: contract.toolRef, inputSchema: contract.inputSchema });
    expect(described.tools[0].revision).toBeTruthy();
  });

  it('respects explicit filters and finds CLI tools when the filter is removed', async () => {
    const tools = setup();
    const filtered = payload(await tools.search.execute('search', {
      query: 'wecom doc.search', sources: ['mcp', 'composio', 'extension', 'endpoint'],
    }));
    expect(filtered.tools).toEqual([]);
    expect(filtered.searchScope.excludedSources).toContain('cli');
    expect(filtered.searchScope.instruction).toContain('Retry without sources');
    expect(tools.cli.search).not.toHaveBeenCalled();
    expect(payload(await tools.search.execute('retry', { query: 'wecom doc.search' })).tools).toHaveLength(1);
  });

  it('reports omitted CLI even when another source returns unrelated tools', async () => {
    const other: ExternalToolProvider = {
      source: 'composio',
      search: async () => [{ toolRef: 'composio:gmail:list', source: 'composio', namespace: 'gmail', title: 'list drafts', summary: 'Gmail drafts' }],
      describe: async () => undefined, execute: async () => ({ content: [], details: {} }),
    };
    const search = createExternalToolGatewayTools([other]).find(tool => tool.name === EXTERNAL_TOOL_NAMES.search)!;
    const found = payload(await search.execute('search', { query: 'Feishu Lark docs list documents drive files', sources: ['mcp', 'composio', 'extension', 'endpoint'] }));
    expect(found.tools).toHaveLength(1);
    expect(found.searchScope.excludedSources).toContain('cli');
    expect(found.searchScope.instruction).toContain('Results from other apps');
  });

  it('advertises every registered source and recommends searching without a filter', () => {
    const { search } = setup();
    for (const source of EXTERNAL_TOOL_SOURCES) expect(search.description).toContain(source);
    expect(search.description).toContain('WeCom');
    expect(search.description).toContain('retry without sources');
    expect(search.parameters.properties.sources.description).toContain('Omit to search all sources');
  });
});
