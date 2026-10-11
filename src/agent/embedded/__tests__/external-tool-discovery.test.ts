import type { AgentTool } from '@earendil-works/pi-agent-core';
import { ENDPOINT_TEXT_OUTPUT_SCHEMA, type EndpointToolDescriptor } from '@xopcai/endpoint-tools-protocol';
import { beforeEach, expect, it, vi } from 'vitest';

import type { EndpointToolRuntime } from '../../../endpoint-tools/runtime.js';
import { requireXopcDatabase } from '../../../storage/sqlite/connection.js';
import { EndpointToolProvider } from '../../external-tools/endpoint-provider.js';
import { withExternalReadPolicy } from '../../external-tools/read-policy.js';
import { createExternalToolGatewayTools } from '../../external-tools/gateway-tools.js';
import { getExternalToolRegistry } from '../../external-tools/tool-registry.js';
import { wrapToolsWithProtection } from '../../tools/executor.js';
import { getEmbeddedExecutionSession, getEmbeddedExecutionRunId, runWithEmbeddedExecutionSession } from '../execution-context.js';
import { materializeNativeExternalTools } from '../external-tool-discovery.js';
import { deferredToolContract, getXopcToolMetadata } from '../tool-metadata.js';
import type { ExternalToolDescriptor, ExternalToolProvider } from '../../external-tools/types.js';

beforeEach(() => { requireXopcDatabase(); });

function fixture() {
  const conversationId = crypto.randomUUID();
  const descriptor: EndpointToolDescriptor = {
    name: 'mobile.device.get_info', title: 'Device information', description: 'Read current device information',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
    policyId: 'public.background-read', sensitivity: 'public', effect: 'read', confirmation: 'never',
    requiresForeground: false, requiredPermissions: [], timeoutMs: 1000, maxConcurrency: 1,
    supportsCancellation: true, idempotent: true, resultKinds: ['text'],
  };
  const state = { endpointId: 'phone-1', connectionId: 'connection-1', available: true,
    policy: undefined as { mode: string; readOnly?: boolean } | undefined };
  const invoke = vi.fn(async () => {
    expect(getEmbeddedExecutionSession()).toBe(conversationId);
    return { content: [{ type: 'text' as const, text: 'Android fixture' }] };
  });
  const tool = { descriptor, revision: 'descriptor-v1' };
  const snapshot = () => ({ principalId: 'owner', endpointId: state.endpointId, connectionId: state.connectionId,
    displayName: 'Test phone', tools: [tool] });
  const runtime = { registry: {
    get: (id: string) => state.available && id === state.endpointId ? snapshot() : undefined,
    getTool: (id: string, name: string) => state.available && id === state.endpointId && name === descriptor.name ? tool : undefined,
  }, bindings: { get: () => undefined, resolve: () => undefined }, invocations: { invoke } } as unknown as EndpointToolRuntime;
  const context = () => ({ conversationId, channel: 'webchat', chatId: 'chat',
    origin: { type: 'endpoint' as const, endpointId: state.endpointId } });
  const provider = new EndpointToolProvider({ runtime, getCurrentContext: context });
  const foreignSearch = vi.fn(async () => []);
  const tools = wrapToolsWithProtection(createExternalToolGatewayTools([
    withExternalReadPolicy(provider, () => state.policy),
    { source: 'composio', search: foreignSearch, describe: async () => undefined, execute: vi.fn() },
  ], context, undefined, () => conversationId, ['endpoint']));
  const materialize = () => materializeNativeExternalTools({ conversationId, tools });
  return { conversationId, descriptor, state, provider, tools, materialize, invoke, foreignSearch, tool };
}

it('registers the authorized device directory without legacy search, preserves schemas, results and execution scope', async () => {
  const f = fixture();
  expect(getExternalToolRegistry(f.tools)).toBeDefined();
  const [native] = await f.materialize();
  expect(native.name).toMatch(/^device__mobile_device_get_info_/);
  expect(native.name.length).toBeLessThanOrEqual(64);
  expect(getXopcToolMetadata(native)).toMatchObject({ exposure: 'deferred',
    outputSchema: { properties: { content: ENDPOINT_TEXT_OUTPUT_SCHEMA } }, external: { readOnly: true } });
  const controller = new AbortController();
  const update = vi.fn();
  f.invoke.mockImplementationOnce(async () => {
    expect(getEmbeddedExecutionSession()).toBe(f.conversationId);
    expect(getEmbeddedExecutionRunId()).toBe('run-1');
    return { content: [{ type: 'text', text: 'Android fixture' }] };
  });
  await expect(runWithEmbeddedExecutionSession('other', () => native.execute('call', {}, controller.signal, update), 'run-1'))
    .resolves.toMatchObject({ structuredContent: { content: [{ type: 'text', text: 'Android fixture' }] },
      details: { delegatedToolRef: 'endpoint:phone-1:mobile.device.get_info' } });
  expect(f.invoke).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'call', signal: expect.any(AbortSignal), descriptorRevision: 'descriptor-v1' }));
  expect(f.foreignSearch).not.toHaveBeenCalled();
  const search = f.tools.find(tool => tool.name === 'xopc_tool_search')!;
  expect(JSON.stringify(await search.execute('search', { query: 'device', sources: ['endpoint'] }))).toContain('Use tool_search');
  expect(f.foreignSearch).not.toHaveBeenCalled();
  const describe = f.tools.find(tool => tool.name === 'xopc_tool_describe')!;
  await expect(describe.execute('describe', { toolRefs: ['endpoint:phone-1:mobile.device.get_info'] })).rejects.toThrow('call it directly');
  const execute = f.tools.find(tool => tool.name === 'xopc_tool_execute')!;
  await expect(execute.execute('legacy', { toolRef: 'endpoint:phone-1:mobile.device.get_info', revision: 'invented' })).rejects.toThrow('call it directly');
});

