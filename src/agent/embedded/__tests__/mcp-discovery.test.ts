import { Type } from '@sinclair/typebox';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';

const runtime = vi.hoisted(() => ({ getCatalog: vi.fn(), acquireLease: vi.fn(), onCatalogInvalidated: vi.fn() }));
vi.mock('../../mcp/bundle-mcp-runtime.js', () => ({ getOrCreateSessionMcpRuntime: async () => runtime }));

import { materializeDeferredMcpTools } from '../mcp-discovery.js';
import { getXopcToolMetadata } from '../tool-metadata.js';
import { getEmbeddedExecutionSession, runWithEmbeddedExecutionSession } from '../execution-context.js';

beforeEach(() => vi.clearAllMocks());

function fixture(names = ['search']) {
  runtime.getCatalog.mockResolvedValue({ tools: names.map(toolName => ({ serverName: 'docs', safeServerName: 'docs', toolName,
    annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } })), servers: {}, resources: [], prompts: [] });
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'evidence' }], details: {} }));
  const describe = vi.fn(async (_id, args: { toolRefs: string[] }) => ({ content: [{ type: 'text' as const,
    text: JSON.stringify({ tools: args.toolRefs.filter(ref => !ref.endsWith(':denied')).map(toolRef => ({ toolRef, revision: 'v1',
      title: 'Docs search', description: 'Search documentation', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true }, outputSchema: { type: 'object' }, batchRead: toolRef.endsWith(':approved') })) }) }], details: {} }));
  const tools: AgentTool[] = [
    { name: 'xopc_tool_describe', label: 'describe', description: 'describe', parameters: Type.Object({}), execute: describe },
    { name: 'xopc_tool_execute', label: 'execute', description: 'execute', parameters: Type.Object({}), execute },
  ];
  return { tools, execute, describe, params: { conversationId: crypto.randomUUID(), workspaceDir: '/tmp', server: 'docs', tools } };
}

it('uses only the selected authorized contracts and original external executor', async () => {
  const { params, execute, describe } = fixture(['search', 'approved', 'denied']);
  const scopedDescribe = describe.getMockImplementation()!;
  describe.mockImplementation(async (id, args) => {
    expect(getEmbeddedExecutionSession()).toBe(params.conversationId);
    return scopedDescribe(id, args);
  });
  execute.mockImplementation(async () => {
    expect(getEmbeddedExecutionSession()).toBe(params.conversationId);
    return { content: [{ type: 'text' as const, text: 'evidence' }], details: {} };
  });
  const tools = await runWithEmbeddedExecutionSession('parent-conversation', () => materializeDeferredMcpTools(params));
  expect(tools.map(tool => tool.name)).toEqual(['mcp__docs__search', 'mcp__docs__approved']);
  expect(getXopcToolMetadata(tools[0])).toMatchObject({ exposure: 'deferred', external: { readOnly: false }, outputSchema: { type: 'object' } });
  expect(getXopcToolMetadata(tools[1])).toMatchObject({ external: { readOnly: true } });
  await runWithEmbeddedExecutionSession('parent-conversation', () => tools[1].execute('call', { query: 'notes' }));
  expect(execute).toHaveBeenCalledWith('call', { toolRef: 'mcp:docs:approved', revision: 'v1', arguments: { query: 'notes' }, readOnly: true }, undefined, undefined);
  expect(await materializeDeferredMcpTools({ ...params, server: 'other' })).toEqual([]);
  expect(await materializeDeferredMcpTools({ ...params, tools: [] })).toEqual([]);
});

it('rejects JS identifier collisions rather than silently selecting a different tool', async () => {
  await expect(materializeDeferredMcpTools(fixture(['a-b', 'a_b']).params)).rejects.toThrow('identifier collision');
  const { params } = fixture();
  params.tools.push({ ...params.tools[0], name: 'mcp__docs__search' });
  await expect(materializeDeferredMcpTools(params)).rejects.toThrow('identifier collision');
});
