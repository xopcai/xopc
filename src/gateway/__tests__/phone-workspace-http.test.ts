import { once } from 'node:events';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { AgentDefaultsSchema } from '../../agent-config/schema.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { authenticateDeviceAccessToken, createDevice, issueDeviceTokenPair } from '../../storage/sqlite/device-access-repository.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { PhoneRuntime } from '../../phone/runtime.js';
import { PhoneRepository } from '../../phone/repository.js';
import { MOCK_PHONE_MODEL } from '../../phone/contracts.js';
import { createHonoApp } from '../hono/app.js';
import { signedDeviceHeaders } from '../security/__tests__/signed-device-headers.js';
import { DEFAULT_MOBILE_SCOPES } from '../security/gateway-scopes.js';
import type { GatewayService } from '../service.js';

const runtimeRef = vi.hoisted(() => ({ current: undefined as PhoneRuntime | undefined }));
vi.mock('../../phone/runtime.js', async original => ({ ...await original<object>(), getPhoneRuntime: () => runtimeRef.current }));

it('serves mobile phone discovery, grants and fenced control through authenticated lazy routes', async () => {
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
  seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'test/chat' }, phoneUse: { primary: MOCK_PHONE_MODEL } } }) });
  const conversationId = randomUUID();
  ensureSessionRecord(conversationId, '.', { agentId: 'main', sourceChannel: 'webchat' });
  const transcriptId = readCurrentTranscriptId(getSqliteDatabase(), conversationId)!;
  const config = ConfigSchema.parse({ phone: { enabled: true }, gateway: { auth: { mode: 'token', token: 'phone-owner-test' } } });
  const driver = { discover: async () => [{ serial: 'emulator-phone-test', name: 'Phone', state: 'device', emulator: true }],
    observe: async () => ({ frameId: randomUUID(), capturedAt: Date.now(), width: 100, height: 200, rotation: 0,
      package: 'com.android.settings', frame: Buffer.from('private-pixels'), elements: [] }), execute: vi.fn(async () => {}) };
  const runtime = new PhoneRuntime(new PhoneRepository(), () => driver);
  runtimeRef.current = runtime;
  const phone = runtime.repository.save({ serial: 'emulator-phone-test', name: 'Private phone', enabled: true, appAccess: 'all', allowedApps: [] });
  await runtime.execute(conversationId, { op: 'open', deviceId: phone.id, mode: 'control' }, { config, agentId: 'main', modelRef: MOCK_PHONE_MODEL });
  const report = runtime.status(conversationId)!;
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const device = createDevice({ displayName: 'Harmony', platform: 'harmonyos', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }),
    scopes: DEFAULT_MOBILE_SCOPES });
  const credentials = issueDeviceTokenPair(device.id);
  const disconnectPrincipal = vi.fn(); const issue = vi.fn((_claim: object) => ({ ticket: 'test-ticket', path: '/api/phone/live/v1/ws' }));
  const service = { currentConfig: config, getResolvedAuth: () => ({ mode: 'token', token: 'phone-owner-test' }),
    getAuthToken: () => 'phone-owner-test', isGatewayReady: () => true, getExtensionLoader: () => null, emit: vi.fn(),
    phoneStreams: { issue, disconnectPrincipal },
    endpointTools: { registry: { revokePrincipal: vi.fn() } },
    realtime: { disconnectPrincipal: vi.fn() }, voiceRealtime: { disconnectPrincipal: vi.fn() },
    sessions: { getSession: async (id: string) => id === conversationId ? { agentId: 'main', transcriptId } : undefined },
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
    const base = `http://127.0.0.1:${address.port}`;
    const path = `/api/phone/conversations/${conversationId}`;
    const clientId = randomUUID();
    const mobile = (target: string, body?: object, method = body ? 'POST' : 'GET') => {
      const text = body ? JSON.stringify(body) : '';
      return fetch(base + target, { method, headers: signedDeviceHeaders(keys.privateKey, credentials.accessToken, target, method, text,
        { 'Content-Type': 'application/json' }), body: text || undefined });
    };
    const grant = (access: string) => fetch(base + `/api/phone/device-access/${device.id}`, { method: 'PATCH',
      headers: { Authorization: 'Bearer phone-owner-test', 'Content-Type': 'application/json' }, body: JSON.stringify({ access }) });
    expect((await fetch(base + path + '/summary')).status).toBe(401);
    let summary = await mobile(path + '/summary');
    expect(summary.status, await summary.clone().text()).toBe(200);
    expect(await summary.json()).toMatchObject({ payload: { available: true, access: 'control' } });
    expect((await mobile(path + '?clientId=' + clientId)).status).toBe(200);
    expect((await grant('none')).status).toBe(200);
    expect(disconnectPrincipal).toHaveBeenCalledWith(device.id);
    expect(authenticateDeviceAccessToken(credentials.accessToken)?.scopes).toContain('sessions.write');
    summary = await mobile(path + '/summary');
    expect(await summary.json()).toMatchObject({ payload: { available: true, access: 'none' } });
    expect((await mobile(path + '?clientId=' + clientId)).status).toBe(403);
    expect((await mobile(`/api/phone/device-access/${device.id}`, { access: 'control' }, 'PATCH')).status).toBe(403);
    expect((await grant('view')).status).toBe(200);
    summary = await mobile(path + '/summary');
    expect(await summary.json()).toMatchObject({ payload: { access: 'view', binding: { transcriptId, phoneSessionId: report.sessionId } } });
    const state = await mobile(path + '?clientId=' + clientId);
    expect(state.status, await state.clone().text()).toBe(200);
    expect(await state.text()).not.toContain('facts');
    const input = { op: 'takeover', clientId, operationId: randomUUID(), epoch: report.controlEpoch, expectedTranscriptId: transcriptId };
    const controlPath = path + '/' + report.sessionId + '/control';
    expect((await mobile(controlPath, input)).status).toBe(403);
    expect((await mobile('/api/phone/devices')).status).toBe(403);
    expect((await grant('control')).status).toBe(200);
    expect((await mobile(controlPath, { ...input, expectedTranscriptId: randomUUID() })).status).toBe(409);
    const taken = await mobile(controlPath, input);
    expect(taken.status, await taken.clone().text()).toBe(200);
    const live = (await taken.json()).payload;
    expect(live.ownControl).toBe(true);
    expect((await mobile(controlPath, { ...input, operationId: randomUUID() })).status).toBe(409);
    const ticketPath = path + '/' + report.sessionId + '/video-ticket';
    expect((await mobile(ticketPath, { clientId, purpose: 'control', expectedTranscriptId: transcriptId, epoch: live.report.controlEpoch })).status).toBe(200);
    const claim = issue.mock.calls.at(-1)![0] as { validate: () => Promise<void>; readOnly: boolean; deviceId: string };
    expect(claim.readOnly).toBe(false); expect(claim.deviceId).toBe(device.id);
    expect((await grant('view')).status).toBe(200);
    await expect(claim.validate()).rejects.toMatchObject({ code: 'PHONE_PERMISSION_REQUIRED' });
    expect(disconnectPrincipal).toHaveBeenCalledWith(device.id);
    expect(authenticateDeviceAccessToken(credentials.accessToken)?.scopes).not.toContain('phone.control');
    expect((await mobile(controlPath, { ...input, op: 'input', epoch: live.report.controlEpoch,
      action: { type: 'tap', point: [100, 100] }, operationId: randomUUID() })).status).toBe(403);
    expect(driver.execute).not.toHaveBeenCalled();
    expect((await grant('none')).status).toBe(200);
    expect((await mobile(path + '/' + report.sessionId + '/frame?expectedTranscriptId=' + transcriptId)).status).toBe(403);
    expect((await grant('control')).status).toBe(200);
    const revoked = await fetch(base + '/api/endpoint-tools/devices/revoke', { method: 'POST',
      headers: { Authorization: 'Bearer phone-owner-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [device.id] }) });
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    expect(authenticateDeviceAccessToken(credentials.accessToken)).toBeUndefined();
    expect((await mobile(path + '/summary')).status).toBe(401);
    expect(disconnectPrincipal).toHaveBeenCalledWith(device.id);
    await expect(claim.validate()).rejects.toMatchObject({ code: 'PHONE_ACCESS_REVOKED' });
  } finally {
    await runtime.shutdown(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  }
});
