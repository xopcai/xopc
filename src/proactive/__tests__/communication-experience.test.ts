import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertConnectorConnection, upsertConnectorSyncPolicy, upsertKnowledgeSourceItems } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { delegationOverview } from '../experience.js';
import { ProactiveWorker } from '../execution/worker.js';
import { continueMailFollowUp, listMailFollowUps, mailFollowUpSources, scanMailFollowUps, startMailFollowUp, updateMailFollowUp } from '../follow-ups.js';
import { getCard, performCardAction } from '../inbox/cards.js';
import { recheckProactiveNotification } from '../inbox/notification-policy.js';
import { ProactiveInboxService } from '../inbox/service.js';
import { ProactiveScenarioService } from '../scenarios/service.js';
import { ProactiveEventService } from '../service.js';

describe('delegated email follow-up', () => {
  let dir: string; let events: ProactiveEventService;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T08:00:00Z'));
    dir = mkdtempSync(join(tmpdir(), 'xopc-mail-follow-up-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    ensureSessionRecord('chat:test', dir);
    for (const id of ['mail', 'other']) {
      upsertConnectorConnection({ id, connectorId: 'gmail', provider: 'composio', principalId: 'local-owner', providerConnectionId: `test-${id}`, identity: {}, status: 'active', isDefault: true, metadata: {} });
      upsertConnectorSyncPolicy({ accountId: `account:${id}`, scanEnabled: true, proactiveEnabled: true });
    }
    events = new ProactiveEventService(() => new ProactiveScenarioService().routes());
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });
  function email(externalId: string, labels: string[] = ['INBOX'], connectionId = 'mail') {
    upsertKnowledgeSourceItems([{ sourceInstanceId: connectionId, collectionScope: 'inbox', externalId, itemType: 'email', occurredAt: new Date().toISOString(), contentHash: `${externalId}-${labels.join()}`, normalizedText: JSON.stringify({ threadId: 'same-provider-id', subject: 'Confirm review', sender: 'customer@example.test', content: 'Please confirm the review date.', labels }), metadata: { workspaceId: 'workspace', connectionId, connectorId: 'gmail' }, sensitivity: 'personal', retentionClass: 'bounded', synthesisPipeline: 'connected_knowledge', synthesisStatus: 'pending' }]);
    return (getSqliteDatabase().prepare('SELECT item_id FROM knowledge_source_items WHERE external_id = ? AND source_instance_id = ?').get(externalId, connectionId) as { item_id: string }).item_id;
  }
  function start() { return startMailFollowUp('workspace', { sourceItemId: email('first'), instructions: 'Get the customer to confirm the review date.', dueAt: '2026-09-14T08:00:00Z' }); }
  async function prepare(onExecute?: () => void) {
    events.markReadyBatches(new Date(Date.now() + 600000));
    await new ProactiveWorker({ execute: async input => {
      const context = input.authorizedContext.follow_up as { items: Array<{ evidenceId: string; content: string }> };
      expect(context.items.every(item => !item.evidenceId.includes('other-account-only'))).toBe(true);
      onExecute?.();
      return { text: JSON.stringify({ title: 'Reply ready for review', summary: 'The review needs a confirmed date', whyNow: 'The delegated conversation changed', impact: 'Confirm the review', workDone: 'Read the current thread and prepared a draft', recommendation: 'Review the draft before sending', urgency: 'medium', confidence: .95, evidenceIds: context.items.map(item => item.evidenceId), artifact: { kind: 'draft', title: 'Review follow-up', content: 'Hello, could you confirm a suitable review date? Thank you.' } }) };
    } }).tick();
    new ProactiveInboxService().project();
  }
  it('prepares an editable draft, binds the conversation, and watches sent messages and new replies without marking completion', async () => {
    const follow = start(); email('other-account-only', ['INBOX'], 'other');
    await prepare();
    const first = delegationOverview('workspace').prepared[0]!;
    expect(first.communication?.id).toBe(follow.id);
    expect(first.evidence).toHaveLength(1);
    const edited = performCardAction(first.id, 'workspace', { actionId: 'edit_artifact', expectedRevision: first.revision, idempotencyKey: 'edit-mail-draft', artifact: { ...first.artifact!, content: 'Hello, which date works for you?' } });
    expect(edited.artifact?.content).toContain('which date');
    expect(continueMailFollowUp('workspace', follow.id, 'chat:test').connectionId).toBe('mail');
    expect(getCard(first.id, 'workspace').communication?.sessionKey).toBe('chat:test');
    getSqliteDatabase().prepare("DELETE FROM sessions WHERE session_key = 'chat:test'").run();
    expect(getCard(first.id, 'workspace').communication?.sessionKey).toBeNull();
    expect(scanMailFollowUps(events)).toBe(0);
    vi.setSystemTime(new Date('2026-09-13T09:00:00Z')); email('sent', ['SENT']);
    expect(getCard(first.id, 'workspace').status).toBe('expired');
    expect(recheckProactiveNotification(first.id)).toBe('cancel');
    expect(scanMailFollowUps(events)).toBe(1);
    expect(listMailFollowUps('workspace')[0]).toMatchObject({ status: 'watching', latestDirection: 'sent' });
    await prepare();
    vi.setSystemTime(new Date('2026-09-13T10:00:00Z')); email('reply');
    expect(scanMailFollowUps(events)).toBe(1);
    expect(listMailFollowUps('workspace')[0]).toMatchObject({ status: 'watching', latestDirection: 'received' });
  });
  it('checks once at the agreed time and suppresses unchanged repeats', () => {
    start(); expect(scanMailFollowUps(events)).toBe(0);
    vi.setSystemTime(new Date('2026-09-14T08:00:00Z')); expect(scanMailFollowUps(events)).toBe(1);
    vi.setSystemTime(new Date('2026-09-15T08:00:00Z')); expect(scanMailFollowUps(events)).toBe(0);
  });
  it('enforces scope, revision, duplicate identity, source authorization and explicit pause/end', async () => {
    const follow = start(); await prepare(); const card = delegationOverview('workspace').prepared[0]!;
    const input = { sourceItemId: mailFollowUpSources('workspace')[0]!.id, instructions: 'Same thread', dueAt: '2026-09-14T08:00:00Z' };
    expect(() => startMailFollowUp('workspace', input)).toThrow(/already delegated/);
    expect(() => startMailFollowUp('foreign', input)).toThrow(/Authorize/);
    const paused = updateMailFollowUp('workspace', follow.id, { expectedRevision: 1, status: 'paused' });
    expect(getCard(card.id, 'workspace').status).toBe('expired');
    expect(() => continueMailFollowUp('workspace', follow.id, 'chat:test')).toThrow(/Resume/);
    expect(() => updateMailFollowUp('workspace', follow.id, { expectedRevision: 1, status: 'watching' })).toThrow(/changed/);
    expect(() => updateMailFollowUp('foreign', follow.id, { expectedRevision: paused.revision, status: 'watching' })).toThrow(/not found/);
    updateMailFollowUp('workspace', follow.id, { expectedRevision: paused.revision, status: 'completed' });
    expect(scanMailFollowUps(events)).toBe(0);
    upsertConnectorSyncPolicy({ accountId: 'account:mail', proactiveEnabled: false });
    expect(getCard(card.id, 'workspace').artifact).toBeUndefined();
    expect(mailFollowUpSources('workspace')).toEqual([]);
  });
  it('discards a generated draft when a new reply arrives while it is being prepared', async () => {
    start(); await prepare(() => { vi.setSystemTime(new Date('2026-09-13T08:01:00Z')); email('new-reply'); });
    expect(delegationOverview('workspace').prepared).toEqual([]);
    expect(getSqliteDatabase().prepare('SELECT outcome_reason FROM proactive_runs').get()).toMatchObject({ outcome_reason: 'source_changed' });
  });
});
