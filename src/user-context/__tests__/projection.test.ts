import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../../agent/memory/types.js';
import type { ConnectorConnection, ConnectorDefinition, ConnectorInstance } from '../../connectors/types.js';
import type { KnowledgeSourceItem, KnowledgeSyncRun } from '../../knowledge/types.js';
import {
  facetForMemoryKind,
  isPersonalContextConnector,
  isUserContextRecord,
  originForMemoryRecord,
  projectPersonalContextSources,
  projectUserContextRecord,
  recordsDerivedFromPersonalContextSource,
} from '../projection.js';

function record(patch: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: 'memory-1',
    kind: 'preference',
    status: 'active',
    scope: { userId: 'local-owner' },
    provenance: { sourceAgentId: 'main' },
    content: 'Prefer a concise answer.',
    source: { provider: 'local' },
    explicitness: 'explicit',
    durability: 'durable',
    importance: 0.8,
    disclosurePolicy: 'referenceable',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

describe('user context projection', () => {
  it('keeps personal records while excluding operational agent memory', () => {
    expect(isUserContextRecord(record({ kind: 'preference' }))).toBe(true);
    expect(isUserContextRecord(record({ kind: 'project_context', tags: ['user-understanding'] }))).toBe(true);
    expect(isUserContextRecord(record({ kind: 'project_context', tags: [] }))).toBe(false);
    expect(isUserContextRecord(record({ kind: 'curated_note' }))).toBe(false);
  });

  it('maps records to human facets and origins', () => {
    expect(facetForMemoryKind('boundary')).toBe('boundaries');
    expect(facetForMemoryKind('relationship')).toBe('people');
    expect(facetForMemoryKind('long_term_goal')).toBe('priorities');
    expect(originForMemoryRecord(record())).toBe('told_by_you');
    expect(originForMemoryRecord(record({ explicitness: 'observed' }))).toBe('observed');
    expect(originForMemoryRecord(record({
      explicitness: 'inferred',
      source: { provider: 'user-understanding' },
    }))).toBe('inferred');
    expect(originForMemoryRecord(record({ source: { provider: 'calendar' } }))).toBe('connected_source');
  });

  it('exposes source, stability, and due review without mutating the record', () => {
    const source = record({
      confidence: 0.9,
      evidence: [{ confidence: 0.9 }, { confidence: 0.8 }],
      reviewAfter: new Date(Date.now() - 1_000).toISOString(),
      source: { provider: 'calendar', path: 'calendar://events' },
    });
    const projected = projectUserContextRecord(source);
    expect(projected.status).toBe('needs_review');
    expect(projected.reviewDue).toBe(true);
    expect(projected.evidenceCount).toBe(2);
    expect(projected.sourcePath).toBe('calendar://events');
    expect(source.status).toBe('active');
  });

  it('recognizes only connectors that can feed personal context', () => {
    const connector = (capabilities: ConnectorDefinition['capabilities']) => ({ capabilities }) as ConnectorDefinition;
    expect(isPersonalContextConnector(connector(['memory_source']))).toBe(true);
    expect(isPersonalContextConnector(connector(['context', 'tools']))).toBe(true);
    expect(isPersonalContextConnector(connector(['tools']))).toBe(false);
  });

  it('projects context, memory, read, and explicit write access separately', () => {
    const definitions = [{
      id: 'calendar',
      displayName: 'Calendar',
      description: 'Calendar access',
      branding: { logoUrl: '/assets/connectors/calendar.svg', source: 'builtin' },
      category: 'data',
      capabilities: ['context', 'memory_source', 'tools'],
      permissions: { data: ['events:read', 'events:create'] },
    }] as ConnectorDefinition[];

    const [source] = projectPersonalContextSources(definitions, []);

    expect(source?.access).toEqual({ context: true, memory: true, read: true, write: true });
    expect(source?.branding?.logoUrl).toBe('/assets/connectors/calendar.svg');
    expect(source?.permissionDetails).toEqual(['events:read', 'events:create']);
  });

  it('selects source-derived understanding by exact connection instance across agents', () => {
    const exact = record({ source: { provider: 'calendar', sourceInstanceId: 'calendar-1' } });
    const similarSource = record({ id: 'memory-2', source: { provider: 'calendar', sourceInstanceId: 'calendar-2' } });
    const otherAgent = record({ id: 'memory-3', source: { provider: 'calendar', sourceInstanceId: 'calendar-1' }, provenance: { sourceAgentId: 'other' } });
    const operational = record({ id: 'memory-4', kind: 'curated_note', source: { provider: 'calendar', sourceInstanceId: 'calendar-1' } });

    expect(recordsDerivedFromPersonalContextSource(
      [exact, similarSource, otherAgent, operational],
      'calendar-1',
    )).toEqual([exact, otherAgent]);
  });

  it('projects the latest source health, activity, and derived understanding count', () => {
    const definitions = [{
      id: 'calendar',
      displayName: 'Calendar',
      description: 'Calendar access',
      category: 'data',
      capabilities: ['context'],
    }] as ConnectorDefinition[];
    const instances = [{
      instanceId: 'calendar-1',
      connectorId: 'calendar',
      displayName: 'Calendar',
      enabled: true,
      status: 'connected',
      usage: { lastHealthCheckAt: '2026-07-20T08:00:00.000Z', lastHealthStatus: 'ok' },
      audit: [{ at: '2026-07-20T09:00:00.000Z', action: 'health_check' }],
    }] as ConnectorInstance[];

    const [source] = projectPersonalContextSources(definitions, instances, [
      record({ source: { provider: 'calendar', sourceInstanceId: 'calendar-1' } }),
      record({ id: 'memory-2', source: { provider: 'mail' } }),
    ]);

    expect(source).toMatchObject({
      lastHealthCheckAt: '2026-07-20T08:00:00.000Z',
      lastHealthStatus: 'ok',
      lastActivityAt: '2026-07-20T09:00:00.000Z',
      derivedUnderstandingCount: 1,
    });
  });

  it('projects connected knowledge volume and the latest sync outcome', () => {
    const definitions = [{
      id: 'composio-gmail',
      displayName: 'Gmail',
      description: 'Gmail access',
      category: 'data',
      capabilities: ['context', 'memory_source', 'tools'],
    }] as ConnectorDefinition[];
    const items = [{
      id: 'item-1',
      sourceInstanceId: 'composio:composio-gmail:gmail-work',
      externalId: 'message-1',
      itemType: 'email',
      contentHash: 'hash-1',
      metadata: { connectorId: 'composio-gmail' },
      sensitivity: 'normal',
      retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge',
      synthesisStatus: 'completed',
      synthesisAttempts: 1,
      createdAt: '2026-07-20T08:00:00.000Z',
      updatedAt: '2026-07-20T08:00:00.000Z',
    }] as KnowledgeSourceItem[];
    const syncRuns = [{
      id: 'run-1',
      sourceInstanceId: 'composio:composio-gmail:gmail-work',
      status: 'partial',
      itemsSeen: 1,
      itemsCreated: 1,
      itemsUpdated: 0,
      warnings: ['one item was skipped'],
      startedAt: '2026-07-20T08:00:00.000Z',
      finishedAt: '2026-07-20T08:01:00.000Z',
    }] as KnowledgeSyncRun[];

    const connections = [{
      id: 'gmail-work',
      connectorId: 'composio-gmail',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'provider-work',
      alias: 'Work',
      identity: {},
      status: 'active',
      isDefault: true,
      metadata: {},
      createdAt: '2026-07-20T07:00:00.000Z',
      updatedAt: '2026-07-20T07:00:00.000Z',
    }] as ConnectorConnection[];
    const [source] = projectPersonalContextSources(definitions, [], [], { sourceItems: items, syncRuns, connections });

    expect(source).toMatchObject({
      knowledgeItemCount: 1,
      lastSyncAt: '2026-07-20T08:01:00.000Z',
      lastSyncStatus: 'partial',
      lastActivityAt: '2026-07-20T08:01:00.000Z',
      instanceId: 'gmail-work',
      accountLabel: 'Work',
    });
  });

  it('keeps multiple accounts isolated in the source projection', () => {
    const definitions = [{
      id: 'composio-gmail', displayName: 'Gmail', description: 'Gmail access', category: 'data',
      capabilities: ['context', 'memory_source'],
    }] as ConnectorDefinition[];
    const connections = ['work', 'personal'].map((id) => ({
      id,
      connectorId: 'composio-gmail',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: `provider-${id}`,
      alias: id,
      identity: {},
      status: 'active',
      isDefault: id === 'work',
      metadata: {},
      createdAt: '2026-07-20T07:00:00.000Z',
      updatedAt: '2026-07-20T07:00:00.000Z',
    })) as ConnectorConnection[];
    const sources = projectPersonalContextSources(definitions, [], [
      record({ source: { provider: 'composio-gmail', sourceInstanceId: 'composio:composio-gmail:work' } }),
      record({ id: 'personal-record', source: { provider: 'composio-gmail', sourceInstanceId: 'composio:composio-gmail:personal' } }),
    ], { connections });

    expect(sources.map((source) => [source.instanceId, source.derivedUnderstandingCount])).toEqual(
      expect.arrayContaining([
        ['work', 1],
        ['personal', 1],
      ]),
    );
  });

  it('attributes cross-source understanding through evidence and exposes learning progress', () => {
    const definitions = [{
      id: 'composio-gmail', displayName: 'Gmail', description: 'Gmail access', category: 'data',
      capabilities: ['context', 'memory_source'],
    }] as ConnectorDefinition[];
    const connections = [{
      id: 'work', connectorId: 'composio-gmail', provider: 'composio', principalId: 'local-owner',
      providerConnectionId: 'provider-work', identity: {}, status: 'active', isDefault: true,
      metadata: {}, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    }] as ConnectorConnection[];
    const sourceItems = [{
      id: 'gmail-item', sourceInstanceId: 'composio:composio-gmail:work', externalId: 'message-1',
      itemType: 'email', contentHash: 'hash', metadata: {}, sensitivity: 'personal', retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge', synthesisStatus: 'completed', synthesisAttempts: 1,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    }] as KnowledgeSourceItem[];
    const crossSource = record({
      source: { provider: 'connected-sources' },
      evidence: [{ sourceItemId: 'gmail-item', relation: 'supports' }],
    });
    const learningJobs = [{
      id: 'job-1', idempotencyKey: 'bootstrap:work:v1', connectorId: 'composio-gmail', connectionId: 'work',
      sourceInstanceId: 'composio:composio-gmail:work', agentId: 'main', mode: 'bootstrap', status: 'running',
      phase: 'deriving', itemsDiscovered: 12, itemsIndexed: 10, candidatesCreated: 1, attemptCount: 1,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:01:00.000Z',
    }] as Parameters<typeof projectPersonalContextSources>[3]['learningJobs'];

    const [source] = projectPersonalContextSources(definitions, [], [crossSource], {
      connections, sourceItems, learningJobs,
    });
    expect(source).toMatchObject({
      derivedUnderstandingCount: 1,
      learning: { status: 'running', phase: 'deriving', itemsIndexed: 10 },
    });
  });

  it('does not let an older learning failure override a newer successful run', () => {
    const definitions = [{
      id: 'composio-gmail', displayName: 'Gmail', description: 'Gmail access', category: 'data',
      capabilities: ['context', 'memory_source'],
    }] as ConnectorDefinition[];
    const connections = [{
      id: 'work', connectorId: 'composio-gmail', provider: 'composio', principalId: 'local-owner',
      providerConnectionId: 'provider-work', identity: {}, status: 'active', isDefault: true,
      metadata: {}, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    }] as ConnectorConnection[];
    const learningJobs = [
      {
        id: 'scheduled', idempotencyKey: 'scheduled:work', status: 'queued', phase: 'queued',
        createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z',
        nextRunAt: '2099-01-01T00:00:00.000Z',
      },
      {
        id: 'completed', idempotencyKey: 'manual:work', status: 'completed', phase: 'completed',
        createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:01:00.000Z',
      },
      {
        id: 'failed', idempotencyKey: 'bootstrap:work', status: 'failed', phase: 'fetching',
        error: 'connected_account_unavailable', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:01:00.000Z',
      },
    ].map((job) => ({
      connectorId: 'composio-gmail', connectionId: 'work', sourceInstanceId: 'composio:composio-gmail:work',
      agentId: 'main', mode: 'incremental', itemsDiscovered: 0, itemsIndexed: 0, candidatesCreated: 0,
      attemptCount: 1, ...job,
    })) as Parameters<typeof projectPersonalContextSources>[3]['learningJobs'];

    const [source] = projectPersonalContextSources(definitions, [], [], { connections, learningJobs });

    expect(source.learning).toMatchObject({ status: 'completed', phase: 'completed' });
    expect(source.learning?.error).toBeUndefined();
  });

  it('numbers multiple Composio accounts when identity labels are unavailable', () => {
    const definitions = [{
      id: 'composio-gmail', displayName: 'Gmail', description: 'Gmail access', category: 'data',
      capabilities: ['context', 'memory_source'],
    }] as ConnectorDefinition[];
    const connections = [
      { id: 'newer', connectedAt: '2026-07-20T08:00:00.000Z' },
      { id: 'older', connectedAt: '2026-07-20T07:00:00.000Z' },
    ].map(({ id, connectedAt }) => ({
      id,
      connectorId: 'composio-gmail',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: `provider-${id}`,
      identity: {},
      status: 'active',
      isDefault: false,
      metadata: {},
      connectedAt,
      createdAt: connectedAt,
      updatedAt: connectedAt,
    })) as ConnectorConnection[];

    const sources = projectPersonalContextSources(definitions, [], [], { connections });

    expect(sources.map((source) => ({
      instanceId: source.instanceId,
      accountLabel: source.accountLabel,
      accountOrdinal: source.accountOrdinal,
      accountCount: source.accountCount,
    }))).toEqual([
      { instanceId: 'older', accountLabel: undefined, accountOrdinal: 1, accountCount: 2 },
      { instanceId: 'newer', accountLabel: undefined, accountOrdinal: 2, accountCount: 2 },
    ]);
  });

  it('hides abandoned pending accounts when an active account exists', () => {
    const definitions = [{
      id: 'composio-github', displayName: 'GitHub', description: 'GitHub access', category: 'code',
      capabilities: ['context', 'memory_source'],
    }] as ConnectorDefinition[];
    const connections = [
      { id: 'pending', status: 'pending' },
      { id: 'active', status: 'active' },
    ].map(({ id, status }) => ({
      id,
      connectorId: 'composio-github',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: `provider-${id}`,
      identity: {},
      status,
      isDefault: id === 'active',
      metadata: {},
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })) as ConnectorConnection[];

    const sources = projectPersonalContextSources(definitions, [], [], { connections });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ instanceId: 'active', enabled: true, status: 'active' });
  });
});
