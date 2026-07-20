import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../../agent/memory/types.js';
import type { ConnectorDefinition, ConnectorInstance } from '../../connectors/types.js';
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
    scope: { agentId: 'main' },
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
    expect(isUserContextRecord(record({ kind: 'agent_note' }))).toBe(false);
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
      category: 'data',
      capabilities: ['context', 'memory_source', 'tools'],
      permissions: { data: ['events:read', 'events:create'] },
    }] as ConnectorDefinition[];

    const [source] = projectPersonalContextSources(definitions, []);

    expect(source?.access).toEqual({ context: true, memory: true, read: true, write: true });
    expect(source?.permissionDetails).toEqual(['events:read', 'events:create']);
  });

  it('selects source-derived understanding by exact connector and agent scope', () => {
    const exact = record({ source: { provider: 'calendar' } });
    const similarSource = record({ id: 'memory-2', source: { provider: 'calendar-archive' } });
    const otherAgent = record({ id: 'memory-3', source: { provider: 'calendar' }, scope: { agentId: 'other' } });
    const operational = record({ id: 'memory-4', kind: 'agent_note', source: { provider: 'calendar' } });

    expect(recordsDerivedFromPersonalContextSource(
      [exact, similarSource, otherAgent, operational],
      'main',
      'calendar',
    )).toEqual([exact]);
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
      record({ source: { provider: 'calendar' } }),
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

    const [source] = projectPersonalContextSources(definitions, [], [], { sourceItems: items, syncRuns });

    expect(source).toMatchObject({
      knowledgeItemCount: 1,
      lastSyncAt: '2026-07-20T08:01:00.000Z',
      lastSyncStatus: 'partial',
      lastActivityAt: '2026-07-20T08:01:00.000Z',
    });
  });
});
