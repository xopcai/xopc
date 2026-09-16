import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { listKnowledgeItems, searchKnowledgeItems } from '../../knowledge-memory/index.js';
import { ProjectService } from '../../projects/project-service.js';
import { ProjectTrustStore } from '../../project-trust/trust-store.js';
import { createRuntimeImportService } from '../runtime.js';
import { importProduct, listImportSources } from '../productImport.js';
let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'product-import-')));
  vi.stubEnv('HOME', home); vi.stubEnv('XOPC_STATE_DIR', join(home, 'xopc'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(home, '.claude')); vi.stubEnv('CODEX_HOME', join(home, '.codex'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(home, 'test.db') });
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });
function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text);
}
function skill(path: string, body = 'Write concise reports.') {
  write(join(path, 'SKILL.md'), `---\nname: reports\ndescription: Weekly reports\n---\n${body}`);
}
const run = () => importProduct(createRuntimeImportService('gateway-owner'), 'claude-code');
it('imports reference context and known projects with scope-aware retrieval', async () => {
  const projectRoot = join(home, 'project');
  write(join(projectRoot, 'CLAUDE.md'), 'Project lunar release uses weekly milestones.');
  write(join(home, '.claude/CLAUDE.md'), 'Prefer concise summaries of lunar work.');
  write(join(home, '.claude.json'), JSON.stringify({ projects: { [projectRoot]: {} } }));
  skill(join(home, '.claude/skills/reports'));
  const result = await run();
  expect(result).toMatchObject({ projects: 1, skills: 1, context: 2, issues: [] });
  const project = new ProjectService().findByWorkspaceRoot(projectRoot)!;
  expect(new ProjectTrustStore().get(projectRoot)).not.toBe(true);
  const context = { agentId: 'main', workspaceId: '', sessionId: 'test' };
  const personal = searchKnowledgeItems({ query: 'lunar', context, sources: ['workspace'], trustedOnly: true });
  expect(personal).toHaveLength(1);
  expect(personal[0].scope.type).toBe('global');
  const scoped = searchKnowledgeItems({ query: 'lunar', context: { ...context, projectId: project.id }, sources: ['workspace'], trustedOnly: true });
  expect(scoped).toHaveLength(2);
  expect(await run()).toMatchObject({ projects: 0, skills: 0, context: 0, skipped: 4 });
  expect(listImportSources('gateway-owner').find(s => s.id === 'claude-code')?.lastImport?.skills).toBe(0);
});
it('imports Codex projects and documents through the same pipeline', async () => {
  const root = join(home, 'codex-project'); mkdirSync(root);
  write(join(home, '.codex/config.toml'), `[projects."${root}"]\ntrust_level = "trusted"`);
  write(join(home, '.codex/AGENTS.md'), 'Use short summaries.');
  write(join(root, 'AGENTS.md'), 'Run project tests.');
  expect(await importProduct(createRuntimeImportService('gateway-owner'), 'codex')).toMatchObject({ projects: 1, context: 2, issues: [] });
  expect(new ProjectTrustStore().get(root)).not.toBe(true);
});
it('automatically names a conflicting skill and deduplicates the renamed copy', async () => {
  skill(join(home, 'xopc/skills/reports'), 'Existing xopc version.');
  skill(join(home, '.claude/skills/reports'));
  expect(await run()).toMatchObject({ skills: 1, issues: [] });
  expect(readFileSync(join(home, 'xopc/skills/claude-code-reports/SKILL.md'), 'utf8')).toContain('name: claude-code-reports');
  expect(await run()).toMatchObject({ skills: 0, skipped: 1, issues: [] });
  expect(readFileSync(join(home, 'xopc/skills/reports/SKILL.md'), 'utf8')).toContain('Existing xopc version.');
});
it('does not activate project skills without project trust', async () => {
  const project = join(home, 'private-project');
  skill(join(project, '.claude/skills/reports'));
  write(join(home, '.claude.json'), JSON.stringify({ projects: { [project]: {} } }));
  const result = await run();
  expect(result.projects).toBe(1);
  expect(result.skills).toBe(0);
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('Trust this project') })]));
});
it('keeps malformed or credential-bearing content out while importing valid items', async () => {
  skill(join(home, '.claude/skills/reports'));
  write(join(home, '.claude/CLAUDE.md'), 'API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789');
  write(join(home, '.claude.json'), 'not json');
  const result = await run();
  expect(result.skills).toBe(1);
  expect(result.issues.length).toBeGreaterThan(0);
  expect(listKnowledgeItems()).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('sk-');
});
it('serializes double clicks and returns the recorded result for the same request', async () => {
  skill(join(home, '.claude/skills/reports'));
  const id = randomUUID();
  const service = createRuntimeImportService('gateway-owner');
  const results = await Promise.all([importProduct(service, 'claude-code', id), importProduct(service, 'claude-code', id)]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0].skills).toBe(1);
});
it('retrieves imported documents under local-file policy and preserves source changes', async () => {
  write(join(home, '.claude/CLAUDE.md'), 'Lunar context. '.repeat(500));
  expect(await run()).toMatchObject({ context: 1 });
  const context = { agentId: 'main', workspaceId: '', sessionId: 'test' };
  const results = searchKnowledgeItems({ query: 'lunar', context, sources: ['workspace'] });
  expect(results.length).toBeGreaterThan(1);
  expect(results.every(r => r.content.length <= 2000)).toBe(true);
  expect(searchKnowledgeItems({ query: 'lunar', context, sources: ['connector'] })).toEqual([]);
  expect(searchKnowledgeItems({ query: 'lunar', context, sources: [] })).toEqual([]);
  write(join(home, '.claude/CLAUDE.md'), 'Changed source content.');
  const changed = await run();
  expect(changed.context).toBe(0);
  expect(changed.issues[0].reason).toContain('source document has changed');
  expect(listKnowledgeItems().some(r => r.content.includes('Changed source'))).toBe(false);
});
it('does not duplicate an imported skill after the user edits it', async () => {
  skill(join(home, '.claude/skills/reports'));
  await run();
  skill(join(home, 'xopc/skills/reports'), 'User edits.');
  const result = await run();
  expect(result.skills).toBe(0);
  expect(result.issues[0].reason).toContain('Existing content was kept');
  expect(readFileSync(join(home, 'xopc/skills/reports/SKILL.md'), 'utf8')).toContain('User edits.');
});
it('does not report a successful import when the app is unavailable', async () => {
  await expect(run()).rejects.toMatchObject({ code: 'source_not_found' });
});
