import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { scanLocal } from '../scanner.js';
import { readTree } from '../files.js';
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'xopc-import-')); });
afterEach(() => rmSync(home, { force: true, recursive: true }));
function skill(root: string, header = '') {
  mkdirSync(join(root, 'references'), { recursive: true });
  writeFileSync(join(root, 'SKILL.md'), `---\nname: report\ndescription: Make reports\n${header}---\nRead references/example.md`);
  writeFileSync(join(root, 'references/example.md'), 'example');
}
it('finds both current formats, retaining complete skill trees and scope', () => {
  skill(join(home, '.agents/skills/report'));
  skill(join(home, '.claude/skills/report'));
  const codex = scanLocal({ source: 'codex', home });
  expect(codex.candidates[0]).toMatchObject({ name: 'report', shared: true, compatibility: 'compatible' });
  const claude = scanLocal({ source: 'claude-code', home });
  expect(claude.candidates[0].files.map(f => f.path)).toEqual(['references/example.md', 'SKILL.md']);
});
it('blocks executable extensions and rejects malformed YAML without a fallback parser', () => {
  skill(join(home, '.claude/skills/report'), 'context: fork\n');
  expect(scanLocal({ source: 'claude-code', home }).candidates[0].compatibility).toBe('blocked');
  skill(join(home, '.claude/skills/report'), 'hooks: [\n');
  expect(scanLocal({ source: 'claude-code', home }).candidates[0].compatibility).toBe('blocked');
});
it('redacts MCP secrets and preserves unsupported permission constraints as blockers', () => {
  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex/config.toml'), '[mcp_servers.docs]\ncommand="node"\nargs=["server.js"]\nenv={ API_KEY="a-secret-value" }\nenabled_tools=["read"]');
  const scan = scanLocal({ source: 'codex', home });
  expect(JSON.stringify(scan)).not.toContain('a-secret-value');
  expect(scan.candidates[0]).toMatchObject({ compatibility: 'blocked', requiredEnv: ['API_KEY'], mcp: { command: 'node' } });
});
it('rejects links inside skill trees', () => {
  skill(join(home, 'report'));
  symlinkSync('/etc/passwd', join(home, 'report/leak'));
  expect(() => readTree(join(home, 'report'))).toThrow('Symbolic links');
});
it('does not persist skill trees containing probable credentials', () => {
  skill(join(home, '.claude/skills/report'));
  writeFileSync(join(home, '.claude/skills/report/.env'), 'PASSWORD=example');
  const item = scanLocal({ source: 'claude-code', home }).candidates[0];
  expect(item.compatibility).toBe('blocked');
  expect(item.files).toEqual([]);
});
it('blocks missing referenced resources and project-specific MCP scope', () => {
  skill(join(home, '.claude/skills/report'));
  writeFileSync(join(home, '.claude/skills/report/SKILL.md'), '---\nname: report\ndescription: Reports\n---\nRead [instructions](../missing.md)');
  expect(scanLocal({ source: 'claude-code', home }).candidates[0].compatibility).toBe('blocked');
  const projectRoot = join(home, 'project'); mkdirSync(projectRoot);
  writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://example.com/mcp' } } }));
  expect(scanLocal({ source: 'claude-code', home, projectRoot }).candidates.find(c => c.kind === 'mcp')).toMatchObject({ scope: 'project', compatibility: 'blocked' });
});
it('preserves passive Codex metadata without treating it as execution policy', () => {
  skill(join(home, '.agents/skills/report'), 'metadata:\n  short-description: Weekly reporting\ndisable-model-invocation: true\n');
  const candidate = scanLocal({ source: 'codex', home }).candidates[0];
  expect(candidate.compatibility).toBe('compatible');
  expect(Buffer.from(candidate.files.find(f => f.path === 'SKILL.md')!.data, 'base64').toString()).toContain('disable-model-invocation: true');
});
it('retains both Claude project instruction locations and Codex override precedence', () => {
  const projectRoot = join(home, 'project');
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, 'CLAUDE.md'), 'Project conventions');
  writeFileSync(join(projectRoot, '.claude/CLAUDE.md'), 'More project context');
  const rules = scanLocal({ source: 'claude-code', home, projectRoot, projectOnly: true }).candidates;
  expect(rules.filter(c => c.kind === 'rule')).toHaveLength(2);
  writeFileSync(join(projectRoot, 'AGENTS.md'), 'Base rules');
  writeFileSync(join(projectRoot, 'AGENTS.override.md'), 'Preferred rules');
  const codex = scanLocal({ source: 'codex', home, projectRoot, projectOnly: true });
  expect(codex.candidates.filter(c => c.kind === 'rule').map(c => c.content)).toEqual(['Preferred rules']);
});
