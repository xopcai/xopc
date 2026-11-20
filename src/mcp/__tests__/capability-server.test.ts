import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CapabilityDescriptor } from '@xopcai/gateway-contract';

import { createCapabilityMcpServer } from '../capability-server.js';
import { MCP_BRIDGE_PATH } from '../connection-grants.js';
import { GatewayHttpError } from '../gateway-http-client.js';

const descriptor: CapabilityDescriptor = {
  id: 'xopc.notes.create', majorVersion: 1, descriptorDigest: 'a'.repeat(64),
  description: 'Create a note', effect: 'local-write', surfaces: ['mcp'],
  inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
};
const args = { title: 'Fixture', idempotencyKey: 'stable-key' };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup() {
  const gateway = {
    getJson: vi.fn().mockResolvedValue({ capabilities: [descriptor] }),
    postJson: vi.fn().mockResolvedValue({ data: { id: 'note' } }),
  };
  const server = createCapabilityMcpServer(gateway);
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  cleanups.push(async () => { await client.close(); await server.close(); });
  const call = (input: Record<string, unknown> = args, name = 'xopc_notes_create') => client.callTool({ name, arguments: input });
  return { gateway, client, call };
}

describe('stdio Gateway MCP tools', () => {
  it('exposes domain parameters and an output schema for granted MCP capabilities', async () => {
    const { client, gateway } = await setup();
    gateway.getJson.mockResolvedValue({ capabilities: [descriptor, { ...descriptor, id: 'xopc.notes.delete', surfaces: ['http'] }] });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'xopc_notes_create', inputSchema: { required: ['idempotencyKey'] },
      outputSchema: { properties: { id: { type: 'string' } } },
    });
    expect(Object.keys(tools[0]!.inputSchema.properties!)).toEqual(['title', 'idempotencyKey']);
  });

  it('passes the internal contract and stable key to Gateway and returns the domain payload', async () => {
    const { gateway, call } = await setup();
    expect((await call()).structuredContent).toEqual({ id: 'note' });
    expect(gateway.postJson).toHaveBeenCalledWith(MCP_BRIDGE_PATH, {
      capability: descriptor.id, majorVersion: 1, descriptorDigest: descriptor.descriptorDigest,
      input: { title: 'Fixture' }, idempotencyKey: args.idempotencyKey,
    }, expect.any(AbortSignal));
  });

  it('rejects access removed after discovery and rejects undiscovered capability names', async () => {
    const { client, gateway, call } = await setup();
    await client.listTools();
    gateway.getJson.mockResolvedValue({ capabilities: [] });
    for (const name of ['xopc_notes_create', 'xopc_notes_delete']) {
      expect(await call(args, name)).toMatchObject({ isError: true, content: [{ text: '{"code":"FORBIDDEN"}' }] });
    }
    expect(gateway.postJson).not.toHaveBeenCalled();
  });

  it('requires a stable key and rejects a changed contract until rediscovery', async () => {
    const { client, gateway, call } = await setup();
    await client.listTools();
    expect(await call({ title: 'Fixture' })).toMatchObject({ content: [{ text: '{"code":"INVALID_INPUT"}' }] });
    gateway.getJson.mockResolvedValue({ capabilities: [{ ...descriptor, descriptorDigest: 'b'.repeat(64) }] });
    expect(await call()).toMatchObject({ content: [{ text: '{"code":"CONTRACT_CHANGED"}' }] });
    expect(gateway.postJson).not.toHaveBeenCalled();
    await client.listTools();
    expect((await call()).structuredContent).toEqual({ id: 'note' });
  });

  it('preserves domain conflicts and reports uncertain writes without retrying', async () => {
    const { gateway, call } = await setup();
    gateway.postJson.mockRejectedValueOnce(new GatewayHttpError(409, 'REVISION_CONFLICT', 'operation-1'));
    expect(await call()).toMatchObject({ isError: true, content: [{ text: '{"code":"REVISION_CONFLICT","operationId":"operation-1"}' }] });
    gateway.postJson.mockRejectedValueOnce(new Error('private credential details'));
    expect(await call()).toMatchObject({ isError: true, content: [{ text: '{"code":"OUTCOME_UNKNOWN"}' }] });
    expect(gateway.postJson).toHaveBeenCalledTimes(2);
  });
});
