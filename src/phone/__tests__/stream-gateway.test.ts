import { generateKeyPairSync } from 'node:crypto';
import { createDevice } from '../../storage/sqlite/device-access-repository.js';
import { openXopcDatabase, closeXopcDatabase } from '../../storage/sqlite/connection.js';
import { signedDeviceHeaders } from '../../gateway/security/__tests__/signed-device-headers.js';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { PhoneStreamGateway } from '../stream-gateway.js';
import type { PhoneInteractiveSession } from '../interactive-session.js';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const gateway = new PhoneStreamGateway(); const server = createServer();
  server.on('upgrade', (req, socket, head) => gateway.handleUpgrade(req, socket, head));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  cleanups.push(async () => { gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const stream = { provider: { descriptor: { kind: 'scrcpy-h264' } }, subscribe: vi.fn(() => () => {}), input: vi.fn(async () => {}), authorizeClient: vi.fn(() => { throw new Error('View only'); }), revoke: vi.fn(async () => {}) } as unknown as PhoneInteractiveSession;
  const disconnect = vi.fn(async () => {}); const validate = vi.fn(async () => {});
  const claim = { origin, principal: 'owner', client: 'viewer', validate, connect: async () => stream, disconnect };
  const socket = (ticket?: string, requestedOrigin = origin, headers: Record<string, string> = {}) => new WebSocket(origin.replace('http:', 'ws:') + '/api/phone/live/v1/ws', ticket ? ['xopc-phone-v1', ticket] : ['xopc-phone-v1'], { origin: requestedOrigin, headers });
  return { gateway, claim, socket, stream, validate, disconnect };
}
it('requires a single-use phone ticket, matching origin and revalidates the session', async () => {
  const f = await fixture();
  const denied = (ticket?: string, origin?: string) => new Promise<void>(resolve => { const ws = f.socket(ticket, origin); ws.once('error', () => resolve()); });
  await denied();
  const wrong = f.gateway.issue(f.claim); await denied(wrong.ticket, 'http://attacker.invalid');
  await denied(wrong.ticket);
  const issued = f.gateway.issue(f.claim); const ws = f.socket(issued.ticket);
  await new Promise<void>((resolve, reject) => { ws.once('message', bytes => { expect(JSON.parse(bytes.toString()).type).toBe('ready'); resolve(); }); ws.once('error', reject); });
  expect(f.validate).toHaveBeenCalled(); await denied(issued.ticket);
  ws.close(); await vi.waitFor(() => expect(f.disconnect).toHaveBeenCalled());
});
it('does not let a view-only socket cancel another window’s held gesture', async () => {
  const f = await fixture(); const issued = f.gateway.issue(f.claim); const ws = f.socket(issued.ticket);
  await new Promise<void>(resolve => ws.once('message', () => resolve()));
  ws.send(JSON.stringify({ type: 'cancelPointers', epoch: 2 }));
  await new Promise<void>(resolve => ws.once('close', () => resolve()));
  expect(f.stream.revoke).not.toHaveBeenCalled();
});

it('refuses pointer input from an explicitly read-only ticket even if the client owns control elsewhere', async () => {
  const f = await fixture(); const issued = f.gateway.issue({ ...f.claim, readOnly: true });
  const ws = f.socket(issued.ticket);
  await new Promise<void>(resolve => ws.once('message', () => resolve()));
  ws.send(JSON.stringify({ type: 'pointer', phase: 'down', seq: 1, epoch: 2, geometry: 1, x: 500, y: 500 }));
  await new Promise<void>(resolve => ws.once('close', () => resolve()));
  expect(f.stream.input).not.toHaveBeenCalled();
});

it('binds native video tickets to the paired device key and disconnects on revocation', async () => {
  closeXopcDatabase(); openXopcDatabase({ path: ':memory:' });
  const f = await fixture();
  try {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const attacker = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const device = createDevice({ displayName: 'Harmony', platform: 'harmonyos', scopes: ['phone.view'], publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) });
    const claim = { ...f.claim, principal: device.id, deviceId: device.id, readOnly: true };
    const path = '/api/phone/live/v1/ws';
    const stolen = f.gateway.issue(claim);
    const denied = f.socket(stolen.ticket, 'http://ignored-for-native', signedDeviceHeaders(attacker.privateKey, stolen.ticket, path, 'CONNECT'));
    await new Promise<void>(resolve => denied.once('error', () => resolve()));
    expect(f.stream.subscribe).not.toHaveBeenCalled();
    const ticket = f.gateway.issue(claim);
    const ws = f.socket(ticket.ticket, 'http://ignored-for-native', signedDeviceHeaders(keys.privateKey, ticket.ticket, path, 'CONNECT'));
    await new Promise<void>((resolve, reject) => { ws.once('message', () => resolve()); ws.once('error', reject); });
    f.gateway.disconnectPrincipal(device.id);
    await new Promise<void>(resolve => ws.once('close', () => resolve()));
    await vi.waitFor(() => expect(f.disconnect).toHaveBeenCalled());
  } finally { closeXopcDatabase(); }
});

it('revalidates authorization before every input and fences old control epochs', async () => {
  const f = await fixture(); const ticket = f.gateway.issue({ ...f.claim, readOnly: false, inputEpoch: 3 });
  const ws = f.socket(ticket.ticket);
  await new Promise<void>(resolve => ws.once('message', () => resolve()));
  ws.send(JSON.stringify({ type: 'pointer', phase: 'down', seq: 1, epoch: 2, geometry: 1, x: 500, y: 500 }));
  await new Promise<void>(resolve => ws.once('close', () => resolve()));
  expect(f.stream.input).not.toHaveBeenCalled();
  const next = f.gateway.issue({ ...f.claim, readOnly: false, inputEpoch: 3 });
  const second = f.socket(next.ticket);
  await new Promise<void>(resolve => second.once('message', () => resolve()));
  f.validate.mockRejectedValueOnce(new Error('Grant revoked'));
  second.send(JSON.stringify({ type: 'pointer', phase: 'down', seq: 1, epoch: 3, geometry: 1, x: 500, y: 500 }));
  await new Promise<void>(resolve => second.once('close', () => resolve()));
  expect(f.stream.input).not.toHaveBeenCalled();
});
