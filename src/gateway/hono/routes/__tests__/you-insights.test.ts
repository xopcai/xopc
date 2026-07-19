import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../../../../agent/memory/types.js';
import { buildInsightSuggestions, buildPersonalPlaybooks } from '../you.js';

function record(patch: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'memory-1',
    kind: 'routine',
    status: 'active',
    scope: { agentId: 'main' },
    content: 'Every Friday I prepare a concise progress update.',
    source: { provider: 'local' },
    confidence: 0.9,
    sensitivity: 'normal',
    explicitness: 'observed',
    durability: 'recurring',
    importance: 0.8,
    disclosurePolicy: 'referenceable',
    evidence: [{ sourceText: 'week one' }, { sourceText: 'week two' }],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    tags: ['user-understanding'],
    ...patch,
  };
}

describe('insight action suggestions', () => {
  it('suggests action only for stable, actionable understanding', () => {
    expect(buildInsightSuggestions([record()])).toEqual([
      expect.objectContaining({
        id: 'memory-1',
        action: 'make_repeatable',
        evidenceCount: 2,
      }),
    ]);
    expect(buildInsightSuggestions([record({ evidence: [], confidence: 0.2, importance: 0.1 })])).toEqual([]);
  });

  it('does not repeat accepted or dismissed suggestions', () => {
    expect(buildInsightSuggestions([record({ tags: ['user-understanding', 'insight-action:accepted'] })])).toEqual([]);
    expect(buildInsightSuggestions([record({ tags: ['user-understanding', 'insight-action:dismissed'] })])).toEqual([]);
  });

  it('turns durable goals into progress suggestions', () => {
    expect(buildInsightSuggestions([record({ kind: 'long_term_goal', explicitness: 'explicit', evidence: [] })])[0]).toEqual(
      expect.objectContaining({ action: 'start_progress' }),
    );
  });
});

describe('personal playbooks', () => {
  it('groups active memory rules by how they affect collaboration', () => {
    const playbooks = buildPersonalPlaybooks([
      record({ id: 'preference-1', kind: 'preference', content: 'Keep updates concise.' }),
      record({ id: 'lesson-1', kind: 'task_lesson', content: 'Run focused tests before the full suite.' }),
      record({ id: 'routine-1', kind: 'routine', content: 'Prepare a Friday summary.' }),
    ]);

    expect(playbooks.map((item) => item.id)).toEqual(['communication', 'execution', 'routines']);
    expect(playbooks.every((item) => item.enabled)).toBe(true);
  });

  it('keeps paused playbooks visible and marked inactive', () => {
    const playbooks = buildPersonalPlaybooks([
      record({ status: 'archived', tags: ['user-understanding', 'playbook:paused:routines'] }),
    ]);

    expect(playbooks).toEqual([
      expect.objectContaining({ id: 'routines', enabled: false }),
    ]);
  });
});
