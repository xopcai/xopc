import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:https';
import { Hono } from 'hono';
import { registerDeviceAuthPublicRoutes, registerDeviceRoutes } from '../../../src/gateway/hono/routes/devices.js';
import type { AuthenticatedRouteDeps } from '../../../src/gateway/hono/routes/deps.js';
import { openXopcDatabase, closeXopcDatabase, getDevice } from '../../../src/storage/sqlite/index.js';
import { authenticateDeviceAccessToken } from '../../../src/storage/sqlite/device-access-repository.js';

// Isolated loopback-only harness. Never load a user's config, database or Gateway credentials.
const stateDir = mkdtempSync(join(tmpdir(), 'xopc-harmony-native-'));
const certPath = join(stateDir, 'ca.pem');
const keyPath = join(stateDir, 'key.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
  '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
const testResources = new URL('../entry/src/ohosTest/resources/rawfile/', import.meta.url);
mkdirSync(testResources, { recursive: true });
copyFileSync(certPath, new URL('native-test-ca.pem', testResources));
openXopcDatabase({ path: join(stateDir, 'xopc.db') });
const app = new Hono();
registerDeviceAuthPublicRoutes(app);
registerDeviceRoutes(app, {
  service: { currentConfig: { gateway: { publicUrl: 'https://127.0.0.1:9443' } }, realtime: { disconnectPrincipal() {} } },
} as unknown as AuthenticatedRouteDeps);
app.get('/api/test/invitation', async (c) => {
  const response = await app.request('/api/device-pairing/setups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetKind: 'mobile' }),
  });
  const result = await response.json();
  return c.json({ link: result.setup.universalLink });
});
app.get('/api/test/auth', (c) => {
  const identity = authenticateDeviceAccessToken((c.req.header('Authorization') ?? '').replace(/^Bearer /, ''));
  if (!identity) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ deviceId: identity.deviceId, platform: getDevice(identity.deviceId)?.platform });
});
const server = createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const method = req.method ?? 'GET';
    const response = await app.request(req.url ?? '/', {
      method, headers: req.headers as Record<string, string>,
      ...(['GET', 'HEAD'].includes(method) ? {} : { body: Buffer.concat(chunks) }),
    });
    const body = await response.text();
    if (req.url === '/api/device-pairing/requests' && response.ok) {
      const pending = JSON.parse(Buffer.from(JSON.parse(body).signedPayload, 'base64url').toString()).request;
      if (pending.status === 'pending') {
        const decision = await app.request(`/api/device-pairing/requests/${pending.requestId}/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve', expectedRevision: pending.revision }),
        });
        if (!decision.ok) throw new Error('TEST_APPROVAL_FAILED');
      }
    }
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(body);
  } catch { res.writeHead(500); res.end('{"error":"test harness failed"}'); }
});
server.listen(9443, '127.0.0.1', () => {
  console.log(`Native test harness ready. Public CA: ${certPath}`);
  console.log('Public CA generated in ohosTest resources. Build the test HAP now; use hdc rport tcp:9443 tcp:9443.');
});
const cleanup = (): void => {
  server.closeAllConnections(); server.close(); closeXopcDatabase();
  rmSync(stateDir, { recursive: true, force: true }); process.exit(0);
};
process.once('SIGINT', cleanup); process.once('SIGTERM', cleanup);
