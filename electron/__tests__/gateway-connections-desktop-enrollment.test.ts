import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DESKTOP_HOST_MANIFEST } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DesktopEnrollmentManager } from '../desktop/enrollment.js';
import { DesktopIdentityStore } from '../desktop/device-identity.js';

let root: string, server: ReturnType<typeof createServer>, origin: string, gatewayId: string;
let setupWrites: number, epoch: number, profile: any, manager: any;
let orphanCancelled: boolean;
const key = generateKeyPairSync('ed25519'), token = 'synthetic-desktop-owner';
const encryption = { available: async () => true, encrypt: async (value: string) => Buffer.from(value), decrypt: async (value: Buffer) => value.toString() };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'xopc-desktop-enrollment-')); setupWrites = 0; orphanCancelled = false; epoch = 4; gatewayId = randomUUID();
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/gateway-identity/challenge') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const { nonce } = JSON.parse(Buffer.concat(chunks).toString());
      const signedPayload = Buffer.from(JSON.stringify({ purpose: 'gateway-route-v1', gatewayId, nonce, serverTime: Date.now(), expiresAt: Date.now() + 30000, requestProofVersion: 1 })).toString('base64url');
      res.end(JSON.stringify({ signedPayload, signature: sign(null, Buffer.from(signedPayload), key.privateKey).toString('base64url') })); return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('{}'); return; }
    if (req.url === '/api/desktop-host/compatibility') { res.end(JSON.stringify({ ok: true, payload: { gatewayId, publicKey: profile.identity.publicKey, manifest: DESKTOP_HOST_MANIFEST, capabilities: { sshPairing: true } } })); return; }
    if (req.url?.startsWith('/api/device-pairing/setups/')) {
      if (req.method === 'DELETE') orphanCancelled = true;
      res.end(JSON.stringify({ ok: true, request: null })); return;
    }
    if (req.method === 'POST') setupWrites++;
    res.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  profile = { id: randomUUID(), name: 'Synthetic Gateway', origin, transport: 'ssh', identity: { gatewayId, publicKey: key.publicKey.export({ type: 'spki', format: 'pem' }).toString() } };
  manager = { snapshot: () => ({ epoch, selectedId: profile.id, profiles: [profile] }), privateConnection: vi.fn(async () => ({ ...profile, token })) };
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
const enrollment = (consent: () => Promise<boolean>, visible = true) => new DesktopEnrollmentManager({ manager, store: new DesktopIdentityStore(join(root, 'identities'), encryption), visible: () => visible, consent });
it('does not create an invitation or device key when native consent is declined', async () => {
  const consent = vi.fn(async () => false), flow = enrollment(consent);
  await expect(flow.perform('enroll', epoch, profile.id)).rejects.toThrow('DESKTOP_LOCAL_CONSENT_DENIED');
  expect(consent).toHaveBeenCalledOnce(); expect(setupWrites).toBe(0); expect(await readdir(root)).toEqual([]);
  expect(flow.snapshot()[profile.id]).toEqual({ state: 'cancelled', localCapabilities: false });
  expect(JSON.stringify(flow.snapshot())).not.toMatch(/synthetic-desktop-owner|PRIVATE KEY|refreshToken/);
});
it('rejects a hidden window before owner discovery or native approval', async () => {
  const consent = vi.fn(async () => true), flow = enrollment(consent, false);
  await expect(flow.perform('enroll', epoch, profile.id)).rejects.toThrow('DESKTOP_LOCAL_UI_REQUIRED');
  expect(consent).not.toHaveBeenCalled(); expect(manager.privateConnection).not.toHaveBeenCalled(); expect(setupWrites).toBe(0);
});
it('drops late native approval after a connection epoch change', async () => {
  let approve!: (value: boolean) => void; const started = Promise.withResolvers<void>();
  const flow = enrollment(async () => { started.resolve(); return new Promise(resolve => { approve = resolve; }); });
  const running = flow.perform('enroll', epoch, profile.id); await started.promise;
  epoch++; flow.cancel(); approve(true);
  await expect(running).rejects.toThrow('DESKTOP_OPERATION_CANCELLED'); expect(setupWrites).toBe(0); expect(flow.snapshot()).toEqual({});
});
it('checks an independent identity without reading the owner credential', async () => {
  const flow = enrollment(async () => true);
  await expect(flow.perform('check', epoch, profile.id)).rejects.toThrow('DESKTOP_NOT_ENROLLED');
  expect(manager.privateConnection).not.toHaveBeenCalled(); expect(flow.snapshot()[profile.id].state).toBe('unregistered');
});
it('cancels an orphan invitation before offering a replacement and still requires fresh native consent', async () => {
  const store = new DesktopIdentityStore(join(root, 'identities'), encryption);
  const binding = { profileId: profile.id, gatewayId, publicKey: profile.identity.publicKey, origin };
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), setupId = randomUUID();
  await store.save({ version: 1, binding, phase: 'revoked', displayName: 'Synthetic desktop',
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), requestId: randomUUID(), completionKey: randomUUID(),
    pairingToken: `xopc_pair_${setupId}_${'x'.repeat(43)}`, initialRefreshToken: `xopc_rt_${randomUUID()}_${'y'.repeat(43)}` });
  const consent = vi.fn(async () => false), flow = enrollment(consent);
  await expect(flow.perform('reenroll', epoch, profile.id)).rejects.toThrow('DESKTOP_LOCAL_CONSENT_DENIED');
  expect(orphanCancelled).toBe(true); expect(consent).toHaveBeenCalledOnce(); expect(setupWrites).toBe(0);
  expect((await store.load(binding))?.phase).toBe('revoked');
});
