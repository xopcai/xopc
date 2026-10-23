import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { resultReferenceVersion, type TurnOutcome } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { saveMediaBuffer } from '../../media/store.js';
import { isMediaUriReferencedByLiveSession } from '../../media/session-references.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { loadTranscriptRowsForSession } from '../../storage/sqlite/transcript-repository.js';
import { buildSessionContextForLlm } from '../../session/session-context-for-llm.js';
import { materializeTaskHandoffFile, resolveTaskHandoffReferences } from '../task-handoff.js';
import { createPersonalTaskTool } from '../../agent/tools/personal-task-tool.js';
import { TaskReadModelProjector } from '../task-read-model-projector.js';
import { TaskRepository } from '../task-repository.js';
import { createHash } from 'node:crypto';
import { resolveMediaReference } from '../../media/media-reference.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { TaskRunCoordinator } from '../task-run-coordinator.js';
import { TaskResultDeliveryService } from '../task-result-delivery-service.js';
import { TaskMainUpdateDelivery } from '../task-main-update-delivery.js';
import { TaskResultDeliveryRepository } from '../task-result-delivery-repository.js';
import type { ClientHistoryMessage } from '../../session/client-history.js';
import { SessionStore } from '../../session/store.js';
import { resetSessionRecord } from '../../storage/sqlite/session-repository.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { ConfigSchema } from '../../config/schema.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { personalAgentId } from '../../personal-agent/repository.js';
import { PERSONAL_PERSONA_GUIDANCE } from '../../personal-agent/persona.js';
import { PersonalReplyComposer, buildPersonalReplyPrompt, parsePersonalReplyDraft, type PersonalReplyPacket } from '../../personal-agent/reply-composer.js';
import * as modelCalls from '../../providers/model-call.js';
import * as providers from '../../providers/index.js';
import * as resultReader from '../../personal-agent/result-reader.js';
import { personalPerformanceSnapshot } from '../../personal-agent/performance.js';
import { insertSessionInput, claimNextSessionInput, finishSessionInputRun, bumpSessionInputRevision } from '../../storage/sqlite/session-input-repository.js';

