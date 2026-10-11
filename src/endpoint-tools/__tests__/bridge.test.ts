import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { describe, expect, it, vi } from 'vitest';
import { ENDPOINT_PROTOCOL_VERSION, locationDescriptor } from '@xopcai/endpoint-tools-protocol';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { SessionStore } from '../../session/store.js';
import { appendTranscriptEntry, searchSessionTranscript } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

import { createDeviceBridge, simulatedEnvironmentSensors } from '../bridge.js';
import { connectDeviceBridge } from '../bridge-host.js';
import { EndpointToolPolicy } from '../policy.js';
import { projectDeviceReading } from '../result-projector.js';
import { EndpointToolRuntime } from '../runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { EndpointToolProvider } from '../../agent/external-tools/endpoint-provider.js';

const context = () => ({ invocationId: randomUUID(), signal: new AbortController().signal,
  reportProgress: () => {}, uploadFile: async () => { throw new Error('Unexpected upload'); } });

describe('Device Bridge', () => {
  it('keeps independent resource IDs, validates adapters and distinguishes unknown from zero', async () => {
    const sensors = simulatedEnvironmentSensors(() => 100_000);
    sensors[1].read = async () => ({ value: null, capturedAt: 100_000 });
    const registry = createDeviceBridge(sensors, () => 100_000);
    const policy = new EndpointToolPolicy();
    for (const descriptor of registry.descriptors()) expect(() => policy.validateDescriptor('desktop', descriptor)).not.toThrow();
    const list = await registry.get('desktop.bridge.list_resources')!.definition.execute({}, context());
    expect(list.content[0]).toMatchObject({ value: [expect.objectContaining({ resourceId: 'sim.room.temperature' }),
      expect.objectContaining({ resourceId: 'sim.room.humidity' })] });
    const read = registry.get('desktop.bridge.read_sensor')!.definition;
    expect((await read.execute({ resourceId: 'sim.room.humidity' }, context())).content[0]).toMatchObject({ value: { value: null, simulated: true } });
    await expect(read.execute({ resourceId: 'missing' }, context())).rejects.toThrow('Unknown');
    await expect(read.execute({ resourceId: 'sim.room.humidity', extra: true }, context())).rejects.toThrow();
    expect(() => createDeviceBridge([sensors[0], sensors[0]])).toThrow('Duplicate');
    sensors[1].read = async () => ({ value: 101, capturedAt: 100_000 });
    await expect(createDeviceBridge(sensors, () => 100_000).get(read.descriptor.name)!.definition.execute({ resourceId: 'sim.room.humidity' }, context())).rejects.toThrow('value');
    sensors[0].read = async () => ({ value: 0, capturedAt: 60_000 });
    await expect(createDeviceBridge(sensors, () => 100_000).get(read.descriptor.name)!.definition.execute({ resourceId: 'sim.room.temperature' }, context())).rejects.toThrow('stale');
    expect(() => projectDeviceReading(read.descriptor.name, 'bridge', 'principal', [{ type: 'json', value: {
      resourceId: 'different', capturedAt: 100_000 } }], 100_000, { resourceId: 'requested' })).toThrow('different resource');
  });

  it('runs an authenticated signed Bridge through the listening Gateway and an explicitly bound Agent tool', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-bridge-http-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    const endpointTools = new EndpointToolRuntime({ uploadRoot: join(dir, 'uploads') });
    const realtime = new RealtimeRuntime(endpointTools);
    const token = 'bridge-test-token';
    const app = createHonoApp({ service: {
      currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
      getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
      isGatewayReady: () => true, getExtensionLoader: () => null, endpointTools, realtime,
    } as unknown as GatewayService });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
    let bridge: Awaited<ReturnType<typeof connectDeviceBridge>> | undefined;
    try {
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No listener');
      const base = `http://127.0.0.1:${address.port}`;
      await expect(connectDeviceBridge({ gatewayUrl: base, token: 'wrong', identityPath: join(dir, 'bad.json'),
        registry: createDeviceBridge([]) })).rejects.toThrow('401');
      bridge = await connectDeviceBridge({ gatewayUrl: base, token, identityPath: join(dir, 'identity.json'),
        registry: createDeviceBridge(simulatedEnvironmentSensors()), displayName: 'Simulated sensors' });
      const provider = new EndpointToolProvider({ runtime: endpointTools,
        getCurrentContext: () => ({ channel: 'cli', chatId: 'bridge-chat', conversationId: 'bridge-chat', origin: { type: 'system', source: 'cli' } }) });
      expect(await provider.search('sensor')).toEqual([]);
      const binding = await fetch(base + '/api/endpoint-tools/bindings/bridge-chat', { method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ endpointId: bridge.endpointId }) });
      expect(binding.status, await binding.clone().text()).toBe(200);
      const tool = (await provider.search('sensor')).find(item => item.toolRef.includes('read_sensor'));
      expect(tool).toBeDefined();
      const result = await provider.execute(tool!.toolRef, { resourceId: 'sim.room.temperature' }, undefined, { toolCallId: 'sensor-test', signal: new AbortController().signal });
      expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ source: { endpointId: bridge.endpointId,
        resourceId: 'sim.room.temperature' }, cached: false, data: { value: 23.5, simulated: true, unit: 'celsius' } });
      bridge.close();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(await provider.search('sensor')).toEqual([]);
    } finally {
      bridge?.close(); realtime.close(); endpointTools.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
  it('uses the real authenticated lazy route for exact-scope one-call authorization and releases only location summaries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-location-http-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    const runtime = new EndpointToolRuntime({ uploadRoot: join(dir, 'uploads'), audit: { started: () => {}, finished: () => {} } });
    const conversationId = randomUUID(); ensureSessionRecord(conversationId, dir, { agentId: 'main' });
    const token = 'location-fixture';
    const app = createHonoApp({ service: {
      currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
      getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
      isGatewayReady: () => true, getExtensionLoader: () => null, endpointTools: runtime,
    } as unknown as GatewayService });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    const actualFetch = globalThis.fetch; let calls = 0;
    const descriptor = locationDescriptor('mobile');
    const register = (id: string) => {
      const connectionId = randomUUID();
      runtime.registry.register({ principalId: id, endpointId: id, connectionInstanceId: randomUUID(),
        displayName: 'Same name', kind: 'mobile', platform: 'ios', appVersion: '1', availability: 'foreground',
        nonce: randomUUID(), signedAt: Date.now(), signature: 'fixture', tools: [descriptor] }, connectionId,
        { readyState: 1, close: () => {}, send: data => {
          const message = JSON.parse(data);
          if (message.type !== 'tool.invoke') return;
          calls++; expect(message.payload.confirmationRequired).toBe(true);
          queueMicrotask(() => {
            const send = (type: 'tool.received' | 'tool.result', payload: object) => runtime.handleMessage(id, connectionId,
              { protocolVersion: ENDPOINT_PROTOCOL_VERSION, messageId: randomUUID(), type, sentAt: Date.now(), payload } as any);
            send('tool.received', { invocationId: message.payload.invocationId });
            send('tool.result', { invocationId: message.payload.invocationId, content: [{ type: 'json', value: {
              latitude: 31.234567, longitude: 121.456789, accuracyMeters: 8, capturedAt: Date.now(), precision: 'precise', coordinateSystem: 'WGS84',
            } }], details: { latitude: 31.234567 } });
          });
        } });
    };
    register('source'); register('target');
    try {
      if (!server.listening) await once(server, 'listening');
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
      const base = `http://127.0.0.1:${address.port}/api/endpoint-tools/target-authorizations`;
      expect((await actualFetch(base)).status).toBe(401);
      vi.stubGlobal('fetch', async (input: any, init?: RequestInit) => {
        if (String(input).startsWith('https://api.open-meteo.com/')) {
          expect(Number(new URL(String(input)).searchParams.get('latitude'))).toBeCloseTo(31.24);
          return new Response(JSON.stringify({ latitude: 31.234567, longitude: 121.456789, current: { temperature_2m: 23, weather_code: 0 } }));
        }
        return actualFetch(input, init);
      });
      const provider = new EndpointToolProvider({ runtime, getCurrentContext: () => ({ channel: 'web', chatId: conversationId,
        conversationId, origin: { type: 'endpoint', endpointId: 'source' } }) });
      expect((await provider.search('location')).some(item => item.namespace === 'target')).toBe(false);
      const body = { conversationId, requestorPrincipalId: 'source', targetEndpointId: 'target', toolName: descriptor.name,
        arguments: { purpose: 'weather', precision: 'approximate' } };
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const response = await actualFetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
      expect(response.status, await response.clone().text()).toBe(201);
      const tool = (await provider.search('location')).find(item => item.namespace === 'target')!;
      expect(tool).toBeDefined();
      expect((await provider.describe(tool.toolRef))?.description).toContain(JSON.stringify(body.arguments));
      await expect(provider.execute(tool.toolRef, { ...body.arguments, precision: 'precise' }, undefined,
        { toolCallId: 'expanded', signal: new AbortController().signal })).rejects.toThrow('scope');
      expect(calls).toBe(0);
      const result = await provider.execute(tool.toolRef, body.arguments, undefined, { toolCallId: 'once', signal: new AbortController().signal });
      expect(JSON.stringify(result)).not.toMatch(/31\.234567|121\.456789|latitude|longitude/);
      expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ source: { endpointId: 'target' }, purpose: 'weather', precision: 'approximate' });
      await expect(provider.execute(tool.toolRef, body.arguments, undefined, { toolCallId: 'again' })).rejects.toThrow('unavailable');
      expect(calls).toBe(1);
      appendTranscriptEntry(conversationId, { role: 'toolResult', toolCallId: 'once', toolName: descriptor.name,
        content: result.content, details: result.details, isError: false, timestamp: Date.now() });
      const store = new SessionStore({ config: ConfigSchema.parse({}) });
      expect(await store.exportSession(conversationId, 'json')).not.toMatch(/31\.234567|121\.456789|latitude|longitude/);
      expect(JSON.stringify(await store.loadMessages(conversationId))).not.toMatch(/31\.234567|121\.456789|latitude|longitude/);
      expect(searchSessionTranscript(conversationId, '31.234567')).toEqual([]);
      expect(searchSessionTranscript(conversationId, '121.456789')).toEqual([]);
      expect((await (await actualFetch(base, { headers })).json()).payload).toEqual([]);
      const events = getSqliteDatabase().prepare('SELECT * FROM device_grant_events ORDER BY created_at_ms, rowid').all();
      expect(events.map(row => row.event)).toEqual(['issued', 'reserved', 'consumed']);
      expect(JSON.stringify(events)).not.toMatch(/31\.234567|121\.456789|latitude|longitude/);
      const issued = await actualFetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
      const grantId = (await issued.json()).payload.id;
      expect((await actualFetch(base + '/' + grantId, { method: 'DELETE', headers })).status).toBe(200);
      expect((await provider.search('location')).some(item => item.namespace === 'target')).toBe(false);
    } finally {
      vi.unstubAllGlobals(); runtime.close(); await new Promise<void>(resolve => server.close(() => resolve()));
      closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

});
