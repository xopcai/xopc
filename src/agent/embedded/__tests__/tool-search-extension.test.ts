import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition, ToolInfo } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi } from 'vitest';

import type { ExternalDiscoveryParams, ExternalDiscoveryResult } from '../../external-tools/discovery.js';
import { ExternalToolService } from '../../external-tools/service.js';
import type { ExternalToolRegistry } from '../../external-tools/tool-registry.js';
import { createXopcToolSearchExtension, TOOL_DISCOVERY_STATE } from '../tool-search-extension.js';
import { setXopcToolMetadata } from '../tool-metadata.js';
import { xopcToolsToDefinitions } from '../xopc-tools-bridge.js';

function fixture(options: { nativeDiscovery?: boolean; externalDiscovery?: boolean; externalTimeoutMs?: number; external?: boolean } = {}) {
  const tools: AgentTool[] = ['web_search', 'xopc_tool_describe', 'xopc_tool_execute'].map(name => setXopcToolMetadata({
    name, label: name, description: name === 'web_search' ? 'Search WeCom documentation on the web' : name,
    parameters: Type.Object({}), execute: vi.fn(),
  }, { exposure: 'deferred' }));
  const definitions = xopcToolsToDefinitions(tools);
  let active: string[] = [];
  const appendEntry = vi.fn();
  const search = vi.fn(async (_params: ExternalDiscoveryParams) => ({
    tools: [{ toolRef: 'cli:wecom:doc.search', source: 'cli', namespace: 'wecom', title: 'doc.search', summary: 'WeCom documents' }],
    connectionCandidates: [], installCandidates: [], unavailableSources: [], selectedConnections: [],
  } as ExternalDiscoveryResult));
  const registry: ExternalToolRegistry = { service: new ExternalToolService([]), nativeSources: ['endpoint'], search, execute: vi.fn() };
  const api = {
    registerTool: (definition: ToolDefinition) => definitions.push(definition),
    getAllTools: () => definitions as unknown as ToolInfo[],
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => { active = [...new Set(names)].filter(name => definitions.some(tool => tool.name === name)); },
    appendEntry,
  } as unknown as ExtensionAPI;
  createXopcToolSearchExtension(tools, { ...options, registry: options.external === false ? undefined : registry })(api);
  const definition = definitions.find(tool => tool.name === 'tool_search')!;
  const call = async (input = { query: 'WeCom search', limit: 8 }, signal = new AbortController().signal) => {
    const result = await definition.execute('search', input, signal, undefined, {} as ExtensionToolContext);
    return JSON.parse((result.content[0] as { text: string }).text);
  };
  return { api, search, definition, call, appendEntry };
}

describe('unified tool_search', () => {
  it('loads native declarations, returns external references and makes describe/execute available', async () => {
    const f = fixture();
    const found = await f.call();
    expect(found.loadedTools).toEqual([expect.objectContaining({ name: 'web_search', nextAction: 'call' })]);
    expect(found.externalTools).toEqual([expect.objectContaining({ toolRef: 'cli:wecom:doc.search', nextAction: 'describe' })]);
    expect(f.api.getActiveTools()).toEqual(expect.arrayContaining(['web_search', 'xopc_tool_describe', 'xopc_tool_execute']));
    expect(f.api.getAllTools().some(tool => tool.name === 'doc.search')).toBe(false);
    expect(f.appendEntry).toHaveBeenCalledWith(TOOL_DISCOVERY_STATE, expect.objectContaining({ loaded: expect.any(Array) }));
    expect(f.definition.reachesTools?.({ query: 'WeCom' })).toBe('all');
    expect(f.definition.executionMode).toBe('sequential');
    expect(f.search.mock.calls[0][0]).not.toHaveProperty('sources');
  });

  it('retains connection candidates and account context without treating them as executable tools', async () => {
    const f = fixture();
    f.search.mockResolvedValueOnce({ tools: [], unavailableSources: [], installCandidates: [],
      connectionCandidates: [{ candidateRef: 'composio-gmail', label: 'Gmail', capabilities: ['email.search'] }],
      selectedConnections: [], waitingObjective: 'Find the weekly report',
      instruction: 'Use xopc_require_connection only when account authorization or selection is actually required.' } as ExternalDiscoveryResult);
    const found = await f.call({ query: 'weekly mail', limit: 8 });
    expect(found.externalTools).toEqual([]);
    expect(found.connectionCandidates[0].candidateRef).toBe('composio-gmail');
    expect(found.waitingObjective).toBe('Find the weekly report');
    expect(found.instruction).toContain('xopc_require_connection');
    expect(f.api.getActiveTools()).not.toContain('xopc_tool_execute');
  });

  it('preserves native results on connector failure and distinguishes a source error from no matches', async () => {
    const f = fixture();
    f.search.mockRejectedValueOnce(new Error('Directory offline'));
    const found = await f.call();
    expect(found.loadedTools[0].name).toBe('web_search');
    expect(found.sourceErrors).toEqual([{ source: 'connectors', message: 'Directory offline' }]);
    expect(found.instruction).toContain('do not prove missing authorization');
  });

  it('preserves an explicit external discovery denial while allowing native discovery', async () => {
    const f = fixture({ externalDiscovery: false });
    const found = await f.call();
    expect(found.loadedTools[0].name).toBe('web_search');
    expect(found.scope.connectors).toBe(false);
    expect(found.externalTools).toEqual([]);
    expect(f.search).not.toHaveBeenCalled();
  });

  it('bounds directory latency and does not lose native matches', async () => {
    const f = fixture({ externalTimeoutMs: 5 });
    f.search.mockImplementationOnce(() => new Promise(() => {}));
    const found = await f.call();
    expect(found.loadedTools).toHaveLength(1);
    expect(found.sourceErrors[0].message).toContain('timed out');
  });

  it('keeps a request worker connector-only and never restores native declarations', async () => {
    const f = fixture({ nativeDiscovery: false });
    const found = await f.call();
    expect(found.loadedTools).toEqual([]);
    expect(found.scope.native).toBe(false);
    expect(f.api.getActiveTools()).not.toContain('web_search');
    expect(found.externalTools).toHaveLength(1);
    expect(f.appendEntry).not.toHaveBeenCalled();
  });

  it('does not exceed the requested tool-result budget or overwrite active tools', async () => {
    const f = fixture();
    const found = await f.call({ query: 'WeCom', limit: 1 });
    expect(found.loadedTools.length + found.externalTools.length).toBeLessThanOrEqual(1);
    await f.call({ query: 'xopc_tool_describe', limit: 1 });
    expect(f.api.getActiveTools()).toContain('web_search');
  });

  it('aborts promptly without turning cancellation into a missing-capability result', async () => {
    const f = fixture();
    f.search.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    const promise = f.call(undefined, controller.signal);
    controller.abort(new Error('Cancelled by user'));
    await expect(promise).rejects.toThrow('Cancelled by user');
  });

  it.each([{ query: '', limit: 8 }, { query: 'mail', limit: 21 }, { query: 'mail', limit: 0 }])('rejects invalid discovery requests %j', async params => {
    const f = fixture();
    await expect(f.call(params)).rejects.toThrow('Tool search requires');
    expect(f.search).not.toHaveBeenCalled();
  });
});
