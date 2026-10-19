import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { resolveSkillSources } from '../../../agent/skills/skill-sources.js';
import { loadMergedMcpConfig } from '../../../agent/mcp/config.js';
import { AgentPluginStore } from '../store.js';
import { PluginSetupService, setupActionSchema } from '../setup.js';

vi.mock('../../../agent/mcp/connection-setup.js', () => ({ probeMcpConnection: vi.fn(async () => ({ state: 'connected', toolCount: 1 })), startMcpAuthorization: vi.fn(), getMcpAuthorization: vi.fn(), cancelMcpAuthorization: vi.fn(), submitMcpRedirect: vi.fn() }));
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function fixture(explicit = true) {
  const root = mkdtempSync(join(tmpdir(), 'plugin-capability-access-')); roots.push(root);
  const source = join(root, 'source'), stateDir = join(root, 'state');
  mkdirSync(source); vi.stubEnv('XOPC_STATE_DIR', stateDir);
  const skills = ['local', 'alpha', 'beta', 'fallback'];
  for (const name of skills) { mkdirSync(join(source, 'skills', name), { recursive: true }); writeFileSync(join(source, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} capability\n---\nInstructions.`); }
  const account = (id: string) => ({ id, title: id, servers: [id], methods: [{ id: 'cli', title: 'Sign in', type: 'cli', login: { command: 'node', args: ['${PLUGIN_ROOT}/login.mjs'] }, check: { command: 'node', args: ['${PLUGIN_ROOT}/login.mjs'] } }] });
  writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'composite', extensions: { 'ai.xopc': { setup: { authorizations: ['alpha', 'beta'].map(account), ...(explicit ? { capabilityAccess: {
    skills: { local: {}, alpha: { authorizations: [{ id: 'alpha', scopes: ['read'] }] }, beta: { authorizations: ['beta'] } },
    mcp: { local: {}, alpha: { authorizations: [{ id: 'alpha', scopes: [] }] }, beta: { authorizations: ['beta'] } },
  } } : {}) } } } }));
  writeFileSync(join(source, 'mcp.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: Object.fromEntries(['local', 'alpha', 'beta'].map(name => [name, { type: 'stdio', command: 'node' }])) }));
  const store = new AgentPluginStore(stateDir), plan = store.inspect(source); expect(plan.diagnostics).toEqual([]);
  const plugin = store.install(source, { reviewHash: plan.reviewHash });
  const service = new PluginSetupService(store); service.create(plugin.id, 'owner');
  const path = join(stateDir, 'plugin-setup', `${plugin.id}.json`);
  const save = (accounts: string[], issue = false, expiresAt?: number) => {
    const job = JSON.parse(readFileSync(path, 'utf8'));
    Object.assign(job, { state: 'completed', installed: true, resources: 'ready', partial: accounts.length !== 2 });
    job.connections = ['local', 'alpha', 'beta'].map(name => ({ name, state: name === 'local' || accounts.includes(name) ? 'connected' : 'skipped' }));
    job.authorizations = ['alpha', 'beta'].map(id => ({ id, method: 'cli', state: accounts.includes(id) ? 'connected' : 'pending', ...(id === 'alpha' && expiresAt !== undefined ? { expiresAt } : {}), issues: issue && id === 'alpha' ? [{ id: 'read', title: 'Read access missing', scopes: ['read'], instructions: [] }] : [] }));
    writeFileSync(path, JSON.stringify(job)); store.setEnabled(plugin.id, true);
  };
  const visible = () => ({
    skills: resolveSkillSources({ workspaceDir: root, agentId: 'main' }, {}).sources.filter(s => s.id === `plugin:${plugin.id}`).flatMap(s => s.skillFiles ?? []).map(path => path.split('/').at(-2)).sort(),
    servers: Object.values(loadMergedMcpConfig({ workspaceDir: root }).config.mcpServers).map(s => (s.xopcPlugin as { serverName: string }).serverName).sort(),
  });
  return { root, source, path, store, plugin, save, visible, service };
}
it('gates both actual Skill sources and MCP projection through unauthenticated, partial, complete and invalidated states', () => {
  const { save, visible } = fixture();
  save([]); expect(visible()).toEqual({ skills: ['local'], servers: ['local'] });
  save(['alpha']); expect(visible()).toEqual({ skills: ['alpha', 'local'], servers: ['alpha', 'local'] });
  save(['alpha', 'beta']); expect(visible()).toEqual({ skills: ['alpha', 'beta', 'fallback', 'local'], servers: ['alpha', 'beta', 'local'] });
  save(['beta']); expect(visible()).toEqual({ skills: ['beta', 'local'], servers: ['beta', 'local'] });
});
it('hides only the affected scoped Skill while keeping an identity-only shared MCP and local capability', () => {
  const { save, visible } = fixture(); save(['alpha', 'beta'], true);
  expect(visible()).toEqual({ skills: ['beta', 'local'], servers: ['alpha', 'beta', 'local'] });
});
it('expires authorization without a file mutation and invalidates the cached skill revision key', () => {
  const { save, visible, store } = fixture(); const now = Date.now(); save(['alpha', 'beta'], false, now + 1000);
  vi.spyOn(Date, 'now').mockReturnValue(now); const before = store.revisionKey(); expect(visible().skills).toContain('alpha');
  vi.spyOn(Date, 'now').mockReturnValue(now + 1001); expect(store.revisionKey()).not.toBe(before);
  expect(visible()).toEqual({ skills: ['beta', 'local'], servers: ['beta', 'local'] }); vi.restoreAllMocks();
});
it('denies private capabilities with missing, corrupt or stale setup evidence', () => {
  const { save, visible, path } = fixture(); save(['alpha', 'beta']);
  const stale = JSON.parse(readFileSync(path, 'utf8'));
  stale.packageRevision = 'stale-revision'; writeFileSync(path, JSON.stringify(stale));
  expect(visible()).toEqual({ skills: ['local'], servers: ['local'] });
  rmSync(path); expect(visible()).toEqual({ skills: ['local'], servers: ['local'] });
  writeFileSync(path, '{broken'); expect(visible()).toEqual({ skills: [], servers: [] });
});
it('uses conservative defaults for third-party packages without capability mappings', () => {
  const { save, visible } = fixture(false); save([]); expect(visible()).toEqual({ skills: [], servers: [] });
  save(['alpha']); expect(visible()).toEqual({ skills: [], servers: ['alpha'] });
  save(['alpha', 'beta']); expect(visible().skills).toHaveLength(4);
});
it('rejects unknown dependency references instead of treating them as local', () => {
  const { source, store } = fixture(); const path = join(source, 'plugin.json'); const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.extensions['ai.xopc'].setup.capabilityAccess.skills.alpha = { authorizations: ['unknown'] };
  writeFileSync(path, JSON.stringify(manifest)); expect(store.inspect(source).diagnostics.some(d => d.component === 'capability-access')).toBe(true);
});

it('prepares and retains a local tool even when another capability lacks required credentials', async () => {
  const { root, source, store, plugin, service, visible } = fixture();
  const manifestPath = join(source, 'plugin.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.extensions['com.openai'] = { userConfig: { TOKEN: { type: 'string', title: 'Token', sensitive: true, required: true } } };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const mcpPath = join(source, 'mcp.json'), mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
  mcp.mcpServers.alpha.env = { TOKEN: '${user_config.TOKEN}' };writeFileSync(mcpPath, JSON.stringify(mcp));
  store.install(source, { replace: true, reviewHash: store.inspect(source).reviewHash });service.create(plugin.id, 'owner');
  const act = (action: string) => service.act(plugin.id, 'owner', setupActionSchema.parse({ action, expectedRevision: service.get(plugin.id, 'owner')!.revision }), {} as never, root);
  const prepared = await act('prepare');expect(prepared.missingConfig).toContain('TOKEN');
  expect(prepared.connections.find(value => value.name === 'local')?.state).toBe('connected');
  await act('defer');expect(visible()).toEqual({ skills: ['local'], servers: ['local'] });
});
