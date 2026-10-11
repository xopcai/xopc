import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/index.js';
import { createDevice, issueDeviceTokenPair } from '../src/storage/sqlite/device-access-repository.js';
import { getOrCreateGatewayIdentity } from '../src/storage/sqlite/gateway-identity-repository.js';
import { getSqliteDatabase } from '../src/storage/sqlite/transaction.js';
import { auth } from '../src/gateway/hono/middleware/auth.js';
import { proofDigest, requestProofMessage } from '../src/gateway/security/device-request-proof.js';

const directory = mkdtempSync(join(tmpdir(), 'xopc-proof-bench-'));
const app = new Hono();
const ownerToken = crypto.randomBytes(32).toString('hex');
app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: ownerToken }) }));
app.post('/api/bench', async c => c.json(await c.req.json()));
openXopcDatabase({ path: join(directory, 'bench.db') });
const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const create = (name: string) => createDevice({ displayName: name, platform: 'ios', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }), scopes: ['sessions.write'] });
const legacy = create('legacy'); const signed = create('signed');
getSqliteDatabase().prepare('UPDATE devices SET request_proof_version = 1 WHERE device_id = ?').run(signed.id);
const legacyToken = issueDeviceTokenPair(legacy.id).accessToken;
const signedToken = issueDeviceTokenPair(signed.id).accessToken;
const gatewayId = getOrCreateGatewayIdentity().id;
const body = JSON.stringify({ text: 'Hello 你好', payload: 'x'.repeat(1024) });
const digest = proofDigest(body);
const times = { legacy: [] as number[], signed: [] as number[], nodeSigning: [] as number[] };
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await once(server, 'listening');
const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
try {
  for (let i = 0; i < 300; i++) {
    for (const kind of (i % 2 ? ['signed', 'legacy'] : ['legacy', 'signed']) as Array<'signed' | 'legacy'>) {
      const token = kind === 'signed' ? signedToken : legacyToken;
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      if (kind === 'signed') {
        const start = performance.now();
        const proof = { timestamp: Date.now(), nonce: crypto.randomBytes(24).toString('base64url'), digest };
        const message = requestProofMessage({ gatewayId, credential: token, method: 'POST', target: '/api/bench', headers: name => name === 'content-type' ? 'application/json' : undefined, proof });
        const signature = crypto.sign('sha256', Buffer.from(message), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
        headers['X-Xopc-Proof'] = `${proof.timestamp}.${proof.nonce}.${digest}.${signature}`;
        if (i >= 30) times.nodeSigning.push(performance.now() - start);
      }
      const start = performance.now();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/bench`, { method: 'POST', headers, body });
      await response.arrayBuffer();
      if (response.status !== 200) throw new Error(`Benchmark rejected: ${response.status}`);
      if (i >= 30) times[kind].push(performance.now() - start);
    }
  }
  const stats = (values: number[]) => {
    values.sort((a, b) => a - b);
    return { samples: values.length, p50Ms: +values[Math.floor(values.length * .5)].toFixed(3), p95Ms: +values[Math.floor(values.length * .95)].toFixed(3) };
  };
  console.log(JSON.stringify({ environment: 'Loopback HTTP, 1KB JSON, SQLite default durability; signing uses Node, not mobile hardware', legacy: stats(times.legacy), signed: stats(times.signed), nodeSigning: stats(times.nodeSigning) }, null, 2));
} finally {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  closeXopcDatabase(); rmSync(directory, { recursive: true, force: true });
}
