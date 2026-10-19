import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentPluginStore } from '../store.js';
import { pluginCredentialProviderPrefix, savePluginAuthBinding } from '../auth.js';
import { materializePluginServers } from '../mcp-adapter.js';
import { resolveConnectorSecretReferences } from '../../../connectors/secret-store.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { savePluginUserConfig } from '../user-config.js';
import { removePluginCredentials } from '../credentials.js';
import { PLUGIN_SCHEMA, MCP_SCHEMA, pluginServerId } from '../validation.js';

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
  const materialized = materializePluginServers(store.get('auth-test')!, store, [], true)[pluginServerId('auth-test', 'main')];
  expect(JSON.stringify(materialized)).not.toContain('private-token');
  expect(materialized.auth).toBeUndefined();
  expect(await resolveConnectorSecretReferences(materialized, new CredentialResolver({ stateDir: state }))).toMatchObject({ headers: { Authorization: 'Bearer private-token' } });
  const file = readdirSync(join(state, 'plugin-auth/auth-test'))[0];
  expect(readFileSync(join(state, 'plugin-auth/auth-test', file), 'utf8')).not.toContain('private-token');
  mcp('https://two.example/mcp');
  store.install(source, { replace: true, reviewHash: store.inspect(source).reviewHash });
  expect(materializePluginServers(store.get('auth-test')!, store, [], true)[pluginServerId('auth-test', 'main')].headers).toBeUndefined();
});

it('keeps staged credentials separate and carries compatible grant references through updates', async () => {
  const source = temp(), state = temp(), store = new AgentPluginStore(state);
  writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'staged-auth' }));
  writeFileSync(join(source, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { main: { type: 'streamable-http', url: 'https://same.example/mcp' } } }));
  store.install(source, { reviewHash: store.inspect(source).reviewHash });
  const id = 'staged-auth', serverId = pluginServerId(id, 'main');
  const save = (value: string) => savePluginAuthBinding(store, id, 'main', { mode: 'api-key', secrets: [{ target: 'headers', key: 'Authorization', value, prefix: 'Bearer ' }] });
  const value = async (plugin = store.get(id)!) => (await resolveConnectorSecretReferences(materializePluginServers(plugin, store, [], true)[serverId], new CredentialResolver({ stateDir: state }))).headers;
  await save('old-token');
  writeFileSync(join(source, 'change'), 'v2');
  const candidate = store.install(source, { replace: true, stage: true, reviewHash: store.inspect(source).reviewHash });
  await save('new-token');
  expect(await value()).toEqual({ Authorization: 'Bearer old-token' });
  expect(await value(candidate)).toEqual({ Authorization: 'Bearer new-token' });
  store.commitPending(id);
  expect(await value()).toEqual({ Authorization: 'Bearer new-token' });
  for (const version of ['v3', 'v4']) {
    writeFileSync(join(source, 'change'), version);
    store.install(source, { replace: true, reviewHash: store.inspect(source).reviewHash });
    expect(await value()).toEqual({ Authorization: 'Bearer new-token' });
  }
});

it('removes versioned configuration references and secrets without touching another plugin', async () => {
  const source = temp(), state = temp(), store = new AgentPluginStore(state);
  const install = (name: string) => {
    writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name }));
    return store.install(source, { reviewHash: store.inspect(source).reviewHash });
  };
  const first = install('config-owner'), second = install('config-other');
  for (const plugin of [first, second]) {
    plugin.layout!.userConfig = { key: { type: 'string', title: 'Key', required: true, sensitive: true } };
    await savePluginUserConfig(store, plugin, { key: 'fixture-secret' });
  }
  await removePluginCredentials(store, first.id);
  expect(existsSync(join(state, 'plugin-config', `${first.id}-${first.receipt.revision}.json`))).toBe(false);
  expect(existsSync(join(state, 'plugin-config', `${second.id}-${second.receipt.revision}.json`))).toBe(true);
  const profiles = await new CredentialResolver({ stateDir: state }).listProfiles();
  expect(profiles.some(p => p.provider.startsWith(pluginCredentialProviderPrefix(first.id)))).toBe(false);
  expect(profiles.some(p => p.provider.startsWith(pluginCredentialProviderPrefix(second.id)))).toBe(true);
});
