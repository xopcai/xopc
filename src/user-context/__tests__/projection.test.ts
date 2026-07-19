import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../../agent/memory/types.js';
import type { ConnectorDefinition } from '../../connectors/types.js';
import {
  facetForMemoryKind,
  isPersonalContextConnector,
  isUserContextRecord,
  originForMemoryRecord,
  projectUserContextRecord,
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
});
