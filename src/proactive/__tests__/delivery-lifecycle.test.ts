import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertConnectorConnection, upsertConnectorSyncPolicy, upsertKnowledgeSourceItems } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ProjectService } from '../../projects/index.js';
import { NotificationService } from '../../notifications/service.js';
import { recheckNotificationDelivery } from '../../notifications/proactive-policy.js';
import { drainChannelNotifications } from '../../notifications/proactive-channel.js';
import { prepareBrowserPush, registerBrowserPush, drainBrowserPush, testBrowserPush, acknowledgeBrowserProbe, listBrowserProbes } from '../../notifications/web-push.js';
import type { WorkflowRunService } from '../../workflows/service/workflow-run-service.js';
import { createControlledSubscription, updateControlledSubscription } from '../scenarios/control.js';
import { ProactiveScenarioService } from '../scenarios/service.js';
import { ProactiveEventService } from '../service.js';
import { ProactiveWorker } from '../execution/worker.js';
import { ProactiveInboxService } from '../inbox/service.js';
import { cardChanges, getCard, listCards, performCardAction } from '../inbox/cards.js';
import { deliverProactiveCard } from '../inbox/delivery.js';
import { digestCards, flushDueDigests, nextDigestTime } from '../inbox/digest.js';
import { recordDecision, transitionInboxItem, getInboxItem } from '../inbox/repository.js';
import { reconcileCards } from '../inbox/lifecycle.js';
import { proactivePreferences, updateProactivePreferences } from '../policy/service.js';
import { recordProactivePresence } from '../policy/presence.js';
import { scanDueProjects } from '../temporal/schedule.js';
import { ProactiveTemporalWorker } from '../temporal/worker.js';
import { previewSubscription } from '../scenarios/preview.js';
import { proactiveMetrics } from '../metrics.js';
import { prepareCardWorkflow } from '../actions/workflow.js';

