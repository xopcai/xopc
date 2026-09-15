import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { buildTaskAgentContext } from '../task-context.js';
import { isSessionSourceBinding, parseTurnContextRefs } from '../types.js';

describe('task references', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'task-reference-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });
  it('resolves the selected version and refuses missing or changed tasks', () => {
    const task = new TaskRepository().create({ title: 'Launch', objective: 'Ship', body: 'Check rollout' });
    const context = buildTaskAgentContext(task, String(task.version));
    expect(context).toMatchObject({ kind: 'task', sourceId: task.id, version: String(task.version), truncated: false });
    expect(context?.text).toContain('Check rollout');
    expect(context?.text).toContain('Ship');
    expect(buildTaskAgentContext(task, '999')).toBeNull();
    expect(buildTaskAgentContext(undefined)).toBeNull();
    expect(buildTaskAgentContext({ ...task, body: 'x'.repeat(30_000) })?.text.length).toBe(24_000);
    expect(buildTaskAgentContext({ ...task, body: 'x'.repeat(30_000) })?.truncated).toBe(true);
  });
  it('searches stored tasks before limiting and treats SQL wildcard characters literally', () => {
    const tasks = new TaskRepository();
    const match = tasks.create({ title: 'Old 100% plan', objective: 'Ship', body: '会议记录', now: 1 });
    tasks.create({ title: 'Latest', objective: 'Ship', now: 2 });
    expect(tasks.list({ search: '100%', limit: 1 }).map(task => task.id)).toEqual([match.id]);
    expect(tasks.list({ search: '会议' }).map(task => task.id)).toEqual([match.id]);
    expect(tasks.list({ search: 'OLD' }).map(task => task.id)).toEqual([match.id]);
    expect(tasks.list({ search: "' OR 1=1 --" })).toEqual([]);
  });
  it('accepts per-turn task references without creating persistent task bindings', () => {
    expect(parseTurnContextRefs([{ kind: 'task', sourceId: ' t ', expectedVersion: '2' }]))
      .toEqual([{ kind: 'task', sourceId: 't', expectedVersion: '2' }]);
    expect(parseTurnContextRefs([{ kind: 'file', sourceId: 'f' }])).toBeNull();
    expect(isSessionSourceBinding({ kind: 'task', sourceId: 't', version: '2', attachedAt: 1 })).toBe(false);
  });
});
