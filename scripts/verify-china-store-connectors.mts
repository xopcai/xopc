import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';

import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { ConfigSchema } from '../src/config/schema.js';
import { createHonoApp } from '../src/gateway/hono/app.js';
import type { GatewayService } from '../src/gateway/service.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';

const releaseDirectory = resolve(process.env.XOPC_CONNECTOR_RELEASE_DIR || '/tmp/xopc-china-store-release');
const release = JSON.parse(await readFile(join(releaseDirectory, 'release-manifest.json'), 'utf8'));
const live = process.argv.includes('--live');
const directory = await mkdtemp(join(tmpdir(), 'china-store-acceptance-'));
Object.assign(process.env, { XOPC_STATE_DIR: directory, PI_CODING_AGENT_DIR: join(directory, 'pi'), XOPC_CONFIG_PATH: join(directory, 'xopc.json'), XOPC_WORKSPACE: directory, XOPC_SKILLS_STORE_URL: 'https://store.xopc.ai', XOPC_LOG_LEVEL: 'fatal' });
const originalFetch = globalThis.fetch;
if (!live) globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'store.xopc.ai') return originalFetch(input, init);
  const pkg = release.packages.find((value: any) => url.pathname === '/api/v1/packages/' + value.name || url.pathname === '/files/' + value.artifact);
  if (!pkg) return new Response('{}', { status: 404 });
  if (url.pathname.startsWith('/files/')) return new Response(await readFile(join(releaseDirectory, pkg.artifact)));
  return Response.json({ id: pkg.name, name: pkg.name, type: 'connector', description: pkg.description, latestVersion: { version: pkg.version, manifest: pkg.manifest, sha256: pkg.sha256, downloadUrl: 'https://store.xopc.ai/files/' + pkg.artifact } });
};
const auth = { mode: 'token' as const, token: randomUUID() };
const config = ConfigSchema.parse({ gateway: { auth } });
await writeFile(process.env.XOPC_CONFIG_PATH!, JSON.stringify(config));
openXopcDatabase(); seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: directory }] });
const service = { currentConfig: config, saveConfig: async () => { await writeFile(process.env.XOPC_CONFIG_PATH!, JSON.stringify(config)); return { saved: true }; }, getResolvedAuth: () => auth, getAuthToken: () => auth.token, getEffectiveListenPort: () => 18790, isGatewayReady: () => true, getExtensionLoader: () => null } as unknown as GatewayService;
const app = createHonoApp({ service });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert(address && typeof address !== 'string');
const base = 'http://127.0.0.1:' + address.port;
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json() as any;
  assert.equal(response.status, 200, path + ': ' + JSON.stringify(data));
  return data.payload;
}
const results = [];
try {
  assert.equal((await fetch(base + '/api/capabilities/connectors')).status, 401);
  for (const pkg of release.packages) {
    const root = '/api/capabilities/connectors/' + pkg.name;
    const { plan } = await api(root + '/install-plan', 'POST', { version: pkg.version });
    assert.equal(plan.definition.provenance.sha256, pkg.sha256);
    const secrets = Object.fromEntries((plan.definition.setup.secrets || []).map((field: any) => [field.key, 'synthetic-acceptance-value']));
    const { instance } = await api(root + '/install', 'POST', { version: pkg.version, reviewHash: plan.reviewHash, secrets });
    assert.equal(instance.connectorId, pkg.name);
    assert.equal(instance.materialized.type, 'mcp');
    const serverId = instance.materialized.serverId;
    const materialized = config.mcp!.servers[serverId]!;
    if (pkg.local) assert.deepEqual(materialized.args, pkg.manifest.runtime.serverTemplate.args);
    else assert.equal(new URL(materialized.url!).href, new URL(pkg.manifest.runtime.serverTemplate.url).href);
    assert(!JSON.stringify(config).includes('synthetic-acceptance-value'));
    assert((await api('/api/connectors/installed')).instances.some((item: any) => item.connectorId === pkg.name));
    await api('/api/connectors/' + instance.instanceId, 'DELETE');
    assert(!config.mcp!.servers[serverId]);
    results.push({ name: pkg.name, version: pkg.version, sha256: pkg.sha256, installed: true, removed: true });
  }
  const report = { ok: true, liveStore: live, authenticatedGateway: true, realAccountBusinessCalls: false, packages: results };
  await writeFile(join(releaseDirectory, live ? 'live-acceptance.json' : 'local-acceptance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  globalThis.fetch = originalFetch;
  await new Promise<void>(resolve => server.close(() => resolve()));
  closeXopcDatabase(); await rm(directory, { recursive: true, force: true });
}

process.exit(0);
