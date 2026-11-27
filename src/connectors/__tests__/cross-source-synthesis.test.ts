import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { listKnowledgeItems } from '../../knowledge-memory/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import { grantUnderstandingConsent } from '../../user-context/sources/consent-repository.js';
import { upsertUnderstandingSourceGrant } from '../../user-context/sources/repository.js';
import {
  listUserAssertions,
  listUserAssertionSources,
  recordUserModelObservation,
} from '../../user-model/index.js';
import { synthesizeConnectedSources } from '../cross-source-synthesis.js';

function seedConnectorGrant(input: {
  toolkit: string;
  displayName: string;
  processingPolicy?: 'local_only' | 'remote_allowed';
}) {
  const sourceInstanceId = `composio:composio-${input.toolkit}:acc-${input.toolkit}`;
  const grant = upsertUnderstandingSourceGrant({
    sourceKey: `connector-account:acc-${input.toolkit}`,
    adapterId: `connector:composio-${input.toolkit}`,
    category: input.toolkit === 'googlecalendar' ? 'calendar' : 'mail',
    platform: 'all',
    displayName: input.displayName,
    accessMode: 'continuous',
    retentionPolicy: 'bounded_raw',
    processingPolicy: input.processingPolicy ?? 'remote_allowed',
    config: { sourceInstanceId },
  });
  grantUnderstandingConsent({
    grantId: grant.id,
    purposes: ['personalization', 'work_assistance'],
    allowedDomains: ['identity', 'goals', 'capabilities', 'preferences', 'behavior', 'relationships'],
    deniedDomains: ['health'],
    allowedFields: ['title', 'content', 'timestamps', 'participants', 'owner_activity', 'status'],
    accessMode: 'continuous',
    lookbackDays: 180,
    rawRetentionDays: 7,
    processingPolicy: input.processingPolicy ?? 'remote_allowed',
    allowedAgentIds: ['main'],
    disclosureVersion: 'test-v1',
  });
  return { grant, sourceInstanceId };
}

