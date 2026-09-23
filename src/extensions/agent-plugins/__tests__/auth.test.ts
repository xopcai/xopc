import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentPluginStore } from '../store.js';
import { savePluginAuthBinding, pluginOAuthScope, removePluginCredentials } from '../auth.js';
import { materializePluginServers } from '../mcp-adapter.js';
import { resolveConnectorSecretReferences } from '../../../connectors/secret-store.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { McpOAuthStore } from '../../../agent/mcp/oauth/mcp-oauth-store.js';
import { PLUGIN_SCHEMA, MCP_SCHEMA } from '../validation.js';

const roots: string[] = [];
const temp = () => { const p = mkdtempSync(join(tmpdir(), 'xopc-plugin-auth-')); roots.push(p); return p; };
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
it('stores references, resolves only in transport, and detaches credentials when endpoints change', async () => {
  const source = temp(); const state = temp(); const store = new AgentPluginStore(state);
  writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'auth-test' }));
  const mcp = (url: string) => writeFileSync(join(source, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { main: { type: 'streamable-http', url } } }));
  mcp('https://one.example/mcp');
  store.install(source, { reviewHash: store.inspect(source).reviewHash });
  await savePluginAuthBinding(store, 'auth-test', 'main', { mode: 'api-key', secrets: [{ target: 'headers', key: 'Authorization', value: 'private-token', prefix: 'Bearer ' }] });
  const materialized = materializePluginServers(store.get('auth-test')!, store)['plugin/auth-test/main'];
  expect(JSON.stringify(materialized)).not.toContain('private-token');
  expect(materialized.auth).toBeUndefined();
  expect(await resolveConnectorSecretReferences(materialized, new CredentialResolver({ stateDir: state }))).toMatchObject({ headers: { Authorization: 'Bearer private-token' } });
  const file = readdirSync(join(state, 'plugin-auth/auth-test'))[0];
  expect(readFileSync(join(state, 'plugin-auth/auth-test', file), 'utf8')).not.toContain('private-token');
  mcp('https://two.example/mcp');
  store.install(source, { replace: true, reviewHash: store.inspect(source).reviewHash });
  expect(materializePluginServers(store.get('auth-test')!, store)['plugin/auth-test/main'].headers).toBeUndefined();
});
it('isolates OAuth credentials from native endpoints and other plugin instances', () => {
  const url = 'https://example.com/mcp';
  const scope = pluginOAuthScope({ xopcPlugin: { id: 'one', serverName: 'main' } });
  expect(new McpOAuthStore(scope).pathFor(url)).not.toBe(new McpOAuthStore().pathFor(url));
  expect(new McpOAuthStore(scope).pathFor(url)).not.toBe(new McpOAuthStore('owner:plugin/two/main').pathFor(url));
});
it('isolates a corrupt binding to its server and removes only this plugin credentials', async () => {
  const source = temp(); const state = temp(); vi.stubEnv('XOPC_STATE_DIR', state);
  const store = new AgentPluginStore(state);
  writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'cleanup' }));
  writeFileSync(join(source, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: {
    main: { type: 'streamable-http', url: 'https://example.com/mcp' },
    other: { type: 'stdio', command: 'node' },
  } }));
  store.install(source, { reviewHash: store.inspect(source).reviewHash });
  const resolver = new CredentialResolver({ stateDir: state });
  await resolver.saveApiKey('unrelated', 'keep-me');
  await savePluginAuthBinding(store, 'cleanup', 'main', { mode: 'api-key', secrets: [{ target: 'headers', key: 'Authorization', value: 'remove-me' }] });
  const dir = join(state, 'plugin-auth/cleanup'); const path = join(dir, readdirSync(dir)[0]);
  const content = readFileSync(path, 'utf8'); writeFileSync(path, '{');
  const diagnostics: Array<{ component: string; message: string }> = [];
  expect(Object.keys(materializePluginServers(store.get('cleanup')!, store, diagnostics))).toEqual(['plugin/cleanup/other']);
  expect(diagnostics[0].component).toBe('mcp:main');
  writeFileSync(path, content);
  const own = new McpOAuthStore('owner:plugin/cleanup/main'); const native = new McpOAuthStore();
  const url = 'https://example.com/mcp';
  const record = { version: 1 as const, serverUrl: url, updatedAt: '', tokens: { access_token: 'fixture', token_type: 'Bearer' } };
  await own.update(url, () => record); await native.update(url, () => record);
  await removePluginCredentials(store, 'cleanup');
  expect(await own.load(url)).toBeUndefined(); expect(await native.load(url)).toBeDefined();
  expect((await resolver.listProfiles()).map(profile => profile.provider)).toEqual(['unrelated']);
});
