import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { taskCheckId } from '@xopcai/gateway-contract';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { TaskConversationRepository } from '../../../../tasks/task-conversation-repository.js';
import { TaskApplicationService } from '../../../../tasks/task-application-service.js';
import { TaskRepository } from '../../../../tasks/task-repository.js';
import { TaskRunRepository } from '../../../../tasks/task-run-repository.js';
import { TaskCollaborationRepository } from '../../../../tasks/task-collaboration-repository.js';
import { TaskCriterionReviewRepository } from '../../../../tasks/task-criterion-review-repository.js';
import { TaskContextRepository } from '../../../../tasks/task-context-repository.js';
import { registerTaskRoutes } from '../tasks.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { getSqliteDatabase } from '../../../../storage/sqlite/transaction.js';
import { authenticateDeviceAccessToken, createDevice, issueDeviceTokenPair, revokeDevice } from '../../../../storage/sqlite/device-access-repository.js';

describe('task routes', () => {
  let stateDir: string;
  let app: Hono;
  const abortAgentRun = vi.fn();

  beforeEach(() => {
    abortAgentRun.mockReset();
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    app = new Hono();
    app.use('*', async (c, next) => {
      const identity = authenticateDeviceAccessToken(c.req.header('x-test-device-token') ?? '');
      setGatewayPrincipal(c, identity ? { kind: 'device', principalId: identity.deviceId,
        deviceId: identity.deviceId, accessSessionId: identity.accessSessionId, scopes: identity.scopes }
        : { kind: c.req.header('x-test-principal-kind') === 'device' ? 'device' : 'owner', principalId: 'test-owner', scopes: ['tasks.read', 'tasks.write'] });
      await next();
    });
    registerTaskRoutes(app, {
      service: {
        currentConfig: {},
        projects: {},
        sessions: {},
        sessionIndexInstance: {},
        dispatchTaskEvents: vi.fn(),
        dispatchTaskRuns: vi.fn(),
        getActiveWebchatRunId: vi.fn(() => 'live-run'),
        abortAgentRun,
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
      chatRateLimitMiddleware: async (_c, next) => next(),
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('moves a running task freely without aborting it and exposes its durable change log', async () => {
    const tasks = new TaskRepository();
    const created = new TaskApplicationService().create({ idempotencyKey: 'manual-board-task',
      title: 'Manual board move', priority: 'normal', activation: { mode: 'capture', phase: 'backlog' },
      dependencies: [], context: [], authorityGrants: [], contract: { objective: 'Work', expectedOutputs: [],
        acceptanceCriteria: [], constraints: [], approvalRequired: [], assumptions: [], risks: [],
        acceptancePolicy: 'manual', outputDestinations: [] } });
    if (!created.ok) throw new Error('Expected task');
    const task = tasks.require(created.model.task.id);
    const run = new TaskRunRepository().create({ taskId: task.id,
      executorKind: 'agent', executorRef: { agentId: 'main' }, trigger: {},
      correlationId: 'manual-route', idempotencyKey: 'manual-route', contractVersion: 1 });
    const response = await app.request(`/api/tasks/${task.id}/commands`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        expectedVersion: task.version, idempotencyKey: 'manual-route-close', source: 'mobile',
        command: { type: 'move', phase: 'closed' },
      }) });
    expect(response.status).toBe(200);
    expect(abortAgentRun).not.toHaveBeenCalled();
    expect(new TaskRunRepository().require(run.id).status).toBe('queued');
    const detail = await app.request(`/api/tasks/${task.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ task: { phase: 'closed', resolution: 'done' },
      operationalState: 'queued', phaseChanges: [{ fromPhase: 'backlog', toPhase: 'closed',
        toResolution: 'done', source: 'mobile', actor: { kind: 'user', id: 'test-owner' }, runId: run.id }] });
    expect(new TaskRunRepository().claimNext({ owner: 'worker', leaseMs: 1000 })?.id).toBe(run.id);
  });

  it('aborts the live conversation after persisting a pause', async () => {
    const task = new TaskRepository().create({ title: 'Pause route', objective: 'Wait' });
    ensureSessionRecord('5c2dd4d5-11cb-4b7d-91c3-ceba1691edfa', stateDir, { agentId: "main" });
    new TaskRunRepository().create({ taskId: task.id, conversationId: '5c2dd4d5-11cb-4b7d-91c3-ceba1691edfa', executorKind: 'agent',
      executorRef: { agentId: 'main' }, trigger: { kind: 'manual' }, correlationId: 'pause-route',
      idempotencyKey: 'pause-route', contractVersion: task.latestContractVersion });
    const response = await app.request(`/api/tasks/${task.id}/commands`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'pause-route-command', expectedVersion: task.version,
        command: { type: 'add_wait', wait: { kind: 'paused', reason: 'Later', condition: {} } } }) });
    expect(response.status).toBe(200);
    expect(abortAgentRun).toHaveBeenCalledWith('live-run');
    expect(new TaskRunRepository().listActiveWaits(task.id)[0]?.kind).toBe('paused');
  });

  it('accepts an authenticated task instruction and reads it back by sequence', async () => {
    const task = new TaskRepository().create({ title: 'Collaborate', objective: 'Review options' });
    const response = await app.request(`/api/tasks/${task.id}/collaboration`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'route-instruction' },
      body: JSON.stringify({ kind: 'instruction', body: 'Compare option B' }) });
    expect(response.status).toBe(201);
    expect(new TaskCollaborationRepository().pendingDeliveries()).toHaveLength(1);
    const read = await app.request(`/api/tasks/${task.id}/collaboration?afterSequence=0`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ ok: true,
      items: [{ sequence: 1, body: 'Compare option B', deliveryStatus: 'pending' }] });
    const duplicate = await app.request(`/api/tasks/${task.id}/collaboration`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'route-instruction' },
      body: JSON.stringify({ kind: 'instruction', body: 'Compare option B' }) });
    expect(duplicate.status).toBe(201);
    expect(new TaskCollaborationRepository().list(task.id)).toHaveLength(1);
    const unrelatedAnswer = await app.request(`/api/tasks/${task.id}/collaboration`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'answer', body: 'Yes', causationId: 'unknown' }) });
    expect(unrelatedAnswer.status).toBe(400);
  });

  it.each(['done', 'cancelled'] as const)('handles an answer to an existing wait on a task closed as %s', async resolution => {
    const tasks = new TaskRepository(), runs = new TaskRunRepository(), board = new TaskCollaborationRepository();
    const task = tasks.create({ title: 'Worker question', objective: 'Answer a question' });
    const question = board.append({ taskId: task.id, authorKind: 'worker_agent', authorId: 'main',
      kind: 'question', body: 'Which source?', idempotencyKey: 'closed-question' });
    runs.createWait({ taskId: task.id, kind: 'external_event', reason: 'Which source?',
      condition: { collaborationEntryId: question.id } });
    new TaskApplicationService().execute({ taskId: task.id, expectedVersion: task.version,
      idempotencyKey: 'close-question', command: { type: 'close', resolution } });
    const request = (kind: string, causationId?: string) => app.request(`/api/tasks/${task.id}/collaboration`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, body: 'Use source A', causationId }),
    });
    expect((await request('answer', question.id)).status).toBe(resolution === 'done' ? 201 : 409);
    expect((await request('instruction')).status).toBe(409);
    expect((await request('answer', 'unknown')).status).toBe(400);
    expect(tasks.require(task.id)).toMatchObject({ phase: 'closed', resolution });
  });

  it('reports orchestration metrics on the authenticated task route', async () => {
    const response = await app.request('/api/tasks/orchestration-metrics');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true,
      metrics: { delegatedTasks: 0, pendingDeliveries: 0, interruptedRuns: 0 } });
  });

  it.each(['manual', 'verified_then_review', 'verified_auto'] as const)('records a human criterion review for %s and rejects stale task versions', async (acceptancePolicy) => {
    const task = new TaskRepository().create({ title: 'Review route', objective: 'Check result',
      acceptanceCriteria: ['User accepts the result', 'User accepts the evidence'], acceptancePolicy });
    const url = `/api/tasks/${task.id}/criteria/${encodeURIComponent(taskCheckId(task.id, task.latestContractVersion, 0))}/review`;
    const input = { expectedVersion: task.version, contractVersion: task.latestContractVersion, resultId: 'manual', status: 'passed' };
    const response = await app.request(url, { method: 'PUT',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true,
      review: { criterionIndex: 0, status: 'passed', reviewedBy: { kind: 'user', id: 'test-owner' } } });
    expect(new TaskCriterionReviewRepository().list(task.id, task.latestContractVersion)).toHaveLength(1);
    const stale = await app.request(url, { method: 'PUT',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(stale.status).toBe(409);
    const cleared = await app.request(url, { method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, expectedVersion: task.version + 1, status: 'unverified' }) });
    expect(cleared.status).toBe(200);
    expect(new TaskCriterionReviewRepository().list(task.id, task.latestContractVersion)).toMatchObject([{ status: 'unverified' }]);
    expect(new TaskCriterionReviewRepository().allPassed(task)).toBe(false);
    await app.request(url, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, expectedVersion: task.version + 2 }) });
    const lastUrl = `/api/tasks/${task.id}/criteria/${encodeURIComponent(taskCheckId(task.id, task.latestContractVersion, 1))}/review`;
    const lastInput = { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, expectedVersion: task.version + 3 }) };
    const last = await app.request(lastUrl, lastInput);
    expect(last.status).toBe(200);
    await expect(last.json()).resolves.toMatchObject({ ok: true, version: task.version + 4 });
    expect((await app.request(lastUrl, lastInput)).status).toBe(409);
    const tasks = new TaskRepository();
    expect(tasks.require(task.id)).toMatchObject({ phase: 'backlog' });
    expect(tasks.phaseChanges(task.id).filter(change => change.toPhase === 'closed')).toHaveLength(0);
  });

  it('requires a separate sign-off on the reviewed result and rejects a superseded result', async () => {
    const tasks = new TaskRepository();
    const runs = new TaskRunRepository();
    const service = new TaskApplicationService();
    const created = service.create({ idempotencyKey: 'signoff-task', title: 'Sign-off',
      contract: { objective: 'Deliver a report', acceptanceCriteria: ['Report is ready'], acceptancePolicy: 'manual',
        expectedOutputs: [], constraints: [], approvalRequired: [], assumptions: [], risks: [], outputDestinations: [] },
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' } });
    if (!created.ok) throw new Error('Expected task');
    const task = created.model.task;
    const finish = (label: string) => {
      const run = runs.create({ taskId: task.id, executorKind: 'agent', executorRef: { agentId: 'main' }, trigger: {},
        correlationId: label, idempotencyKey: label, contractVersion: task.latestContractVersion });
      const context = new TaskContextRepository().captureSnapshot({ ownerKind: 'task_run', ownerId: run.id, query: label });
      const started = runs.start({ runId: run.id, expectedVersion: run.version, contextSnapshotId: context.id, policySnapshot: {} });
      if (!started) throw new Error('Expected started run');
      expect(service.completeRun({ runId: run.id, expectedRunVersion: started.version, receipt: {
        status: 'succeeded', summary: label, changes: [], evidence: [], verification: { status: 'unverified', checks: [] },
        remainingWork: [], needsUser: false, completionVerdict: 'partial',
      } }).ok).toBe(true);
      return run.id;
    };
    const url = `/api/tasks/${task.id}`;
    const review = (resultId: string) => app.request(`${url}/criteria/${encodeURIComponent(taskCheckId(task.id, task.latestContractVersion, 0))}/review`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resultId, contractVersion: task.latestContractVersion,
        expectedVersion: tasks.require(task.id).version, status: 'passed' }),
    });
    const sign = (resultId: string, kind = 'owner', expectedVersion = tasks.require(task.id).version, deviceToken = '') => app.request(`${url}/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-principal-kind': kind, 'x-test-device-token': deviceToken },
      body: JSON.stringify({ expectedVersion,
        idempotencyKey: `signoff:${resultId}:${expectedVersion}`, command: { type: 'signoff', resultId } }),
    });
    const firstRun = finish('First result');
    const first = new TaskCriterionReviewRepository().target(task)!.id;
    expect(first).not.toBe(firstRun);
    expect((await review(first)).status).toBe(200);
    expect(tasks.require(task.id).phase).toBe('review');
    new TaskCollaborationRepository().append({ taskId: task.id, kind: 'instruction', authorKind: 'user',
      authorId: 'test-owner', body: 'Use the corrected source', idempotencyKey: 'new-direction' });
    const changes = getSqliteDatabase().prepare(`SELECT payload_json FROM domain_outbox
      WHERE event_type = 'task.changed.v2' AND subject_id = ? ORDER BY rowid DESC LIMIT 1`).get(task.id) as { payload_json: string };
    expect(JSON.parse(changes.payload_json)).toMatchObject({ changedFields: ['acceptance', 'attention'], source: 'runtime' });
    await expect((await app.request(url)).json()).resolves.toMatchObject({
      presentation: { status: 'blocked', primaryAction: { type: 'inspect_run', runId: firstRun } },
    });
    expect((await sign(first)).status).toBe(409);
    const secondRun = finish('Second result');
    const second = new TaskCriterionReviewRepository().target(task)!.id;
    expect((await review(first)).status).toBe(409);
    expect((await sign(second)).status).toBe(409);
    expect((await review(second)).status).toBe(200);
    const response = await app.request(url);
    const detail = await response.json();
    expect(response.status, JSON.stringify(detail)).toBe(200);
    expect(detail.acceptanceTarget).toEqual({ id: second, runId: secondRun, canSignOff: true });
    expect(detail.presentation.primaryAction).toEqual({ type: 'signoff', resultId: second });
    expect(detail.criterionReviewHistory).toMatchObject([{ resultId: first, status: 'passed' }]);
    expect((await sign(second, 'device')).status).toBe(403);
    const signedVersion = tasks.require(task.id).version;
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const device = createDevice({ displayName: 'Paired mobile', platform: 'android',
      publicKeyJwk: keys.publicKey.export({ format: 'jwk' }), scopes: ['tasks.read', 'tasks.write'] });
    const token = issueDeviceTokenPair(device.id).accessToken;
    expect((await sign(second, 'device', signedVersion, token)).status).toBe(200);
    expect((await sign(second, 'device', signedVersion, token)).status).toBe(200);
    revokeDevice(device.id);
    expect((await sign(second, 'device', signedVersion, token)).status).toBe(403);
    expect(tasks.require(task.id)).toMatchObject({ phase: 'closed', resolution: 'done' });
    expect(getSqliteDatabase().prepare('SELECT result_id FROM task_signoffs').all()).toEqual([{ result_id: second }]);
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM task_bound_criterion_reviews').get()).toEqual({ n: 2 });
  });

  it.each(['execution', 'wait'])('leaves the final criterion unreviewed while blocked by %s', async (blocker) => {
    const tasks = new TaskRepository();
    const task = tasks.create({ title: 'Review with pending work', objective: 'Check result',
      acceptanceCriteria: ['Result verified'], acceptancePolicy: 'manual' });
    const runs = new TaskRunRepository();
    if (blocker === 'execution') {
      runs.create({ taskId: task.id, executorKind: 'agent', executorRef: { agentId: 'main' }, trigger: {},
        correlationId: 'pending-run', idempotencyKey: 'pending-run', contractVersion: task.latestContractVersion });
    } else {
      runs.createWait({ taskId: task.id, kind: 'approval', reason: 'Pending approval', condition: {} });
    }
    const response = await app.request(`/api/tasks/${task.id}/criteria/${encodeURIComponent(taskCheckId(task.id, task.latestContractVersion, 0))}/review`, { method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: task.version, contractVersion: task.latestContractVersion, resultId: 'manual', status: 'passed' }) });
    expect(response.status).toBe(409);
    expect(tasks.require(task.id).version).toBe(task.version);
    expect(new TaskCriterionReviewRepository().list(task.id, task.latestContractVersion)).toEqual([]);
  });

  it.each(['missing', 'written', 'changed after review', 'unchanged', 'a symlink'])(
    'requires independent workspace evidence before sign-off when the target is %s', async (scenario) => {
      const db = getSqliteDatabase();
      db.prepare('INSERT INTO projects (project_id, name, slug, workspace_root, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
        .run('project-1', 'Project', 'project', stateDir);
      const service = new TaskApplicationService();
      const created = service.create({ idempotencyKey: 'workspace-target', title: 'Create TOOLS.md', projectId: 'project-1',
        contract: { objective: 'Save TOOLS.md', acceptanceCriteria: ['The document is usable'], acceptancePolicy: 'manual',
          expectedOutputs: ['TOOLS.md'], constraints: [], approvalRequired: [], assumptions: [], risks: [],
          outputDestinations: [{ kind: 'workspace_file', workspaceId: 'project:project-1', relativePath: 'TOOLS.md' }] },
        dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' } });
      if (!created.ok) throw new Error('Expected task');
      const task = created.model.task;
      const runs = new TaskRunRepository();
      const run = runs.create({ taskId: task.id, executorKind: 'agent', executorRef: { agentId: 'main' }, trigger: {},
        correlationId: 'workspace', idempotencyKey: 'workspace', contractVersion: task.latestContractVersion });
      const context = new TaskContextRepository().captureSnapshot({ ownerKind: 'task_run', ownerId: run.id, query: 'Save file' });
      const target = join(stateDir, 'TOOLS.md');
      if (scenario === 'unchanged') writeFileSync(target, 'Pre-existing content');
      const started = runs.start({ runId: run.id, expectedVersion: run.version, contextSnapshotId: context.id, policySnapshot: {} })!;
      writeFileSync(join(stateDir, 'preview.md'), 'Preview exists at another location');
      if (scenario === 'a symlink') symlinkSync(join(stateDir, 'preview.md'), target);
      if (scenario === 'written' || scenario === 'changed after review') writeFileSync(target, 'Verified output');
      expect(service.completeRun({ runId: run.id, expectedRunVersion: started.version, receipt: {
        status: 'succeeded', summary: 'Preview saved', changes: [], evidence: [], verification: { status: 'unverified', checks: [] },
        remainingWork: [], needsUser: false, completionVerdict: 'partial',
      } }).ok).toBe(true);
      const url = `/api/tasks/${task.id}`;
      const detail = await (await app.request(url)).json();
      const checkId = detail.acceptanceChecks[0].id;
      const review = await app.request(`${url}/criteria/${encodeURIComponent(checkId)}/review`, { method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: detail.task.version, contractVersion: task.latestContractVersion,
          resultId: detail.acceptanceTarget.id, status: 'passed' }) });
      expect(review.status).toBe(200);
      const latest = await (await app.request(url)).json();
      expect(latest.acceptanceTarget.canSignOff).toBe(['written', 'changed after review'].includes(scenario));
      if (scenario === 'changed after review') writeFileSync(target, 'Different file content after verification');
      const signoff = await app.request(`${url}/commands`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: latest.task.version, idempotencyKey: 'workspace-signoff',
          command: { type: 'signoff', resultId: detail.acceptanceTarget.id } }) });
      expect(signoff.status).toBe(scenario === 'written' ? 200 : 409);
    });

  it('does not allow a device token to make a human criterion review', async () => {
    const task = new TaskRepository().create({ title: 'Owner review', objective: 'Check result',
      acceptanceCriteria: ['Owner accepts the result'], acceptancePolicy: 'manual' });
    const response = await app.request(`/api/tasks/${task.id}/criteria/${encodeURIComponent(taskCheckId(task.id, task.latestContractVersion, 0))}/review`, { method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-principal-kind': 'device' },
      body: JSON.stringify({ expectedVersion: task.version, contractVersion: task.latestContractVersion, resultId: 'manual', status: 'passed' }) });
    expect(response.status).toBe(403);
    expect(new TaskCriterionReviewRepository().list(task.id, task.latestContractVersion)).toHaveLength(0);
  });

  it.each(['/new', '/RESET prompt', '/restart', '/clear', '/archive'])(
    'rejects destructive conversation command %s',
    async (content) => {
      const task = new TaskRepository().create({ title: 'Continuous task', objective: 'Keep one transcript' });
      const conversationId = '86f460b7-2578-4f2d-9216-06dd70f50e30';
      ensureSessionRecord(conversationId, stateDir, { agentId: 'main' });
      new TaskRunRepository().create({
        taskId: task.id,
        conversationId,
        executorKind: 'agent',
        executorRef: { agentId: 'main' },
        trigger: { kind: 'manual' },
        correlationId: `continuous-${content}`,
        idempotencyKey: `continuous-${content}`,
        contractVersion: task.latestContractVersion,
      });
      new TaskConversationRepository().activateExecutionSession({
        taskId: task.id,
        conversationId,
        agentId: 'main',
      });

      const response = await app.request(`/api/tasks/${task.id}/inputs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { message: 'A task has one continuous conversation.' },
      });
    },
  );

  it('deletes an idle Task and reports a stable missing-task error', async () => {
    const task = new TaskRepository().create({ title: 'Delete route', objective: 'Delete through REST' });

    const deleted = await app.request(`/api/tasks/${task.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ ok: true, deleted: true, taskId: task.id });

    const missing = await app.request(`/api/tasks/${task.id}`, { method: 'DELETE' });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      ok: false,
      code: 'task_not_found',
      error: 'Task not found',
    });
  });

  it('rejects deletion while a TaskRun is active', async () => {
    const task = new TaskRepository().create({ title: 'Active route', objective: 'Keep active' });
    const run = new TaskRunRepository().create({
      taskId: task.id,
      executorKind: 'agent',
      executorRef: { agentId: 'main' },
      trigger: { kind: 'manual' },
      correlationId: 'route-active-run',
      idempotencyKey: 'route-active-run',
      contractVersion: task.latestContractVersion,
    });

    const response = await app.request(`/api/tasks/${task.id}`, { method: 'DELETE' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'task_active',
      error: 'Cancel the active TaskRun before deleting the Task',
      runId: run.id,
    });
  });
});
