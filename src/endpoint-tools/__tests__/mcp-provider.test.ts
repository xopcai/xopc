import { resolve } from 'node:path';

import { EndpointToolRegistry, type EndpointToolExecutionContext } from '@xopcai/endpoint-tools-client';
import { expect, it, vi } from 'vitest';

import { connectDeviceMcpProvider, resourceWithinScope } from '../mcp-provider.js';

const policy = { effect: 'read' as const, sensitivity: 'public' as const, confirmation: 'never' as const,
  requiresForeground: false, requiredPermissions: [], timeoutMs: 5_000, maxConcurrency: 1,
  supportsCancellation: true, idempotent: true, resultKinds: ['text' as const, 'json' as const] };
const context = (): EndpointToolExecutionContext => ({ invocationId: 'fixture', signal: new AbortController().signal,
  reportProgress: vi.fn(), uploadFile: vi.fn() });

it('federates a real stdio MCP server with explicit installation, schemas, refresh and withdrawal', async () => {
  const registry = new EndpointToolRegistry([]);
  const provider = await connectDeviceMcpProvider({ registry, localId: 'climate', title: 'Climate', summary: 'Device climate',
    server: { command: process.execPath, args: [resolve('scripts/fixtures/device-mcp.mjs')] },
    policies: { 'Read-Temperature': policy, refresh_catalog: policy, xopc_resource_read: policy }, resourcePrefixes: ['fixture:///safe/'] });
  try {
    expect(registry.get('provider_climate.not_installed')).toBeUndefined();
    const read = registry.get('provider_climate.Read-Temperature')!;
    expect(await read.definition.execute({}, context())).toEqual({ content: [{ type: 'json', value: { value: 23 } }] });
    const resource = registry.get('provider_climate.xopc_resource_read')!;
    await expect(resource.definition.execute({ uri: 'fixture:///safe/file' }, context())).resolves.toMatchObject({ content: [{ text: 'device resource' }] });
    await expect(resource.definition.execute({ uri: 'fixture:///safe-other/file' }, context())).rejects.toThrow('outside');
    await registry.get('provider_climate.refresh_catalog')!.definition.execute({}, context());
    await vi.waitFor(() => expect(registry.get(read.definition.descriptor.name)?.revision).not.toBe(read.revision));
    expect(registry.providerCatalog().providers[0].instructions).toContain('device fixture');
  } finally { await provider.close(); }
  expect(registry.providerCatalog().providers).toHaveLength(0);
});

it('enforces canonical URI scope boundaries', () => {
  for (const uri of ['file:///safe-other/file', 'file:///safe/../private', 'file:///safe/%2e%2e/private', 'file:///safe/%2f../private', 'https://other/safe/file']) {
    expect(resourceWithinScope(uri, 'file:///safe/')).toBe(false);
  }
  expect(resourceWithinScope('file:///safe/folder/file', 'file:///safe/')).toBe(true);
});

it('discovers and calls a real Streamable HTTP MCP server without Gateway MCP configuration', async () => {
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  const { randomUUID } = await import('node:crypto');
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const server = new Server({ name: 'http-fixture', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: 'read_clock', description: 'Read fixture clock', inputSchema: { type: 'object' } }] }));
  server.setRequestHandler(CallToolRequestSchema, () => ({ content: [{ type: 'text', text: '12:00' }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await server.connect(transport);
  const listener = createServer((request, response) => { void transport.handleRequest(request, response); });
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('Missing MCP address');
  const registry = new EndpointToolRegistry([]);
  let provider: Awaited<ReturnType<typeof connectDeviceMcpProvider>> | undefined;
  try {
    provider = await connectDeviceMcpProvider({ registry, localId: 'clock', title: 'Clock', summary: 'Read a device clock',
      server: { url: `http://127.0.0.1:${address.port}/mcp` }, policies: { read_clock: policy } });
    await expect(registry.get('provider_clock.read_clock')!.definition.execute({}, context())).resolves.toEqual({ content: [{ type: 'text', text: '12:00' }] });
  } finally {
    await provider?.close(); await server.close();
    await new Promise<void>(resolve => listener.close(() => resolve()));
  }
}, 15_000);
