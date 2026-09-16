import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { ImportSelectionRepository } from '../../storage/sqlite/import-selection-repository.js';
import { listKnowledgeItems, searchKnowledgeItems } from '../../knowledge-memory/index.js';
import { ProjectService } from '../../projects/project-service.js';
import { createRuntimeImportService } from '../runtime.js';
import { importSelection, recoverSelectionRuns } from '../productImport.js';
import { scanProduct } from '../inventory.js';
import type { ImportInventory } from '../types.js';
let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'product-import-')));
  vi.stubEnv('HOME', home); vi.stubEnv('XOPC_STATE_DIR', join(home, 'xopc'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(home, '.claude')); vi.stubEnv('CODEX_HOME', join(home, '.codex'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(home, 'test.db') });
  mkdirSync(join(home, '.claude'));
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });
function write(path: string, text: string) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); }
function skill(path: string, body = 'Write concise reports.') { write(join(path, 'SKILL.md'), `---\nname: reports\ndescription: Weekly reports\n---\n${body}`); }
const service = () => createRuntimeImportService('gateway-owner');
const scan = () => scanProduct(service(), 'claude-code');
const run = (inventory: ImportInventory, candidateIds: string[]) => importSelection(service(), { inventoryId: inventory.id, candidateIds, requestId: randomUUID() });
it('imports only 2 explicitly selected projects out of 100, and no unselected documents', async () => {
  const paths = Array.from({ length: 100 }, (_, i) => join(home, `project-${i}`));
  paths.forEach(p => write(join(p, 'CLAUDE.md'), 'Lunar project context'));
  write(join(home, '.claude.json'), JSON.stringify({ projects: Object.fromEntries(paths.map(p => [p, {}])) }));
  const inventory = await scan();
  const selected = inventory.candidates.filter(c => c.kind === 'project').slice(0, 2);
  const document = inventory.candidates.find(c => c.parentId === selected[0].id)!;
  const result = await run(inventory, [...selected.map(i => i.id), document.id]);
  expect(result).toMatchObject({ projects: 2, context: 1, skills: 0, status: 'completed' });
  expect(new ProjectService().list().items).toHaveLength(2);
  expect(listKnowledgeItems()).toHaveLength(1);
  const context = { agentId: 'main', workspaceId: '', sessionId: 'test' };
  expect(searchKnowledgeItems({ query: 'lunar', context, sources: ['workspace'] })).toEqual([]);
  const projectId = result.items.find(i => i.candidateId === selected[0].id)!.targetId;
  expect(searchKnowledgeItems({ query: 'lunar', context: { ...context, projectId }, sources: ['workspace'] })).toHaveLength(1);
});
it('rejects empty, unknown, duplicate, cross-owner and missing-parent selections', async () => {
  const path = join(home, 'project'); write(join(path, 'CLAUDE.md'), 'Context');
  write(join(home, '.claude.json'), JSON.stringify({ projects: { [path]: {} } }));
  const inventory = await scan(); const project = inventory.candidates.find(i => i.kind === 'project')!;
  for (const ids of [[], [randomUUID()], [project.id, project.id], [inventory.candidates.find(i => i.kind === 'context')!.id]]) await expect(run(inventory, ids)).rejects.toBeDefined();
  await expect(importSelection(createRuntimeImportService('other'), { inventoryId: inventory.id, candidateIds: [project.id], requestId: randomUUID() }, 'other')).rejects.toMatchObject({ code: 'not_found' });
  expect(new ProjectService().list().items).toEqual([]);
});
it('preflights all selected content before any project is created', async () => {
  const path = join(home, 'project'); write(join(path, 'CLAUDE.md'), 'Original');
  write(join(home, '.claude.json'), JSON.stringify({ projects: { [path]: {} } }));
  const inventory = await scan();
  write(join(path, 'CLAUDE.md'), 'Changed');
  await expect(run(inventory, inventory.candidates.map(i => i.id))).rejects.toMatchObject({ code: 'inventory_stale' });
  expect(new ProjectService().list().items).toEqual([]);
  expect(listKnowledgeItems()).toEqual([]);
});
it('ignores changes to unselected files and imports only the chosen skill', async () => {
  skill(join(home, '.claude/skills/reports'));
  write(join(home, '.claude/CLAUDE.md'), 'Original');
  const inventory = await scan(); write(join(home, '.claude/CLAUDE.md'), 'Changed');
  const result = await run(inventory, [inventory.candidates.find(i => i.kind === 'skill')!.id]);
  expect(result).toMatchObject({ skills: 1, context: 0, status: 'completed' });
  expect(existsSync(join(home, 'xopc/skills/reports/SKILL.md'))).toBe(true);
});
it('shows conflict names before confirmation and never renames again during execution', async () => {
  skill(join(home, 'xopc/skills/reports'), 'Existing'); skill(join(home, '.claude/skills/reports'));
  const inventory = await scan(); const item = inventory.candidates[0];
  expect(item).toMatchObject({ status: 'conflict', targetName: 'claude-code-reports', suggested: false });
  expect(await run(inventory, [item.id])).toMatchObject({ skills: 1 });
  expect(readFileSync(join(home, 'xopc/skills/claude-code-reports/SKILL.md'), 'utf8')).toContain('name: claude-code-reports');
  expect((await scan()).candidates[0].status).toBe('existing');
});
it('rejects new target conflicts instead of silently choosing another name', async () => {
  skill(join(home, '.claude/skills/reports')); const inventory = await scan();
  skill(join(home, 'xopc/skills/reports'), 'Created while selecting');
  await expect(run(inventory, [inventory.candidates[0].id])).rejects.toMatchObject({ code: 'inventory_stale' });
  expect(existsSync(join(home, 'xopc/skills/claude-code-reports'))).toBe(false);
});
it('blocks untrusted project skills but allows an explicitly selected project entry', async () => {
  const path = join(home, 'project'); skill(join(path, '.claude/skills/reports'));
  write(join(home, '.claude.json'), JSON.stringify({ projects: { [path]: {} } }));
  const inventory = await scan(); expect(inventory.candidates.find(i => i.kind === 'skill')!.status).toBe('blocked');
  const result = await run(inventory, [inventory.candidates.find(i => i.kind === 'project')!.id]);
  expect(result).toMatchObject({ projects: 1, skills: 0 });
});
it('deduplicates simultaneous requests and rejects a request ID used with another selection', async () => {
  skill(join(home, '.claude/skills/reports')); write(join(home, '.claude/CLAUDE.md'), 'Rules');
  const inventory = await scan();
  const selection = { inventoryId: inventory.id, candidateIds: [inventory.candidates.find(i => i.kind === 'skill')!.id], requestId: randomUUID() };
  const results = await Promise.all([importSelection(service(), selection), importSelection(service(), selection)]);
  expect(results[0]).toEqual(results[1]);
  await expect(importSelection(service(), { ...selection, candidateIds: [inventory.candidates.find(i => i.kind === 'context')!.id] })).rejects.toMatchObject({ code: 'conflict' });
});
it('rejects expired inventories without business writes', async () => {
  skill(join(home, '.claude/skills/reports')); const inventory = await scan();
  const repo = new ImportSelectionRepository('gateway-owner');
  repo.save('inventory', { ...repo.get('inventory', inventory.id), expiresAt: 0 });
  await expect(run(inventory, [inventory.candidates[0].id])).rejects.toMatchObject({ code: 'inventory_stale' });
  expect(existsSync(join(home, 'xopc/skills/reports'))).toBe(false);
});
it('recovers a durable running record without creating duplicate projects', async () => {
  const path = join(home, 'project'); write(join(path, 'CLAUDE.md'), 'Context');
  write(join(home, '.claude.json'), JSON.stringify({ projects: { [path]: {} } }));
  const inventory = await scan(); const result = await run(inventory, inventory.candidates.map(i => i.id));
  const repo = new ImportSelectionRepository('gateway-owner');
  repo.save('run', { ...result, status: 'running' });
  await recoverSelectionRuns(service(), 'gateway-owner');
  expect(repo.get('run', result.id).status).toBe('completed');
  expect(new ProjectService().list().items).toHaveLength(1);
  expect(listKnowledgeItems()).toHaveLength(1);
});
it('retries only failed items without repeating successful context writes', async () => {
  skill(join(home, '.claude/skills/reports')); write(join(home, '.claude/CLAUDE.md'), 'Useful context');
  const inventory = await scan(); const importer = service();
  vi.spyOn(importer, 'activate').mockRejectedValueOnce(new Error('Temporary failure'));
  const first = await importSelection(importer, { inventoryId: inventory.id, candidateIds: inventory.candidates.map(i => i.id), requestId: randomUUID() });
  expect(first).toMatchObject({ status: 'partial', skills: 0, context: 1 });
  const failed = first.items.filter(i => i.status === 'failed').map(i => i.candidateId);
  await expect(importSelection(service(), { inventoryId: inventory.id, candidateIds: inventory.candidates.map(i => i.id), requestId: randomUUID(), retryOf: first.id })).rejects.toMatchObject({ code: 'invalid_selection' });
  const retry = await importSelection(service(), { inventoryId: inventory.id, candidateIds: failed, requestId: randomUUID(), retryOf: first.id });
  expect(retry).toMatchObject({ status: 'completed', skills: 1, context: 0 });
  expect(listKnowledgeItems()).toHaveLength(1);
});
it('resumes a pending skill using its durable staged job', async () => {
  skill(join(home, '.claude/skills/reports')); const inventory = await scan(); const importer = service();
  vi.spyOn(importer, 'activate').mockRejectedValueOnce(new Error('Interrupted'));
  const result = await importSelection(importer, { inventoryId: inventory.id, candidateIds: [inventory.candidates[0].id], requestId: randomUUID() });
  const repo = new ImportSelectionRepository('gateway-owner'); const jobId = result.items[0].jobId;
  repo.save('run', { ...result, status: 'running', items: result.items.map(i => ({ ...i, status: 'pending', error: undefined })) });
  await recoverSelectionRuns(service(), 'gateway-owner');
  expect(repo.get('run', result.id)).toMatchObject({ status: 'completed', skills: 1, items: [{ jobId }] });
});
it('cleans expired unconfirmed inventories and snapshots without installing content', async () => {
  skill(join(home, '.claude/skills/reports')); const inventory = await scan();
  const repo = new ImportSelectionRepository('gateway-owner'); const stored = repo.get('inventory', inventory.id);
  repo.save('inventory', { ...stored, expiresAt: 0 });
  await recoverSelectionRuns(service(), 'gateway-owner');
  expect(() => repo.get('inventory', inventory.id)).toThrow();
  expect(stored.scanIds.every(id => !existsSync(join(home, 'xopc/imports', id)))).toBe(true);
  expect(existsSync(join(home, 'xopc/skills/reports'))).toBe(false);
});
