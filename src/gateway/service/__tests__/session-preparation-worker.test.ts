import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ProjectService } from '../../../projects/index.js';
import { ExecutionEnvironmentStore } from '../../../execution-environments/store.js';
import { acceptSessionCommand, getSessionPreparation, retrySessionPreparation } from '../../../storage/sqlite/session-creation-repository.js';
import { SessionPreparationWorker } from '../session-preparation-worker.js';
import type { GatewayService } from '../../service.js';

let directory: string;
let previousState: string | undefined;
beforeEach(() => {
  previousState = process.env.XOPC_STATE_DIR;
  directory = mkdtempSync(join(tmpdir(), 'xopc-preparation-worker-'));
  process.env.XOPC_STATE_DIR = directory;
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });
  seedTestAgentCatalog();
});
afterEach(() => {
  closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  if (previousState === undefined) delete process.env.XOPC_STATE_DIR;
  else process.env.XOPC_STATE_DIR = previousState;
  rmSync(directory, { recursive: true, force: true });
});

it.each(['local_checkout', 'managed_worktree'] as const)('prepares %s asynchronously and drains only after binding is ready', async mode => {
  const repository = join(directory, 'repository'); mkdirSync(repository);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
  git('init'); writeFileSync(join(repository, 'file.txt'), 'initial'); git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Initial');
  const projects = new ProjectService();
  const project = projects.create({ name: 'Preparation', workspaceRoot: repository });
  const id = randomUUID();
  acceptSessionCommand({ conversationId: id, principalId: 'owner', command: {
    kind: 'start', clientMessageId: 'first', creation: { agentId: 'main', projectId: project.id,
      execution: { mode }, temporary: false, model: 'test/model', thinkingLevel: 'off' },
    input: { content: 'hello' }, origin: { type: 'system', source: 'cli' },
  }, preparedInput: { status: 'queued', content: 'hello', requestedDelivery: 'next', effectiveDelivery: 'next', origin: { type: 'system', source: 'cli' } },
  attachProject: (conversationId, projectId) => projects.attachSession(conversationId, projectId) });
  const environments = new ExecutionEnvironmentStore();
  const drain = vi.fn(async () => {
    expect(getSessionPreparation(id)?.state).toBe('ready');
    const binding = environments.resolveBinding(id)!;
    expect(environments.get(binding.environmentId)?.status).toBe('ready');
  });
  const service = { projects, drainSessionInputs: drain, getSessionInputState: () => ({}), emit: vi.fn() } as unknown as GatewayService;
  const worker = new SessionPreparationWorker(service);
  if (mode === 'managed_worktree') {
    writeFileSync(join(repository, 'file.txt'), 'dirty');
    worker.wake(id); await worker.stop();
    expect(drain).not.toHaveBeenCalled();
    const failed = getSessionPreparation(id)!;
    expect(failed.state).toBe('preparation_failed');
    writeFileSync(join(repository, 'file.txt'), 'initial');
    retrySessionPreparation(id, 'owner', { operationId: failed.operationId, expectedRevision: failed.revision, idempotencyKey: 'retry' });
  }
  worker.wake(id); worker.wake(id); await worker.stop();
  expect(drain).toHaveBeenCalledOnce();
  worker.wake(id); await worker.stop();
  expect(drain).toHaveBeenCalledOnce();
}, 30_000);
