import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ProjectService } from '../../projects/index.js';
import { allowedPushEndpoint, prepareBrowserPush, registerBrowserPush, drainBrowserPush } from '../../notifications/web-push.js';
import { NotificationService } from '../../notifications/service.js';
import { ProactiveScenarioService } from '../scenarios/service.js';
import { createControlledSubscription, updateControlledSubscription } from '../scenarios/control.js';
import { effectiveProactivePolicy, proactivePreferences, subscriptionSettings, quietHoursEnd, reserveProactiveNotification, updateProactivePreferences } from '../policy/service.js';
import { ProactiveEventService } from '../service.js';
import { ProactiveWorker } from '../execution/worker.js';
import { parseAnalysisResult } from '../execution/insight.js';
import { listCards, performCardAction } from '../inbox/cards.js';
import { ProactiveInboxService } from '../inbox/service.js';
import { getInboxItem } from '../inbox/repository.js';
import { deliverProactiveCard } from '../inbox/delivery.js';
import { scanDueProjects } from '../temporal/schedule.js';

describe('proactive user controls', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-proactive-controls-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });

  function subscribe() {
    const project = new ProjectService().create({ name: 'Launch' });
    return createControlledSubscription('default', { scenarioKey: 'project_delivery_risk', scopeKind: 'project', scopeId: project.id, delivery: 'inbox' });
  }
  async function createCard() {
    const sub = subscribe();
    const events = new ProactiveEventService(() => new ProactiveScenarioService().routes());
    scanDueProjects(events);
    events.markReadyBatches(new Date(Date.now() + 600000));
    const id = events.listEvents()[0]!.id;
    await new ProactiveWorker({ execute: async () => ({ text: JSON.stringify({ title: 'Review launch', summary: 'An upcoming commitment needs review.', whyNow: 'The project changed.', impact: 'Launch preparation', recommendation: 'Review scope', workDone: 'Checked project', urgency: 'high', confidence: .9, evidenceIds: [id] }) }) }).tick();
    new ProactiveInboxService().project();
    return { sub, card: listCards('default').cards[0]! };
  }
  it('accepts honest no-findings without requiring fabricated evidence or insight fields', () => {
    expect(parseAnalysisResult('{"result":"no_insight","reason":"unchanged"}', new Set())).toEqual({ result: 'no_insight', reason: 'unchanged' });
    expect(() => parseAnalysisResult('{"result":"no_insight","reason":"unchanged","title":"invented"}', new Set())).toThrow();
  });
  it('persists user settings, uses explicit revisions and keeps global off authoritative', () => {
    const sub = subscribe();
    const prefs = proactivePreferences('default');
    updateProactivePreferences('default', { expectedRevision: prefs.revision, level: 'off' });
    updateControlledSubscription('default', sub.id, { expectedRevision: 1, level: 'active' });
    expect(effectiveProactivePolicy(sub.id).enabled).toBe(false);
    expect(() => updateControlledSubscription('default', sub.id, { expectedRevision: 1, level: 'quiet' })).toThrow('changed');
    expect(() => updateProactivePreferences('default', { expectedRevision: 1, timezone: 'not/a/zone' })).toThrow();
    expect(() => updateControlledSubscription('other', sub.id, { expectedRevision: 2, enabled: false })).toThrow('not found');
  });
  it('emits one durable scan on due changes, skips unchanged input, and respects disabling', () => {
    const sub = subscribe();
    const events = new ProactiveEventService(() => new ProactiveScenarioService().routes());
    const now = new Date();
    expect(scanDueProjects(events, now)).toBe(1);
    expect(scanDueProjects(events, now)).toBe(0);
    expect(scanDueProjects(events, new Date(now.getTime() + 180 * 60000))).toBe(0);
    updateControlledSubscription('default', sub.id, { expectedRevision: 1, enabled: false });
    expect(scanDueProjects(events, new Date(now.getTime() + 86400000))).toBe(0);
  });
  it('quiet cards remain visible and actions reject stale revisions and replay safely', async () => {
    const { card } = await createCard();
    expect(card).toBeDefined();
    expect(listCards('other').cards).toEqual([]);
    const action = { actionId: 'read', expectedRevision: card.revision, idempotencyKey: 'read-card-key' };
    const read = performCardAction(card.id, 'default', action);
    expect(read.status).toBe('read');
    expect(read.revision).toBeGreaterThan(card.revision);
    expect(performCardAction(card.id, 'default', action).status).toBe('read');
    expect(() => performCardAction(card.id, 'default', { ...action, idempotencyKey: 'different-key', actionId: 'resolve' })).toThrow('changed');
    expect(() => performCardAction(card.id, 'other', action)).toThrow('not found');
  });
  it('shares one atomic daily interruption budget and does not charge retry reservations twice', () => {
    const sub = subscribe();
    updateControlledSubscription('default', sub.id, { expectedRevision: 1, delivery: 'important' });
    updateProactivePreferences('default', { expectedRevision: 0, timezone: 'UTC', quietStartHour: 0, quietEndHour: 0, dailyNotificationLimit: 1 });
    const now = new Date('2026-09-12T12:00:00Z');
    expect(reserveProactiveNotification(sub.id, 'first', now)).toBe('allowed');
    expect(reserveProactiveNotification(sub.id, 'first', now)).toBe('allowed');
    expect(reserveProactiveNotification(sub.id, 'second', now)).toBe('suppressed');
  });
  it('does not acknowledge persistence failure and rolls back its notification reservation', async () => {
    const { card, sub } = await createCard();
    updateControlledSubscription('default', sub.id, { expectedRevision: 1, delivery: 'important' });
    updateProactivePreferences('default', { expectedRevision: 0, quietStartHour: 0, quietEndHour: 0 });
    const notifications = new NotificationService({ publish: vi.fn() });
    vi.spyOn(notifications, 'persistGatewayEvent').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => deliverProactiveCard(getInboxItem(card.id)!, notifications, vi.fn())).toThrow('disk full');
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM proactive_notification_budget').get()).toMatchObject({ n: 0 });
  });
  it('discards a result if the user disables its subscription while analysis is running', async () => {
    const sub = subscribe();
    const events = new ProactiveEventService(() => new ProactiveScenarioService().routes());
    scanDueProjects(events); events.markReadyBatches(new Date(Date.now() + 600000));
    await new ProactiveWorker({ execute: async () => {
      updateControlledSubscription('default', sub.id, { expectedRevision: 1, enabled: false });
      return { text: '{"result":"no_insight","reason":"routine"}' };
    } }).tick();
    expect(listCards('default').cards).toEqual([]);
    expect(getSqliteDatabase().prepare('SELECT status, outcome_reason FROM proactive_runs').get()).toMatchObject({ status: 'discarded', outcome_reason: 'disabled' });
  });
  function browserSubscription() {
    return { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { auth: 'a'.repeat(22), p256dh: 'a'.repeat(87) } }, language: 'en' };
  }
  async function queuedBrowserCard() {
    const result = await createCard();
    updateControlledSubscription('default', result.sub.id, { expectedRevision: 1, delivery: 'important' });
    updateProactivePreferences('default', { expectedRevision: 0, quietStartHour: 0, quietEndHour: 0 });
    prepareBrowserPush(); registerBrowserPush('default', browserSubscription());
    deliverProactiveCard(getInboxItem(result.card.id)!, new NotificationService({ publish: vi.fn() }), vi.fn());
    return result;
  }
  it('only accepts known HTTPS push services and binds subscriptions to their workspace', () => {
    for (const endpoint of ['http://fcm.googleapis.com/push', 'https://localhost/push', 'https://fcm.googleapis.com.evil.test/push', 'https://user@fcm.googleapis.com/push', 'https://fcm.googleapis.com:8080/push']) expect(allowedPushEndpoint(endpoint)).toBe(false);
    expect(allowedPushEndpoint(browserSubscription().subscription.endpoint)).toBe(true);
    const key = prepareBrowserPush();
    expect(prepareBrowserPush()).toEqual(key);
    expect(Object.keys(key)).toEqual(['publicKey']);
    const first = registerBrowserPush('default', browserSubscription());
    expect(registerBrowserPush('default', browserSubscription())).toEqual(first);
    expect(() => registerBrowserPush('other', browserSubscription())).toThrow('another workspace');
    expect(() => registerBrowserPush('default', { ...browserSubscription(), subscription: { endpoint: 'https://localhost/private' } })).toThrow();
  });
  it('leases browser deliveries once, sends private-safe content, and persists completion', async () => {
    const { card } = await queuedBrowserCard();
    const send = vi.fn(async () => ({ statusCode: 201, headers: {}, body: '' }));
    await Promise.all([drainBrowserPush(send), drainBrowserPush(send)]);
    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0] as unknown as [unknown, string];
    const payload = JSON.parse(call[1]);
    expect(payload.route).toContain(card.id);
    expect(call[1]).not.toContain('upcoming commitment');
    expect(getSqliteDatabase().prepare('SELECT status, attempt FROM proactive_web_push_deliveries').get()).toMatchObject({ status: 'sent', attempt: 1 });
    await drainBrowserPush(send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('retries temporary push errors and removes expired browser subscriptions', async () => {
    await queuedBrowserCard();
    const send = vi.fn(async () => { throw Object.assign(new Error('unavailable'), { statusCode: 503 }); });
    await drainBrowserPush(send);
    expect(getSqliteDatabase().prepare('SELECT status, attempt FROM proactive_web_push_deliveries').get()).toMatchObject({ status: 'pending', attempt: 1 });
    getSqliteDatabase().prepare('UPDATE proactive_web_push_deliveries SET next_attempt_at = 0').run();
    await drainBrowserPush(async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM proactive_web_push_subscriptions').get()).toMatchObject({ n: 0 });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM proactive_web_push_deliveries').get()).toMatchObject({ n: 0 });
  });
  it('cancels browser delivery after a policy change or newer notification revision', async () => {
    const { card } = await queuedBrowserCard();
    const send = vi.fn(async () => ({ statusCode: 201, headers: {}, body: '' }));
    getSqliteDatabase().prepare('UPDATE proactive_inbox_items SET notification_revision = notification_revision + 1 WHERE inbox_item_id = ?').run(card.id);
    await drainBrowserPush(send);
    expect(send).not.toHaveBeenCalled();
    expect(getSqliteDatabase().prepare('SELECT status FROM proactive_web_push_deliveries').get()).toMatchObject({ status: 'failed' });
    getSqliteDatabase().prepare("UPDATE proactive_web_push_deliveries SET notification_revision = 2, status = 'pending', next_attempt_at = 0").run();
    updateProactivePreferences('default', { expectedRevision: 1, level: 'off' });
    await drainBrowserPush(send);
    expect(send).not.toHaveBeenCalled();
  });

  it('records no-findings as a completed check with the original policy revision', async () => {
    subscribe();
    const events = new ProactiveEventService(() => new ProactiveScenarioService().routes());
    scanDueProjects(events); events.markReadyBatches(new Date(Date.now() + 600000));
    await new ProactiveWorker({ execute: async () => {
      updateProactivePreferences('default', { expectedRevision: 0, dailyNotificationLimit: 2 });
      return { text: '{"result":"no_insight","reason":"unchanged"}' };
    } }).tick();
    expect(getSqliteDatabase().prepare('SELECT status, outcome_reason, policy_revision, subscription_revision FROM proactive_runs').get()).toMatchObject({ status: 'completed', outcome_reason: 'unchanged', policy_revision: 0, subscription_revision: 1 });
    expect(listCards('default').cards).toEqual([]);
  });
  it('resolves quiet hours across DST jumps and repeated local hours', () => {
    const preferences = { ...proactivePreferences('default'), timezone: 'America/New_York', quietStartHour: 22, quietEndHour: 8 };
    expect(quietHoursEnd(preferences, new Date('2026-03-08T06:30:00Z'))?.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(quietHoursEnd(preferences, new Date('2026-11-01T05:30:00Z'))?.toISOString()).toBe('2026-11-01T13:00:00.000Z');
    expect(quietHoursEnd({ ...preferences, quietStartHour: 0, quietEndHour: 0 }, new Date())).toBeNull();
  });

  it('keeps legacy natural-language feedback and template settings on the same prompt revision', async () => {
    const { sub, card } = await createCard();
    new ProactiveInboxService().instruct(card.id, 'Only notify me about external commitments.');
    const settings = subscriptionSettings(sub.id);
    expect(settings.userInstructions).toContain('external commitments');
    expect(settings.revision).toBe(2);
    expect(() => updateControlledSubscription('default', sub.id, { expectedRevision: 1, userInstructions: '' })).toThrow('changed');
    const updated = updateControlledSubscription('default', sub.id, { expectedRevision: 2, userInstructions: '' });
    expect(updated.userInstructions).toBe('');
    expect(updated.revision).toBe(3);
  });

});
