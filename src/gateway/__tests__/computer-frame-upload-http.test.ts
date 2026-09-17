import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { COMPUTER_FRAME_MAX_BYTES } from '@xopcai/computer-control-contract';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { uploadDesktopFrame } from '../../../electron/computer/frame-upload.js';
import { ConfigSchema } from '../../config/schema.js';
import { EndpointUploadService } from '../../endpoint-tools/upload-service.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

let dir: string, base: string, png: Buffer, uploads: EndpointUploadService;
let server: ReturnType<typeof serve>;
const token = 'isolated-frame-test';
const endpointId = 'desktop-test';
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'xopc-frame-http-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
  uploads = new EndpointUploadService(join(dir, 'files'));
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null, endpointTools: { uploads },
  } as unknown as GatewayService });
  server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  base = `http://127.0.0.1:${address.port}`;
  png = await sharp(randomBytes(1024 * 1024 * 3), { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer();
}, 30_000);
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  uploads.close(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  rmSync(dir, { recursive: true, force: true });
});
function grant() {
  const invocationId = randomUUID();
  return { invocationId, ...uploads.createGrant(invocationId, endpointId, Date.now(), 'computer-frame') };
}
async function post(g: ReturnType<typeof grant>, bytes: BodyInit, extra: Record<string, string> = {}) {
  return fetch(base + g.path + '?name=observation.png', { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'image/png',
    'x-endpoint-id': endpointId, 'x-endpoint-upload-token': g.token, ...extra,
  }, body: bytes, duplex: 'half' } as RequestInit);
}
it('uploads a real >1MB screenshot through auth, body limits, image validation and the desktop client', async () => {
  expect(png.length).toBeGreaterThan(1024 * 1024);
  expect(png.length).toBeLessThan(COMPUTER_FRAME_MAX_BYTES);
  const g = grant();
  const file = await uploadDesktopFrame({ base, token, endpointId, invocationId: g.invocationId, grant: g,
    signal: new AbortController().signal, file: { name: 'observation.png', mimeType: 'image/png', bytes: png } });
  uploads.validateAndClose(g.invocationId, [file]);
  expect(readdirSync(join(dir, 'files'))).toEqual([]);
  expect((await fetch(`${base}/api/endpoint-tools/files/${file.fileId}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
  expect(uploads.takeComputerFrame(file.fileId, 'other-invocation')).toBeUndefined();
  expect(Buffer.from(uploads.takeComputerFrame(file.fileId, g.invocationId)!).equals(png)).toBe(true);
  expect(uploads.takeComputerFrame(file.fileId, g.invocationId)).toBeUndefined();
}, 15_000);
it('keeps ordinary and neighboring APIs at 1MB', async () => {
  for (const path of ['/api/config', '/api/endpoint-tools/invocations/test/files-other']) {
    const res = await fetch(base + path, { method: 'POST', body: png });
    expect(res.status).toBe(413);
    await res.arrayBuffer();
  }
});
it('requires Gateway authentication and the correct endpoint-bound upload grant', async () => {
  const g = grant();
  // Rejection precedes body decoding. A large in-flight body can reset an early
  // rejected HTTP/1 socket; large authenticated uploads are exercised separately.
  const probe = Buffer.from('permission probe');
  const denied = await post(g, probe, { Authorization: 'Bearer invalid' });
  expect(denied.status).toBe(401); await denied.arrayBuffer();
  for (const headers of [{ 'x-endpoint-id': 'another-device' }, { 'x-endpoint-upload-token': 'invalid' }]) {
    const response = await post(g, probe, headers);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD_GRANT' } });
  }
  uploads.abort(g.invocationId);
  expect(await (await post(g, probe)).json()).toMatchObject({ error: { code: 'INVALID_UPLOAD_GRANT' } });
});
it('enforces 5MB for both declared-length and chunked frame uploads', async () => {
  const oversized = Buffer.alloc(COMPUTER_FRAME_MAX_BYTES + 1);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(oversized); controller.close(); } });
  for (const body of [oversized, stream]) {
    const g = grant();
    const res = await post(g, body);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'UPLOAD_TOO_LARGE' } });
    uploads.abort(g.invocationId);
  }
});
it('rejects corrupt and MIME-mismatched screenshots without exposing decoder errors', async () => {
  for (const [bytes, mime] of [[Buffer.from('not an image: private content'), 'image/png'], [png, 'image/jpeg']] as const) {
    const g = grant();
    const res = await post(g, bytes, { 'Content-Type': mime });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('INVALID_COMPUTER_FRAME');
    expect(body).not.toContain('private content');
    uploads.abort(g.invocationId);
  }
});
it('rejects images exceeding the decoded pixel budget even when the compressed body is tiny', async () => {
  const image = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
  expect(image.length).toBeLessThan(COMPUTER_FRAME_MAX_BYTES);
  const g = grant();
  const response = await post(g, image);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: 'INVALID_COMPUTER_FRAME' } });
  uploads.abort(g.invocationId);
});
