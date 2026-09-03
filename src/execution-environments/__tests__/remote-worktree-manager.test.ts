import crypto from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  EXECUTION_HOST_PROTOCOL_VERSION,
  type ExecutionHostHelloPayload,
  type ExecutionHostRegistration,
  type ServerExecutionHostMessage,
} from '@xopcai/realtime-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionHostWorkspaceRuntime } from '../../execution-hosts/workspace-runtime.js';
import { ExecutionHostRegistry } from '../../execution-hosts/registry.js';
import { createExecutionHost } from '../../execution-hosts/repository.js';
import { runExec } from '../../infra/exec.js';
import { ProjectStore } from '../../projects/project-store.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { RemoteWorkspaceExecutionBackend } from '../remote-workspace-execution-backend.js';
import { RemoteWorktreeManager } from '../remote-worktree-manager.js';
import { ExecutionEnvironmentStore } from '../store.js';

describe('remote worktree execution', () => {
  let root: string;
  let source: string;
  let remote: string;
  let hostState: string;
  let baseSha: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'xopc-remote-worktree-'));
    source = join(root, 'source');
    remote = join(root, 'origin.git');
    hostState = join(root, 'host-state');
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(root, 'xopc.db') });
    await mkdir(source, { recursive: true });
    await runExec('git', ['init', '--bare', remote]);
    await runExec('git', ['init'], { cwd: source });
    writeFileSync(join(source, 'README.md'), 'baseline\n');
    await runExec('git', ['add', 'README.md'], { cwd: source });
    await runExec('git', ['-c', 'user.name=xopc test', '-c', 'user.email=xopc@example.test', 'commit', '-m', 'baseline'], { cwd: source });
    await runExec('git', ['remote', 'add', 'origin', pathToFileURL(remote).toString()], { cwd: source });
    await runExec('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: source });
    baseSha = (await runExec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(root, { recursive: true, force: true });
  });

  it('provisions, routes a workspace tool, and removes the remote environment', async () => {
    const hostId = 'host-remote-1';
    const registration: ExecutionHostRegistration = {
      hostId,
      displayName: 'Remote host',
      platform: process.platform,
      arch: process.arch,
      appVersion: '1',
      publicKey: 'x'.repeat(64),
      capabilities: { git: true, shell: true, search: true, patch: true, snapshots: false },
      maxConcurrency: 2,
    };
    createExecutionHost(registration);
    const hello: ExecutionHostHelloPayload = {
      protocolVersion: EXECUTION_HOST_PROTOCOL_VERSION,
      hostId,
      platform: registration.platform,
      arch: registration.arch,
      appVersion: registration.appVersion,
      capabilities: registration.capabilities,
      maxConcurrency: registration.maxConcurrency,
      nonce: 'nonce-that-is-long-enough',
      signedAt: Date.now(),
      signature: 'signature-that-is-long-enough'.repeat(2),
    };
    const registry = new ExecutionHostRegistry();
    const hostRuntime = new ExecutionHostWorkspaceRuntime(hostState);
    const controllers = new Map<string, AbortController>();
    registry.connect(hello, 'connection-1', {
      close: () => undefined,
      send: (message: ServerExecutionHostMessage) => {
        if (message.type === 'execution.cancel') {
          controllers.get(message.operationId)?.abort(message.reason);
          return;
        }
        const controller = new AbortController();
        controllers.set(message.command.operationId, controller);
        queueMicrotask(() => {
          registry.handleMessage(hostId, 'connection-1', {
            type: 'execution.accepted',
            operationId: message.command.operationId,
          });
          void hostRuntime.execute(message.command, controller.signal, (payload) => {
            registry.handleMessage(hostId, 'connection-1', {
              type: 'execution.progress',
              operationId: message.command.operationId,
              sequence: 1,
              payload,
            });
          }).then((result) => {
            registry.handleMessage(hostId, 'connection-1', {
              type: 'execution.result',
              operationId: message.command.operationId,
              result,
            });
          }).catch((error) => {
            registry.handleMessage(hostId, 'connection-1', {
              type: 'execution.error',
              operationId: message.command.operationId,
              code: (error as { code?: string }).code ?? 'EXECUTION_FAILED',
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
            });
          }).finally(() => controllers.delete(message.command.operationId));
        });
      },
    });

    const project = new ProjectStore().create({
      name: 'Remote project',
      slug: 'remote-project',
      workspaceRoot: source,
      executionMode: 'managed_worktree',
      executionHostId: hostId,
    });
    const store = new ExecutionEnvironmentStore();
    const manager = new RemoteWorktreeManager({ getRegistry: () => registry, store });
    const environment = await manager.provisionManagedWorktree({
      projectId: project.id,
      hostId,
      repositoryPath: source,
    });
    expect(environment).toMatchObject({ hostId, status: 'ready', baseRef: 'HEAD' });
    expect(existsSync(environment.rootPath)).toBe(true);

    const sessionKey = 'agent:main:webchat:default:direct:remote-test';
    store.bind({ subjectKind: 'session', subjectId: sessionKey, environmentId: environment.id });
    const backend = new RemoteWorkspaceExecutionBackend({ sessionKey, registry, store });
    await backend.execute({
      toolCallId: crypto.randomUUID(),
      toolName: 'write_file',
      params: { path: 'remote.txt', content: 'executed remotely\n' },
    });
    expect(readFileSync(join(environment.rootPath, 'remote.txt'), 'utf8')).toBe('executed remotely\n');

    store.releaseBinding('session', sessionKey, environment.id);
    const deleted = await manager.remove(environment.id);
    expect(deleted.status).toBe('deleted');
    expect(existsSync(environment.rootPath)).toBe(false);
  });

  it('recovers a provisioned location after the original gateway response was lost', async () => {
    const project = new ProjectStore().create({
      name: 'Recovery project',
      slug: 'recovery-project',
      workspaceRoot: source,
      executionMode: 'managed_worktree',
    });
    const store = new ExecutionEnvironmentStore();
    const requested = store.create({
      id: 'recover-env',
      projectId: project.id,
      hostId: 'host-recovery',
      kind: 'managed_worktree',
      rootPath: 'remote-pending:recover-env',
      baseRef: 'HEAD',
      baseSha,
    });
    const provisioning = store.transition({
      environmentId: requested.id,
      expectedVersion: requested.version,
      toStatus: 'provisioning',
      reason: 'test provisioning',
    });
    const failed = store.transition({
      environmentId: requested.id,
      expectedVersion: provisioning.version,
      toStatus: 'error',
      reason: 'gateway response lost',
      error: 'host disconnected',
    });
    const registry = {
      execute: vi.fn(async () => ({
        healthy: true,
        rootExists: true,
        dirty: false,
        headSha: baseSha,
        rootPath: '/remote/worktrees/recover-env',
        repositoryRoot: '/remote/repositories/repo.git',
        gitCommonDir: '/remote/repositories/repo.git',
        baseSha,
        problems: [],
      })),
    } as unknown as ExecutionHostRegistry;

    const recovered = await new RemoteWorktreeManager({ getRegistry: () => registry, store }).reconcile(failed.id);
    expect(recovered).toMatchObject({
      status: 'ready',
      rootPath: '/remote/worktrees/recover-env',
      repositoryRoot: '/remote/repositories/repo.git',
      baseSha,
    });
  });
});
