import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../../../config/schema.js';
import { AgentPluginStore } from '../store.js';
import { PluginSetupService, setupActionSchema } from '../setup.js';
import { materializePluginServers } from '../mcp-adapter.js';
import { agentPluginInventoryRow } from '../inventory.js';
import { getPluginCliAuthorization } from '../cli-authorization.js';
import { safeAuthorizationUrl, parsePluginAuthorizationCheck } from '../setup-contract.js';
const probe = vi.hoisted(() => vi.fn());
vi.mock('../../../agent/mcp/connection-setup.js', () => ({ probeMcpConnection: probe, startMcpAuthorization: vi.fn(), getMcpAuthorization: vi.fn(), cancelMcpAuthorization: vi.fn(), submitMcpRedirect: vi.fn() }));
const roots: string[] = [];
const config = ConfigSchema.parse({});
function fixture(withCliCredentials = false, permissionIssue = false) {
  const root = mkdtempSync(join(tmpdir(), 'xopc-auth-lifecycle-')); roots.push(root);
  const source = join(root, 'source'); mkdirSync(join(source, '.codex-plugin'), { recursive: true });
  const process = { command: 'node', args: ['${PLUGIN_ROOT}/login.mjs', 'login'], ...(withCliCredentials ? { env: { CLIENT_SECRET: '${user_config.clientSecret}' } } : {}) };
  writeFileSync(join(source, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'accounts', userConfig: { clientId: { type: 'string', title: 'Client ID', required: true }, clientSecret: { type: 'string', title: 'Client Secret', required: true, sensitive: true } }, extensions: { 'ai.xopc': { setup: { version: 1, authorizations: [{ id: 'account', title: 'Test account', servers: ['notes'], methods: [{ id: 'manual', type: 'form', title: 'Client credentials', fields: ['clientId', 'clientSecret'] }, { id: 'cli', type: 'cli', title: 'CLI', fields: withCliCredentials ? ['clientSecret'] : [], login: process, check: { ...process, args: ['${PLUGIN_ROOT}/login.mjs', 'check'] } }] }] } } } }));
  writeFileSync(join(source, '.mcp.json'), JSON.stringify({ mcpServers: { notes: { command: 'node' } } }));
  writeFileSync(join(source, 'login.mjs'), `import {existsSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const path=join(process.env.PLUGIN_ACCOUNT_HOME,'approved');if(${withCliCredentials}&&process.env.CLIENT_SECRET!=='secret-cli-vault')throw new Error('Missing CLI credential');if(process.argv[2]==='check'){console.log(JSON.stringify({authenticated:existsSync(path),issues:${permissionIssue}&&!existsSync(join(process.env.PLUGIN_ACCOUNT_HOME,'calendar-granted'))?[{id:'calendar',title:'Calendar permission required',scopes:['calendar:calendar.event:read'],instructions:['Enable application access, then reconnect'],method:'cli',helpUrl:'https://example.com/permissions'}]:[]}));}else{console.log(JSON.stringify({type:'challenge',kind:'qr',url:'https://example.com/authorize',message:'Step 2: authorize user'}));while(!existsSync(path))await new Promise(r=>setTimeout(r,30));writeFileSync(join(process.env.PLUGIN_ACCOUNT_HOME,'env-check'),String(process.env.XOPC_TEST_HOST_SECRET));}`);
  const store = new AgentPluginStore(join(root, 'state')); const plan = store.inspect(source); expect(plan.diagnostics).toEqual([]);
  const plugin = store.install(source, { reviewHash: plan.reviewHash });
  const service = new PluginSetupService(store); service.create(plugin.id, 'owner');
  const act = async (input: Record<string, unknown>) => service.act(plugin.id, 'owner', setupActionSchema.parse({ expectedRevision: service.get(plugin.id, 'owner')!.revision, ...input }), config, root);
  return { root, store, service, plugin, act };
}
beforeEach(() => { vi.clearAllMocks(); probe.mockResolvedValue({ state: 'connected', toolCount: 1 }); });
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
it('persists skipped authorization, exposes the badge, and reconnects a credential form globally', async () => {
  const { store, plugin, service, act } = fixture();
  let job = await act({ action: 'prepare' }); expect(job.missingConfig).toEqual([]); expect(probe).not.toHaveBeenCalled();
  await act({ action: 'defer' });
  expect(new PluginSetupService(store).get(plugin.id, 'owner')).toMatchObject({ installed: true, deferred: true, state: 'completed' });
  expect(store.active('future-agent')).toHaveLength(1); expect(materializePluginServers(store.get(plugin.id)!, store)).toEqual({});
  expect(agentPluginInventoryRow(store.get(plugin.id)!, store)).toMatchObject({ installationState: 'installed', authorizationStatus: 'required' });
  await expect(act({ action: 'configure', authorization: 'account', method: 'manual', values: { clientId: 'id', clientSecret: '' } })).rejects.toThrow('required');
  await act({ action: 'configure', authorization: 'account', method: 'manual', values: { clientId: 'id', clientSecret: 'secret-only-in-vault' } });
  job = await act({ action: 'prepare' }); expect(job.authorizations[0].state).toBe('connected');
  await act({ action: 'complete' });
  expect(service.get(plugin.id, 'owner')).toMatchObject({ installed: true, deferred: false, partial: false });
  expect(agentPluginInventoryRow(store.get(plugin.id)!, store).authorizationStatus).toBe('connected');
  expect(Object.keys(materializePluginServers(store.get(plugin.id)!, store))).toHaveLength(1);
  expect(readFileSync(join(store.stateDir, 'plugin-config', `${plugin.id}-${plugin.receipt.revision}.json`), 'utf8')).not.toContain('secret-only-in-vault');
});
it('runs reviewed CLI login, validates QR challenges, verifies identity and isolates host secrets', async () => {
  vi.stubEnv('XOPC_TEST_HOST_SECRET', 'must-not-be-inherited');
  const { store, plugin, service, act } = fixture(); await act({ action: 'prepare' }); await act({ action: 'defer' });
  const job = await act({ action: 'authorize', server: 'account', method: 'cli' }); const id = job.authorizations[0].attemptId!;
  await vi.waitFor(() => expect(getPluginCliAuthorization(id, 'owner', plugin.receipt.revision)).toMatchObject({ state: 'awaiting_user', challenge: { type: 'qr', url: 'https://example.com/authorize', message: 'Step 2: authorize user' } }));
  expect(() => getPluginCliAuthorization(id, 'intruder', plugin.receipt.revision)).toThrow('match');
  const home = join(store.dataDir(plugin.id), 'accounts', plugin.receipt.revision, 'account'); writeFileSync(join(home, 'approved'), 'yes');
  await vi.waitFor(() => expect(getPluginCliAuthorization(id, 'owner', plugin.receipt.revision)?.state).toBe('connected'));
  expect(readFileSync(join(home, 'env-check'), 'utf8')).toBe('undefined');
  await act({ action: 'prepare' }); await act({ action: 'complete' }); expect(service.get(plugin.id, 'owner')?.authorizations[0].state).toBe('connected');
});
it('authorizes and materializes Node plugins without Node on PATH', async () => {
  const { root, store, plugin, act } = fixture();
  vi.stubEnv('PATH', root);
  await act({ action: 'prepare' });
  const job = await act({ action: 'authorize', server: 'account', method: 'cli' });
  const id = job.authorizations[0].attemptId!;
  await vi.waitFor(() => expect(getPluginCliAuthorization(id, 'owner', plugin.receipt.revision)?.state).toBe('awaiting_user'));
  writeFileSync(join(store.dataDir(plugin.id), 'accounts', plugin.receipt.revision, 'account', 'approved'), 'yes');
  await vi.waitFor(() => expect(getPluginCliAuthorization(id, 'owner', plugin.receipt.revision)?.state).toBe('connected'));
  await act({ action: 'prepare' });
  await act({ action: 'complete' });
  expect(Object.values(materializePluginServers(store.get(plugin.id)!, store))[0].command).toBe(process.execPath);
});
it('skipping an active CLI cancels it and never loads unauthenticated servers', async () => {
  const { store, plugin, act } = fixture(); await act({ action: 'prepare' });
  const job = await act({ action: 'authorize', server: 'account', method: 'cli' }); const id = job.authorizations[0].attemptId!;
  await act({ action: 'defer' });
  expect(getPluginCliAuthorization(id, 'owner', plugin.receipt.revision)?.state).toBe('cancelled');
  expect(materializePluginServers(store.get(plugin.id)!, store)).toEqual({});
});
it('stops an in-flight CLI when its installation is removed outside the authorization service', async () => {
  const { store, plugin, act } = fixture(); await act({ action: 'prepare' });
  const job = await act({ action: 'authorize', server: 'account', method: 'cli' }); const id = job.authorizations[0].attemptId!;
  await vi.waitFor(() => expect(getPluginCliAuthorization(id, 'owner', plugin.receipt.revision)?.state).toBe('awaiting_user'));
  new AgentPluginStore(store.stateDir).remove(plugin.id, true);
  await vi.waitFor(() => expect(getPluginCliAuthorization(id, 'owner', plugin.receipt.revision)?.state).toBe('cancelled'));
  expect(store.get(plugin.id)).toBeUndefined();
});
it('rejects unsafe challenge URLs', () => {
  expect(() => safeAuthorizationUrl('javascript:alert(1)')).toThrow();
  expect(() => safeAuthorizationUrl('http://remote.example/')).toThrow();
  expect(() => safeAuthorizationUrl('https://user:secret@example.com/')).toThrow();
  expect(safeAuthorizationUrl('http://127.0.0.1:3000/approve')).toContain('127.0.0.1');
});

