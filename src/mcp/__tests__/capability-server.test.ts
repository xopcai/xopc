import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CapabilityDescriptor } from '@xopcai/gateway-contract';

import { createCapabilityMcpServer } from '../capability-server.js';
import { GatewayHttpError } from '../gateway-http-client.js';

const descriptor: CapabilityDescriptor = { id: 'xopc.notes.create', majorVersion: 1, descriptorDigest: 'a'.repeat(64),
  description: 'Create a note', effect: 'local-write', surfaces: ['http'], inputSchema: { type: 'object' }, outputSchema: {} };
const args = { majorVersion: 1, descriptorDigest: descriptor.descriptorDigest, input: { title: 'Fixture' }, idempotencyKey: 'stable-key' };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup() {
  const gateway = { getJson: vi.fn().mockResolvedValue({ capabilities: [descriptor] }), postJson: vi.fn().mockResolvedValue({ status: 'succeeded', data: { id: 'note' } }) };
  const server = createCapabilityMcpServer(gateway, [descriptor.id]);
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  cleanups.push(async () => { await client.close(); await server.close(); });
  return { gateway, client };
}
describe('capability MCP HTTP proxy', () => {
  it('requires exact explicit capabilities', () => {
    const gateway = { getJson: vi.fn(), postJson: vi.fn() };
    expect(() => createCapabilityMcpServer(gateway, [])).toThrow('explicit');
    expect(() => createCapabilityMcpServer(gateway, ['xopc.*'])).toThrow('wildcards');
  });
  it('discovers only allowed HTTP capabilities and pins their contract', async () => {
    const { client, gateway } = await setup();
    gateway.getJson.mockResolvedValue({ capabilities: [descriptor, { ...descriptor, id: 'xopc.notes.delete' }] });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.inputSchema.properties).toMatchObject({ descriptorDigest: { const: descriptor.descriptorDigest } });
    expect(tools[0]!.inputSchema.required).toContain('idempotencyKey');
    gateway.getJson.mockResolvedValue({ capabilities: [{ ...descriptor, surfaces: ['agent'] }] });
    expect((await client.listTools()).tools).toEqual([]);
  });
  it('forwards the contract and stable key unchanged', async () => {
    const { client, gateway } = await setup();
    const result = await client.callTool({ name: descriptor.id, arguments: args });
    expect(result.structuredContent).toEqual({ status: 'succeeded', data: { id: 'note' } });
    expect(gateway.postJson).toHaveBeenCalledWith('/api/capabilities/operations/xopc.notes.create/invocations', args);
  });
  it('denies revoked visibility and undiscovered names without dispatch', async () => {
    const { client, gateway } = await setup();
    await client.listTools();
    gateway.getJson.mockResolvedValue({ capabilities: [] });
    for (const name of [descriptor.id, 'xopc.notes.delete']) {
      expect(await client.callTool({ name, arguments: args })).toMatchObject({ isError: true, content: [{ text: '{"code":"FORBIDDEN"}' }] });
    }
    expect(gateway.postJson).not.toHaveBeenCalled();
  });
  it('rejects changed contracts, missing write keys and caller identity fields', async () => {
    const { client, gateway } = await setup();
    for (const [input, code] of [[{ ...args, majorVersion: 2 }, 'CONTRACT_CHANGED'],
      [{ ...args, idempotencyKey: undefined }, 'INVALID_INPUT'], [{ ...args, principalId: 'admin' }, 'INVALID_INPUT']] as const) {
      expect(await client.callTool({ name: descriptor.id, arguments: input })).toMatchObject({ isError: true, content: [{ text: JSON.stringify({ code }) }] });
    }
    expect(gateway.postJson).not.toHaveBeenCalled();
  });
  it('preserves domain conflicts without exposing error payloads', async () => {
    const { client, gateway } = await setup();
    gateway.postJson.mockRejectedValue(new GatewayHttpError(409, 'REVISION_CONFLICT', 'operation-1'));
    expect(await client.callTool({ name: descriptor.id, arguments: args })).toMatchObject({ isError: true,
      content: [{ text: '{"code":"REVISION_CONFLICT","operationId":"operation-1"}' }] });
  });
  it('never retries an uncertain write', async () => {
    const { client, gateway } = await setup();
    gateway.postJson.mockRejectedValue(new Error('private credential details'));
    expect(await client.callTool({ name: descriptor.id, arguments: args })).toMatchObject({ isError: true,
      content: [{ text: '{"code":"OUTCOME_UNKNOWN"}' }] });
    expect(gateway.postJson).toHaveBeenCalledTimes(1);
  });
});
