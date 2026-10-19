import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { serve } from '@hono/node-server';
import { ConfigSchema } from '../src/config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { AgentPluginStore } from '../src/extensions/agent-plugins/store.js';
import { pluginServerId } from '../src/extensions/agent-plugins/validation.js';
import { prepareNativeMcpConfig } from '../src/agent/mcp/native-mcp.js';
import { createNativeMcpCredentials } from '../src/agent/mcp/credential-store.js';
import { pluginOAuthCredentialId } from '../src/extensions/agent-plugins/mcp-adapter.js';
import { CredentialResolver } from '../src/auth/credentials.js';
import { pluginCredentialProviderPrefix } from '../src/extensions/agent-plugins/auth.js';
import { SkillManager } from '../src/agent/skills/skill-manager.js';
import { createHonoApp } from '../src/gateway/hono/app.js';
import { ExtensionLoader } from '../src/extensions/loader.js';
import { fetchRegistry } from '../src/extensions/marketplace.js';
import { resolveExtensionsDir } from '../src/config/paths.js';
import type { GatewayService } from '../src/gateway/service.js';
import { invokePreparedTool } from './lib/plugin-lab-runtime.mts';
const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'xopc-store-e2e-'));
const evidence = resolve(process.env.XOPC_PLUGIN_E2E_EVIDENCE || '/tmp/xopc-store-plugin-e2e');
await mkdir(evidence, { recursive: true });
process.env.XOPC_STATE_DIR = root; process.env.PI_CODING_AGENT_DIR = join(root, 'pi'); process.env.XOPC_LOG_LEVEL = 'fatal';
process.env.XOPC_CONFIG_PATH = join(root, 'xopc.json'); process.env.XOPC_WORKSPACE = root;
const storeUrl = process.env.XOPC_EXTENSIONS_STORE_URL || 'https://store.xopc.ai';
process.env.XOPC_SKILLS_STORE_URL = storeUrl; process.env.XOPC_EXTENSIONS_STORE_URL = storeUrl;
const auth = { mode: 'token' as const, token: randomUUID() }, config = ConfigSchema.parse({ gateway: { auth, skillsStoreBaseUrl: storeUrl } });
await writeFile(process.env.XOPC_CONFIG_PATH, JSON.stringify(config));
openXopcDatabase();
seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: root, profile: { name: 'Main' } }, { id: 'other', enabled: true, workspace: root, profile: { name: 'Other' } }] });
const service = { currentConfig: config, getResolvedAuth: () => auth, getAuthToken: () => auth.token, getEffectiveListenPort: () => 18790, isGatewayReady: () => true, getExtensionLoader: () => null, marketplace: { reloadSkills() {} } } as unknown as GatewayService;
const app = createHonoApp({ service }); let gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
if (!gateway.listening) await once(gateway, 'listening');
let base = '';
function address() { const a = gateway.address(); assert(a && typeof a !== 'string'); base = `http://127.0.0.1:${a.port}`; } address();
const checks: string[] = [];
const pass = (name: string) => { checks.push(name); console.log(JSON.stringify({ passed: name })); };
async function api(path: string, method = 'GET', body?: unknown, status = 200): Promise<any> {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
  const data: any = await response.json(); assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`); return data.payload ?? data;
}
const store = new AgentPluginStore();
async function job(id: string) { return api(`/api/extensions/agent-plugins/${id}/setup`); }
async function act(id: string, action: string, values: Record<string, unknown> = {}) {
  const current = await job(id);
  let next = await api(`/api/extensions/agent-plugins/${id}/setup`, 'POST', { action, expectedRevision: current.revision, idempotencyKey: randomUUID(), ...values });
  if (action === 'prepare') {
    for (let n = 0; n < 1200 && next.state === 'running'; n++) { await new Promise(r => setTimeout(r, 100)); next = await job(id); }
    assert.notEqual(next.state, 'running');
  }
  return next;
}
async function signIn(id: string, deny = false) {
  await act(id, 'authorize', { server: 'notes' });
  let authState: any;
  for (let n = 0; n < 600; n++) {
    authState = await api(`/api/extensions/agent-plugins/${id}/setup/auth/notes`);
    if (authState.authorizationUrl) break;
    assert.notEqual(authState.state, 'error', JSON.stringify(authState)); await new Promise(r => setTimeout(r, 100));
  }
  assert(authState.authorizationUrl);
  const consent = new URL(authState.authorizationUrl); consent.searchParams.set('consent', deny ? 'deny' : 'allow');
  const response = await fetch(consent, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 302);
  const redirect = response.headers.get('location'); assert(redirect);
  const wrong = new URL(redirect); wrong.searchParams.set('state', 'wrong-state');
  await api(`/api/extensions/agent-plugins/${id}/setup/auth/notes/redirect`, 'POST', { url: wrong.href }, 400);
  await api(`/api/extensions/agent-plugins/${id}/setup/auth/notes/redirect`, 'POST', { url: redirect });
  for (let n = 0; n < 600; n++) {
    authState = await api(`/api/extensions/agent-plugins/${id}/setup/auth/notes`);
    if (['connected', 'error', 'cancelled'].includes(authState.state)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (deny) assert.notEqual(authState.state, 'connected'); else assert.equal(authState.state, 'connected', JSON.stringify(authState));
}
async function install(name: string, version: string, id?: string) {
  const source = `store:${name}@${version}`;
  const plan = await api('/api/extensions/inspect', 'POST', { source });
  const row = await api(id ? `/api/extensions/agent-plugins/${id}/update` : '/api/extensions/install', 'POST', { source, reviewHash: plan.reviewHash, setup: true });
  return row;
}
try {
  assert.equal((await fetch(base + '/api/extensions/inspect', { method: 'POST' })).status, 401);
  const registry = await fetchRegistry(true);
  for (const name of ['xopc-plugin-lab-codex', 'xopc-plugin-lab-claude', 'xopc-extension-lab']) assert(registry.extensions.some(e => e.id === name));
  pass('public Store discovery and authenticated local Gateway');
  for (const dialect of ['codex', 'claude']) {
    const name = `xopc-plugin-lab-${dialect}`;
    let id: string;
    if (dialect === 'codex') {
      const result = await run(process.execPath, ['dist/src/cli/bin.js', 'extensions', 'install', `store:${name}@1.0.0`, '--yes'], { cwd: resolve('.'), env: process.env, timeout: 120000, maxBuffer: 2e6 });
      await writeFile(join(evidence, 'cli-install.log'), result.stdout + result.stderr);
      const installed = store.list().find(p => p.manifest.name === name); assert(installed); id = installed.id;
    } else id = (await install(name, '1.0.0')).pluginId;
    assert(id);
    const plugin = store.get(id)!; assert.equal(plugin.layout?.dialect, dialect); assert.equal(plugin.receipt.provenance?.kind, 'store');
    assert.equal(store.active('main', root).some(p => p.id === id), false);
    pass(`${dialect}: Store ZIP download, SHA verification and disabled installation${dialect === 'codex' ? ' via built xopc CLI' : ''}`);
    await api(`/api/extensions/agent-plugins/${id}/setup`, 'POST', { action: 'complete', expectedRevision: (await job(id)).revision }, 400);
    let setup = await act(id, 'prepare'); assert.equal(setup.resources, 'ready'); assert.match(setup.error, /configuration/);
    await act(id, 'configure', { values: { accessKey: `test-only-${dialect}` } });
    setup = await act(id, 'prepare'); assert.equal(setup.connections.find((s: any) => s.name === 'local').state, 'connected'); assert.equal(setup.connections.find((s: any) => s.name === 'notes').state, 'oauth_required');
    pass(`${dialect}: Store resources, required secret configuration and native stdio discovery`);
    if (dialect === 'codex') { await signIn(id, true); pass('OAuth denial and wrong-state callback rejected'); }
    await signIn(id);
    setup = await act(id, 'prepare'); assert(setup.connections.every((s: any) => s.state === 'connected'), JSON.stringify(setup));
    const duplicate = randomUUID(), before = await job(id);
    const complete = { action: 'complete', expectedRevision: before.revision, idempotencyKey: duplicate, workspacePaths: [root] };
    await api(`/api/extensions/agent-plugins/${id}/setup`, 'POST', complete);
    await api(`/api/extensions/agent-plugins/${id}/setup`, 'POST', complete);
    await api(`/api/extensions/agent-plugins/${id}/setup`, 'POST', { action: 'prepare', expectedRevision: before.revision }, 400);
    let runtime = await prepareNativeMcpConfig(config, root, 'main');
    // Use the normalized public IDs rather than assuming native tool name length.
    const note = pluginServerId(id, 'notes'), local = pluginServerId(id, 'local');
    assert(runtime.servers.some(s => s.name === note));
    await invokePreparedTool(runtime, root, note, 'sandbox-note-001'); await invokePreparedTool(runtime, root, local, 'local-note-001');
    assert.equal((await prepareNativeMcpConfig(config, root, 'other')).servers.some(s => [note, local].includes(s.name)), true);
    assert.equal((await prepareNativeMcpConfig(config, join(root, 'unbound'), 'main')).servers.some(s => [note, local].includes(s.name)), false);
    assert(new SkillManager(root, join(root, 'empty-skills'), { agentId: 'main' }).getSkills().some(s => s.name === `${id}.lab`));
    assert.equal(new SkillManager(root, join(root, 'empty-skills'), { agentId: 'other' }).getSkills().some(s => s.name === `${id}.lab`), true);
    pass(`${dialect}: OAuth PKCE login, idempotent activation, actual Agent tool calls and global Agent/Skill availability and explicit workspace scope`);
    // Restart the local HTTP server, then use the persisted grant through a new native runtime.
    if ('closeAllConnections' in gateway) gateway.closeAllConnections(); await new Promise<void>(r => gateway.close(() => r()));
    gateway = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 0 }); if (!gateway.listening) await once(gateway, 'listening'); address();
    runtime = await prepareNativeMcpConfig(config, root, 'main'); await invokePreparedTool(runtime, root, note, 'sandbox-note-001');
    pass(`${dialect}: Gateway restart retains setup and local OAuth grant`);
    const originalRevision = store.get(id)!.receipt.revision;
    await install(name, '1.1.0-e2e-invalid', id);
    setup = await act(id, 'prepare'); assert.equal(setup.state, 'failed'); assert.equal(setup.resources, 'error');
    assert.equal(store.get(id)!.receipt.revision, originalRevision);
    await invokePreparedTool(await prepareNativeMcpConfig(config, root, 'main'), root, note, 'sandbox-note-001');
    await act(id, 'cancel'); assert.equal(store.pending(id), undefined);
    pass(`${dialect}: invalid resource hash blocks candidate; old tools survive failure and cancellation`);
    await install(name, '1.1.0', id);
    await act(id, 'configure', { values: { accessKey: `test-only-v2-${dialect}` } });
    setup = await act(id, 'prepare');
    if (setup.connections.some((s: any) => s.name === 'notes' && s.state !== 'connected')) { await signIn(id); setup = await act(id, 'prepare'); }
    assert(setup.connections.every((s: any) => s.state === 'connected'), JSON.stringify(setup));
    await act(id, 'complete', { workspacePaths: [root] }); assert.equal(store.get(id)!.manifest.version, '1.1.0');
    await invokePreparedTool(await prepareNativeMcpConfig(config, root, 'main'), root, local, '1.1.0');
    await api(`/api/extensions/agent-plugins/${id}/rollback`, 'POST', {}); assert.equal(store.get(id)!.manifest.version, '1.0.0');
    await invokePreparedTool(await prepareNativeMcpConfig(config, root, 'main'), root, local, '1.0.0');
    pass(`${dialect}: Store version upgrade and rollback use correct local resource/config revision`);
    assert((await prepareNativeMcpConfig(config, root, 'other')).servers.some(s => s.name === note));
    const history = store.history(id);
    const aliases = history.flatMap(p => Object.entries(p.receipt.oauthServers ?? {}).map(([name, url]) => ({ alias: pluginOAuthCredentialId(id, p.receipt.revision, name), url })));
    const savedConfig = await readFile(join(root, 'plugin-config', `${id}-${originalRevision}.json`), 'utf8');
    assert(!savedConfig.includes(`test-only-${dialect}`));
    assert(savedConfig.includes('xopcSecretRef'));
    const setupDisk = await readFile(join(root, 'plugin-setup', `${id}.json`), 'utf8');
    assert(!setupDisk.includes('access_token') && !setupDisk.includes('authorizationUrl'));
    await api(`/api/extensions/agent-plugins/${id}`, 'DELETE', { removeData: true, removeCredentials: true }); assert.equal(store.get(id), undefined);
    assert.equal((await prepareNativeMcpConfig(config, root, 'other')).servers.some(s => s.name === note), false);
    await assert.rejects(readFile(join(store.dataDir(id), 'resources', originalRevision, 'program')));
    const nativeCredentials = await createNativeMcpCredentials();
    for (const entry of aliases) assert(!await nativeCredentials.tokens(entry.alias, entry.url));
    assert(!(await new CredentialResolver({ stateDir: root }).listProfiles()).some(p => p.provider.startsWith(pluginCredentialProviderPrefix(id))));
    for (const p of history) await assert.rejects(readFile(join(root, 'plugin-config', `${id}-${p.receipt.revision}.json`)));
    pass(`${dialect}: global activation and uninstall remove runtime projection and resources, config references and owned credentials`);
  }
  config.mcp ??= { servers: {} };
  config.mcp.servers ??= {};
  const sharedCredential = `mcp_draft_${'f'.repeat(32)}`;
  config.mcp.servers.labShared = { url: `${storeUrl}/plugin-lab/mcp`, xopcOAuthCredentialId: sharedCredential };
  const nativeAttempt = await api('/api/mcp/servers/labShared/auth', 'POST', {});
  let sharedAuth: any;
  for (let n = 0; n < 600; n++) {
    sharedAuth = await api(`/api/mcp/auth/${nativeAttempt.id}`);
    if (sharedAuth.authorizationUrl && sharedAuth.acceptsRedirect) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert(sharedAuth.authorizationUrl);
  const consent = new URL(sharedAuth.authorizationUrl); consent.searchParams.set('consent', 'allow');
  const consentResult = await fetch(consent, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); assert.equal(consentResult.status, 302);
  await api(`/api/mcp/auth/${nativeAttempt.id}/redirect`, 'POST', { url: consentResult.headers.get('location') });
  for (let n = 0; n < 600; n++) {
    sharedAuth = await api(`/api/mcp/auth/${nativeAttempt.id}`);
    if (['connected', 'error'].includes(sharedAuth.state)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(sharedAuth.state, 'connected', JSON.stringify(sharedAuth));
  const reuse = await install('xopc-plugin-lab-claude', '1.0.0');
  await act(reuse.pluginId, 'configure', { values: { accessKey: 'reuse-test-only' } });
  await act(reuse.pluginId, 'prepare');
  const candidates = await api(`/api/extensions/agent-plugins/${reuse.pluginId}/setup/reusable`);
  assert(candidates.notes.some((v: any) => v.id === 'labShared'));
  await act(reuse.pluginId, 'reuse', { server: 'notes', sourceServerId: 'labShared' });
  const reused = await act(reuse.pluginId, 'prepare'); assert(reused.connections.every((v: any) => v.state === 'connected'));
  await act(reuse.pluginId, 'complete', {});
  let sharedRuntime = await prepareNativeMcpConfig(config, root, 'main');
  const reusedServer = pluginServerId(reuse.pluginId, 'notes');
  assert.equal(sharedRuntime.credentialAliases[reusedServer], sharedCredential);
  await invokePreparedTool(sharedRuntime, root, reusedServer, 'sandbox-note-001');
  config.mcp.servers.labShared.url = `${storeUrl}/plugin-lab/changed`;
  sharedRuntime = await prepareNativeMcpConfig(config, root, 'main');
  assert(!sharedRuntime.servers.some(s => s.name === reusedServer));
  config.mcp.servers.labShared.url = `${storeUrl}/plugin-lab/mcp`;
  await api(`/api/extensions/agent-plugins/${reuse.pluginId}`, 'DELETE', { removeData: true, removeCredentials: true });
  assert(await (await createNativeMcpCredentials()).tokens(sharedCredential, `${storeUrl}/plugin-lab/mcp`));
  assert.equal((await api('/api/mcp/servers/labShared/probe', 'POST', {})).state, 'connected');
  pass('explicit account reuse, source-change invalidation and shared credentials survive plugin uninstall');
  const nativeInstall = await run(process.execPath, ['dist/src/cli/bin.js', 'extensions', 'install', 'store:xopc-extension-lab@1.0.1', '--yes'], { cwd: resolve('.'), env: process.env, timeout: 120000, maxBuffer: 2e6 });
  await writeFile(join(evidence, 'native-cli-install.log'), nativeInstall.stdout + nativeInstall.stderr);
  const loader = new ExtensionLoader({ workspaceDir: root, extensionsDir: resolveExtensionsDir() });
  try {
    const deniedNative = await loader.loadExtension({ id: 'xopc-extension-lab', name: 'Extension Lab', path: join(resolveExtensionsDir(), 'xopc-extension-lab'), source: 'global', enabled: true });
    assert.equal(deniedNative, null);
    loader.setSecurityConfig({ allow: ['xopc-extension-lab'] });
    const loaded = await loader.loadExtension({ id: 'xopc-extension-lab', name: 'Extension Lab', path: join(resolveExtensionsDir(), 'xopc-extension-lab'), source: 'global', enabled: true });
    assert(loaded, JSON.stringify(loader.getDiagnostics()));
    const tool = loader.getRegistry().getTool('plugin_lab_status'); assert(tool);
    const result = await tool.execute(randomUUID(), {}); assert(JSON.stringify(result).includes('extension-store-verified'));
    assert(await loader.unloadExtension('xopc-extension-lab')); assert.equal(loader.getRegistry().getTool('plugin_lab_status'), undefined);
  } finally { await loader.shutdown(); }
  pass('native Extension: Store installation via built CLI, host loader activation, tool execution and unload');
  const resourceDir = join(root, 'plugin-resource-cache');
  assert.deepEqual((await readdir(resourceDir)).filter(p => /^[a-f0-9]{64}$/.test(p)), []);
  pass('resource cache ownership cleanup after both plugins are removed');
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: true, store: storeUrl, at: new Date().toISOString(), checks }, null, 2));
  console.log(JSON.stringify({ ok: true, count: checks.length, evidence }));
} catch (error) {
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: false, checks, error: String(error), stack: error instanceof Error ? error.stack : undefined }, null, 2)); throw error;
} finally {
  if ('closeAllConnections' in gateway) gateway.closeAllConnections(); await new Promise<void>(r => gateway.close(() => r())); closeXopcDatabase(); await rm(root, { recursive: true, force: true });
}
process.exit(0);