it('saves method-scoped CLI credentials as references and completes the subsequent login', async () => {
  const { store, plugin, service, act } = fixture(true); await act({ action: 'prepare' });
  await expect(act({ action: 'configure', authorization: 'account', method: 'cli', values: { clientId: 'unexpected' } })).rejects.toThrow('Invalid credential form');
  await expect(act({ action: 'configure', authorization: 'account', method: 'cli', values: { clientSecret: '' } })).rejects.toThrow('required');
  await act({ action: 'configure', authorization: 'account', method: 'cli', values: { clientSecret: 'secret-cli-vault' } });
  const saved = readFileSync(join(store.stateDir, 'plugin-config', `${plugin.id}-${plugin.receipt.revision}.json`), 'utf8');
  expect(saved).toContain('xopcSecretRef'); expect(saved).not.toContain('secret-cli-vault');
  await act({ action: 'prepare' }); expect(probe).not.toHaveBeenCalled();
  const job = await act({ action: 'authorize', server: 'account', method: 'cli' });
  await vi.waitFor(() => expect(getPluginCliAuthorization(job.authorizations[0].attemptId!, 'owner', plugin.receipt.revision)?.state).toBe('awaiting_user'));
  writeFileSync(join(store.dataDir(plugin.id), 'accounts', plugin.receipt.revision, 'account', 'approved'), 'yes');
  await vi.waitFor(() => expect(getPluginCliAuthorization(job.authorizations[0].attemptId!, 'owner', plugin.receipt.revision)?.state).toBe('connected'));
  await act({ action: 'prepare' }); await act({ action: 'complete' });
  expect(service.get(plugin.id, 'owner')?.authorizations[0].state).toBe('connected');
});

