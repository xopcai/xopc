import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionEnvironmentStore } from '../../../../execution-environments/store.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { requiredGatewayScope } from '../../../security/gateway-scopes.js';
import type { GatewayService } from '../../../service.js';
import { registerExecutionEnvironmentRoutes } from '../execution-environments.js';

describe('project environment options', () => {
  let directory: string;
  let repo: string;
  let app: Hono;
  let project: { workspaceRoot?: string } | null;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
  const request = () => app.request('/api/projects/project-a/environment-options');
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-environment-options-'));
    repo = join(directory, 'repo');
    mkdirSync(repo);
    project = { workspaceRoot: repo };
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    app = new Hono();
    registerExecutionEnvironmentRoutes(app, { service: { projects: { get: vi.fn(() => project) } } as unknown as GatewayService });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });
  it('requires workspace-read scope', () => {
    expect(requiredGatewayScope('GET', '/api/projects/project-a/environment-options')).toBe('workspace.read');
  });
  it('returns 404 for a missing project', async () => {
    project = null;
    expect((await request()).status).toBe(404);
  });
  it.each([undefined, '/not/an/xopc/workspace'])('disables both modes for unavailable workspace %s', async (workspaceRoot) => {
    project = { workspaceRoot };
    expect(await (await request()).json()).toMatchObject({ options: { localAvailable: false, worktreeUnavailableReason: 'workspace_unavailable' } });
  });
  it('allows Local for a non-Git directory and for an unborn repository', async () => {
    expect(await (await request()).json()).toMatchObject({ options: { localAvailable: true, worktreeUnavailableReason: 'git_commit_required' } });
    git('init');
    expect(await (await request()).json()).toMatchObject({ options: { localAvailable: true, worktreeUnavailableReason: 'git_commit_required' } });
  });
  it('checks actual Git state without allocating an environment or changing files', async () => {
    git('init');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial');
    const head = git('rev-parse', 'HEAD');
    expect(await (await request()).json()).toEqual({ ok: true, options: { localAvailable: true } });
    writeFileSync(join(repo, 'untracked.txt'), 'draft');
    expect(await (await request()).json()).toMatchObject({ options: { localAvailable: true, worktreeUnavailableReason: 'uncommitted_changes' } });
    expect(new ExecutionEnvironmentStore().list()).toEqual([]);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('status', '--porcelain')).toContain('untracked.txt');
  });
});
