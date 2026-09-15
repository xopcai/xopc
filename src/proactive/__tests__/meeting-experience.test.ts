import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertConnectorConnection, upsertConnectorSyncPolicy, upsertKnowledgeSourceItems } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { delegationOverview } from '../experience.js';
import { ProactiveWorker } from '../execution/worker.js';
import { getCard } from '../inbox/cards.js';
import { reconcileCards } from '../inbox/lifecycle.js';
import { recheckProactiveNotification } from '../inbox/notification-policy.js';
import { ProactiveInboxService } from '../inbox/service.js';
import { createControlledSubscription } from '../scenarios/control.js';
import { ProactiveScenarioService } from '../scenarios/service.js';
import { ProactiveEventService } from '../service.js';
import { isMeetingWorthPreparing, ProactiveTemporalWorker } from '../temporal/worker.js';

describe('meeting preparation lifecycle', () => {
  let dir: string;
  let source: ProactiveEventService;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T08:00:00Z'));
    dir = mkdtempSync(join(tmpdir(), 'xopc-meeting-experience-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    upsertConnectorConnection({ id: 'calendar', connectorId: 'googlecalendar', provider: 'composio', principalId: 'local-owner', providerConnectionId: 'test', identity: {}, status: 'active', isDefault: true, metadata: {} });
    upsertConnectorSyncPolicy({ accountId: 'account:calendar', scanEnabled: true, proactiveEnabled: true });
    createControlledSubscription('workspace', { scenarioKey: 'meeting_preparation', scopeKind: 'workspace', scopeId: 'workspace' });
    source = new ProactiveEventService(() => new ProactiveScenarioService().routes());
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });
  function meeting(start = '2026-09-13T10:00:00Z', revision = 'one', deletedAt?: string) {
    upsertKnowledgeSourceItems([{ sourceInstanceId: 'calendar', collectionScope: 'events', externalId: 'review', itemType: 'calendar_event', occurredAt: start, contentHash: revision, normalizedText: JSON.stringify({ title: 'Customer review', start }), metadata: { workspaceId: 'workspace', connectionId: 'calendar', connectorId: 'googlecalendar' }, sensitivity: 'personal', retentionClass: 'bounded', synthesisPipeline: 'connected_knowledge', synthesisStatus: 'pending', ...(deletedAt ? { deletedAt } : {}) }]);
  }
  async function prepare(onExecute?: () => void) {
    await new ProactiveTemporalWorker(source).tick();
    source.markReadyBatches(new Date(Date.now() + 600000));
    await new ProactiveWorker({ execute: async input => {
      const items = (input.authorizedContext.connected_source as { items: Array<{ evidenceId: string }> }).items;
      onExecute?.();
      return { text: JSON.stringify({ title: 'Your review brief', summary: 'Ready for review', whyNow: 'The meeting is approaching', impact: 'Meeting preparation', recommendation: 'Review the open questions', workDone: 'Prepared a brief', urgency: 'medium', confidence: .95, evidenceIds: items.map(item => item.evidenceId), artifact: { kind: 'briefing', title: 'Review brief', content: '## Goal\nConfirm the proposal.\n## Questions\nWhat remains undecided?' } }) };
    } }).tick();
    new ProactiveInboxService().project();
  }
  it('delivers the prepared brief, invalidates rescheduled work and updates the same meeting card', async () => {
    meeting(); await prepare();
    const overview = delegationOverview('workspace');
    const first = overview.scenes.find(scene => scene.status === 'prepared')!.card!;
    expect(first.artifact?.kind).toBe('briefing');
    expect(overview.scenes).toEqual([expect.objectContaining({ kind: 'meeting_preparation', status: 'prepared', title: 'Your review brief', card: expect.objectContaining({ id: first.id }) })]);
    meeting('2026-09-13T15:00:00Z', 'two');
    expect(getCard(first.id, 'workspace').status).toBe('expired');
    expect(recheckProactiveNotification(first.id)).toBe('cancel');
    expect(delegationOverview('workspace').scenes[0]?.card).toBeNull();
    await prepare();
    const next = delegationOverview('workspace').scenes.find(scene => scene.status === 'prepared')!.card!;
    expect(next.id).toBe(first.id);
    expect(next.expiresAt).toBe('2026-09-13T15:00:00.000Z');
    expect(next.revision).toBeGreaterThan(first.revision);
  });
  it('withdraws cancelled meetings including their prepared artifact', async () => {
    meeting(); await prepare();
    const card = delegationOverview('workspace').scenes.find(scene => scene.status === 'prepared')!.card!;
    meeting('2026-09-13T10:00:00Z', 'cancelled', '2026-09-13T08:01:00Z');
    reconcileCards();
    expect(getCard(card.id, 'workspace')).toMatchObject({ status: 'withdrawn', summary: '' });
    expect(getCard(card.id, 'workspace').artifact).toBeUndefined();
    expect(recheckProactiveNotification(card.id)).toBe('cancel');
    expect((await new ProactiveTemporalWorker(source).tick()).published).toBe(0);
  });
  it('discards a brief when source contents change during preparation', async () => {
    meeting(); await prepare(() => meeting('2026-09-13T10:00:00Z', 'updated-during-run'));
    expect(delegationOverview('workspace').scenes[0]?.card).toBeNull();
    expect(getSqliteDatabase().prepare('SELECT outcome_reason FROM proactive_runs').get()).toMatchObject({ outcome_reason: 'source_changed' });
    await prepare();
    expect(delegationOverview('workspace').scenes.filter(scene => scene.status === 'prepared')).toHaveLength(1);
  });
  it('does not prepare cancelled, declined, all-day or malformed events', () => {
    for (const event of [{ title: 'Cancelled', status: 'cancelled' }, { title: 'Holiday', allDay: true }, { title: 'Declined', attendees: [{ self: true, responseStatus: 'declined' }] }, {}]) expect(isMeetingWorthPreparing(JSON.stringify(event))).toBe(false);
    expect(isMeetingWorthPreparing('invalid')).toBe(false);
    expect(isMeetingWorthPreparing(JSON.stringify({ title: 'Customer review' }))).toBe(true);
  });
});
