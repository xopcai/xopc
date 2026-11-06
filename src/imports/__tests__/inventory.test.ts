import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { listKnowledgeItems } from '../../knowledge-memory/index.js';
import { ProjectService } from '../../projects/project-service.js';
import { createRuntimeImportService } from '../runtime.js';
import { scanProduct, previewInventoryItem } from '../inventory.js';
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'import-inventory-'));
  vi.stubEnv('HOME', home); vi.stubEnv('XOPC_STATE_DIR', join(home, 'xopc'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(home, '.claude')); vi.stubEnv('CODEX_HOME', join(home, '.codex'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(home, 'test.db') });
  mkdirSync(join(home, '.claude/skills/reports'), { recursive: true });
  writeFileSync(join(home, '.claude/skills/reports/SKILL.md'), '---\nname: reports\ndescription: Reporting\n---\nMake reports');
  writeFileSync(join(home, '.claude/CLAUDE.md'), 'Prefer concise answers');
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });
it.each([
  { source: 'codex', rule: 'AGENTS.md', mcpConfig: '.codex/config.toml', mcp: '[mcp_servers.docs]\ncommand = "node"' },
  { source: 'claude-code', rule: 'CLAUDE.md', mcpConfig: '.mcp.json', mcp: '{"mcpServers":{"docs":{"command":"node"}}}' },
] as const)('lists only $source projects with importable content', async ({ source, rule, mcpConfig, mcp }) => {
  const project = join(home, 'ba');
  const connectionProject = join(home, 'connection-only');
  const paths = [...Array.from({ length: 101 }, (_, i) => join(home, `temporary-${i}`)), project, connectionProject];
  paths.forEach(path => mkdirSync(path));
  writeFileSync(join(project, rule), 'Project working rules');
  if (source === 'codex') {
    mkdirSync(join(home, '.codex'));
    mkdirSync(join(connectionProject, '.codex'));
    writeFileSync(join(home, '.codex/config.toml'), paths.map(path => `[projects.${JSON.stringify(path)}]\ntrust_level = "trusted"`).join('\n'));
  } else {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: Object.fromEntries(paths.map(path => [path, {}])) }));
  }
  writeFileSync(join(connectionProject, mcpConfig), mcp);
  const service = createRuntimeImportService('owner');
  const inventory = await scanProduct(service, source, 'owner');
  const projects = inventory.candidates.filter(c => c.kind === 'project');
  expect(projects.map(c => c.displayPath)).toEqual([project]);
  expect(inventory.candidates.find(c => c.parentId === projects[0].id)).toMatchObject({ kind: 'context', name: rule, status: 'ready' });
  expect(inventory.candidates.find(c => c.kind === 'connection')).toMatchObject({ name: 'docs', parentId: undefined, scope: 'project' });
  expect(new ProjectService().list().items).toEqual([]);
  expect(listKnowledgeItems()).toEqual([]);
  expect(JSON.stringify(inventory)).not.toContain('Project working rules');
  const context = inventory.candidates.find(c => c.parentId === projects[0].id)!;
  expect(previewInventoryItem(service, 'owner', inventory.id, context.id).text).toBe('Project working rules');
  expect(() => previewInventoryItem(service, 'other', inventory.id, context.id)).toThrow('not found');
}, 30_000); // Scans more than 100 real directories on shared CI disks.

it('returns sanitized MCP connections as setup-only inventory items', async () => {
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'node', args: ['server.js'], env: { API_KEY: 'secret' } } } }));
  const service = createRuntimeImportService('owner');
  const inventory = await scanProduct(service, 'claude-code', 'owner');
  const connection = inventory.candidates.find(item => item.kind === 'connection')!;
  expect(connection).toMatchObject({ name: 'docs', status: 'requires_setup', suggested: false });
  const preview = previewInventoryItem(service, 'owner', inventory.id, connection.id).text;
  expect(preview).toContain('server.js');
  expect(preview).not.toContain('secret');
});
