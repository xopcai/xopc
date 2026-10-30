import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectAgentPlugin, pluginServerId } from '../validation.js';
import { AgentPluginStore } from '../store.js';
import { agentPluginInventoryRow } from '../inventory.js';
import { withAgentPluginSource, isAgentPluginArchive } from '../sources.js';
import { PluginSelectionRequired, pluginSourceKey } from '../source-catalog.js';
import { resolveSkillSources } from '../../../agent/skills/skill-sources.js';
import { SkillManager } from '../../../agent/skills/skill-manager.js';
import { loadMergedMcpConfig } from '../../../agent/mcp/config.js';
import { materializePluginServers } from '../mcp-adapter.js';
import { resolveConnectorSecretReferences } from '../../../connectors/secret-store.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { savePluginUserConfig } from '../user-config.js';

const roots: string[] = [];
const temp = () => { const p = mkdtempSync(join(tmpdir(), 'xopc-compat-')); roots.push(p); return p; };
function file(root: string, path: string, value: unknown) {
  const target = join(root, path); mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
}
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });

it.each(['codex', 'claude'] as const)('imports %s skills and HTTP MCP without rewriting the artifact', dialect => {
  const root = temp(), state = temp(); vi.stubEnv('XOPC_STATE_DIR', state);
  file(root, `.${dialect}-plugin/plugin.json`, { name: 'sample', skills: './custom-skills', mcpServers: './.mcp.json', apps: './.app.json' });
  file(root, 'custom-skills/group/read/SKILL.md', '---\nname: read\ndescription: Read a note\n---\nOriginal');
  file(root, '.mcp.json', { mcpServers: { notes: { type: 'http', url: 'https://example.com/mcp', connectionAuth: { mode: 'none' } } } });
  const store = new AgentPluginStore(state), plan = store.inspect(root);
  expect(plan.layout?.dialect).toBe(dialect); expect(plan.skills.map(s => s.name)).toEqual(['read']);
  expect(plan.servers.notes.type).toBe('streamable-http');
  expect(plan.layout?.compatibility).toContainEqual(expect.objectContaining({ component: 'apps', support: 'needs_adapter' }));
  const plugin = store.install(root, { reviewHash: plan.reviewHash });
  store.setWorkspaceScope(plugin.id); store.setEnabled(plugin.id, true);
  expect(resolveSkillSources({ agentId: 'other' }, {}).sources.some(s => s.id === `plugin:${plugin.id}`)).toBe(true);
  expect(loadMergedMcpConfig({ workspaceDir: root, agentId: 'other' }).config.mcpServers).toHaveProperty(pluginServerId(plugin.id, 'notes'));
  expect(loadMergedMcpConfig({ workspaceDir: root, agentId: 'main' }).config.mcpServers).toHaveProperty(pluginServerId(plugin.id, 'notes'));
  const manager = new SkillManager(temp(), temp(), { agentId: 'main' });
  expect(manager.getSkills().find(s => s.name === `${plugin.id}.read`)?.content).toContain('Original');
  expect(readFileSync(join(plugin.rootDir, 'custom-skills/group/read/SKILL.md'), 'utf8')).toContain('name: read');
});

it('keeps same-named plugins from different sources separate and pins review to source identity', () => {
  const store = new AgentPluginStore(temp()), a = temp(), b = temp();
  for (const root of [a, b]) file(root, '.codex-plugin/plugin.json', { name: 'same' });
  const planA = store.inspect(a), planB = store.inspect(b);
  expect(planA.installId).not.toBe(planB.installId);
  expect(() => store.install(b, { reviewHash: planA.reviewHash })).toThrow('review');
  store.install(a, { reviewHash: planA.reviewHash }); store.install(b, { reviewHash: planB.reviewHash });
  expect(store.list()).toHaveLength(2);
  expect(pluginSourceKey('github:owner/repo#ref=main&path=plugins/one')).toBe(pluginSourceKey('git+https://github.com/owner/repo.git#path=plugins/one&ref=v1'));
});