it('rejects stale connections, contracts and bindings and changes the persistence fingerprint', async () => {
  const f = fixture();
  const [old] = await f.materialize();
  f.state.connectionId = 'connection-2';
  await expect(old.execute('stale', {})).rejects.toThrow('contract changed');
  const [fresh] = await f.materialize();
  expect(fresh.name).toBe(old.name);
  expect(deferredToolContract(fresh)).not.toBe(deferredToolContract(old));
  f.tool.revision = 'descriptor-v2';
  await expect(fresh.execute('stale', {})).rejects.toThrow('contract changed');
  f.state.endpointId = 'phone-2';
  await expect(old.execute('wrong-device', {})).rejects.toThrow('unavailable');
  f.state.available = false;
  expect(await f.materialize()).toEqual([]);
  expect(f.invoke).not.toHaveBeenCalled();
});

it('rechecks the provider identity between describe and execute', async () => {
  const f = fixture();
  const [native] = await f.materialize();
  const describe = f.provider.describe.bind(f.provider);
  vi.spyOn(f.provider, 'describe').mockImplementationOnce(async ref => {
    const descriptor = await describe(ref);
    f.state.connectionId = 'new-connection';
    return descriptor;
  });
  await expect(native.execute('race', {})).rejects.toThrow('connection, binding or tool contract changed');
  expect(f.invoke).not.toHaveBeenCalled();
});

it('cannot promote interactive or sensitive device reads into Codemode using local readOnly overrides', async () => {
  const f = fixture();
  f.descriptor.sensitivity = 'personal';
  f.descriptor.requiresForeground = true;
  f.descriptor.requiredPermissions = ['contacts-read'];
  f.state.policy = { mode: 'allow', readOnly: true };
  const [native] = await f.materialize();
  expect(getXopcToolMetadata(native)?.external?.readOnly).toBe(false);
  f.state.policy = { mode: 'deny', readOnly: true };
  expect(await f.materialize()).toEqual([]);
  await expect(native.execute('revoked', {})).rejects.toThrow('unavailable');
  expect(f.invoke).not.toHaveBeenCalled();
});

it('does not expose a device without an authorized origin and never registers connection orchestration as callable', async () => {
  const f = fixture();
  vi.spyOn(f.provider, 'search').mockResolvedValue([]);
  expect(await f.materialize()).toEqual([]);
  for (const name of ['xopc_require_connection', 'xopc_update_connection_objective']) {
    expect(getXopcToolMetadata(f.tools.find(tool => tool.name === name) as AgentTool)?.exposure).toBe('model-only');
  }
});

it.each(['extension', 'memory'] as const)('projects the local %s directory without applying the legacy search limit', async source => {
  const descriptors: ExternalToolDescriptor[] = Array.from({ length: 25 }, (_, index) => ({
    source, toolRef: `${source}:plugin:lookup_${index}`, namespace: 'plugin', title: `Lookup ${index}`,
    summary: 'Plugin records', description: 'Read plugin records', inputSchema: { type: 'object' },
    ...(index === 0 ? { exposure: 'model-only' as const } : {}),
  }));
  const provider: ExternalToolProvider = { source, search: vi.fn(async () => descriptors),
    describe: async ref => descriptors.find(descriptor => descriptor.toolRef === ref), execute: vi.fn(async () => ({ content: [], details: {} })) };
  const tools = createExternalToolGatewayTools([provider], undefined, undefined, undefined, ['extension', 'memory']);
  const native = await materializeNativeExternalTools({ conversationId: crypto.randomUUID(), tools });
  expect(native).toHaveLength(25);
  expect(provider.search).toHaveBeenCalledWith('');
  expect(getXopcToolMetadata(native[0])?.exposure).toBe('model-only');
  expect(native.slice(1).every(tool => getXopcToolMetadata(tool)?.exposure === 'deferred')).toBe(true);
  expect(new Set(native.map(tool => tool.name)).size).toBe(25);
});