it('gates unscoped tools until missing business permissions are recovered', async () => {
  const { store, plugin, service, act } = fixture(false, true);
  await act({ action: 'prepare' });
  await act({ action: 'configure', authorization: 'account', method: 'cli', values: {} });
  const home = join(store.dataDir(plugin.id), 'accounts', plugin.receipt.revision, 'account');
  mkdirSync(home, { recursive: true }); writeFileSync(join(home, 'approved'), 'yes');
  let job = await act({ action: 'prepare' });
  expect(job.authorizations[0]).toMatchObject({ state: 'connected', issues: [{ id: 'calendar', scopes: ['calendar:calendar.event:read'] }] });
  await act({ action: 'complete' });
  expect(agentPluginInventoryRow(store.get(plugin.id)!, store)).toMatchObject({ active: true, authorizationStatus: 'required', readiness: 'degraded' });
  expect(Object.keys(materializePluginServers(store.get(plugin.id)!, store))).toHaveLength(0);
  writeFileSync(join(home, 'calendar-granted'), 'yes');
  job = await act({ action: 'prepare' });
  expect(job.authorizations[0].issues).toEqual([]);
  await act({ action: 'complete' });
  expect(service.get(plugin.id, 'owner')?.authorizations[0].issues).toEqual([]);
  expect(agentPluginInventoryRow(store.get(plugin.id)!, store)).toMatchObject({ authorizationStatus: 'connected', readiness: 'ready' });
});

