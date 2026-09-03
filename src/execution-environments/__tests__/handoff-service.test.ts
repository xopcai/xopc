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

import { ExecutionHostRegistry } from '../../execution-hosts/registry.js';
import { createExecutionHost } from '../../execution-hosts/repository.js';
import { ExecutionHostWorkspaceRuntime } from '../../execution-hosts/workspace-runtime.js';
import { runExec } from '../../infra/exec.js';
import { ProjectStore } from '../../projects/project-store.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { ExecutionEnvironmentHandoffService } from '../handoff-service.js';
import { ExecutionEnvironmentHandoffStore } from '../handoff-store.js';
import { LocalWorktreeManager } from '../local-worktree-manager.js';
import { RemoteWorktreeManager } from '../remote-worktree-manager.js';
import {
  RemoteWorkspaceExecutionBackend,
  SessionWorkspaceExecutionBackend,
} from '../remote-workspace-execution-backend.js';
import { SnapshotTransferService } from '../snapshot-transfer-service.js';
import { ExecutionEnvironmentStore } from '../store.js';

function connectHost(registry: ExecutionHostRegistry, hostId: string, stateDir: string): void {
  const registration: ExecutionHostRegistration = {
    hostId,
    displayName: 'Handoff host',
    platform: process.platform,
    arch: process.arch,
    appVersion: '1',
    publicKey: 'x'.repeat(64),
    capabilities: { git: true, shell: true, search: true, patch: true, snapshots: true },
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
  const runtime = new ExecutionHostWorkspaceRuntime(stateDir);
  const controllers = new Map<string, AbortController>();
  registry.connect(hello, 'connection-handoff', {
    close: () => undefined,
    send: (message: ServerExecutionHostMessage) => {
      if (message.type === 'execution.cancel') {
        controllers.get(message.operationId)?.abort(message.reason);
        return;
      }
      const controller = new AbortController();
      controllers.set(message.command.operationId, controller);
      queueMicrotask(() => {
        registry.handleMessage(hostId, 'connection-handoff', {
          type: 'execution.accepted',
          operationId: message.command.operationId,
        });
        void runtime.execute(message.command, controller.signal, () => undefined).then((result) => {
          registry.handleMessage(hostId, 'connection-handoff', {
            type: 'execution.result',
            operationId: message.command.operationId,
            result,
          });
        }).catch((error) => {
          registry.handleMessage(hostId, 'connection-handoff', {
            type: 'execution.error',
            operationId: message.command.operationId,
            code: (error as { code?: string }).code ?? 'EXECUTION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            retryable: (error as { retryable?: boolean }).retryable === true,
          });
        }).finally(() => controllers.delete(message.command.operationId));
      });
    },
  });
}

describe('ExecutionEnvironmentHandoffService', () => {
  let root: string;
  let source: string;
  let origin: string;
  let project: ReturnType<ProjectStore['create']>;
  let store: ExecutionEnvironmentStore;
  let local: LocalWorktreeManager;
  let remote: RemoteWorktreeManager;
  let handoffStore: ExecutionEnvironmentHandoffStore;
  let service: ExecutionEnvironmentHandoffService;
  let evict: ReturnType<typeof vi.fn>;
  let registry: ExecutionHostRegistry;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'xopc-handoff-'));
    source = join(root, 'source');
    origin = join(root, 'origin.git');
    await mkdir(source, { recursive: true });
    await runExec('git', ['init', '--bare', origin]);
    await runExec('git', ['init', '-b', 'main'], { cwd: source });
    writeFileSync(join(source, 'README.md'), 'baseline\n');
    await runExec('git', ['add', 'README.md'], { cwd: source });
    await runExec('git', ['-c', 'user.name=xopc test', '-c', 'user.email=xopc@example.test', 'commit', '-m', 'baseline'], { cwd: source });
    await runExec('git', ['remote', 'add', 'origin', pathToFileURL(origin).toString()], { cwd: source });
    await runExec('git', ['push', 'origin', 'main'], { cwd: source });

    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(root, 'xopc.db') });
    const hostId = 'handoff-host';
    registry = new ExecutionHostRegistry();
    connectHost(registry, hostId, join(root, 'host-state'));
    project = new ProjectStore().create({ name: 'Handoff project', workspaceRoot: source });
    store = new ExecutionEnvironmentStore();
    local = new LocalWorktreeManager({ store, stateDir: join(root, 'gateway-state') });
    remote = new RemoteWorktreeManager({ store, getRegistry: () => registry });
    handoffStore = new ExecutionEnvironmentHandoffStore();
    evict = vi.fn();
    service = new ExecutionEnvironmentHandoffService({
      store,
      handoffs: handoffStore,
      localWorktrees: local,
      remoteWorktrees: remote,
      snapshots: new SnapshotTransferService({ getRegistry: () => registry, stateDir: join(root, 'gateway-state') }),
      onEnvironmentFrozen: evict,
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(root, { recursive: true, force: true });
  });

  async function boundLocalSource(sessionKey: string) {
    const environment = await local.provisionManagedWorktree({
      projectId: project.id,
      repositoryPath: source,
    });
    const binding = store.bind({ subjectKind: 'session', subjectId: sessionKey, environmentId: environment.id });
    return { environment, binding };
  }

  it('atomically hands a clean managed worktree from local to remote', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:handoff-clean';
    const { environment: sourceEnvironment, binding: sourceBinding } = await boundLocalSource(sessionKey);

    const result = await service.start({ sessionKey, project, targetHostId: 'handoff-host' });

    expect(result).toMatchObject({ cleanupPending: false, handoff: { status: 'completed' } });
    expect(result.environment).toMatchObject({ hostId: 'handoff-host', status: 'ready' });
    expect(store.resolveBinding('session', sessionKey)).toMatchObject({
      environmentId: result.environment.id,
      epoch: sourceBinding.epoch + 1,
    });
    expect(store.get(sourceEnvironment.id)?.status).toBe('deleted');
    expect(existsSync(sourceEnvironment.rootPath)).toBe(false);
    expect(handoffStore.listEvents(result.handoff.id).map((event) => event.toStatus)).toEqual([
      'preparing',
      'preparing',
      'switching',
      'cleanup_pending',
      'completed',
    ]);
    expect(evict).toHaveBeenCalledTimes(2);
  });

  it('transfers tracked and untracked dirty state without changing the source commit', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:handoff-dirty';
    const { environment } = await boundLocalSource(sessionKey);
    writeFileSync(join(environment.rootPath, 'README.md'), 'modified but not committed\n');
    writeFileSync(join(environment.rootPath, 'dirty.bin'), Buffer.from([0, 1, 2, 255]));

    const result = await service.start({ sessionKey, project, targetHostId: 'handoff-host' });

    expect(readFileSync(join(result.environment.rootPath, 'README.md'), 'utf8')).toBe('modified but not committed\n');
    expect(readFileSync(join(result.environment.rootPath, 'dirty.bin'))).toEqual(Buffer.from([0, 1, 2, 255]));
    expect((await runExec('git', ['rev-parse', 'HEAD'], { cwd: result.environment.rootPath })).stdout.trim())
      .toBe(result.handoff.baseSha);
    expect(result.handoff.artifact).toMatchObject({ artifactId: result.handoff.id });
    expect(handoffStore.getActiveForSession(sessionKey)).toBeUndefined();
    expect(evict).toHaveBeenCalledTimes(2);
  });

  it('fences local workspace calls as soon as the source starts handing off', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:handoff-fence';
    const { environment } = await boundLocalSource(sessionKey);
    store.transition({
      environmentId: environment.id,
      expectedVersion: environment.version,
      toStatus: 'handing_off',
      reason: 'test fence',
    });
    const execute = vi.fn();
    const backend = new SessionWorkspaceExecutionBackend({
      sessionKey,
      registry: new ExecutionHostRegistry(),
      store,
      localBackend: { placement: 'local', execute },
    });

    await expect(backend.execute({ toolCallId: 'call', toolName: 'read_file', params: { path: 'README.md' } }))
      .rejects.toThrow(/handing_off/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('downloads a dirty remote snapshot before handing the session back to local', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:handoff-remote-local';
    const sourceEnvironment = await remote.provisionManagedWorktree({
      projectId: project.id,
      hostId: 'handoff-host',
      repositoryPath: source,
    });
    store.bind({ subjectKind: 'session', subjectId: sessionKey, environmentId: sourceEnvironment.id });
    const backend = new RemoteWorkspaceExecutionBackend({ sessionKey, registry, store });
    await backend.execute({
      toolCallId: 'remote-write-modified',
      toolName: 'write_file',
      params: { path: 'README.md', content: 'changed remotely\n' },
    });
    await backend.execute({
      toolCallId: 'remote-write-untracked',
      toolName: 'write_file',
      params: { path: 'remote-only.txt', content: 'remote untracked\n' },
    });

    const result = await service.start({ sessionKey, project, targetHostId: 'local' });

    expect(result.environment.hostId).toBe('local');
    expect(readFileSync(join(result.environment.rootPath, 'README.md'), 'utf8')).toBe('changed remotely\n');
    expect(readFileSync(join(result.environment.rootPath, 'remote-only.txt'), 'utf8')).toBe('remote untracked\n');
    expect(store.get(sourceEnvironment.id)?.status).toBe('deleted');
  });

  it('finishes source cleanup after a crash following the atomic binding switch', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:handoff-recover';
    const { environment: sourceEnvironment, binding } = await boundLocalSource(sessionKey);
    const baseSha = (await local.inspect(sourceEnvironment.id)).headSha!;
    const target = await remote.provisionManagedWorktree({
      projectId: project.id,
      hostId: 'handoff-host',
      repositoryPath: source,
      baseRef: baseSha,
    });
    let handoff = handoffStore.create({
      sessionKey,
      sourceEnvironmentId: sourceEnvironment.id,
      targetEnvironmentId: target.id,
      targetHostId: target.hostId,
      sourceBindingId: binding.id,
      sourceBindingEpoch: binding.epoch,
    });
    store.transition({
      environmentId: sourceEnvironment.id,
      expectedVersion: sourceEnvironment.version,
      toStatus: 'handing_off',
      reason: 'test crash recovery',
    });
    handoff = handoffStore.update({
      id: handoff.id,
      expectedVersion: handoff.version,
      toStatus: 'switching',
      message: 'test target ready',
      baseSha,
    });
    store.replaceBinding({
      subjectKind: 'session',
      subjectId: sessionKey,
      sourceBindingId: binding.id,
      sourceEnvironmentId: sourceEnvironment.id,
      sourceEpoch: binding.epoch,
      targetEnvironmentId: target.id,
    });

    const recovered = await service.reconcile({ handoffId: handoff.id, project });

    expect(recovered.handoff.status).toBe('completed');
    expect(store.resolveBinding('session', sessionKey)?.environmentId).toBe(target.id);
    expect(store.get(sourceEnvironment.id)?.status).toBe('deleted');
  });
});
