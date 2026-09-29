import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentPluginStore } from '../store.js';
import { PLUGIN_SCHEMA, MCP_SCHEMA } from '../validation.js';
import { isAgentPluginArchive, withAgentPluginSource } from '../sources.js';
import { SkillManager } from '../../../agent/skills/skill-manager.js';

const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'xopc-plugin-store-')); roots.push(root); return root; };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
it('requires review, installs disabled, blocks tampering, and preserves data on update/removal', () => {
  const root = temp(); const store = new AgentPluginStore(temp());
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'sample' }));
  expect(() => store.install(root)).toThrow('review');
  const installed = store.install(root, { reviewHash: store.inspect(root).reviewHash });
  expect(installed.receipt.enabled).toBe(false);
  expect(store.setEnabled('sample', true).receipt.enabled).toBe(true);
  mkdirSync(store.dataDir('sample'), { recursive: true });
  writeFileSync(join(store.dataDir('sample'), 'state'), 'persistent');
  writeFileSync(join(root, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { main: { type: 'stdio', command: 'node' } } }));
  expect(() => store.install(root, { replace: true })).toThrow('review');
  const updated = store.install(root, { replace: true, reviewHash: store.inspect(root).reviewHash });
  expect(updated.receipt.enabled).toBe(true);
  expect(store.rollback('sample').rootDir).toBe(installed.rootDir);
  expect(store.rollback('sample').rootDir).toBe(updated.rootDir);
  writeFileSync(join(updated.rootDir, 'tampered'), 'bad');
  expect(store.get('sample')?.readiness).toBe('blocked');
  expect(store.active()).toHaveLength(0);
  store.remove('sample');
  expect(readFileSync(join(store.dataDir('sample'), 'state'), 'utf8')).toBe('persistent');
});
it('installs an archive with one wrapper directory and rejects stale reviews', () => {
  const source = join(temp(), 'plugin.zip'); const store = new AgentPluginStore(temp());
  const zip = new AdmZip();
  zip.addFile('wrapper/plugin.json', Buffer.from(JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'archive' })));
  zip.writeZip(source);
  const plan = store.inspect(source);
  zip.addFile('wrapper/extra.txt', Buffer.from('changed')); zip.writeZip(source);
  expect(() => store.install(source, { reviewHash: plan.reviewHash })).toThrow();
  expect(store.install(source, { reviewHash: store.inspect(source).reviewHash }).id).toBe('archive');
});
it('prioritizes native metadata over the portable manifest', () => {
  const zip = new AdmZip();
  zip.addFile('wrapper/plugin.json', Buffer.from(JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'mixed' })));
  expect(isAgentPluginArchive(zip.toBuffer())).toBe(true);
  zip.addFile('wrapper/package.json', Buffer.from(JSON.stringify({ xopc: { extension: './index.js' } })));
  expect(isAgentPluginArchive(zip.toBuffer())).toBe(false);
});
it('persists validated Store provenance in the install receipt', () => {
  const root = temp(); const store = new AgentPluginStore(temp());
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'provenance' }));
  const provenance = {
    kind: 'store' as const,
    packageName: 'provenance',
    packageType: 'plugin' as const,
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    publisherVerification: 'verified' as const,
    sourceRepository: 'https://github.com/xopcai/xopc-plugins',
    sourceCommit: 'abcdef1234567',
    artifactFormat: 'agent-plugins@1.0.0',
    riskTier: 'content' as const,
  };
  const installed = store.install(root, { reviewHash: store.inspect(root).reviewHash, provenance });
  expect(installed.receipt.provenance).toEqual(provenance);
  expect(JSON.parse(readFileSync(join(store.stateDir, 'plugin-receipts/provenance.json'), 'utf8'))).toMatchObject({ provenance });
});
it('resolves Store source provenance alongside a verified plugin archive', async () => {
  vi.stubEnv('XOPC_EXTENSIONS_STORE_URL', 'https://store.example.com');
  const zip = new AdmZip();
  zip.addFile('plugin.json', Buffer.from(JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'store-plugin' })));
  const archive = zip.toBuffer();
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(archive).digest('hex');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/v1/packages/store-plugin')) return new Response(JSON.stringify({
      id: 'store-plugin', name: 'store-plugin', type: 'plugin', description: 'Store plugin', readme: null, downloads: 0,
      author: { username: 'xopcai', avatarUrl: null },
      publisher: { verification: 'verified', sourceRepository: 'https://github.com/xopcai/xopc-plugins' },
      latestVersion: { version: '1.0.0', changelog: null, publishedAt: new Date().toISOString(), downloadUrl: 'https://store.example.com/files/store-plugin.zip', sha256, sourceCommit: 'abcdef1234567', artifactFormat: 'agent-plugins@1.0.0', riskTier: 'content' },
    }), { status: 200 });
    if (url.endsWith('/files/store-plugin.zip')) return new Response(new Uint8Array(archive), { status: 200 });
    return new Response('not found', { status: 404 });
  }));

  const resolved = await withAgentPluginSource('store:store-plugin', undefined, (local, provenance) => ({
    plugin: new AgentPluginStore(temp()).inspect(local).manifest.name,
    provenance,
  }));
  expect(resolved).toMatchObject({
    plugin: 'store-plugin',
    provenance: { kind: 'store', packageName: 'store-plugin', version: '1.0.0', sha256, publisherVerification: 'verified', riskTier: 'content' },
  });
});
it('refreshes validated plugin Skills on activation without recursive discovery or symlink installation', () => {
  const source = temp(); const state = temp(); vi.stubEnv('XOPC_STATE_DIR', state);
  writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'skills-fixture' }));
  mkdirSync(join(source, 'skills/plugin-fixture-skill'), { recursive: true });
  mkdirSync(join(source, 'skills/nested/hidden-fixture-skill'), { recursive: true });
  writeFileSync(join(source, 'skills/plugin-fixture-skill/SKILL.md'), '---\nname: plugin-fixture-skill\ndescription: Visible skill\n---\nUseful instructions');
  writeFileSync(join(source, 'skills/nested/hidden-fixture-skill/SKILL.md'), '---\nname: hidden-fixture-skill\ndescription: Hidden skill\n---\nNot discovered');
  const store = new AgentPluginStore(state);
  store.install(source, { reviewHash: store.inspect(source).reviewHash });
  const manager = new SkillManager(temp(), temp());
  expect(manager.getSkills().some(skill => skill.name === 'plugin-fixture-skill')).toBe(false);
  store.setEnabled('skills-fixture', true);
  expect(manager.getSkills().some(skill => skill.name === 'plugin-fixture-skill')).toBe(true);
  expect(manager.getSkills().some(skill => skill.name === 'hidden-fixture-skill')).toBe(false);
  store.setEnabled('skills-fixture', false);
  expect(manager.getSkills().some(skill => skill.name === 'plugin-fixture-skill')).toBe(false);
});