it('validates permission-check output before exposing guidance or recovery actions', () => {
  const issue = { id: 'calendar', title: 'Calendar', scopes: ['calendar:calendar.event:read'], method: 'cli', helpUrl: 'https://example.com/permissions' };
  expect(parsePluginAuthorizationCheck(JSON.stringify({ authenticated: true, issues: [issue] }), ['cli']).issues).toHaveLength(1);
  expect(() => parsePluginAuthorizationCheck(JSON.stringify({ authenticated: true, issues: [{ ...issue, helpUrl: 'javascript:alert(1)' }] }), ['cli'])).toThrow();
  expect(() => parsePluginAuthorizationCheck(JSON.stringify({ authenticated: true, issues: [issue] }), ['different'])).toThrow();
  expect(() => parsePluginAuthorizationCheck(JSON.stringify({ authenticated: true, issues: [{ ...issue, token: 'secret' }] }), ['cli'])).toThrow();
});

it('rechecks a previously connected CLI account without login and removes revoked runtime access', async () => {
  const { root, store, plugin, service, act } = fixture();
  await act({ action: 'prepare' });
  await act({ action: 'configure', authorization: 'account', method: 'cli', values: {} });
  const marker = join(store.dataDir(plugin.id), 'accounts', plugin.receipt.revision, 'account', 'approved');
  mkdirSync(join(marker, '..'), { recursive: true }); writeFileSync(marker, 'yes');
  await act({ action: 'prepare' }); await act({ action: 'complete' });
  expect(Object.keys(materializePluginServers(store.get(plugin.id)!, store))).toHaveLength(1);
  rmSync(marker);
  await service.refreshRuntime(plugin.id, config, root);
  expect(service.get(plugin.id, 'owner')?.authorizations[0].state).toBe('pending');
  expect(materializePluginServers(store.get(plugin.id)!, store)).toEqual({});
  expect(agentPluginInventoryRow(store.get(plugin.id)!, store).authorizationStatus).toBe('required');
});

it('does not reuse connected account evidence when runtime revalidation throws', async () => {
  const { root, store, plugin, service, act } = fixture();
  await act({ action: 'configure', authorization: 'account', method: 'manual', values: { clientId: 'id', clientSecret: 'secret' } });
  await act({ action: 'prepare' }); await act({ action: 'complete' });
  expect(Object.keys(materializePluginServers(store.get(plugin.id)!, store))).toHaveLength(1);
  probe.mockRejectedValueOnce(new Error('Provider unavailable'));
  await service.refreshRuntime(plugin.id, config, root);
  expect(service.get(plugin.id, 'owner')?.authorizations[0].state).toBe('pending');
  expect(materializePluginServers(store.get(plugin.id)!, store)).toEqual({});
});
