import { describe, expect, it } from 'vitest';

import type { KnowledgeSourceItem } from '../../knowledge/types.js';
import type { UnderstandingConsentReceipt } from '../../user-context/sources/types.js';
import { buildConnectorSignalSummary } from '../signal-summary.js';

function consent(allowedFields = ['title', 'content', 'timestamps', 'participants', 'owner_activity', 'status']): UnderstandingConsentReceipt {
  return {
    id: 'consent-1',
    grantId: 'grant-1',
    purposes: ['personalization', 'work_assistance'],
    allowedDomains: ['identity', 'goals', 'capabilities', 'preferences', 'behavior', 'relationships'],
    deniedDomains: ['health'],
    allowedFields,
    accessMode: 'continuous',
    lookbackDays: 180,
    rawRetentionDays: 7,
    processingPolicy: 'remote_allowed',
    disclosureVersion: 'test-v1',
    grantedAt: Date.now(),
  };
}

function sourceItem(overrides: Partial<KnowledgeSourceItem>): KnowledgeSourceItem {
  return {
    id: 'item-1',
    sourceInstanceId: 'composio:composio-googlecalendar:acc-1',
    collectionScope: 'events',
    externalId: 'ext-1',
    itemType: 'calendar_event',
    contentHash: 'hash-1',
    normalizedText: JSON.stringify({ title: 'Event' }),
    metadata: { toolkit: 'googlecalendar', agentId: 'main', actorAttributed: true, ownerIdentities: ['me@example.com'] },
    sensitivity: 'personal',
    retentionClass: 'bounded',
    synthesisPipeline: 'connected_knowledge',
    synthesisStatus: 'completed',
    synthesisAttempts: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('connector signal summary', () => {
  const nowMs = Date.parse('2026-11-27T08:00:00.000Z');

  it('aggregates Google Calendar recurring meetings, small-group collaborators, and upcoming milestones while filtering declined/all-hands noise', () => {
    const items: KnowledgeSourceItem[] = [
      sourceItem({
        id: 'cal-1',
        occurredAt: '2026-11-02T02:00:00.000Z',
        normalizedText: JSON.stringify({
          title: 'Atlas Weekly Sync',
          recurringEventId: 'series-atlas',
          organizer: { email: 'me@example.com', self: true },
          attendees: [
            { email: 'me@example.com', self: true, responseStatus: 'accepted' },
            { email: 'alice@example.com', displayName: 'Alice' },
            { email: 'bob@example.com', displayName: 'Bob' },
          ],
        }),
      }),
      sourceItem({
        id: 'cal-2',
        occurredAt: '2026-11-09T02:00:00.000Z',
        normalizedText: JSON.stringify({
          title: 'Atlas Weekly Sync',
          recurringEventId: 'series-atlas',
          organizer: { email: 'me@example.com', self: true },
          attendees: [
            { email: 'me@example.com', self: true, responseStatus: 'accepted' },
            { email: 'alice@example.com', displayName: 'Alice' },
          ],
        }),
      }),
      sourceItem({
        id: 'cal-declined',
        occurredAt: '2026-11-10T02:00:00.000Z',
        metadata: { toolkit: 'googlecalendar', agentId: 'main', actorAttributed: false, declined: true },
        normalizedText: JSON.stringify({
          title: 'Declined Vendor Pitch',
          attendees: [{ email: 'sales@vendor.com', displayName: 'Sales' }],
        }),
      }),
      sourceItem({
        id: 'cal-allhands',
        occurredAt: '2026-11-12T06:00:00.000Z',
        normalizedText: JSON.stringify({
          title: 'Company All Hands',
          attendees: Array.from({ length: 12 }, (_, idx) => ({ email: `person${idx}@example.com`, displayName: `Person ${idx}` })),
        }),
      }),
      sourceItem({
        id: 'cal-upcoming',
        occurredAt: '2026-12-10T03:00:00.000Z',
        normalizedText: JSON.stringify({
          title: 'Q4 Launch Readiness Review',
          organizer: { email: 'me@example.com', self: true },
          attendees: [{ email: 'me@example.com', self: true }, { email: 'alice@example.com', displayName: 'Alice' }],
        }),
      }),
    ];

    const result = buildConnectorSignalSummary({
      toolkit: 'googlecalendar',
      items,
      consent: consent(),
      nowMs,
    });

    expect(result.sourceId).toBe('connector:googlecalendar');
    expect(result.ownerBackedEvidenceRefs).toContain('knowledge-source://cal-1');
    expect(result.ownerBackedEvidenceRefs).toContain('knowledge-source://cal-2');
    expect(result.metrics.recurringSeries).toBe(1);
    expect(result.metrics.collaborators).toBe(1);

    const parsed = JSON.parse(result.summaryItem!.text!) as Record<string, unknown>;
    expect(parsed.signalSummary).toBe('googlecalendar');
    expect(parsed.activeEventsAnalyzed).toBe(4);
    expect(parsed.patterns).toMatchObject({
      recurringMeetings: [expect.objectContaining({ title: 'Atlas Weekly Sync', occurrences: 2, role: 'organizer' })],
    });
    expect(parsed.collaborators).toEqual([
      expect.objectContaining({ name: 'Alice', sharedSmallMeetings: 3 }),
    ]);
    expect(parsed.highlights).toEqual([
      expect.objectContaining({ title: 'Q4 Launch Readiness Review', date: '2026-12-10' }),
    ]);

    const withoutParticipants = buildConnectorSignalSummary({
      toolkit: 'googlecalendar',
      items,
      consent: consent(['title', 'timestamps', 'owner_activity']),
      nowMs,
    });
    expect(JSON.parse(withoutParticipants.summaryItem!.text!).collaborators).toBeUndefined();
  });

  it('aggregates Gmail sent language hints, bidirectional correspondents, topic clusters, and filters automated mail', () => {
    const items: KnowledgeSourceItem[] = [
      sourceItem({
        id: 'mail-1',
        sourceInstanceId: 'composio:composio-gmail:acc-1',
        collectionScope: 'sent-messages',
        itemType: 'email',
        occurredAt: '2026-11-20T09:00:00.000Z',
        metadata: { toolkit: 'gmail', agentId: 'main', actorAttributed: true, isSent: true, ownerIdentities: ['me@example.com'] },
        normalizedText: JSON.stringify({
          threadId: 'th-1',
          subject: 'Atlas Launch Checklist',
          sender: 'me@example.com',
          recipients: 'Alice <alice@example.com>',
          content: 'Hi Alice, 这是本周 Atlas Launch 的核心里程碑和架构设计总结，请确认 TypeScript API schema 与发布节奏。',
        }),
      }),
      sourceItem({
        id: 'mail-2',
        sourceInstanceId: 'composio:composio-gmail:acc-1',
        collectionScope: 'messages',
        itemType: 'email',
        occurredAt: '2026-11-19T08:00:00.000Z',
        metadata: { toolkit: 'gmail', agentId: 'main', actorAttributed: false, ownerIdentities: ['me@example.com'] },
        normalizedText: JSON.stringify({
          threadId: 'th-1',
          subject: 'Re: Atlas Launch Checklist',
          sender: 'Alice <alice@example.com>',
          recipients: 'me@example.com',
          content: 'Looks great, ready for review.',
        }),
      }),
      sourceItem({
        id: 'mail-auto',
        sourceInstanceId: 'composio:composio-gmail:acc-1',
        collectionScope: 'messages',
        itemType: 'email',
        occurredAt: '2026-11-21T08:00:00.000Z',
        metadata: { toolkit: 'gmail', agentId: 'main', actorAttributed: false, automated: true },
        normalizedText: JSON.stringify({
          subject: 'Weekly Digest Newsletter',
          sender: 'noreply@digest.example.com',
        }),
      }),
    ];

    const result = buildConnectorSignalSummary({ toolkit: 'gmail', items, consent: consent(), nowMs });
    const parsed = JSON.parse(result.summaryItem!.text!) as Record<string, unknown>;
    expect(parsed.counts).toEqual({ sent: 1, humanReceived: 1, filteredAutomated: 1 });
    expect(parsed.collaborators).toEqual([{ name: 'Alice', sent: 1, received: 1 }]);
    expect(parsed.roleBreakdown).toMatchObject({ sentLanguageHint: 'zh-en-mixed' });
    expect(parsed.highlights).toEqual([expect.objectContaining({ subject: 'Atlas Launch Checklist' })]);
  });

  it('aggregates GitHub repositories, languages, and author/reviewer split', () => {
    const items: KnowledgeSourceItem[] = [
      sourceItem({
        id: 'gh-repo-1',
        sourceInstanceId: 'composio:composio-github:acc-1',
        collectionScope: 'repositories',
        itemType: 'repository',
        metadata: { toolkit: 'github', agentId: 'main', actorAttributed: false, ownerIdentities: ['micjoyce'] },
        normalizedText: JSON.stringify({
          fullName: 'micjoyce/xopc',
          owner: 'micjoyce',
          language: 'TypeScript',
          topics: ['ai-agent', 'gateway'],
          fork: false,
        }),
      }),
      sourceItem({
        id: 'gh-pr-1',
        sourceInstanceId: 'composio:composio-github:acc-1',
        collectionScope: 'authored-work',
        itemType: 'development_activity',
        occurredAt: '2026-11-22T10:00:00.000Z',
        metadata: { toolkit: 'github', agentId: 'main', actorAttributed: true, ownerIdentities: ['micjoyce'] },
        normalizedText: JSON.stringify({
          repository: 'micjoyce/xopc',
          title: 'Add connector signal summary',
          isPullRequest: true,
          labels: ['enhancement'],
        }),
      }),
      sourceItem({
        id: 'gh-rev-1',
        sourceInstanceId: 'composio:composio-github:acc-1',
        collectionScope: 'reviewed-work',
        itemType: 'development_activity',
        occurredAt: '2026-11-23T10:00:00.000Z',
        metadata: { toolkit: 'github', agentId: 'main', actorAttributed: true, ownerIdentities: ['micjoyce'] },
        normalizedText: JSON.stringify({
          repository: 'micjoyce/xopc',
          title: 'Fix gateway auth middleware',
          isPullRequest: true,
        }),
      }),
    ];

    const result = buildConnectorSignalSummary({ toolkit: 'github', items, consent: consent(), nowMs });
    const parsed = JSON.parse(result.summaryItem!.text!) as Record<string, unknown>;
    expect(parsed.roleBreakdown).toEqual({ ownedRepos: 1, authoredPrs: 1, authoredIssues: 0, reviewedPrs: 1 });
    expect(parsed.patterns).toMatchObject({
      topLanguages: { TypeScript: 2 },
      topRepositories: { 'micjoyce/xopc': 2 },
      topics: ['ai-agent', 'gateway'],
    });
  });
});
