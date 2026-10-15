import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import { McpConnectionDrafts } from '../connection-drafts.js';
import * as credentialStores from '../credential-store.js';
import { createNativeMcpCredentials } from '../credential-store.js';
import { prepareNativeMcpConfig } from '../native-mcp.js';

const catalog = vi.hoisted(() => ({ discoverMcpTools: vi.fn() }));
vi.mock('../tool-catalog.js', () => catalog);
const connection = vi.hoisted(() => ({ probeMcpConnection: vi.fn(), getMcpAuthorization: vi.fn(), startMcpAuthorization: vi.fn(), cancelMcpAuthorization: vi.fn(), submitMcpRedirect: vi.fn() }));
vi.mock('../../../config/workspace-path-helpers.js', () => ({ getWorkspacePath: () => '/fixture-workspace' }));
vi.mock('../connection-setup.js', () => connection);
vi.mock('../config.js', () => ({ loadMergedMcpConfig: ({ cfg }: { cfg: Config }) => ({ config: { mcpServers: cfg.mcp?.servers ?? {} }, diagnostics: [] }) }));
let root: string, live: Config, drafts: McpConnectionDrafts;
const owner = 'user-a';
let save: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'xopc-mcp-drafts-')); vi.stubEnv('PI_CODING_AGENT_DIR', root);
  live = ConfigSchema.parse({ mcp: { servers: { docs: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer existing' } }, unrelated: { command: 'node' } } } });
  save = vi.fn(async (next: Config) => { live = next; return { saved: true }; });
  drafts = new McpConnectionDrafts({ readConfig: () => live, saveConfig: save });
  connection.probeMcpConnection.mockReset().mockResolvedValue({ state: 'connected', toolCount: 2 });
  connection.getMcpAuthorization.mockReset();
});
afterEach(async () => { drafts.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
async function edit(server: Record<string, unknown> = { url: 'https://example.com/new' }) {
  return drafts.create(owner, { serverId: 'docs', sourceServerId: 'docs', expectedServer: live.mcp!.servers!.docs, server });
}

it('does not change live configuration on failed tests or allow saving an untested/failed draft', async () => {
  const before = structuredClone(live); const draft = await edit();
  await expect(drafts.commit(owner, draft.id)).rejects.toMatchObject({ status: 409 });
  connection.probeMcpConnection.mockResolvedValue({ state: 'error', error: 'Connection refused' });
  expect((await drafts.probe(owner, draft.id)).state).toBe('error');
  await expect(drafts.commit(owner, draft.id)).rejects.toMatchObject({ status: 409 });
  expect(live).toEqual(before); expect(save).not.toHaveBeenCalled();
});

it('checks source versions at creation and commit, preserves unrelated updates and prevents ID collisions', async () => {
  await expect(drafts.create(owner, { serverId: 'docs', sourceServerId: 'docs', expectedServer: { command: 'old' }, server: { command: 'node' } })).rejects.toMatchObject({ status: 409 });
  const draft = await edit(); await drafts.probe(owner, draft.id);
  live.mcp!.servers!.addedElsewhere = { command: 'another' };
  await drafts.commit(owner, draft.id);
  expect(live.mcp!.servers!.addedElsewhere).toEqual({ command: 'another' });
  const stale = await edit(); await drafts.probe(owner, stale.id); live.mcp!.servers!.docs = { command: 'changed-elsewhere' };
  await expect(drafts.commit(owner, stale.id)).rejects.toMatchObject({ status: 409 });
  expect(live.mcp!.servers!.docs).toEqual({ command: 'changed-elsewhere' });
  await expect(drafts.create(owner, { serverId: 'docs', server: { command: 'new' } })).rejects.toMatchObject({ status: 409 });
});

it('owns drafts by principal, expires them and discards late probe responses after deletion', async () => {
  const draft = await edit();
  await expect(drafts.probe('other-user', draft.id)).rejects.toMatchObject({ status: 404 });
  drafts.remove('other-user', draft.id);
  let resolve: (value: unknown) => void = () => {};
  connection.probeMcpConnection.mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = drafts.probe(owner, draft.id); drafts.remove(owner, draft.id); resolve({ state: 'connected', toolCount: 9 });
  await expect(pending).rejects.toMatchObject({ status: 404 });
  await expect(drafts.commit(owner, draft.id)).rejects.toMatchObject({ status: 404 });
  const expired = await edit(); vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
  await expect(drafts.probe(owner, expired.id)).rejects.toMatchObject({ status: 404 });
});

it('tests disabled entries without enabling the active entry, then preserves the chosen enabled state at save', async () => {
  live.mcp!.servers!.docs.enabled = false;
  const draft = await edit({ url: 'https://example.com/new', enabled: false }); await drafts.probe(owner, draft.id);
  expect(connection.probeMcpConnection.mock.calls[0][0].mcp.servers.docs.enabled).toBe(true);
  expect(live.mcp!.servers!.docs.enabled).toBe(false);
  await drafts.commit(owner, draft.id); expect(live.mcp!.servers!.docs.enabled).toBe(false);
  const enable = await edit({ url: 'https://example.com/new', enabled: false }); await drafts.probe(owner, enable.id); await drafts.commit(owner, enable.id, true);
  expect(live.mcp!.servers!.docs.enabled).toBe(true);
});

it('isolates OAuth tokens during testing, cleans failed promotions and routes successful commits without changing tool identity', async () => {
  const url = 'https://example.com/mcp';
  const originalStore = await createNativeMcpCredentials();
  await originalStore.forServer('docs', url).save({ serverUrl: url, tokens: { access_token: 'old-token', token_type: 'Bearer' } });
  const before = await readFile(join(root, 'mcp-auth.json'), 'utf8');
  connection.probeMcpConnection.mockImplementation(async (_config, _workspace, serverId, options) => {
    await options.credentials.forServer(serverId, url).save({ serverUrl: url, tokens: { access_token: 'fresh-token', token_type: 'Bearer' } });
    return { state: 'connected', toolCount: 3 };
  });
  const draft = await edit({ url }); await drafts.probe(owner, draft.id);
  expect(await readFile(join(root, 'mcp-auth.json'), 'utf8')).toBe(before);
  save.mockResolvedValueOnce({ saved: false });
  await expect(drafts.commit(owner, draft.id)).rejects.toMatchObject({ status: 500 });
  expect(JSON.parse(await readFile(join(root, 'mcp-auth.json'), 'utf8'))).toEqual(JSON.parse(before));
  expect(live.mcp!.servers!.docs.xopcOAuthCredentialId).toBeUndefined();
  await drafts.commit(owner, draft.id);
  expect(live.mcp!.servers!.docs.xopcOAuthCredentialId).toMatch(/^mcp_draft_/);
  expect(originalStore.tokens('docs', url)?.access_token).toBe('old-token');
  const native = await prepareNativeMcpConfig(live, root);
  expect(native.servers.find(server => server.name === 'docs')?.config).not.toHaveProperty('xopcOAuthCredentialId');
  expect(native.credentials?.tokens('docs', url)?.access_token).toBe('fresh-token');
});

it('does not mutate existing configuration when persistence fails, and allows retrying the tested draft', async () => {
  const before = structuredClone(live); const draft = await edit(); await drafts.probe(owner, draft.id);
  save.mockResolvedValueOnce({ saved: false });
  await expect(drafts.commit(owner, draft.id)).rejects.toMatchObject({ status: 500 });
  expect(live).toEqual(before);
  await drafts.commit(owner, draft.id); expect(live.mcp!.servers!.docs.url).toBe('https://example.com/new');
});

it('makes successful commits idempotent and never writes again on response retries', async () => {
  const draft = await edit(); await drafts.probe(owner, draft.id);
  expect(await drafts.commit(owner, draft.id)).toEqual({ serverId: 'docs' });
  expect(await drafts.commit(owner, draft.id)).toEqual({ serverId: 'docs' });
  expect(save).toHaveBeenCalledTimes(1);
  await expect(drafts.commit('other-user', draft.id)).rejects.toMatchObject({ status: 404 });
});

it('retains newly published credentials if configuration reached disk but hot reload failed', async () => {
  const url = 'https://example.com/mcp';
  connection.probeMcpConnection.mockImplementation(async (_config, _workspace, id, options) => {
    await options.credentials.forServer(id, url).save({ serverUrl: url, tokens: { access_token: 'published-token', token_type: 'Bearer' } });
    return { state: 'connected', toolCount: 1 };
  });
  const draft = await edit({ url }); await drafts.probe(owner, draft.id);
  save.mockResolvedValueOnce({ saved: false, persisted: true });
  expect(await drafts.commit(owner, draft.id)).toEqual({ serverId: 'docs', reloadRequired: true });
  expect(await drafts.commit(owner, draft.id)).toEqual({ serverId: 'docs', reloadRequired: true });
  expect(save).toHaveBeenCalledTimes(1);
  const candidate = save.mock.calls[0][0] as Config;
  const alias = candidate.mcp!.servers!.docs.xopcOAuthCredentialId!;
  expect((await createNativeMcpCredentials()).tokens(alias, url)?.access_token).toBe('published-token');
});

it('does not resurrect an old OAuth success after a newer connection test fails', async () => {
  connection.startMcpAuthorization.mockReturnValue({ id: 'auth-old', state: 'starting', serverId: 'docs' });
  connection.getMcpAuthorization.mockReturnValue({ id: 'auth-old', state: 'connected', serverId: 'docs', toolCount: 1 });
  const draft = await edit(); drafts.authorize(owner, draft.id); drafts.authorization(owner, draft.id);
  connection.probeMcpConnection.mockResolvedValueOnce({ state: 'error', error: 'Connection refused' });
  await drafts.probe(owner, draft.id);
  await expect(drafts.commit(owner, draft.id)).rejects.toMatchObject({ status: 409 });
  expect(save).not.toHaveBeenCalled();
});

it('freezes the source revision before asynchronous draft allocation', async () => {
  const pending = edit();
  live.mcp!.servers!.docs.description = 'changed during allocation';
  const draft = await pending; await drafts.probe(owner, draft.id);
  await expect(drafts.commit(owner, draft.id)).rejects.toMatchObject({ status: 409 });
  expect(live.mcp!.servers!.docs.description).toBe('changed during allocation');
});

it('does not reuse historical OAuth tokens when the tested connection had no OAuth credentials', async () => {
  const url = 'https://example.com/mcp';
  const originalStore = await createNativeMcpCredentials();
  await originalStore.forServer('docs', url).save({ serverUrl: url, tokens: { access_token: 'historical-token', token_type: 'Bearer' } });
  const draft = await edit({ url }); await drafts.probe(owner, draft.id); await drafts.commit(owner, draft.id);
  const runtime = await prepareNativeMcpConfig(live, root);
  expect(runtime.credentials).toBeDefined();
  expect(await runtime.credentials!.forServer('docs', url).load()).toEqual({ serverUrl: url });
  expect(originalStore.tokens('docs', url)?.access_token).toBe('historical-token');
});

it('rejects authorization cancellation while a configuration commit is in flight', async () => {
  const draft = await edit(); await drafts.probe(owner, draft.id);
  const committing = drafts.commit(owner, draft.id);
  expect(() => drafts.cancelAuthorization(owner, draft.id)).toThrow('being saved');
  await committing;
});

it('keeps an empty credential identity on sign-out instead of adopting a legacy URL grant later', async () => {
  const url = 'https://example.com/mcp';
  const draft = await edit({ url }); await drafts.probe(owner, draft.id); await drafts.commit(owner, draft.id);
  const path = join(root, 'mcp-auth.json');
  const states = JSON.parse(await readFile(path, 'utf8'));
  states[url] = { serverUrl: url, tokens: { access_token: 'legacy-token', token_type: 'Bearer' } };
  await writeFile(path, JSON.stringify(states));
  const runtime = await prepareNativeMcpConfig(live, root);
  runtime.credentials!.remove('docs', url);
  expect((await runtime.credentials!.forServer('docs', url).load())?.tokens).toBeUndefined();
  expect(JSON.parse(await readFile(path, 'utf8'))[url].tokens.access_token).toBe('legacy-token');
});

it('never falls back to removing a legacy grant when creation of a new credential identity fails', async () => {
  const url = 'https://example.com/mcp';
  const draft = await edit({ url }); await drafts.probe(owner, draft.id);
  const store = await createNativeMcpCredentials();
  const path = join(root, 'mcp-auth.json');
  await writeFile(path, JSON.stringify({ [url]: { serverUrl: url, tokens: { access_token: 'legacy-token', token_type: 'Bearer' } } }));
  const forServer = store.forServer.bind(store);
  vi.spyOn(store, 'forServer').mockImplementation((name, address) => ({ ...forServer(name, address), save() { throw new Error('disk full'); } }));
  const remove = vi.spyOn(store, 'remove');
  vi.spyOn(credentialStores, 'createNativeMcpCredentials').mockResolvedValue(store);
  await expect(drafts.commit(owner, draft.id)).rejects.toThrow('disk full');
  expect(remove).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(path, 'utf8'))[url].tokens.access_token).toBe('legacy-token');
});

it('does not return tool discovery results after the draft has been cancelled', async () => {
  const draft = await edit(); await drafts.probe(owner, draft.id);
  let finish: (value: unknown) => void = () => {};
  catalog.discoverMcpTools.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = drafts.tools(owner, draft.id); drafts.remove(owner, draft.id); finish([]);
  await expect(pending).rejects.toMatchObject({ status: 404 });
});