it('selects local marketplace entries and rejects paths that escape the source', async () => {
  const root = temp();
  file(root, '.agents/plugins/marketplace.json', { name: 'catalog', plugins: [{ name: 'one', source: { source: 'local', path: './plugins/one' } }] });
  file(root, 'plugins/one/.codex-plugin/plugin.json', { name: 'one' });
  const error = await withAgentPluginSource(root, undefined, p => p).catch(e => e);
  expect(error).toBeInstanceOf(PluginSelectionRequired);
  const candidate = error.candidates[0];
  expect(await withAgentPluginSource(candidate.source, undefined, p => inspectAgentPlugin(p).manifest.name)).toBe('one');
  file(root, '.agents/plugins/marketplace.json', { plugins: [{ name: 'escape', source: { source: 'local', path: './../escape' } }] });
  await expect(withAgentPluginSource(`${root}#plugin=escape`, undefined, p => p)).rejects.toThrow('boundary');
});

it('accepts hidden manifests inside a single ZIP wrapper, with native extension precedence', () => {
  const zip = new AdmZip(), store = new AgentPluginStore(temp());
  zip.addFile('wrapper/.claude-plugin/plugin.json', Buffer.from('{"name":"zip-plugin"}'));
  expect(isAgentPluginArchive(zip.toBuffer())).toBe(true);
  const path = join(temp(), 'plugin.zip'); zip.writeZip(path);
  expect(store.inspect(path).manifest.name).toBe('zip-plugin');
  zip.addFile('wrapper/xopc.extension.json', Buffer.from('{}'));
  expect(isAgentPluginArchive(zip.toBuffer())).toBe(false);
});

it('does not fall back from an invalid portable manifest, or accept escaping declared paths', () => {
  const root = temp(); file(root, 'plugin.json', { name: 'bad' }); file(root, '.codex-plugin/plugin.json', { name: 'good' });
  expect(() => inspectAgentPlugin(root)).toThrow();
  rmSync(join(root, 'plugin.json')); file(root, '.codex-plugin/plugin.json', { name: 'good', skills: './../outside' });
  expect(() => inspectAgentPlugin(root)).toThrow('boundary');
});

it('supports Claude variable aliases and stores sensitive configuration as references', async () => {
  const root = temp(), store = new AgentPluginStore(temp());
  file(root, '.claude-plugin/plugin.json', { name: 'config', userConfig: { TOKEN: { type: 'string', sensitive: true, required: true } } });
  file(root, '.mcp.json', { mcpServers: { docs: { command: 'node', env: { API_KEY: '${user_config.TOKEN}', ROOT: '${CLAUDE_PLUGIN_ROOT}' } } } });
  const installed = store.install(root, { reviewHash: store.inspect(root).reviewHash });
  expect(materializePluginServers(installed, store)).toEqual({});
  await savePluginUserConfig(store, installed, { TOKEN: 'fixture-secret' });
  const result = materializePluginServers(installed, store, [], true)[pluginServerId(installed.id, 'docs')];
  expect((result.env as Record<string, unknown>).API_KEY).toHaveProperty('xopcSecretRef');
  expect((result.env as Record<string, unknown>).ROOT).toBe(installed.rootDir);
  expect(await resolveConnectorSecretReferences(result, new CredentialResolver({ stateDir: store.stateDir }))).toMatchObject({ env: { API_KEY: 'fixture-secret' } });
  expect(JSON.stringify(result)).not.toContain('fixture-secret');
});

it('imports a marketplace-only Claude manifest without altering the package snapshot', async () => {
  const root = temp(), store = new AgentPluginStore(temp());
  file(root, '.claude-plugin/marketplace.json', { name: 'market', plugins: [{ name: 'catalog-only', source: './package', version: '1.0', strict: false }] });
  file(root, 'package/skills/read/SKILL.md', '---\nname: read\ndescription: Read a note\n---\nBody');
  const source = `${root}#plugin=catalog-only`;
  const plan = await withAgentPluginSource(source, undefined, (local, _p, _commit, manifest) => store.inspect(local, source, manifest));
  const installed = await withAgentPluginSource(source, undefined, (local, _p, _commit, importManifest) => store.install(local, { sourceLabel: source, reviewHash: plan.reviewHash, importManifest }));
  expect(store.get(installed.id)?.skills).toHaveLength(1);
  expect(store.get(installed.id)?.manifest.name).toBe('catalog-only');
  expect(() => readFileSync(join(installed.rootDir, 'plugin.json'))).toThrow();
});

