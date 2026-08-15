import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertConnectorConnection,
  upsertConnectorSyncPolicy,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ContextProviderRegistry } from '../execution/context.js';
import { ProactiveScenarioService } from '../scenarios/service.js';
import { ProactiveEventService } from '../service.js';
import { ProactiveTemporalWorker } from '../temporal/worker.js';

describe('proactive temporal worker', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-proactive-temporal-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    upsertConnectorConnection({
      id: 'calendar-work',
      connectorId: 'googlecalendar',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'provider-calendar',
      identity: {},
      status: 'active',
      isDefault: true,
      metadata: {},
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function storeMeeting(start: string, sensitivity: 'personal' | 'secret' = 'personal'): void {
    upsertKnowledgeSourceItems([{
      sourceInstanceId: 'composio:googlecalendar:calendar-work',
      collectionScope: 'events',
      externalId: 'meeting-1',
      itemType: 'calendar_event',
      occurredAt: start,
      sourceUpdatedAt: '2026-08-15T01:00:00.000Z',
      contentHash: 'calendar-hash-1',
      normalizedText: JSON.stringify({ title: 'Launch review', start }),
      metadata: {
        connectorId: 'googlecalendar',
        connectionId: 'calendar-work',
        workspaceId: '/workspace',
        agentId: 'main',
      },
      sensitivity,
      retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge',
      synthesisStatus: 'pending',
    }]);
  }

  it('publishes each meeting horizon once using durable event deduplication', async () => {
    upsertConnectorSyncPolicy({
      connectionId: 'calendar-work',
      scanEnabled: true,
      proactiveEnabled: true,
      allowedScenarioKeys: ['meeting_preparation'],
    });
    storeMeeting('2026-08-15T12:00:00.000Z');
    getSqliteDatabase().prepare(`INSERT INTO goals (
      goal_id, title, status, agent_id, priority, created_at, updated_at, max_turns
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('goal-1', 'Prepare launch decision', 'active', 'main', 'high', 1, 2, 20);
    const insertNote = getSqliteDatabase().prepare(`INSERT INTO notes (
      note_id, title, kind, status, payload_json, snippet, created_at, updated_at
    ) VALUES (?, ?, 'markdown', 'processed', '{}', ?, ?, ?)`);
    insertNote.run('note-launch', 'Launch review notes', 'Open launch questions', 1, 2);
    insertNote.run('note-private', 'Unrelated personal record', 'Private unrelated detail', 1, 3);
    const events = new ProactiveEventService(() => []);
    const worker = new ProactiveTemporalWorker(events);

    expect(await worker.tick(new Date('2026-08-15T01:00:00.000Z')))
      .toMatchObject({ scanned: 1, published: 1, skipped: 0 });
    expect(await worker.tick(new Date('2026-08-15T01:01:00.000Z')))
      .toMatchObject({ scanned: 1, published: 0, skipped: 0 });
    expect(await worker.tick(new Date('2026-08-15T10:30:00.000Z')))
      .toMatchObject({ scanned: 1, published: 1, skipped: 0 });
    expect(events.listEvents().map((event) => event.payload.window).sort()).toEqual(['24h', '2h']);
    expect(new ProactiveScenarioService().list().map((scenario) => scenario.key))
      .toContain('meeting_preparation');

    const context = await new ContextProviderRegistry().collect('meeting_preparation', {
      batchId: 'batch-1',
      eventIds: [events.listEvents()[0]!.id],
      subscriptionId: 'subscription-1',
    });
    expect(context.content.connected_source).toMatchObject({
      items: [expect.objectContaining({ content: expect.stringContaining('Launch review') })],
    });
    expect(context.content.meeting_workspace).toMatchObject({
      activeGoals: [expect.objectContaining({
        evidenceId: 'goal:goal-1',
        title: 'Prepare launch decision',
      })],
      recentNotes: [expect.objectContaining({ evidenceId: 'note:note-launch' })],
    });
    expect(context.evidenceIds).toContain('goal:goal-1');
    expect(JSON.stringify(context.content.meeting_workspace)).not.toContain('Private unrelated detail');
  });

  it('does not emit when proactive connector use is disabled', async () => {
    upsertConnectorSyncPolicy({
      connectionId: 'calendar-work',
      scanEnabled: true,
      proactiveEnabled: false,
    });
    storeMeeting('2026-08-15T02:00:00.000Z');
    const events = new ProactiveEventService(() => []);

    expect(await new ProactiveTemporalWorker(events).tick(new Date('2026-08-15T01:00:00.000Z')))
      .toMatchObject({ scanned: 1, published: 0, skipped: 1 });
    expect(events.listEvents()).toHaveLength(0);
  });

  it('does not emit temporal signals for secret calendar items', async () => {
    upsertConnectorSyncPolicy({
      connectionId: 'calendar-work',
      scanEnabled: true,
      proactiveEnabled: true,
    });
    storeMeeting('2026-08-15T02:00:00.000Z', 'secret');
    const events = new ProactiveEventService(() => []);

    expect(await new ProactiveTemporalWorker(events).tick(new Date('2026-08-15T01:00:00.000Z')))
      .toMatchObject({ scanned: 1, published: 0, skipped: 1 });
    expect(events.listEvents()).toHaveLength(0);
  });
});
