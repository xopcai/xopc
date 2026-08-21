import { describe, expect, it } from 'vitest';

import { effectiveMemoryStatus, nextMemoryReviewAt, resolveMemoryStability } from '../lifecycle.js';
import type { MemoryRecord } from '../types.js';

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'memory-1',
    providerId: 'local',
    kind: 'preference',
    status: 'active',
    scope: { userId: 'local-owner' },
    provenance: { sourceAgentId: 'main' },
    content: 'Prefer concise answers.',
    source: { provider: 'local' },
    confidence: 0.95,
    sensitivity: 'normal',
    explicitness: 'explicit',
    durability: 'durable',
    importance: 0.8,
    disclosurePolicy: 'referenceable',
    evidence: [{ confidence: 0.95 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('memory lifecycle', () => {
  it('keeps explicit durable understanding stable longer than inference', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    const explicit = resolveMemoryStability(record(), now);
    const inferred = resolveMemoryStability(record({ explicitness: 'inferred', confidence: 0.65, evidence: [] }), now);
    expect(explicit.score).toBeGreaterThan(inferred.score);
    expect(explicit.band).not.toBe('fragile');
  });

  it('derives a review cadence from durability and evidence type', () => {
    const from = Date.parse('2026-01-01T00:00:00.000Z');
    expect(nextMemoryReviewAt(record(), from)).toBe('2027-01-01T00:00:00.000Z');
    expect(nextMemoryReviewAt(record({ explicitness: 'inferred' }), from)).toBe('2026-04-01T00:00:00.000Z');
  });

  it('moves due active records into review without deleting them', () => {
    const due = record({ reviewAfter: '2026-02-01T00:00:00.000Z' });
    expect(effectiveMemoryStatus(due, Date.parse('2026-03-01T00:00:00.000Z'))).toBe('needs_review');
  });
});