describe('cross-source connector synthesis', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-cross-source-synthesis-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('corroborates assertions across Google Calendar and Gmail, persists writing preferences, and blocks private relationships', async () => {
    const cal = seedConnectorGrant({ toolkit: 'googlecalendar', displayName: 'Google Calendar' });
    const gmail = seedConnectorGrant({ toolkit: 'gmail', displayName: 'Gmail' });

    const calItems = upsertKnowledgeSourceItems([
      {
        sourceInstanceId: cal.sourceInstanceId,
        collectionScope: 'events',
        externalId: 'evt-1',
        itemType: 'calendar_event',
        occurredAt: '2026-11-10T02:00:00.000Z',
        contentHash: 'cal-h1',
        normalizedText: JSON.stringify({
          title: 'Atlas Architecture Sync',
          recurringEventId: 'atlas-weekly',
          organizer: { email: 'me@example.com', self: true },
          attendees: [{ email: 'me@example.com', self: true }, { email: 'alice@example.com', displayName: 'Alice' }],
        }),
        metadata: { toolkit: 'googlecalendar', agentId: 'main', actorAttributed: true, ownerIdentities: ['me@example.com'] },
        sensitivity: 'personal',
        retentionClass: 'bounded',
        synthesisPipeline: 'connected_knowledge',
        synthesisStatus: 'completed',
      },
      {
        sourceInstanceId: cal.sourceInstanceId,
        collectionScope: 'events',
        externalId: 'evt-2',
        itemType: 'calendar_event',
        occurredAt: '2026-11-17T02:00:00.000Z',
        contentHash: 'cal-h2',
        normalizedText: JSON.stringify({
          title: 'Atlas Architecture Sync',
          recurringEventId: 'atlas-weekly',
          organizer: { email: 'me@example.com', self: true },
          attendees: [{ email: 'me@example.com', self: true }, { email: 'alice@example.com', displayName: 'Alice' }],
        }),
        metadata: { toolkit: 'googlecalendar', agentId: 'main', actorAttributed: true, ownerIdentities: ['me@example.com'] },
        sensitivity: 'personal',
        retentionClass: 'bounded',
        synthesisPipeline: 'connected_knowledge',
        synthesisStatus: 'completed',
      },
    ]).items;

    const mailItems = upsertKnowledgeSourceItems([
      {
        sourceInstanceId: gmail.sourceInstanceId,
        collectionScope: 'sent-messages',
        externalId: 'mail-1',
        itemType: 'email',
        occurredAt: '2026-11-18T05:00:00.000Z',
        contentHash: 'mail-h1',
        normalizedText: JSON.stringify({
          threadId: 'th-atlas',
          subject: 'Atlas Architecture Review Notes',
          sender: 'me@example.com',
          recipients: 'Alice <alice@example.com>',
          content: 'Hi Alice，以下是本周 Atlas 架构评审的结论和下一步拆解，建议先落地 TypeScript API 改动。',
        }),
        metadata: { toolkit: 'gmail', agentId: 'main', actorAttributed: true, isSent: true, ownerIdentities: ['me@example.com'] },
        sensitivity: 'personal',
        retentionClass: 'bounded',
        synthesisPipeline: 'connected_knowledge',
        synthesisStatus: 'completed',
      },
    ]).items;

    recordUserModelObservation({
      domain: 'goals', type: 'calendar_commitment', subject: { type: 'user', id: 'self' },
      value: { itemType: 'calendar_event' }, context: { toolkit: 'googlecalendar' },
      sensitivityCategories: [], ownerAttribution: 'user',
      observedAt: Date.parse('2026-11-10T02:00:00.000Z'), sourceGrantId: cal.grant.id,
      contentHash: 'obs-1',
    });
    recordUserModelObservation({
      domain: 'goals', type: 'calendar_commitment', subject: { type: 'user', id: 'self' },
      value: { itemType: 'calendar_event' }, context: { toolkit: 'googlecalendar' },
      sensitivityCategories: [], ownerAttribution: 'user',
      observedAt: Date.parse('2026-11-17T02:00:00.000Z'), sourceGrantId: cal.grant.id,
      contentHash: 'obs-2',
    });
    recordUserModelObservation({
      domain: 'behavior', type: 'sent_message_activity', subject: { type: 'user', id: 'self' },
      value: { itemType: 'email' }, context: { toolkit: 'gmail' },
      sensitivityCategories: [], ownerAttribution: 'user',
      observedAt: Date.parse('2026-11-18T05:00:00.000Z'), sourceGrantId: gmail.grant.id,
      contentHash: 'obs-3',
    });

    const analyze = vi.fn(async ({ items, locale }) => {
      expect(locale).toBe('zh-CN');
      expect(items.some((item) => item.evidenceRef === 'signal-summary://googlecalendar')).toBe(true);
      expect(items.some((item) => item.evidenceRef === 'signal-summary://gmail')).toBe(true);
      expect(items.some((item) => item.evidenceRef === 'signal-summary://observations')).toBe(true);
      return {
        modelRef: 'test/model',
        profileCandidates: [
          {
            id: 'role-atlas',
            category: 'role' as const,
            factKey: 'atlas-lead',
            statement: '主导 Atlas 架构设计与周度技术评审。',
            confidence: 'high' as const,
            evidence: ['Organizes weekly Atlas sync and leads email reviews'],
            evidenceRefs: ['signal-summary://googlecalendar', `knowledge-source://${mailItems[0]!.id}`],
            status: 'pending' as const,
          },
          {
            id: 'rel-alice',
            category: 'relationship' as const,
            factKey: 'collaborator-alice',
            statement: '在 Atlas 架构项目上与 Alice 保持高频周度协作。',
            confidence: 'high' as const,
            evidence: ['Co-attends Atlas meetings and exchanges emails'],
            evidenceRefs: [`knowledge-source://${calItems[0]!.id}`, `knowledge-source://${mailItems[0]!.id}`],
            status: 'pending' as const,
          },
          {
            id: 'rel-private',
            category: 'relationship' as const,
            factKey: 'private-spouse',
            statement: 'Alice 是用户的妻子。',
            confidence: 'high' as const,
            evidence: ['Guessed'],
            evidenceRefs: [`knowledge-source://${calItems[0]!.id}`, `knowledge-source://${mailItems[0]!.id}`],
            status: 'pending' as const,
          },
        ],
        writingPreferences: [
          {
            id: 'w-lang',
            dimension: 'language' as const,
            factKey: 'writing:language',
            statement: '习惯用中文撰写工作沟通，保留英文技术术语。',
            confidence: 'high' as const,
            evidence: ['Sent Atlas review mail'],
            evidenceRefs: [`knowledge-source://${mailItems[0]!.id}`],
            sourceIds: ['connector:gmail'],
            status: 'pending' as const,
          },
        ],
        workThreadCandidates: [
          {
            topicKey: 'atlas-architecture',
            title: 'Atlas 架构升级',
            summary: '每周同步并推进 TypeScript API 架构评审与落地。',
            horizon: 'current' as const,
            status: 'active' as const,
            confidence: 'high' as const,
            evidenceRefs: ['signal-summary://googlecalendar', `knowledge-source://${mailItems[0]!.id}`],
          },
        ],
        calibrationQuestions: [
          { id: 'q-1', question: 'Atlas 架构升级是否是本月最高优先级？', options: ['是', '否'] },
        ],
        sourceStatuses: [
          { sourceId: 'connector:googlecalendar', status: 'completed' as const },
          { sourceId: 'connector:gmail', status: 'completed' as const },
        ],
      };
    });

    const config = ConfigSchema.parse({ userContext: { preferences: { responseLanguage: 'zh-CN' } } });
    const result = await synthesizeConnectedSources({
      config,
      agentId: 'main',
      trigger: 'bootstrap',
      nowMs: Date.parse('2026-11-27T08:00:00.000Z'),
      analyze,
    });

    expect(result.skipped).toBe(false);
    expect([...result.sourcesAnalyzed].sort()).toEqual(['connector:gmail', 'connector:googlecalendar']);
    expect(result.writingPreferencesPersisted).toBe(1);
    expect(result.calibrationQuestions).toHaveLength(1);

    const assertions = listUserAssertions();
    const statements = assertions.map((item) => item.statement);
    expect(statements).toContain('主导 Atlas 架构设计与周度技术评审。');
    expect(statements).toContain('在 Atlas 架构项目上与 Alice 保持高频周度协作。');
    expect(statements).toContain('习惯用中文撰写工作沟通，保留英文技术术语。');
    expect(statements).not.toContain('Alice 是用户的妻子。');

    const roleAssertion = assertions.find((item) => item.statement === '主导 Atlas 架构设计与周度技术评审。')!;
    const sourceLabels = (listUserAssertionSources([roleAssertion.id]).get(roleAssertion.id) ?? []).map((s) => s.label);
    expect(sourceLabels).toEqual(expect.arrayContaining(['Google Calendar', 'Gmail']));

    expect(listKnowledgeItems().filter((item) => item.kind === 'work_thread')).toContainEqual(expect.objectContaining({
      content: 'Atlas 架构升级: 每周同步并推进 TypeScript API 架构评审与落地。',
    }));

    // Idempotent second run with unchanged content hash should skip without calling LLM again.
    const second = await synthesizeConnectedSources({
      config,
      agentId: 'main',
      trigger: 'bootstrap',
      nowMs: Date.parse('2026-11-27T08:00:00.000Z'),
      analyze,
    });
    expect(second.skipped).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('skips local_only grants and does not invoke remote synthesis', async () => {
    const cal = seedConnectorGrant({ toolkit: 'googlecalendar', displayName: 'Google Calendar', processingPolicy: 'local_only' });
    upsertKnowledgeSourceItems([{
      sourceInstanceId: cal.sourceInstanceId,
      collectionScope: 'events',
      externalId: 'evt-local',
      itemType: 'calendar_event',
      occurredAt: '2026-11-10T02:00:00.000Z',
      contentHash: 'local-1',
      normalizedText: JSON.stringify({ title: 'Private sync' }),
      metadata: { toolkit: 'googlecalendar', agentId: 'main', actorAttributed: true },
      sensitivity: 'personal',
      retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge',
      synthesisStatus: 'completed',
    }]);
    const analyze = vi.fn();
    const result = await synthesizeConnectedSources({
      config: ConfigSchema.parse({}),
      agentId: 'main',
      force: true,
      analyze,
    });
    expect(result.skipped).toBe(true);
    expect(analyze).not.toHaveBeenCalled();
  });
});
