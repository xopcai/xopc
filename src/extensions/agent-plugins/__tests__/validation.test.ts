import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectAgentPlugin, PLUGIN_SCHEMA, MCP_SCHEMA, expandPluginVariables, containedPath, pluginServerId } from '../validation.js';

const roots: string[] = [];
function fixture(manifest: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'xopc-plugin-test-')); roots.push(root);
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'test', ...manifest }));
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('Agent Plugin validation', () => {
  it('ignores unknown fields and namespaces but rejects malformed metadata before loading', () => {
    const root = fixture({ extra: 1, extensions: { 'unknown.client': null } });
    expect(inspectAgentPlugin(root).diagnostics).toHaveLength(1);
    expect(() => inspectAgentPlugin(fixture({ version: 7 }))).toThrow();
    expect(() => inspectAgentPlugin(fixture({ $schema: 'https://untrusted/schema' }))).toThrow();
  });
  it('isolates malformed servers, enforces headers, paths and transport fields', () => {
    const root = fixture();
    writeFileSync(join(root, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: {
      good: { type: 'stdio', command: 'node', args: ['${PLUGIN_DATA}'] },
      remote: { type: 'streamable-http', url: 'https://example.com/mcp' },
      bad: { type: 'stdio', command: 'node -e evil' },
      escape: { type: 'stdio', command: 'node', cwd: './..' },
      headers: { type: 'streamable-http', url: 'https://example.com', headers: { Test: 'a', test: 'b' } },
      http: { type: 'streamable-http', url: 'http://example.com' },
      reserved: { type: 'stdio', command: 'node', env: { PLUGIN_DATA: 'bad' } },
      auth: { type: 'streamable-http', url: 'https://example.com', auth: {} },
    } }));
    const result = inspectAgentPlugin(root);
    expect(Object.keys(result.servers)).toEqual(['good', 'remote']);
    expect(result.diagnostics).toHaveLength(6);
  });
  it('loads only valid immediate skills and rejects escaping component paths', () => {
    const root = fixture();
    mkdirSync(join(root, 'skills/good'), { recursive: true });
    writeFileSync(join(root, 'skills/good/SKILL.md'), '---\nname: good\ndescription: A good skill\n---\nBody');
    mkdirSync(join(root, 'skills/group/nested'), { recursive: true });
    writeFileSync(join(root, 'skills/group/nested/SKILL.md'), '---\nname: nested\ndescription: Hidden\n---\n');
    symlinkSync(join(fixture(), 'plugin.json'), join(root, 'mcp.json'));
    const result = inspectAgentPlugin(root);
    expect(result.skills.map(s => s.name)).toEqual(['good']);
    expect(result.diagnostics[0].component).toBe('mcp');
    expect(() => containedPath(root, join(root, '../outside'))).toThrow();
  });
  it('expands once and produces collision-free server identities', () => {
    expect(expandPluginVariables('${PLUGIN_ROOT}/${PLUGIN_DATA}/${OTHER}', '/a/${PLUGIN_DATA}', '/b')).toBe('/a/${PLUGIN_DATA}//b/${OTHER}');
    expect(pluginServerId('one', 'a/b')).not.toBe(pluginServerId('one/a', 'b'));
  });
});
