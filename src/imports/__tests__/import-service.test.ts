import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { ImportRepository } from '../../storage/sqlite/import-repository.js';
import { loadSkills } from '../../agent/skills/index.js';
import { ImportService } from '../importService.js';
let home: string;
let service: ImportService;
let target: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'import-service-'));
  target = join(home, 'skills');
  vi.stubEnv('XOPC_STATE_DIR', home);
  vi.stubEnv('HOME', home);
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(home, 'test.db') });
  service = new ImportService({ owner: 'test', stateDir: home });
  mkdirSync(join(home, '.claude/skills/report'), { recursive: true });
  writeFileSync(join(home, '.claude/skills/report/SKILL.md'), '---\nname: report\ndescription: Reports\n---\nCreate a report');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(home, { recursive: true, force: true }); });
async function stage(operation: 'create' | 'replace' | 'rename' = 'create', name = 'report') {
  const scan = await service.scan({ source: 'claude-code', home });
  const plan = service.plan(scan.id, { root: target }, [{ candidateId: scan.candidates[0].id, operation, name }]);
  return service.apply(plan.id, plan.id);
}
it('stages without activating, survives restart, and applies idempotently', async () => {
  const job = await stage();
  expect(existsSync(join(target, 'report'))).toBe(false);
  expect(loadSkills({}).skills.some(s => s.name === 'report')).toBe(false);
  expect(service.apply(job.plan.id, job.plan.id).id).toBe(job.id);
  service = new ImportService({ owner: 'test', stateDir: home });
  const result = await service.activate(job.id, [job.items[0].action.candidateId]);
  expect(result.items[0].status).toBe('active');
  expect(loadSkills({}).skills.some(s => s.name === 'report')).toBe(true);
  expect(readFileSync(join(target, 'report/SKILL.md'), 'utf8')).toContain('Create a report');
  expect((await service.rollback(job.id, [job.items[0].action.candidateId])).items[0].status).toBe('rolled_back');
  expect(existsSync(join(target, 'report'))).toBe(false);
});
it('renames logical skill names and protects edits from rollback', async () => {
  const job = await stage('rename', 'new-report');
  const id = job.items[0].action.candidateId;
  await service.activate(job.id, [id]);
  const path = join(target, 'new-report/SKILL.md');
  expect(readFileSync(path, 'utf8')).toContain('name: new-report');
  writeFileSync(path, 'User edited');
  const result = await service.rollback(job.id, [id]);
  expect(result.items[0]).toMatchObject({ status: 'active', error: expect.stringContaining('edits') });
  expect(readFileSync(path, 'utf8')).toBe('User edited');
});
it('restores a replaced skill and rejects stale plans', async () => {
  mkdirSync(join(target, 'report'), { recursive: true });
  const old = '---\nname: report\ndescription: Old report\n---\nOld';
  writeFileSync(join(target, 'report/SKILL.md'), old);
  const job = await stage('replace');
  const id = job.items[0].action.candidateId;
  await service.activate(job.id, [id]);
  await service.rollback(job.id, [id]);
  expect(readFileSync(join(target, 'report/SKILL.md'), 'utf8')).toBe(old);
  const scan = await service.scan({ source: 'claude-code', home });
  const plan = service.plan(scan.id, { root: target }, [{ candidateId: scan.candidates[0].id, operation: 'replace' }]);
  writeFileSync(join(target, 'report/SKILL.md'), 'changed');
  expect(() => service.apply(plan.id, 'new-key')).toThrow('Target changed');
});
it('isolates records between principals', async () => {
  const job = await stage();
  const other = new ImportService({ owner: 'other', stateDir: home });
  expect(() => other.getJob(job.id)).toThrow('not found');
  expect(other.history()).toEqual([]);
});
it('recovers a crash after publishing and a crash during rollback', async () => {
  const job = await stage();
  const id = job.items[0].action.candidateId;
  const active = await service.activate(job.id, [id]);
  const repo = new ImportRepository('test');
  active.items[0].status = 'publishing';
  repo.save('job', active);
  expect(service.getJob(job.id).items[0].status).toBe('active');
  active.items[0].status = 'rolling_back';
  repo.save('job', active);
  renameSync(join(target, 'report'), join(target, `.tmp-import-undo-${job.id}-${id}`));
  expect(service.getJob(job.id).items[0].status).toBe('rolled_back');
});
it('rejects expired activation', async () => {
  const job = await stage();
  vi.useFakeTimers(); vi.setSystemTime(job.expiresAt + 1);
  await expect(service.activate(job.id, [job.items[0].action.candidateId])).rejects.toThrow('expired');
});
it('recovers a crash between moving the old skill and publishing its replacement', async () => {
  mkdirSync(join(target, 'report'), { recursive: true });
  const original = '---\nname: report\ndescription: Original\n---\nOriginal';
  writeFileSync(join(target, 'report/SKILL.md'), original);
  const job = await stage('replace');
  const item = job.items[0];
  item.status = 'publishing';
  item.backupPath = join(job.plan.target.root, `.tmp-import-backup-${job.id}-${item.action.candidateId}`);
  renameSync(join(target, 'report'), item.backupPath);
  new ImportRepository('test').save('job', job);
  expect(service.getJob(job.id).items[0].status).toBe('staged');
  expect(readFileSync(join(target, 'report/SKILL.md'), 'utf8')).toBe(original);
});
it('cleans expired backups without deleting the published skill', async () => {
  mkdirSync(join(target, 'report'), { recursive: true });
  writeFileSync(join(target, 'report/SKILL.md'), '---\nname: report\ndescription: Original\n---\nOriginal');
  const job = await stage('replace');
  const active = await service.activate(job.id, [job.items[0].action.candidateId]);
  expect(existsSync(active.items[0].backupPath!)).toBe(true);
  vi.useFakeTimers(); vi.setSystemTime(job.expiresAt + 1);
  await service.recoverAndClean();
  expect(existsSync(active.items[0].backupPath!)).toBe(false);
  expect(existsSync(join(target, 'report/SKILL.md'))).toBe(true);
});
it('skips identical managed content and preserves the existing directory', async () => {
  const job = await stage();
  await service.activate(job.id, [job.items[0].action.candidateId]);
  const again = await stage();
  expect(again.items[0].status).toBe('skipped');
});
it('does not publish MCP drafts or execute their command', async () => {
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { test: { command: 'touch', args: [join(home, 'should-not-exist')] } } }));
  const scan = await service.scan({ source: 'claude-code', home });
  const candidate = scan.candidates.find(c => c.kind === 'mcp')!;
  const plan = service.plan(scan.id, { root: target }, [{ candidateId: candidate.id, operation: 'create' }]);
  const job = service.apply(plan.id, plan.id);
  await expect(service.activate(job.id, [candidate.id])).rejects.toThrow('MCP draft');
  expect(existsSync(join(home, 'should-not-exist'))).toBe(false);
});