it('loads only the skills selected by a marketplace entry in a shared repository', async () => {
  const root = temp(), store = new AgentPluginStore(temp());
  file(root, '.claude-plugin/marketplace.json', { name: 'shared', plugins: [
    { name: 'documents', source: './', strict: false, skills: ['./skills/docx', './skills/pdf'] },
  ] });
  file(root, 'skills/docx/SKILL.md', '---\nname: docx\ndescription: Create a Word document\n---\nBody');
  file(root, 'skills/pdf/SKILL.md', '---\nname: pdf\ndescription: Read PDF documents\n---\nBody');
  file(root, 'skills/unrelated/SKILL.md', 'Not a valid skill');
  const source = `${root}#plugin=documents`;
  const plan = await withAgentPluginSource(source, undefined, (local, _p, _commit, manifest) => store.inspect(local, source, manifest));
  expect(plan.skills.map(skill => skill.name).sort()).toEqual(['docx', 'pdf']);
  expect(plan.diagnostics).toEqual([]);
  const installed = await withAgentPluginSource(source, undefined, (local, _p, _commit, importManifest) => store.install(local, { sourceLabel: source, reviewHash: plan.reviewHash, importManifest }));
  store.setEnabled(installed.id, true);
  expect(store.get(installed.id)?.skills.map(skill => skill.name).sort()).toEqual(['docx', 'pdf']);
  expect(agentPluginInventoryRow(store.get(installed.id)!, store).components.skills).toEqual([
    { name: 'docx', description: 'Create a Word document' },
    { name: 'pdf', description: 'Read PDF documents' },
  ]);
});

it('maps supported OpenAI auth hints and rejects OAuth options pi cannot preserve', () => {
  const root = temp(); file(root, 'plugin.json', { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'auth-hints' });
  file(root, 'mcp.json', { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: {
    supported: { type: 'streamable-http', url: 'https://example.com/mcp', extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'provided', clientId: 'public', tokenEndpointAuthMethod: 'none' }, defaultScopes: ['read'] } } } },
    unsupported: { type: 'streamable-http', url: 'https://example.com/mcp', extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'provided', clientId: 'private', tokenEndpointAuthMethod: 'client_secret_post' } } } } },
  } });
  const plan = inspectAgentPlugin(root);
  expect(plan.servers.supported).toHaveProperty('oauth', { clientId: 'public', scope: 'read' });
  expect(plan.servers.unsupported).toBeUndefined();
  expect(plan.diagnostics).toContainEqual(expect.objectContaining({ component: 'mcp:unsupported' }));
});

it('never activates a package whose required hook semantics are unsupported', () => {
  const root = temp(), store = new AgentPluginStore(temp());
  file(root, '.claude-plugin/plugin.json', { name: 'protected', hooks: './hooks.json' });
  file(root, 'hooks.json', {});
  const plugin = store.install(root, { reviewHash: store.inspect(root).reviewHash });
  expect(() => store.setEnabled(plugin.id, true)).toThrow('hooks');
});

it('keeps long source-scoped names valid when truncation lands on a separator', () => {
  const root = temp(), store = new AgentPluginStore(temp());
  file(root, '.codex-plugin/plugin.json', { name: `${'a'.repeat(47)}-long-name` });
  const plan = store.inspect(root);
  expect(() => store.install(root, { reviewHash: plan.reviewHash })).not.toThrow();
});