describe('proactive delivery and lifecycle', () => {
  let dir: string;
  const events = () => new ProactiveEventService(() => new ProactiveScenarioService().routes());
  const notifications = () => new NotificationService({ publish: vi.fn() });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    dir = mkdtempSync(join(tmpdir(), 'xopc-proactive-p2-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    updateProactivePreferences('default', { expectedRevision: 0, timezone: 'UTC', quietStartHour: 0, quietEndHour: 0 });
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { force: true, recursive: true }); vi.useRealTimers(); });
  const candidate = (evidenceIds: string[], action = false) => ({ title: 'Review commitment', summary: 'Private customer scope changed', whyNow: 'A relevant deadline changed', impact: 'Delivery', recommendation: 'Review scope', workDone: 'Checked evidence', urgency: 'high', confidence: .95, evidenceIds,
    ...(action ? { decision: { question: 'Create task?', options: [{ id: 'approve', label: 'Create', consequence: 'A task is created' }, { id: 'reject', label: 'Skip', consequence: 'No task' }] }, proposedAction: { id: 'create_project_task', risk: 'low', rationale: 'Explicit follow-up', input: { title: 'Review commitment', objective: 'Review the delivery commitment.' } } } : {}) });
  async function projectCard(projectId?: string, scenarioKey = 'project_delivery_risk', action = false) {
    const project = projectId ?? new ProjectService().create({ name: 'Launch' }).id;
    const sub = createControlledSubscription('default', { scenarioKey, scopeKind: 'project', scopeId: project, delivery: 'important' });
    const source = events(); scanDueProjects(source); source.markReadyBatches(new Date(Date.now() + 600000));
    await new ProactiveWorker({ execute: async () => ({ text: JSON.stringify(candidate([`project:${project}`], action)), usage: { inputTokens: 100, outputTokens: 20, estimatedCostUsd: .01 } }) }).tick();
    new ProactiveInboxService().project(); reconcileCards();
    const card = listCards('default').cards.find((item) => item.subscriptionId === sub.id)!;
    expect(card).toBeDefined(); return { card, sub, project };
  }
  const sendCard = (id: string, service = notifications()) => deliverProactiveCard(getInboxItem(id)!, service, vi.fn());
  const subscription = (suffix = 'first') => ({ subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`, keys: { auth: 'a'.repeat(22), p256dh: 'a'.repeat(87) } } });

  it('combines quiet-hour alerts into one durable digest after restart and excludes resolved cards', async () => {
    const first = await projectCard(); const second = await projectCard(); const third = await projectCard();
    updateProactivePreferences('default', { expectedRevision: 1, quietStartHour: 22, quietEndHour: 8 });
    vi.setSystemTime(new Date('2026-09-12T23:00:00Z'));
    sendCard(first.card.id); sendCard(second.card.id); sendCard(third.card.id);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM notification_events').get()).toMatchObject({ n: 0 });
    performCardAction(third.card.id, 'default', { actionId: 'resolve', expectedRevision: getCard(third.card.id, 'default').revision, idempotencyKey: 'resolve-third-card' });
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    vi.setSystemTime(new Date('2026-09-13T08:00:00Z'));
    const service = notifications();
    const result = flushDueDigests((plan) => service.persistPlan(plan));
    expect(result).toHaveLength(1);
    expect(result[0]!.target.kind).toBe('proactive_digest');
    const id = (result[0]!.target as { digestId: string }).digestId;
    expect(digestCards(id, 'default')).toHaveLength(2);
    expect(() => digestCards(id, 'other')).toThrow('not found');
    expect(flushDueDigests((plan) => service.persistPlan(plan))).toEqual([]);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM proactive_notification_budget').get()).toMatchObject({ n: 1 });
  });
  it('allows an explicit daily digest at quiet proactive level and respects local DST', async () => {
    const { card, sub } = await projectCard();
    updateControlledSubscription('default', sub.id, { expectedRevision: sub.revision, delivery: 'digest', level: 'quiet' });
    sendCard(card.id);
    expect(flushDueDigests((plan) => notifications().persistPlan(plan))).toEqual([]);
    vi.setSystemTime(new Date('2026-09-12T18:00:00Z'));
    expect(flushDueDigests((plan) => notifications().persistPlan(plan))).toHaveLength(1);
    const preferences = { ...proactivePreferences('default'), timezone: 'America/New_York', digestHour: 2, digestMinute: 30 };
    expect(nextDigestTime(preferences, new Date('2026-03-08T06:00:00Z')).toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });
  it('suppresses duplicate cross-template alerts and creates one shared action result', async () => {
    const first = await projectCard(undefined, 'project_delivery_risk', true);
    const second = await projectCard(first.project, 'blocked_work', true);
    expect(getCard(first.card.id, 'default').relatedCardIds).toContain(second.card.id);
    sendCard(first.card.id); sendCard(second.card.id);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM notification_events').get()).toMatchObject({ n: 1 });
    for (const id of [first.card.id, second.card.id]) performCardAction(id, 'default', { actionId: 'decide', choice: 'approve', expectedRevision: getCard(id, 'default').revision, idempotencyKey: `approve-${id}` });
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?').get(first.project)).toMatchObject({ n: 1 });
  });
  it('uses one browser in automatic mode and cancels a queued alert while the cards are visible', async () => {
    const { card } = await projectCard(); prepareBrowserPush();
    registerBrowserPush('default', subscription('one')); registerBrowserPush('default', subscription('two'));
    updateProactivePreferences('default', { expectedRevision: 1, preferredChannel: 'auto' });
    sendCard(card.id);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM proactive_web_push_deliveries').get()).toMatchObject({ n: 1 });
    recordProactivePresence('default', { clientId: 'visible-browser', active: true, surface: 'web' });
    const send = vi.fn(async () => ({ statusCode: 201, headers: {}, body: '' }));
    await drainBrowserPush(send); expect(send).not.toHaveBeenCalled();
  });
  it('uses the Telegram adapter with a private-safe link and stores the actual provider receipt', async () => {
    const { card } = await projectCard();
    updateProactivePreferences('default', { expectedRevision: 1, preferredChannel: 'telegram', telegram: { chatId: '123456', publicUrl: 'https://console.example.test/' } });
    sendCard(card.id);
    const send = vi.fn(async () => ({ messageId: 'provider-receipt-42' }));
    await drainChannelNotifications(send);
    expect(send).toHaveBeenCalledOnce();
    const args = send.mock.calls[0] as unknown as [unknown, string];
    expect(args[1]).toContain(card.id); expect(args[1]).not.toContain('Private customer');
    expect(getSqliteDatabase().prepare('SELECT status, provider_message_id FROM proactive_channel_deliveries').get()).toMatchObject({ status: 'sent', provider_message_id: 'provider-receipt-42' });
  });
  it('withdraws disconnected source cards permanently and emits a tombstone', async () => {
    upsertConnectorConnection({ id: 'calendar', connectorId: 'googlecalendar', provider: 'composio', principalId: 'local-owner', providerConnectionId: 'test', identity: {}, status: 'active', isDefault: true, metadata: {} });
    upsertConnectorSyncPolicy({ accountId: 'account:calendar', scanEnabled: true, proactiveEnabled: true });
    createControlledSubscription('default', { scenarioKey: 'meeting_preparation', scopeKind: 'workspace', scopeId: 'default', delivery: 'important' });
    upsertKnowledgeSourceItems([{ sourceInstanceId: 'calendar', collectionScope: 'events', externalId: 'meeting', itemType: 'calendar_event', occurredAt: '2026-09-12T13:00:00Z', contentHash: 'one', normalizedText: 'Private meeting', metadata: { workspaceId: 'default', connectionId: 'calendar', connectorId: 'googlecalendar' }, sensitivity: 'personal', retentionClass: 'bounded', synthesisPipeline: 'connected_knowledge', synthesisStatus: 'pending' }]);
    const source = events(); await new ProactiveTemporalWorker(source).tick(); source.markReadyBatches(new Date(Date.now() + 600000));
    await new ProactiveWorker({ execute: async () => ({ text: JSON.stringify(candidate([source.listEvents()[0]!.id])) }) }).tick();
    new ProactiveInboxService().project();
    const card = listCards('default').cards[0]!;
    prepareBrowserPush(); registerBrowserPush('default', subscription()); sendCard(card.id);
    const cursor = cardChanges('default').nextCursor;
    getSqliteDatabase().prepare("UPDATE connector_connections SET status = 'revoked' WHERE id = 'calendar'").run();
    expect(reconcileCards()).toBe(1);
    expect(cardChanges('default', cursor).items).toContainEqual({ id: card.id, deleted: true });
    expect(getCard(card.id, 'default').summary).toBe('');
    getSqliteDatabase().prepare("UPDATE connector_connections SET status = 'active' WHERE id = 'calendar'").run();
    expect(getCard(card.id, 'default').status).toBe('withdrawn');
    expect(listCards('default').cards).toEqual([]);
    expect(() => transitionInboxItem(card.id, { status: 'read' })).toThrow('not found');
    expect(() => recordDecision(card.id, 'approve')).toThrow('not found');
    expect(getSqliteDatabase().prepare('SELECT status FROM proactive_web_push_deliveries').get()).toMatchObject({ status: 'failed' });
    expect(getSqliteDatabase().prepare('SELECT title_en, body_en FROM notification_events').get()).toMatchObject({ title_en: 'Update withdrawn', body_en: null });
  });
  it('previews existing evidence without creating runs, cards or deliveries and rate limits it', async () => {
    const { sub } = await projectCard();
    const executor = { execute: vi.fn(async () => ({ text: '{"result":"no_insight","reason":"routine"}' })) };
    const before = listCards('default').cards.length;
    expect((await previewSubscription('default', sub.id, executor)).result.result).toBe('no_insight');
    expect(listCards('default').cards).toHaveLength(before);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM notification_events').get()).toMatchObject({ n: 0 });
    await expect(previewSubscription('default', sub.id, executor)).rejects.toThrow('five minutes');
    expect(executor.execute).toHaveBeenCalledOnce();
  });
  it('starts a configured workflow once and exposes its live run state', async () => {
    const { card, sub } = await projectCard();
    updateControlledSubscription('default', sub.id, { expectedRevision: sub.revision, preparationWorkflowId: 'prepare-checklist' });
    const start = vi.fn(async () => ({ ok: true, runId: 'workflow-1', sessionKey: 'workflow/session' }));
    const workflows = { startWorkflowRun: start, createRunStore: () => ({ readRunView: async () => ({ run: { status: 'running' } }) }) } as unknown as WorkflowRunService;
    const value = { expectedRevision: getCard(card.id, 'default').revision };
    expect(await prepareCardWorkflow('default', card.id, value, 'main', workflows)).toMatchObject({ runId: 'workflow-1', status: 'running' });
    await prepareCardWorkflow('default', card.id, value, 'main', workflows);
    expect(start).toHaveBeenCalledOnce();
    expect((start.mock.calls as unknown[][])[0]?.[0]).not.toHaveProperty('maxSubagents');
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ preparationOnly: true, writebackPolicy: { targets: [] } }));
  });
  it('separates provider acceptance from opening a browser test notification', async () => {
    prepareBrowserPush(); const { id } = registerBrowserPush('default', subscription());
    const send = vi.fn(async () => ({ statusCode: 201, headers: {}, body: '' }));
    const probe = await testBrowserPush('default', id, send);
    expect(listBrowserProbes('default')[0]).toMatchObject({ status: 'accepted', openedAt: null });
    acknowledgeBrowserProbe('other', probe.id);
    expect(listBrowserProbes('default')[0]).toMatchObject({ status: 'accepted' });
    acknowledgeBrowserProbe('default', probe.id);
    expect(listBrowserProbes('default')[0]).toMatchObject({ status: 'opened' });
  });
  it('reports measured usage and feedback rather than inventing model costs', async () => {
    const { card } = await projectCard();
    performCardAction(card.id, 'default', { actionId: 'useful', expectedRevision: getCard(card.id, 'default').revision, idempotencyKey: 'useful-card-feedback' });
    expect(proactiveMetrics('default').usage).toMatchObject({ inputTokens: 100, outputTokens: 20, estimatedCostUsd: .01, pricedRuns: 1 });
    expect(proactiveMetrics('default').feedback).toContainEqual({ rating: 'useful', count: 1 });
    performCardAction(card.id, 'default', { actionId: 'not_useful', expectedRevision: getCard(card.id, 'default').revision, idempotencyKey: 'changed-feedback' });
    expect(proactiveMetrics('default').feedback).toEqual([{ rating: 'not_useful', count: 1 }]);
  });
  it('preserves omitted preference and subscription fields on partial updates', async () => {
    const { sub } = await projectCard();
    const preferences = updateProactivePreferences('default', { expectedRevision: 1, digestEnabled: true });
    expect(preferences).toMatchObject({ timezone: 'UTC', quietStartHour: 0, quietEndHour: 0, digestEnabled: true });
    const edited = updateControlledSubscription('default', sub.id, { expectedRevision: sub.revision, level: 'active', userInstructions: 'Focus on delivery' });
    const updated = updateControlledSubscription('default', sub.id, { expectedRevision: edited.revision, preparationWorkflowId: 'checklist' });
    expect(updated).toMatchObject({ level: 'active', userInstructions: 'Focus on delivery' });
  });
  it('rolls back digest membership and budget if notification persistence fails', async () => {
    const { card } = await projectCard();
    updateProactivePreferences('default', { expectedRevision: 1, digestEnabled: true });
    sendCard(card.id); vi.setSystemTime(new Date('2026-09-12T18:00:00Z'));
    expect(() => flushDueDigests(() => { throw new Error('disk write failed'); })).toThrow('disk write failed');
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM proactive_notification_budget').get()).toMatchObject({ n: 0 });
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM proactive_digests').get()).toMatchObject({ n: 0 });
    expect(flushDueDigests((plan) => notifications().persistPlan(plan))).toHaveLength(1);
  });
  it('reschedules queued daily summaries when the user changes the digest time', async () => {
    const { card } = await projectCard();
    updateProactivePreferences('default', { expectedRevision: 1, digestEnabled: true }); sendCard(card.id);
    updateProactivePreferences('default', { expectedRevision: 2, digestHour: 20 });
    vi.setSystemTime(new Date('2026-09-12T18:00:00Z'));
    expect(flushDueDigests((plan) => notifications().persistPlan(plan))).toEqual([]);
    vi.setSystemTime(new Date('2026-09-12T20:00:00Z'));
    expect(flushDueDigests((plan) => notifications().persistPlan(plan))).toHaveLength(1);
  });
  it('cancels daily digest delivery after the user disables summaries', async () => {
    const { card } = await projectCard();
    updateProactivePreferences('default', { expectedRevision: 1, digestEnabled: true });
    sendCard(card.id); vi.setSystemTime(new Date('2026-09-12T18:00:00Z'));
    const [notification] = flushDueDigests((plan) => notifications().persistPlan(plan));
    updateProactivePreferences('default', { expectedRevision: 2, digestEnabled: false });
    expect(recheckNotificationDelivery(notification!, 'browser')).toBe('cancel');
  });
  it('only retries a preparation run after a real terminal failure', async () => {
    const { card, sub } = await projectCard();
    updateControlledSubscription('default', sub.id, { expectedRevision: sub.revision, preparationWorkflowId: 'prepare-checklist' });
    let status = 'running';
    const start = vi.fn(async () => ({ ok: true, runId: 'workflow-1', sessionKey: 'workflow/session' }));
    const workflows = { startWorkflowRun: start, createRunStore: () => ({ readRunView: async () => ({ run: { status } }) }) } as unknown as WorkflowRunService;
    const value = { expectedRevision: getCard(card.id, 'default').revision };
    await prepareCardWorkflow('default', card.id, value, 'main', workflows);
    await expect(prepareCardWorkflow('default', card.id, { ...value, retry: true }, 'main', workflows)).rejects.toThrow('Only failed');
    expect(start).toHaveBeenCalledOnce();
    status = 'failed';
    await prepareCardWorkflow('default', card.id, { ...value, retry: true }, 'main', workflows);
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ retryOfRunId: 'workflow-1', preparationOnly: true }));
  });

});
