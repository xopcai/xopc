import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentPluginStore } from '../store.js';
import { PluginSetupService } from '../setup.js';
import { MCP_SCHEMA, PLUGIN_SCHEMA } from '../validation.js';
import { ConfigSchema } from '../../../config/schema.js';
import { preparePluginResources } from '../resources.js';
import { materializePluginServers } from '../mcp-adapter.js';
const connection = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock('../../../agent/mcp/connection-setup.js', () => ({ probeMcpConnection: connection.probe, startMcpAuthorization: vi.fn(), getMcpAuthorization: vi.fn(), cancelMcpAuthorization: vi.fn(), submitMcpRedirect: vi.fn() }));
const roots: string[] = [];
const temp = () => { const p = mkdtempSync(join(tmpdir(), 'xopc-setup-test-')); roots.push(p); return p; };
const config = ConfigSchema.parse({});
function fixture() {
  const source = temp(), store = new AgentPluginStore(temp());
  writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'setup' }));
  writeFileSync(join(source, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { docs: { type: 'streamable-http', url: 'https://example.com/mcp' } } }));
  store.install(source, { reviewHash: store.inspect(source).reviewHash });
  return { source, store, service: new PluginSetupService(store) };
}
beforeEach(() => { vi.clearAllMocks(); connection.probe.mockResolvedValue({ state: 'connected', toolCount: 1 }); });
afterEach(() => roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
it('persists preparation, enforces owners and revisions, and enables globally for existing and future agents', async () => {
  const { store, service } = fixture(); const job = service.create('setup', 'owner');
  expect(new PluginSetupService(store).get('setup', 'owner')).toEqual(job);
  expect(() => service.get('setup', 'other')).toThrow('principal');
  await expect(service.act('setup', 'owner', { action: 'prepare', expectedRevision: 0 }, config, '/tmp')).rejects.toThrow('changed');
  const ready = await service.act('setup', 'owner', { action: 'prepare', expectedRevision: job.revision }, config, '/tmp');
  expect(ready).toMatchObject({ resources: 'ready', state: 'action_required', connections: [{ name: 'docs', state: 'connected' }] });
  expect(store.active('main')).toHaveLength(0);
  const done = await service.act('setup', 'owner', { action: 'complete', expectedRevision: ready.revision, allowPartial: false }, config, '/tmp');
  expect(done.state).toBe('completed'); expect(store.active('main')).toHaveLength(1); expect(store.active('other')).toHaveLength(1);
});
it('keeps the working revision active when a staged update fails or is cancelled', async () => {
  const { source, store, service } = fixture(); let job = service.create('setup', 'owner');
  job = await service.act('setup', 'owner', { action: 'prepare', expectedRevision: job.revision }, config, '/tmp');
  await service.act('setup', 'owner', { action: 'complete', expectedRevision: job.revision, allowPartial: false }, config, '/tmp');
  const previous = store.get('setup')!;
  writeFileSync(join(source, 'change'), 'update');
  store.install(source, { replace: true, stage: true, reviewHash: store.inspect(source).reviewHash });
  job = service.create('setup', 'owner'); connection.probe.mockResolvedValue({ state: 'error' });
  job = await service.act('setup', 'owner', { action: 'prepare', expectedRevision: job.revision }, config, '/tmp');
  await expect(service.act('setup', 'owner', { action: 'complete', expectedRevision: job.revision, allowPartial: false }, config, '/tmp')).rejects.toThrow('unavailable');
  expect(store.active('main')[0].receipt.revision).toBe(previous.receipt.revision);
  await service.act('setup', 'owner', { action: 'cancel', expectedRevision: job.revision }, config, '/tmp');
  expect(store.pending('setup')).toBeUndefined(); expect(store.active('main')[0].receipt.revision).toBe(previous.receipt.revision);
});
it('requires explicit partial consent and never projects an unavailable connection', async () => {
  const { store, service } = fixture(); connection.probe.mockResolvedValue({ state: 'token_required' });
  let job = service.create('setup', 'owner'); job = await service.act('setup', 'owner', { action: 'prepare', expectedRevision: job.revision }, config, '/tmp');
  await service.act('setup', 'owner', { action: 'complete', expectedRevision: job.revision, allowPartial: true }, config, '/tmp');
  expect(store.get('setup')?.readiness).toBe('degraded'); expect(materializePluginServers(store.get('setup')!, store)).toEqual({});
});
it('recovers interrupted work and does not revive a removed plugin', async () => {
  const { store, service } = fixture(); const job = service.create('setup', 'owner');
  const path = join(store.stateDir, 'plugin-setup/setup.json'); writeFileSync(path, JSON.stringify({ ...job, state: 'running' }));
  const recovered = new PluginSetupService(store).get('setup', 'owner')!; expect(recovered.state).toBe('interrupted');
  let finish!: () => void; connection.probe.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ state: 'connected' }); }));
  const preparing = service.act('setup', 'owner', { action: 'prepare', expectedRevision: recovered.revision }, config, '/tmp');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  store.remove('setup'); finish(); await expect(preparing).rejects.toThrow('removed');
  expect(service.get('setup', 'owner')).toBeUndefined();
});
it('downloads declared resources with integrity checking and preserves previous bytes on failure', async () => {
  const { source, store, service } = fixture(); const bytes = Buffer.from('fixture resource');
  let downloads = 0;
  const server = createServer((_req, res) => { downloads++; res.end(bytes); }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
    const resources = [{ id: 'dataset', url: `http://127.0.0.1:${address.port}/data`, sha256: createHash('sha256').update(bytes).digest('hex') }];
    writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'setup', extensions: { 'ai.xopc': { setup: { resources } } } }));
    const plugin = store.install(source, { replace: true, reviewHash: store.inspect(source).reviewHash });
    let job = service.create('setup', 'owner'); job = await service.act('setup', 'owner', { action: 'prepare', expectedRevision: job.revision }, config, '/tmp');
    expect(job.resources).toBe('ready'); expect(readFileSync(join(store.dataDir('setup'), 'resources', plugin.receipt.revision, 'dataset'))).toEqual(bytes);
    const secondSource = temp();
    writeFileSync(join(secondSource, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'shared-resource', extensions: { 'ai.xopc': { setup: { resources } } } }));
    const second = store.install(secondSource, { reviewHash: store.inspect(secondSource).reviewHash });
    writeFileSync(join(store.dataDir('setup'), 'resources', plugin.receipt.revision, 'dataset'), 'changed private copy');
    await preparePluginResources(store, second, new AbortController().signal);
    expect(downloads).toBe(1);
    expect(readFileSync(join(store.dataDir(second.id), 'resources', second.receipt.revision, 'dataset'))).toEqual(bytes);
    const cache = join(store.stateDir, 'plugin-resource-cache', resources[0].sha256);
    store.remove('setup'); expect(readFileSync(cache)).toEqual(bytes);
    store.remove(second.id); expect(() => readFileSync(cache)).toThrow();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('replays a completed action idempotently and rejects reuse for another action', async () => {
  const { service } = fixture(); const job = service.create('setup', 'owner');
  const key = '00000000-0000-4000-8000-000000000001';
  const ready = await service.act('setup', 'owner', { action: 'prepare', expectedRevision: job.revision, idempotencyKey: key }, config, '/tmp');
  const repeated = await service.act('setup', 'owner', { action: 'prepare', expectedRevision: job.revision, idempotencyKey: key }, config, '/tmp');
  expect(repeated.revision).toBe(ready.revision); expect(connection.probe).toHaveBeenCalledTimes(1);
  await expect(service.act('setup', 'owner', { action: 'cancel', expectedRevision: ready.revision, idempotencyKey: key }, config, '/tmp')).rejects.toThrow('another action');
});

it('selects exactly one host CLI resource variant and rejects ambiguous or unsupported variants', async () => {
  const { pluginResources } = await import('../resources.js');
  const file = { url: 'https://store.xopc.ai/files/cli.bin', sha256: 'a'.repeat(64), executable: true };
  const manifest = (variants: unknown[]) => ({ extensions: { 'ai.xopc': { setup: { resources: [{ id: 'official-cli', variants }] } } } });
  const target = { ...file, platform: process.platform, arch: process.arch };
  const other = { ...file, platform: process.platform === 'darwin' ? 'linux' : 'darwin', arch: process.arch };
  expect(pluginResources({ manifest: manifest([target, other]) })).toEqual([{ ...target, id: 'official-cli', maxBytes: 50 * 1024 * 1024 }]);
  expect(() => pluginResources({ manifest: manifest([other]) })).toThrow('Expected one resource variant');
  expect(() => pluginResources({ manifest: manifest([target, target]) })).toThrow('Expected one resource variant');
});