describe('background task result delivery', () => {
  let stateDir: string;
  beforeEach(() => {
    vi.spyOn(resultReader, 'warmPersonalResult').mockImplementation(() => {});
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-result-'));
    vi.stubEnv('XOPC_STATE_DIR', stateDir);
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(stateDir, 'xopc.db'));
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function task(criteria: string[] = []) {
    const main = createConversation({ agentId: 'main' });
    const worker = createConversation({ agentId: 'worker' });
    const created = new TaskApplicationService().create({ idempotencyKey: `draw:${main.key}`,
      title: 'Draw sunset', locale: 'zh', priority: 'normal', originConversationId: main.key,
      contract: { objective: 'Draw sunset', expectedOutputs: ['Image'], acceptanceCriteria: criteria,
        constraints: [], approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] },
      dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'worker' } } });
    if (!created.ok || !created.runId) throw new Error('Expected task run');
    new TaskConversationRepository().activateExecutionSession({ taskId: created.model.task.id,
      conversationId: worker.key, agentId: 'worker', runId: created.runId });
    const coordinator = TaskRunCoordinator.start({ runId: created.runId, fallbackObjective: 'Draw sunset',
      context: { runId: created.runId, conversationId: worker.key, agentId: 'worker',
        taskId: created.model.task.id, channel: 'webchat', origin: 'task', triggerKind: 'user' } });
    if (!coordinator) throw new Error('Expected coordinator');
    return { main, worker, coordinator, runId: created.runId, taskId: created.model.task.id };
  }

  async function image(runId: string, suffix = ''): Promise<TurnOutcome> {
    const media = await saveMediaBuffer(Buffer.from('published-image'), { bucket: 'outbound', contentType: 'image/png' });
    return { version: 1, outcomeId: `outcome:${runId}${suffix}`, runId, turnId: runId, status: 'succeeded',
      summary: 'UNTRUSTED_LONG_WORKER_INSTRUCTIONS', evidence: [], createdAt: new Date().toISOString(),
      deliverables: [{ artifactId: media.id, title: 'Sunset.png', kind: 'image', availability: 'available',
        location: 'artifact_store', uri: media.uri, mimeType: 'image/png', sizeBytes: media.size,
        capabilities: ['preview', 'download'], workspaceRelativePath: '/private/worker/secret.png' }] };
  }

  function markPersonal(conversationId: string) {
    const repository = new AgentCatalogRepository();
    repository.ensureInitialized();
    const agentId = personalAgentId('local-owner');
    repository.create({ id: agentId, models: { chat: { primary: 'test/personal', fallbacks: [] } }, profile: { name: 'Ada', style: 'Natural and clear' } }, { ready: true });
    getSqliteDatabase().prepare("UPDATE sessions SET agent_id = ?, custom_data_json = json_set(COALESCE(custom_data_json, '{}'), '$.personalAgent', 1) WHERE conversation_id = ?")
      .run(agentId, conversationId);
  }

  it('atomically reopens the same Task, preserves the prior run and delivery, and retries one revision idempotently', async () => {
    const { main, worker, coordinator, runId, taskId } = task(); markPersonal(main.key);
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Original full result.' });
    await new TaskResultDeliveryService().drain(vi.fn());
    const db = getSqliteDatabase();
    const before = db.prepare('SELECT delivery_id,payload_json FROM task_result_deliveries').get() as { delivery_id: string; payload_json: string };
    const delivery = JSON.parse(before.payload_json);
    expect(resultReader.listPersonalResults(main.key).items[0].baselineVersion).toBe(resultReferenceVersion(delivery));
    expect(new TaskReadModelProjector().get(taskId)?.allowedCommands).toContain('revise');
    const tool = createPersonalTaskTool({ getCurrentConversationId: () => main.key, getCurrentAgentId: () => personalAgentId('local-owner') });
    const conflict = await tool.execute('revision-conflict', { command: 'revise', taskId, instruction: 'Change blue', baselineResultId: delivery.deliveryId, baselineVersion: '1', expectedVersion: new TaskRepository().require(taskId).version });
    const recovery = JSON.parse(conflict.content[0].type === 'text' ? conflict.content[0].text : 'null');
    expect(recovery).toMatchObject({ ok: false, reason: 'conflict', revisionBaseline: { resultId: delivery.deliveryId, baselineVersion: resultReferenceVersion(delivery) } });
    const input = { taskId, conversationId: main.key, baselineResultId: delivery.deliveryId,
      baselineVersion: resultReferenceVersion(delivery), expectedVersion: new TaskRepository().require(taskId).version,
      instruction: 'Change the sunset to blue. Retain the rest.', idempotencyKey: 'blue-revision' };
    const service = new TaskApplicationService();
    expect(service.reviseCompleted({ ...input, supersedesEntryIds: [delivery.deliveryId] })).toMatchObject({ ok: false, reason: 'invalid_reference' });
    expect(service.reviseCompleted({ ...input, baselineVersion: 'wrong' })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(db.prepare('SELECT count(*) AS n FROM task_work_revisions').get()).toMatchObject({ n: 0 });
    expect(service.reviseCompleted(input)).toMatchObject({ ok: true });
    expect(service.reviseCompleted(input)).toMatchObject({ ok: true });
    expect(() => service.reviseCompleted({ ...input, instruction: 'Different' })).toThrow(/idempotency/);
    expect(db.prepare('SELECT count(*) AS n FROM task_work_revisions').get()).toMatchObject({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(db.prepare('SELECT status FROM task_runs WHERE run_id = ?').get(runId)).toMatchObject({ status: 'succeeded' });
    expect(db.prepare('SELECT payload_json FROM task_result_deliveries').get()).toMatchObject({ payload_json: before.payload_json });
    expect(db.prepare('SELECT status FROM task_allocations').get()).toMatchObject({ status: 'pending' });
    const revisionInstruction = (db.prepare('SELECT instruction_entry_id FROM task_work_revisions').get() as { instruction_entry_id: string }).instruction_entry_id;
    expect(db.prepare('SELECT status FROM task_collaboration_deliveries WHERE entry_id = ?').get(revisionInstruction)).toMatchObject({ status: 'pending' });
    expect(new TaskConversationRepository().getActiveSession(taskId)).toBeUndefined();
    expect(new TaskConversationRepository().getState(taskId)?.activeConversationId).toBeUndefined();
    const next = service.execute({ taskId, expectedVersion: new TaskRepository().require(taskId).version,
      idempotencyKey: 'new-root', actor: { kind: 'system', id: 'task-router' }, command: { type: 'start', executor: { kind: 'agent', agentId: 'worker' } } });
    if (!next.ok || !next.runId) throw new Error('Expected a new root Run');
    expect(next.runId).not.toBe(runId);
    expect(new TaskConversationRepository().activateExecutionSession({ taskId, conversationId: worker.key, agentId: 'worker', runId: next.runId }).assignmentEpoch).toBeGreaterThan(delivery.assignmentEpoch);
    await expect(tool.execute('bad-command', { command: 'start', taskId } as never)).rejects.toThrow(/Unsupported personal_task command/);
    await resolveTaskHandoffReferences(taskId);
    const workspace = join(stateDir, 'executor'); mkdirSync(workspace);
    const copy = await materializeTaskHandoffFile(taskId, 1, workspace, ConfigSchema.parse({}));
    expect(readFileSync(copy.readOnlyPath, 'utf8')).toBe('published-image');
    expect(copy.sha256).toBe(createHash('sha256').update('published-image').digest('hex'));
    expect((await materializeTaskHandoffFile(taskId, 1, workspace, ConfigSchema.parse({}))).readOnlyPath).toBe(copy.readOnlyPath);
    await expect(materializeTaskHandoffFile(taskId, 0, workspace, ConfigSchema.parse({}))).rejects.toThrow(/body is text/);
    const media = await resolveMediaReference(delivery.outcome.deliverables[0].uri);
    writeFileSync(media.path, 'mutated-file');
    await expect(materializeTaskHandoffFile(taskId, 1, join(stateDir, 'executor'), ConfigSchema.parse({}))).rejects.toThrow(/immutable revision/);
  });

  it('preserves four immutable results through three completed revisions on one Task', async () => {
    const { main, worker, coordinator, taskId, runId } = task(['Image available']); markPersonal(main.key);
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Original result' });
    const deliveryService = new TaskResultDeliveryService();
    await deliveryService.drain(vi.fn());
    const db = getSqliteDatabase();
    const versions: Array<{ deliveryId: string; serialized: string }> = [];
    for (let index = 1; index <= 3; index++) {
      const row = db.prepare('SELECT delivery_id,payload_json FROM task_result_deliveries ORDER BY created_at DESC, rowid DESC LIMIT 1').get()!;
      const delivery = JSON.parse(String(row.payload_json));
      versions.push({ deliveryId: delivery.deliveryId, serialized: String(row.payload_json) });
      expect(delivery.resultRevision).toBe(index);
      const service = new TaskApplicationService();
      const applied = service.reviseCompleted({ taskId, conversationId: main.key,
        baselineResultId: delivery.deliveryId, baselineVersion: resultReferenceVersion(delivery),
        expectedVersion: new TaskRepository().require(taskId).version,
        instruction: `Revision ${index}: retain the previous image and update its explanation.`, idempotencyKey: `three-revisions-${index}` });
      expect(applied.ok).toBe(true);
      const next = service.execute({ taskId, expectedVersion: new TaskRepository().require(taskId).version,
        idempotencyKey: `three-roots-${index}`, actor: { kind: 'system', id: 'task-router' },
        command: { type: 'start', executor: { kind: 'agent', agentId: 'worker' } } });
      if (!next.ok || !next.runId) throw new Error('Expected revision root');
      new TaskConversationRepository().activateExecutionSession({ taskId, conversationId: worker.key, agentId: 'worker', runId: next.runId });
      const run = TaskRunCoordinator.start({ runId: next.runId, fallbackObjective: `Revision ${index}`,
        context: { runId: next.runId, conversationId: worker.key, agentId: 'worker', taskId, channel: 'webchat', origin: 'task', triggerKind: 'user' } })!;
      run.captureOutcome(await image(next.runId));
      run.finalize({ status: 'succeeded', summary: 'Ready', assistantText: `Revised explanation ${index}` });
      await deliveryService.drain(vi.fn());
      for (const saved of versions) {
        expect(db.prepare('SELECT payload_json FROM task_result_deliveries WHERE delivery_id = ?').get(saved.deliveryId)?.payload_json).toBe(saved.serialized);
      }
    }
    const latest = JSON.parse(String(db.prepare('SELECT payload_json FROM task_result_deliveries ORDER BY created_at DESC, rowid DESC LIMIT 1').get()!.payload_json));
    expect(latest.resultRevision).toBe(4);
    expect(latest.previousResultId).toBe(versions[2].deliveryId);
    expect(db.prepare('SELECT count(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM task_work_revisions').get()).toMatchObject({ n: 3 });
    expect(db.prepare('SELECT count(*) AS n FROM task_runs WHERE parent_run_id IS NULL').get()).toMatchObject({ n: 4 });
  });

  it('delivers only explicitly selected final artifacts, excluding failed intermediate publications', async () => {
    const { main, coordinator, runId } = task(['Final image available']); markPersonal(main.key);
    const intermediate = await image(runId, '-intermediate');
    intermediate.deliverables[0].title = 'obsolete.png'; intermediate.deliverables[0].availability = 'failed';
    coordinator.captureOutcome(intermediate);
    const final = await image(runId, '-final'); final.deliverables[0].title = 'final.png';
    coordinator.captureOutcome(final);
    const contractVersion = Number((getSqliteDatabase().prepare('SELECT latest_contract_version AS v FROM tasks').get() as { v: number }).v);
    coordinator.captureOutcome({ ...final, outcomeId: 'selected-review', deliverables: [], research: {
      version: 1, contractVersion, instructionSequence: 0,
      finalArtifactIds: [final.deliverables[0].artifactId], inspectedArtifactIds: [final.deliverables[0].artifactId],
      sources: [{ id: 's', toolCallId: 'actual', toolName: 'publish_artifacts', excerpt: 'File available', snapshotHash: 'a'.repeat(64), observedAt: Date.now() }],
      claims: [{ id: 'c', kind: 'fact', statement: 'File available', sourceIds: ['s'], support: 'supported' }], checks: [{ criterionIndex: 0, criterion: 'Final image available', status: 'passed', claimIds: ['c'], note: 'Selected final image is published.' }], instructionChecks: [], review: 'model_reviewed' } });
    coordinator.captureOutcome({ ...final, outcomeId: 'late-generic-turn', status: 'partial', deliverables: [...intermediate.deliverables, ...final.deliverables] });
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Final only.' });
    await new TaskResultDeliveryService().drain(vi.fn());
    const row = getSqliteDatabase().prepare('SELECT payload_json FROM task_result_deliveries').get() as { payload_json: string };
    const delivery = JSON.parse(row.payload_json);
    expect(delivery.outcome.deliverables.map((item: { title: string }) => item.title)).toEqual(['final.png']);
    expect(delivery.outcome.deliverables[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(delivery.text).toBe('Final only.');
    expect(delivery.outcome.status).toBe('succeeded');
  });

  it('retries exhausted delivery without another TaskRun, artifact generation or duplicate message', async () => {
    const { main, coordinator, runId } = task(); markPersonal(main.key);
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Retained delivery.' });
    const db = getSqliteDatabase();
    const row = db.prepare('SELECT delivery_id FROM task_result_deliveries').get() as { delivery_id: string };
    const repository = new TaskResultDeliveryRepository();
    for (let i = 0; i < 8; i++) repository.retry(row.delivery_id, 'offline');
    expect(db.prepare('SELECT status FROM task_result_deliveries').get()).toMatchObject({ status: 'failed' });
    expect(resultReader.listPersonalResults(main.key).items[0].deliveryState).toBe('failed');
    expect(resultReader.retryPersonalResultDelivery(main.key, row.delivery_id)).toMatchObject({ retryQueued: true, executionRestarted: false });
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async () => 'Delivered retained result.').drain(vi.fn());
    const count = loadTranscriptRowsForSession(main.key).length;
    db.prepare('UPDATE task_result_deliveries SET notified_at = -1, reply_notified_at = -1, reply_attempts = 8').run();
    expect(resultReader.retryPersonalResultDelivery(main.key, row.delivery_id)).toMatchObject({ retryQueued: true });
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(vi.fn()).drain(vi.fn());
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(count);
    expect(db.prepare('SELECT count(*) AS n FROM task_runs').get()).toMatchObject({ n: 1 });
    expect(resultReader.retryPersonalResultDelivery(main.key, row.delivery_id)).toMatchObject({ retryQueued: false });
  });

  it('delivers deterministic retained text after five seconds while foreground is unavailable, exactly once', async () => {
    const { main, coordinator, runId } = task(); markPersonal(main.key);
    const outcome = await image(runId); outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Full text with limitations: isolated example only.' });
    await new TaskResultDeliveryService().drain(vi.fn());
    getSqliteDatabase().prepare('UPDATE task_result_deliveries SET created_at = ?').run(Date.now() - 6000);
    const compose = vi.fn(async () => 'Should not run'); const notify = vi.fn();
    const composer = new PersonalReplyComposer(compose);
    await composer.drain(notify, () => false); await composer.drain(notify, () => false);
    expect(compose).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledOnce();
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(1);
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).toContain('isolated example only');
    const payload = getSqliteDatabase().prepare('SELECT payload_json FROM task_result_deliveries').get() as { payload_json: string };
    expect(JSON.parse(payload.payload_json).text).toContain('Full text with limitations');
  });
  it('persists simultaneous completions within the fallback budget under continuous foreground work', async () => {
    const tasks = [task(), task(), task()];
    markPersonal(tasks[0].main.key);
    for (const item of tasks.slice(1)) getSqliteDatabase().prepare('UPDATE sessions SET agent_id=?, custom_data_json=? WHERE conversation_id=?')
      .run(personalAgentId('local-owner'), JSON.stringify({ personalAgent: true }), item.main.key);
    for (const item of tasks) {
      const outcome = await image(item.runId); outcome.deliverables = [];
      item.coordinator.captureOutcome(outcome);
      item.coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: `Retained result ${item.taskId}` });
    }
    await new TaskResultDeliveryService().drain(vi.fn());
    const notify = vi.fn(); const compose = vi.fn(async () => { throw new Error('429 rate limited'); });
    const composer = new PersonalReplyComposer(compose);
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 5100);
      await Promise.all(Array.from({ length: 4 }, () => composer.drain(notify, () => false)));
      expect(compose).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledTimes(3);
      for (const item of tasks) {
        const rows = loadTranscriptRowsForSession(item.main.key);
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows)).toContain(`Retained result ${item.taskId}`);
        const sample = personalPerformanceSnapshot().find(row => row.phase === 'busy_fallback' && row.taskId === item.taskId);
        expect(sample?.durationMs).toBeGreaterThanOrEqual(5100);
        expect(sample?.durationMs).toBeLessThanOrEqual(6000);
      }
    } finally { vi.useRealTimers(); }
  });

  it('lets durable fallback cancel a slow Composer and prevents its late draft from duplicating the final message', async () => {
    const { main, coordinator, runId } = task(); markPersonal(main.key);
    const outcome = await image(runId); outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Original retained result.' });
    await new TaskResultDeliveryService().drain(vi.fn());
    let release!: (text: string) => void;
    let started!: () => void;
    let observedSignal: AbortSignal | undefined;
    const began = new Promise<void>(resolve => { started = resolve; });
    const compose = async (_packet: PersonalReplyPacket, signal: AbortSignal) => {
      observedSignal = signal; started(); return new Promise<string>(resolve => { release = resolve; });
    };
    const notify = vi.fn();
    const slow = new PersonalReplyComposer(compose).drain(notify);
    await began;
    getSqliteDatabase().prepare('UPDATE task_result_deliveries SET created_at = ?').run(Date.now() - 6000);
    await new PersonalReplyComposer(vi.fn()).drain(notify, () => false);
    await slow;
    expect(observedSignal?.aborted).toBe(true);
    release('Late model draft'); await Promise.resolve();
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(1);
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).not.toContain('Late model draft');
    expect(notify).toHaveBeenCalledOnce();
  });

  it('composes personal text once, retains report sources internally, and recovers push failure without regenerating', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    const profileDir = join(stateDir, 'agents', personalAgentId('local-owner'), 'profile');
    mkdirSync(profileDir, { recursive: true });
    const soul = 'Use gentle, dry wit and a patient voice. CUSTOM_PERSONAL_SOUL';
    writeFileSync(join(profileDir, 'SOUL.md'), soul);
    const otherProfileDir = join(stateDir, 'agents', 'main', 'profile');
    mkdirSync(otherProfileDir, { recursive: true });
    writeFileSync(join(otherProfileDir, 'SOUL.md'), 'OTHER_AGENT_SOUL');
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Report ready', assistantText: 'Finding: sunset. https://example.test/source' });
    await new TaskResultDeliveryService().drain(vi.fn());
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(0);
    const compose = vi.fn(async (packet: PersonalReplyPacket) => {
      const prompt = buildPersonalReplyPrompt(packet);
      expect(prompt).toContain('Ada');
      expect(prompt).toContain('Tone: friendly and natural.');
      expect(prompt).toContain('Draw sunset');
      expect(prompt).toContain(PERSONAL_PERSONA_GUIDANCE);
      expect(prompt).not.toContain('lead with the answer or the most relevant judgment');
      expect(prompt).toContain('CUSTOM_PERSONAL_SOUL');
      expect(prompt).not.toContain('OTHER_AGENT_SOUL');
      expect(prompt).not.toContain('UNTRUSTED_LONG_WORKER_INSTRUCTIONS');
      return parsePersonalReplyDraft('The sunset finding is ready.', packet);
    });
    await new PersonalReplyComposer(compose).drain(async () => { throw new Error('Disconnected'); });
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(1);
    expect(readFileSync(join(profileDir, 'SOUL.md'), 'utf-8')).toBe(soul);
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    getSqliteDatabase().prepare('UPDATE task_result_deliveries SET reply_next_attempt_at = 0').run();
    const notify = vi.fn();
    await new PersonalReplyComposer(compose).drain(notify);
    await new PersonalReplyComposer(compose).drain(notify);
    expect(compose).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const detail = await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true });
    expect(detail?.session.messages).toHaveLength(1);
    expect(JSON.stringify(detail)).toContain('The sunset finding is ready.');
    expect(JSON.stringify(detail)).not.toContain('https://example.test/source');
    const stored = getSqliteDatabase().prepare('SELECT reply_payload_json FROM task_result_deliveries').get() as { reply_payload_json: string };
    expect(JSON.parse(stored.reply_payload_json).report).toContain('https://example.test/source');
  });

  it('waits for foreground work and voice availability while artifacts still arrive', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Report' });
    insertSessionInput({ id: 'foreground', conversationId: main.key, clientMessageId: 'foreground',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'New question',
      origin: { type: 'endpoint', endpointId: 'test' } });
    claimNextSessionInput(main.key, 'foreground-run');
    await new TaskResultDeliveryService().drain(vi.fn());
    const compose = vi.fn(async () => 'Ready');
    await new PersonalReplyComposer(compose).drain(vi.fn());
    expect(compose).not.toHaveBeenCalled();
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(1);
    finishSessionInputRun(main.key, 'foreground-run', 'completed');
    await new PersonalReplyComposer(compose).drain(vi.fn(), () => false);
    expect(compose).not.toHaveBeenCalled();
    await new PersonalReplyComposer(compose).drain(vi.fn(), () => true);
    expect(compose).toHaveBeenCalledTimes(1);
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(2);
  });

  it('holds the notification lease until asynchronous voice delivery completes', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Report' });
    await new TaskResultDeliveryService().drain(vi.fn());
    let complete!: () => void;
    const notify = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const composer = new PersonalReplyComposer(async () => 'Ready');
    vi.useFakeTimers();
    const delivery = composer.drain(notify);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(notify).toHaveBeenCalledOnce();
      expect(getSqliteDatabase().prepare('SELECT reply_notified_at FROM task_result_deliveries').get()?.reply_notified_at).toBeNull();
      await vi.advanceTimersByTimeAsync(25_000);
      await composer.drain(notify);
      expect(notify).toHaveBeenCalledOnce();
      complete();
      await delivery;
      expect(getSqliteDatabase().prepare('SELECT reply_notified_at FROM task_result_deliveries').get()?.reply_notified_at).toBeTypeOf('number');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      complete?.();
      await delivery;
      vi.useRealTimers();
    }
  });

  it('discards an old-context draft after new user input and composes again after the foreground turn', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Detailed report' });
    await new TaskResultDeliveryService().drain(vi.fn());
    const compose = vi.fn(async (): Promise<string> => {
      if (compose.mock.calls.length === 1) {
        insertSessionInput({ id: 'new-input', conversationId: main.key, clientMessageId: 'new-input',
          requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Only the conclusion',
          origin: { type: 'endpoint', endpointId: 'test' } });
        return 'Stale detailed introduction';
      }
      return 'Latest concise conclusion';
    });
    const notify = vi.fn();
    await new PersonalReplyComposer(compose).drain(notify);
    expect(notify).not.toHaveBeenCalled();
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(0);
    await new PersonalReplyComposer(compose).drain(notify);
    expect(compose).toHaveBeenCalledTimes(1);
    claimNextSessionInput(main.key, 'new-run');
    finishSessionInputRun(main.key, 'new-run', 'completed');
    await new PersonalReplyComposer(compose).drain(notify);
    expect(compose).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).toContain('Latest concise conclusion');
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).not.toContain('Stale detailed introduction');
    expect(getSqliteDatabase().prepare('SELECT reply_attempts FROM task_result_deliveries').get()).toMatchObject({ reply_attempts: 0 });
  });

  it('invalidates a draft when confirmed voice input arrives before a durable turn is committed', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Report' });
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async () => {
      bumpSessionInputRevision(getSqliteDatabase(), main.key);
      return 'Old voice context';
    }).drain(vi.fn());
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(0);
    await new PersonalReplyComposer(async () => 'Fresh voice context').drain(vi.fn());
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).toContain('Fresh voice context');
  });

  it('delivers artifacts before composition and leases only one composer for the same reply', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Image ready', assistantText: 'Worker report.' });
    await new TaskResultDeliveryService().drain(vi.fn());
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(1);
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).not.toContain('Worker report.');
    let finish!: (value: string) => void;
    const compose = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const first = new PersonalReplyComposer(compose).drain(vi.fn());
    await new PersonalReplyComposer(compose).drain(vi.fn());
    expect(compose).toHaveBeenCalledTimes(1);
    finish('Here is the sunset image you asked for.');
    await first;
    const detail = await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true });
    expect(detail?.session.messages).toHaveLength(2);
    expect((detail?.session.messages[1] as unknown as ClientHistoryMessage).metadata?.turnOutcome?.deliverables).toEqual([]);
  });

  it('keeps artifact and reply retries independent in one outbox row', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Recorded report' });
    await new TaskResultDeliveryService().drain(() => { throw new Error('Artifact push disconnected'); });
    const compose = vi.fn(async () => 'Here is your image.');
    await new PersonalReplyComposer(compose).drain(vi.fn());
    const db = getSqliteDatabase();
    expect(db.prepare(`SELECT status, attempts, notified_at, reply_status, reply_attempts,
      reply_notified_at FROM task_result_deliveries`).all()).toEqual([
      { status: 'delivered', attempts: 1, notified_at: null, reply_status: 'delivered',
        reply_attempts: 0, reply_notified_at: expect.any(Number) },
    ]);
    db.prepare('UPDATE task_result_deliveries SET next_attempt_at = 0').run();
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(compose).drain(vi.fn());
    expect(compose).toHaveBeenCalledTimes(1);
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(2);
  });

  it.each(['cancel', 'reassign', 'edit', 'delete'] as const)('discards a composed late reply after %s', async change => {
    const { main, coordinator, runId, taskId } = task();
    markPersonal(main.key);
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Report ready', assistantText: 'Original result' });
    await new TaskResultDeliveryService().drain(vi.fn());
    const compose = vi.fn(async () => {
      const db = getSqliteDatabase();
      if (change === 'cancel') db.prepare("UPDATE tasks SET phase = 'closed', resolution = 'cancelled' WHERE task_id = ?").run(taskId);
      if (change === 'reassign') db.prepare('UPDATE task_conversation_state SET assignment_epoch = assignment_epoch + 1 WHERE task_id = ?').run(taskId);
      if (change === 'edit') db.prepare('UPDATE tasks SET version = version + 1 WHERE task_id = ?').run(taskId);
      if (change === 'delete') db.prepare('DELETE FROM sessions WHERE conversation_id = ?').run(main.key);
      return 'Late result';
    });
    const notify = vi.fn();
    await new PersonalReplyComposer(compose).drain(notify);
    expect(notify).not.toHaveBeenCalled();
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(0);
  });

  it('recovers expired generation leases and uses a complete fallback when composition times out', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Report ready', assistantText: 'Full result with an important limitation.' });
    await new TaskResultDeliveryService().drain(vi.fn());
    getSqliteDatabase().prepare("UPDATE task_result_deliveries SET reply_status = 'generating', reply_lease_until = 0").run();
    const compose = vi.fn((_packet: PersonalReplyPacket, signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }));
    await new PersonalReplyComposer(compose, 10).drain(vi.fn());
    expect(compose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).toContain('Full result with an important limitation.');
  });

  it('preserves code exactly while composing its explanation', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    const code = '```ts\nconst unchanged = 42;\n```';
    coordinator.finalize({ status: 'succeeded', summary: 'Code ready', assistantText: code });
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async packet => {
      expect(packet.preservedText).toBe(code);
      return 'The code is ready.';
    }).drain(vi.fn());
    const page = await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true });
    expect(page?.session.messages[0]?.content).toBe(`The code is ready.\n\n${code}`);
  });

  it('uses a short reported conclusion with its uncertainty when artifact composition fails', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    const outcome = await image(runId);
    outcome.status = 'partial';
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: '报价待核实',
      assistantText: '结论：方案 A 可能更省，报价尚未核实。\n\n# Details\n' + 'Detailed analysis.\n'.repeat(2000) });
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async () => { throw new Error('Fixed format failure'); }).drain(vi.fn());
    const text = (await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true }))!.session.messages.at(-1)!.content;
    expect(text).toContain('Only part of the request');
    expect(text).toContain('可能更省，报价尚未核实');
    expect(text).toContain('full result and limitations');
    expect(text).not.toContain('Detailed analysis');
    expect(text.length).toBeLessThan(200);
  });

  it('uses the original user request to preserve exact prose even when the Task objective omits that requirement', async () => {
    const { main, coordinator, runId, taskId } = task();
    markPersonal(main.key);
    insertSessionInput({ id: 'original-request', conversationId: main.key, clientMessageId: 'original-request',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'completed', content: '请原样输出正文',
      origin: { type: 'endpoint', endpointId: 'test' } });
    getSqliteDatabase().prepare('UPDATE task_origin_links SET request_input_id = ? WHERE task_id = ?').run('original-request', taskId);
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Exact original prose.' });
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async packet => {
      expect(packet.preservedText).toBe('Exact original prose.');
      expect(buildPersonalReplyPrompt(packet)).toContain('请原样输出正文');
      return '正文在下面。';
    }).drain(vi.fn());
    const page = await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true });
    expect(page?.session.messages[0]?.content).toBe('正文在下面。\n\nExact original prose.');
  });

  it('accepts omitted acknowledgement fields without appending report URLs', () => {
    const packet = { report: Array.from({ length: 12 }, (_, index) => `https://example.test/source-${index}`).join('\n') } as PersonalReplyPacket;
    expect(parsePersonalReplyDraft('Done', packet)).toBe('Done');
    expect(() => parsePersonalReplyDraft('https://invented.test', packet)).toThrow('invented');
    expect(() => parsePersonalReplyDraft(JSON.stringify({ text: 'Done', limitationIds: [] }), packet)).toThrow('plain text');
  });

  it('preserves selected source and deliverable links without adding unused sources', () => {
    const packet = { report: '[Paper](https://example.test/paper) https://example.test/unused',
      preservedText: '[Download](https://example.test/download)' } as PersonalReplyPacket;
    const text = 'Finding remains uncertain. [Paper](https://example.test/paper) [Download](https://example.test/download)';
    expect(parsePersonalReplyDraft(text, packet)).toBe(text);
  });

  it('rejects fabricated links and drafts that omit the result contract', () => {
    const packet = { report: 'https://example.test/source' } as PersonalReplyPacket;
    expect(() => parsePersonalReplyDraft('https://invented.test', packet)).toThrow('invented');
    expect(() => parsePersonalReplyDraft(JSON.stringify({ text: 'Done', sourceIds: [], limitationIds: ['status'] }), packet)).toThrow('plain text');
  });

  it('uses the personal model in one tool-free call and falls back on an invalid model draft', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Report ready', assistantText: 'Grounded result.' });
    await new TaskResultDeliveryService().drain(vi.fn());
    const resolve = vi.spyOn(providers, 'resolveModel').mockReturnValue({ id: 'personal' } as ReturnType<typeof providers.resolveModel>);
    const complete = vi.spyOn(modelCalls, 'completeWithResolvedCredentials').mockResolvedValue({
      role: 'assistant', content: [{ type: 'text', text: '{"text":' }], stopReason: 'stop',
    } as Awaited<ReturnType<typeof modelCalls.completeWithResolvedCredentials>>);
    await new PersonalReplyComposer().drain(vi.fn());
    expect(resolve).toHaveBeenCalledWith('test/personal');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![1].tools).toBeUndefined();
    expect(complete.mock.calls[0]![4]).toMatchObject({ operation: 'personal.reply_composition', conversationId: main.key });
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).toContain('Grounded result.');
  });

  it('regenerates instead of publishing old-context prose when reset happens during composition', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Report ready', assistantText: 'Recorded result.' });
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async () => {
      resetSessionRecord(main.key, stateDir);
      return 'Old context';
    }).drain(vi.fn());
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(0);
    await new PersonalReplyComposer(async () => 'Fresh reply').drain(vi.fn());
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).toContain('Fresh reply');
    expect(JSON.stringify(loadTranscriptRowsForSession(main.key))).not.toContain('Old context');
  });

  it('delivers image-only outcomes while main is busy, with no notification model', async () => {
    const { main, coordinator, runId } = task();
    const outcome = await image(runId);
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Image ready' });
    const notify = vi.fn();
    expect(await new TaskResultDeliveryService().drain(notify)).toBe(1);
    expect(notify).toHaveBeenCalledWith(main.key, expect.any(String));
    const detail = await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true });
    expect(detail?.session.messages).toHaveLength(1);
    expect(detail?.session.messages[0]).toMatchObject({ role: 'assistant', startsNewBubble: true,
      metadata: { turnOutcome: { deliverables: [{ artifactId: outcome.deliverables[0]!.artifactId,
        availability: 'available', uri: outcome.deliverables[0]!.uri }] } } });
    expect(JSON.stringify(detail)).not.toContain('/private/worker/secret.png');
    const decide = vi.fn();
    const submitAndConfirm = vi.fn();
    await new TaskMainUpdateDelivery().drain({ isAvailable: () => false, decide, submitAndConfirm });
    expect(decide).not.toHaveBeenCalled();
    expect(submitAndConfirm).not.toHaveBeenCalled();
    expect(isMediaUriReferencedByLiveSession(outcome.deliverables[0]!.uri!)).toBe(true);
    const context = buildSessionContextForLlm(loadTranscriptRowsForSession(main.key));
    expect(context).toHaveLength(1);
    expect(JSON.stringify(context)).toContain(outcome.deliverables[0]!.artifactId);
    expect(JSON.stringify(context)).not.toContain('UNTRUSTED_LONG_WORKER_INSTRUCTIONS');
  });

  it('delivers a text report directly without asking the main model to summarize it', async () => {
    const { main, coordinator, runId } = task();
    const outcome = await image(runId);
    outcome.deliverables = [];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Report ready', assistantText: '## Findings\n\nA useful report.' });
    expect(await new TaskResultDeliveryService().drain(vi.fn())).toBe(1);
    const detail = await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true });
    expect(JSON.stringify(detail?.session.messages)).toContain('A useful report.');
    expect((detail?.session.messages[0] as unknown as ClientHistoryMessage)?.metadata?.turnOutcome?.status).toBe('succeeded');
    const decide = vi.fn();
    await new TaskMainUpdateDelivery().drain({ isAvailable: () => true, decide, submitAndConfirm: vi.fn() });
    expect(decide).not.toHaveBeenCalled();
  });

  it('preserves long report text, summary and title through delivery to the main transcript', async () => {
    const { main, coordinator, runId } = task();
    const outcome = await image(runId);
    outcome.deliverables = [];
    const summary = `Summary start ${'details '.repeat(500)} Summary end`;
    const report = `# Report start\n${'Detailed findings.\n'.repeat(600)}\n## Report end`;
    const title = 'Long task title '.repeat(30);
    getSqliteDatabase().prepare('UPDATE tasks SET title = ? WHERE task_id = (SELECT task_id FROM task_runs WHERE run_id = ?)').run(title, runId);
    coordinator.captureOutcome({ ...outcome, summary });
    coordinator.finalize({ status: 'succeeded', summary, assistantText: report });
    const row = getSqliteDatabase().prepare('SELECT payload_json FROM task_result_deliveries WHERE task_run_id = ?')
      .get(runId) as { payload_json: string };
    const delivery = JSON.parse(row.payload_json);
    expect(delivery.text).toBe(report);
    expect(delivery.outcome.summary).toBe(summary);
    expect(delivery.taskTitle).toBe(title);
    expect(await new TaskResultDeliveryService().drain(vi.fn())).toBe(1);
    const detail = await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true });
    const message = detail?.session.messages[0] as unknown as ClientHistoryMessage;
    expect(JSON.stringify(message)).toContain('Report end');
    expect(message.metadata?.turnOutcome?.summary).toBe(summary);
  });

  it.each([
    { label: 'undefined', summaryFields: { summary: undefined } },
    { label: 'omitted', summaryFields: {} },
    { label: 'long', summaryFields: { summary: 'x'.repeat(2_100) } },
  ])('captures and delivers a successful text outcome with a $label summary', async ({ summaryFields }) => {
    const { main, coordinator, runId } = task();
    const outcome: TurnOutcome = {
      version: 1, outcomeId: `outcome:${runId}`, runId, turnId: runId, status: 'succeeded',
      deliverables: [], evidence: [], createdAt: new Date().toISOString(), ...summaryFields,
    };
    coordinator.captureOutcome(outcome);
    const row = getSqliteDatabase().prepare('SELECT outcome_json FROM task_run_outcomes WHERE task_run_id = ?')
      .get(runId) as { outcome_json: string };
    expect(JSON.parse(row.outcome_json).summary).toBe(summaryFields.summary);
    coordinator.finalize({ status: 'succeeded', summary: 'Report ready', assistantText: 'A useful news report.' });
    expect(await new TaskResultDeliveryService().drain(vi.fn())).toBe(1);
    const detail = await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true });
    expect(JSON.stringify(detail?.session.messages)).toContain('A useful news report.');
    expect((detail?.session.messages[0] as unknown as ClientHistoryMessage)?.metadata?.turnOutcome?.status).toBe('succeeded');
  });

  it('recovers after restart and retries a failed push without duplicate transcript rows', async () => {
    const { main, coordinator, runId } = task();
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Ready' });
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    await new TaskResultDeliveryService().drain(() => { throw new Error('Disconnected'); });
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(1);
    getSqliteDatabase().prepare('UPDATE task_result_deliveries SET next_attempt_at = 0').run();
    expect(await new TaskResultDeliveryService().drain(vi.fn())).toBe(1);
    expect(await new TaskResultDeliveryService().drain(vi.fn())).toBe(0);
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(1);
  });

  it('collects multiple worker rounds and marks unpublished or missing files unavailable', async () => {
    const { main, coordinator, runId } = task();
    const first = await image(runId, ':first');
    const second = await image(runId, ':second');
    second.deliverables.push({ artifactId: 'not-published', title: 'draft.pdf', kind: 'pdf',
      availability: 'available', location: 'workspace', uri: 'file:///private/draft.pdf', capabilities: ['download'] });
    coordinator.captureOutcome(first);
    coordinator.captureOutcome(second);
    coordinator.finalize({ status: 'succeeded', summary: 'Ready' });
    await new TaskResultDeliveryService().drain(vi.fn());
    const detail = await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true });
    expect((detail?.session.messages[0] as unknown as ClientHistoryMessage)?.metadata?.turnOutcome).toMatchObject({ status: 'partial',
      deliverables: [{ artifactId: first.deliverables[0]!.artifactId },
        { artifactId: second.deliverables[0]!.artifactId }, { artifactId: 'not-published', availability: 'failed', capabilities: [] }] });
  });

  it('drops queued results from a superseded assignment and never recreates deleted conversations', async () => {
    const { main, taskId, coordinator, runId } = task();
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Ready' });
    getSqliteDatabase().prepare('UPDATE task_conversation_state SET assignment_epoch = assignment_epoch + 1 WHERE task_id = ?').run(taskId);
    expect(await new TaskResultDeliveryService().drain(vi.fn())).toBe(0);
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(0);
    getSqliteDatabase().prepare('DELETE FROM sessions WHERE conversation_id = ?').run(main.key);
    expect(new TaskResultDeliveryRepository().pending()).toHaveLength(0);
    expect(await new TaskResultDeliveryService().drain(vi.fn())).toBe(0);
  });

  it('delivers to the active transcript after reset and serves only scoped media through authenticated Gateway', async () => {
    const { main, coordinator, runId } = task();
    markPersonal(main.key);
    const outcome = await image(runId);
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Ready' });
    const reset = resetSessionRecord(main.key, stateDir)!;
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async () => 'Here is the image you requested.').drain(vi.fn());
    const db = getSqliteDatabase();
    expect(db.prepare('SELECT transcript_id FROM transcript_entries WHERE role = ?').all('custom'))
      .toEqual([{ transcript_id: reset.transcriptId }, { transcript_id: reset.transcriptId }]);
    const store = new SessionStore(stateDir);
    const token = 'task-result-test-auth-token';
    const app = createHonoApp({ service: {
      currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
      getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
      isGatewayReady: () => true, getExtensionLoader: () => null,
      sessionIndexInstance: store,
      sessions: { getMessagePage: store.getMessagePage.bind(store), getSession: store.get.bind(store) },
    } as unknown as GatewayService });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP address');
      const base = `http://127.0.0.1:${address.port}`;
      const headers = { Authorization: `Bearer ${token}` };
      const history = await fetch(`${base}/api/sessions/${main.key}/history?view=compact`, { headers });
      expect(history.status).toBe(200);
      const historyBody = await history.json();
      expect(historyBody.session.messages[0]).toMatchObject({ startsNewBubble: true,
        metadata: { taskResultDelivery: { taskRunId: runId }, turnOutcome: { deliverables: [{ kind: 'image' }] } } });
      expect(historyBody.session.messages[1]).toMatchObject({ content: 'Here is the image you requested.', startsNewBubble: true,
        metadata: { taskResultDelivery: { deliveryId: expect.stringMatching(/^reply:/) }, turnOutcome: { deliverables: [] } } });
      const query = `/api/media/read?uri=${encodeURIComponent(outcome.deliverables[0]!.uri!)}&conversationId=`;
      expect((await fetch(base + query + main.key)).status).toBe(401);
      const media = await fetch(base + query + main.key, { headers });
      expect(media.status).toBe(200);
      expect(await media.text()).toBe('published-image');
      const unrelated = createConversation({ agentId: 'other' });
      expect((await fetch(base + query + unrelated.key, { headers })).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('does not show a queued success after the user cancels its task', async () => {
    const { main, taskId, coordinator, runId } = task();
    coordinator.captureOutcome(await image(runId));
    coordinator.finalize({ status: 'succeeded', summary: 'Ready' });
    getSqliteDatabase().prepare("UPDATE tasks SET phase = 'closed', resolution = 'cancelled' WHERE task_id = ?").run(taskId);
    expect(await new TaskResultDeliveryService().drain(vi.fn())).toBe(0);
    expect(loadTranscriptRowsForSession(main.key)).toHaveLength(0);
  });
});
