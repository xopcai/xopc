import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase, runSqliteWriteTransaction, SqliteCommitEffectError } from '../../storage/sqlite/transaction.js';
import { ProjectService } from '../project-service.js';
import * as workspace from '../workspace-project.js';

describe('project workspace creation recovery', () => {
  let directory: string;
  let projects: ProjectService;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-workspace-creation-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    projects = new ProjectService();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });
  function pending() { return getSqliteDatabase().prepare('SELECT * FROM project_workspace_creation').all(); }

  it('does not create directories before outer commit or after rollback', () => {
    const root = join(directory, 'rollback');
    expect(() => runSqliteWriteTransaction(() => {
      projects.create({ name: 'Rollback', workspaceRoot: root, createWorkspaceRoot: true });
      expect(existsSync(root)).toBe(false);
      expect(pending()).toHaveLength(1);
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(existsSync(root)).toBe(false);
    expect(projects.list().total).toBe(0);
    expect(pending()).toHaveLength(0);
  });

  it('creates a requested directory after commit, including direct domain callers', () => {
    const root = join(directory, 'committed');
    runSqliteWriteTransaction(() => {
      projects.create({ name: 'Committed', workspaceRoot: root, createWorkspaceRoot: true });
      expect(existsSync(root)).toBe(false);
    });
    expect(existsSync(root)).toBe(true);
    expect(pending()).toHaveLength(0);
  });

  it('recovers committed intent after reopening and preserves its project identity', () => {
    const root = join(directory, 'recover');
    const mkdir = vi.spyOn(workspace, 'ensureWorkspaceDirectory').mockImplementationOnce(() => { throw new Error('temporary failure'); });
    expect(() => projects.create({ name: 'Recover', workspaceRoot: root, createWorkspaceRoot: true })).toThrow(SqliteCommitEffectError);
    const project = projects.list().items[0];
    expect(pending()).toHaveLength(1);
    expect(existsSync(root)).toBe(false);
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    projects.flushCommittedEffects(project.id);
    projects.flushCommittedEffects(project.id);
    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(existsSync(root)).toBe(true);
    expect(projects.list().items.map(item => item.id)).toEqual([project.id]);
    expect(pending()).toHaveLength(0);
  });

  it('does not create an obsolete workspace after a project is deleted or rebound', () => {
    const deletedRoot = join(directory, 'deleted');
    runSqliteWriteTransaction(() => {
      const project = projects.create({ name: 'Deleted', workspaceRoot: deletedRoot, createWorkspaceRoot: true });
      projects.delete(project.id);
    });
    expect(existsSync(deletedRoot)).toBe(false);
    const oldRoot = join(directory, 'old');
    const newRoot = join(directory, 'new');
    mkdirSync(newRoot);
    runSqliteWriteTransaction(() => {
      const project = projects.create({ name: 'Rebound', workspaceRoot: oldRoot, createWorkspaceRoot: true });
      projects.update(project.id, { workspaceRoot: newRoot });
    });
    expect(existsSync(oldRoot)).toBe(false);
    expect(pending()).toHaveLength(0);
  });

  it('rejects a symlink redirect introduced between the request and directory creation', () => {
    const root = join(directory, 'planned', 'child');
    const elsewhere = join(directory, 'elsewhere');
    mkdirSync(elsewhere);
    expect(() => runSqliteWriteTransaction(() => {
      projects.create({ name: 'Redirect', workspaceRoot: root, createWorkspaceRoot: true });
      symlinkSync(elsewhere, join(directory, 'planned'));
    })).toThrow(SqliteCommitEffectError);
    expect(existsSync(join(elsewhere, 'child'))).toBe(false);
    expect(pending()).toHaveLength(1);
  });
});
