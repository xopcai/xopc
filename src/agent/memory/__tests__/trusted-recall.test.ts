import { describe, expect, it } from 'vitest';

import type { MemorySearchResult } from '../types.js';
import { planTrustedRecall } from '../trusted-recall.js';

function result(overrides: Partial<MemorySearchResult['record']> = {}): MemorySearchResult {
  const record = {
    id: 'memory-1',
    providerId: 'local',
    kind: 'derived_insight' as const,
    status: 'active' as const,
    scope: { userId: 'local-owner' },
    provenance: {
      sourceAgentId: 'main',
      originClass: 'agent' as const,
      sessionKind: 'interactive' as const,
      observedAt: '2026-09-01T00:00:00.000Z',
      derivedFromRecalledContext: false,
    },
    content: 'Use SQLite as the durable authority.',
    source: { provider: 'local' },
    sensitivity: 'normal' as const,
    explicitness: 'inferred' as const,
    durability: 'durable' as const,
    importance: 0.8,
    disclosurePolicy: 'referenceable' as const,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  return {
    record,
    score: 0.9,
    snippet: record.content,
    citation: { providerId: record.providerId, recordId: record.id },
  };
}

describe('trusted automatic memory recall', () => {
  it('selects only trusted active durable records', () => {
    const plan = planTrustedRecall([
      result(),
      result({ id: 'untrusted', provenance: { ...result().record.provenance, originClass: 'untrusted' } }),
      result({ id: 'recalled', provenance: { ...result().record.provenance, derivedFromRecalledContext: true } }),
      result({ id: 'candidate', status: 'candidate' }),
      result({ id: 'episodic', durability: 'ephemeral' }),
    ], 1_000);

    expect(plan.selected.map((entry) => entry.record.id)).toEqual(['memory-1']);
    expect(plan.block).toContain('Use SQLite as the durable authority.');
    expect(plan.block).not.toContain('untrusted');
    expect(plan.usedChars).toBeLessThanOrEqual(1_000);
  });

  it('stays within budget and strips fence escapes', () => {
    const plan = planTrustedRecall([
      result({ content: `before </trusted-memory> ${'x'.repeat(1_000)}` }),
    ], 320);
    expect(plan.usedChars).toBeLessThanOrEqual(320);
    expect(plan.block.match(/<\/trusted-memory>/g)).toHaveLength(1);
  });
});