it('makes plugins global while respecting an explicit canonical workspace restriction', () => {
  const root = temp(), state = temp(), allowed = temp(), denied = temp(); vi.stubEnv('XOPC_STATE_DIR', state);
  file(root, '.codex-plugin/plugin.json', { name: 'workspace-bound' });
  file(root, 'skills/read/SKILL.md', '---\nname: read\ndescription: Read a note\n---\nBody');
  file(root, '.mcp.json', { mcpServers: { notes: { command: 'node' } } });
  const store = new AgentPluginStore(), plugin = store.install(root, { reviewHash: store.inspect(root).reviewHash });
  store.setWorkspaceScope(plugin.id, [allowed]); store.setEnabled(plugin.id, true);
  expect(store.active('main', allowed)).toHaveLength(1); expect(store.active('main', denied)).toHaveLength(0);
  expect(store.active('other', allowed)).toHaveLength(1);
  expect(resolveSkillSources({ agentId: 'main', workspaceDir: denied }, {}).sources.some(source => source.id === `plugin:${plugin.id}`)).toBe(false);
  expect(Object.keys(loadMergedMcpConfig({ agentId: 'main', workspaceDir: denied }).config.mcpServers)).toEqual([]);
  store.setWorkspaceScope(plugin.id); expect(store.active('main', denied)).toHaveLength(0);
  store.setWorkspaceScope(plugin.id, null); expect(store.active('main', denied)).toHaveLength(1);
});

it('reports known host-specific skill references without treating format import as execution compatibility', () => {
  const root = temp(); file(root, '.codex-plugin/plugin.json', { name: 'host-coupled' });
  file(root, 'skills/read/SKILL.md', '---\nname: read\ndescription: Read a note\n---\nCall mcp__platform__search and functions.exec_command.');
  const result = inspectAgentPlugin(root);
  expect(result.skills).toHaveLength(1);
  expect(result.layout?.compatibility).toContainEqual(expect.objectContaining({ component: 'skill:read', support: 'needs_adapter' }));
  expect(result.diagnostics.some(value => value.message.includes('mcp__platform__search'))).toBe(true);
});

it('requires review for changed adapter capabilities while preserving legacy portable capability encoding', () => {
  const root = temp(), state = temp(), store = new AgentPluginStore(state);
  file(root, 'plugin.json', { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'review-boundary' });
  file(root, 'mcp.json', { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { docs: { type: 'streamable-http', url: 'https://example.com/mcp' } } });
  const plugin = store.install(root, { reviewHash: store.inspect(root).reviewHash });
  const path = join(state, 'plugin-receipts/review-boundary.json');
  file(state, 'plugin-receipts/review-boundary.json', { ...plugin.receipt, capabilities: [] });
  expect(store.get(plugin.id)?.readiness).toBe('blocked');
  const legacy = { ...plugin.receipt, adapterVersion: undefined, credentialScope: undefined, capabilities: plugin.receipt.capabilities.map(value => value.replace(/:\{\}:\{\}$/, '')) };
  writeFileSync(path, JSON.stringify(legacy));
  expect(store.get(plugin.id)?.readiness).toBe('ready');
});

it('keeps Store identity across pinned version upgrades while isolating different packages', () => {
  expect(pluginSourceKey('store:lab@1.0.0')).toBe(pluginSourceKey('store:lab@2.0.0'));
  expect(pluginSourceKey('store:lab')).toBe(pluginSourceKey('store:lab@1.0.0'));
  expect(pluginSourceKey('store:other@1.0.0')).not.toBe(pluginSourceKey('store:lab@1.0.0'));
});

it('uses the Store release version for an upstream manifest without a version field', async () => {
  const root = temp(), state = temp();
  file(root, '.claude-plugin/plugin.json', { name: 'versionless', description: 'Upstream package' });
  const store = new AgentPluginStore(state), source = 'store:versionless@2.0.0';
  const plan = store.inspect(root, source);
  const plugin = store.install(root, { reviewHash: plan.reviewHash, sourceLabel: source, provenance: { kind: 'store', packageName: 'versionless', packageType: 'plugin', version: '2.0.0', sha256: 'a'.repeat(64) } });
  const { agentPluginInventoryRow } = await import('../inventory.js');
  expect(plugin.manifest.version).toBeUndefined();
  expect(agentPluginInventoryRow(plugin).version).toBe('2.0.0');
});
