import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskRunDispatcher } from '../task-run-dispatcher.js';
import { TaskRunRepository } from '../task-run-repository.js';

const contract = { objective: 'Do work', expectedOutputs: [], acceptanceCriteria: [], constraints: [],
  approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_auto' as const,
  outputDestinations: [] };

describe('TaskRunDispatcher', () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-dispatcher-'));
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(stateDir, 'xopc.db'));
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function queue(key: string) {
    const created = new TaskApplicationService().create({ idempotencyKey: key, title: key,
      priority: 'normal', contract, dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } });
    if (!created.ok || !created.runId) throw new Error('Expected queued TaskRun');
    return created.runId;
  }

  it('executes two independent TaskRuns concurrently within its limit', async () => {
    queue('one'); queue('two');
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let peak = 0;
    const runAgent = vi.fn(async () => { active += 1; peak = Math.max(peak, active); await barrier; active -= 1; });
    const dispatcher = new TaskRunDispatcher({ workerId: 'test', maxConcurrency: 2,
      ensureSession: async (_taskId, runId) => runId, runAgent });
    const draining = dispatcher.drain();
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));
    expect(peak).toBe(2);
    release();
    await draining;
  });

  it('finalizes an expired leased run for inspection instead of replaying it', async () => {
    const runId = queue('interrupted');
    const runs = new TaskRunRepository();
    const claimed = runs.claimNext({ owner: 'old-process', leaseMs: 60_000, executorKind: 'agent' })!;
    runs.setStatus({ runId, expectedVersion: claimed.version, from: ['queued'], to: 'running' });
    getSqliteDatabase().prepare('UPDATE task_runs SET lease_expires_at = ? WHERE run_id = ?')
      .run(Date.now() - 1, runId);
    const runAgent = vi.fn(async () => {});
    await new TaskRunDispatcher({ workerId: 'new-process', ensureSession: async () => 'unused', runAgent }).drain();
    expect(runAgent).not.toHaveBeenCalled();
    expect(runs.require(runId).status).toBe('failed');
    expect(runs.getReceipt(runId)?.failure?.code).toBe('execution_interrupted');
  });

  it('renews a lease without invalidating the version held by a running Agent', () => {
    const runId = queue('long-running');
    const runs = new TaskRunRepository();
    const claimed = runs.claimNext({ owner: 'worker', leaseMs: 60_000, executorKind: 'agent' })!;
    const running = runs.setStatus({ runId, expectedVersion: claimed.version, from: ['queued'], to: 'running' })!;
    const renewed = runs.heartbeat({ runId, owner: 'worker', leaseMs: 60_000 })!;
    expect(renewed.version).toBe(running.version);
    const completed = new TaskApplicationService().completeRun({
      runId,
      expectedRunVersion: running.version,
      receipt: { status: 'succeeded', summary: 'Done', changes: [], evidence: [],
        verification: { status: 'unverified', checks: [] }, remainingWork: [], needsUser: false,
        completionVerdict: 'partial' },
    });
    expect(completed.ok).toBe(true);
    expect(runs.require(runId).status).toBe('succeeded');
  });
});
