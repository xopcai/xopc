import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import type { TurnOutcome } from '@xopcai/gateway-contract';
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

describe('background task result delivery', () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-result-'));
    vi.stubEnv('XOPC_STATE_DIR', stateDir);
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(stateDir, 'xopc.db'));
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function task() {
    const main = createConversation({ agentId: 'main' });
    const worker = createConversation({ agentId: 'worker' });
    const created = new TaskApplicationService().create({ idempotencyKey: `draw:${main.key}`,
      title: 'Draw sunset', locale: 'zh', priority: 'normal', originConversationId: main.key,
      contract: { objective: 'Draw sunset', expectedOutputs: ['Image'], acceptanceCriteria: [],
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
    const outcome = await image(runId);
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Ready' });
    const reset = resetSessionRecord(main.key, stateDir)!;
    await new TaskResultDeliveryService().drain(vi.fn());
    const db = getSqliteDatabase();
    expect(db.prepare('SELECT transcript_id FROM transcript_entries WHERE role = ?').all('custom'))
      .toEqual([{ transcript_id: reset.transcriptId }]);
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
      expect((await history.json()).session.messages[0]).toMatchObject({ startsNewBubble: true,
        metadata: { taskResultDelivery: { taskRunId: runId }, turnOutcome: { deliverables: [{ kind: 'image' }] } } });
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
