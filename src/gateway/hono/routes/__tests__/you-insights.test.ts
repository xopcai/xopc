import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../../../../agent/memory/types.js';
import {
  buildActionableInsightSuggestions,
  USER_CONFIRMED_MEMORY_TAG,
} from '../../../../user-context/actionableInsights.js';
import { buildPersonalPlaybooks, buildRoutineAutomationDraftHref } from '../you.js';

function record(patch: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'memory-1',
    providerId: 'local',
    kind: 'routine',
    status: 'active',
    scope: { userId: 'local-owner' },
    provenance: { sourceAgentId: 'main' },
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
    tags: ['user-understanding', USER_CONFIRMED_MEMORY_TAG],
    ...patch,
  };
}

describe('insight action suggestions', () => {
  it('suggests action only for stable, actionable understanding', () => {
    expect(buildActionableInsightSuggestions([record()], [])).toEqual([
      expect.objectContaining({
        id: 'memory-1',
        action: 'make_repeatable',
        evidenceCount: 2,
      }),
    ]);
    expect(buildActionableInsightSuggestions([record({ tags: ['user-understanding'] })], [])).toEqual([]);
  });

  it('does not repeat accepted or dismissed suggestions', () => {
    expect(buildActionableInsightSuggestions([record({ tags: ['user-understanding', USER_CONFIRMED_MEMORY_TAG, 'insight-action:accepted'] })], [])).toEqual([]);
    expect(buildActionableInsightSuggestions([record({ tags: ['user-understanding', USER_CONFIRMED_MEMORY_TAG, 'insight-action:dismissed'] })], [])).toEqual([]);
  });

  it('turns durable goals into progress suggestions', () => {
    expect(buildActionableInsightSuggestions([record({ kind: 'long_term_goal', explicitness: 'explicit', evidence: [] })], [])[0]).toEqual(
      expect.objectContaining({ action: 'start_progress' }),
    );
  });

  it('does not treat commitments or clause fragments as task suggestions', () => {
    expect(buildActionableInsightSuggestions([
      record({ id: 'commitment', kind: 'commitment', content: 'Update the project note tomorrow.' }),
      record({ id: 'fragment-1', kind: 'long_term_goal', content: '并且将现状更新进来' }),
      record({ id: 'fragment-2', kind: 'long_term_goal', content: '事项，汇总并更新到项目 note。' }),
      record({ id: 'fragment-3', kind: 'long_term_goal', content: '调查下问题' }),
      record({ id: 'deferred', kind: 'long_term_goal', content: '这个方向暂时不用开始推进' }),
    ], [])).toEqual([]);
  });

  it('deduplicates similar insights and goals already represented by open tasks', () => {
    const duplicate = record({
      id: 'goal-2',
      kind: 'long_term_goal',
      content: '系统学习 Rust，并完成一个可发布的命令行工具。',
    });
    expect(buildActionableInsightSuggestions([
      record({ id: 'goal-1', kind: 'long_term_goal', content: '系统学习 Rust，并完成一个可发布的命令行工具' }),
      duplicate,
    ], [])).toHaveLength(1);
    expect(buildActionableInsightSuggestions([duplicate], [
      '系统学习 Rust，并完成一个可发布的命令行工具',
    ])).toEqual([]);
  });

  it('proposes learned execution patterns for explicit approval', () => {
    expect(buildActionableInsightSuggestions([record({ kind: 'task_lesson', explicitness: 'observed' })], [])[0]).toEqual(
      expect.objectContaining({ action: 'add_playbook' }),
    );
  });

  it('builds a direct, encoded automation draft route for routines', () => {
    const href = buildRoutineAutomationDraftHref(record({ content: 'Every Friday, send R&D status.' }));
    const url = new URL(href, 'https://xopc.local');
    expect(url.pathname).toBe('/automations');
    expect(url.searchParams.get('draft')).toBe('Every Friday, send R&D status.');
    expect(url.searchParams.get('autogenerate')).toBe('1');
    expect(url.searchParams.get('insight')).toBe('memory-1');
  });
});

describe('personal playbooks', () => {
  it('groups active memory rules by how they affect collaboration', () => {
    const playbooks = buildPersonalPlaybooks([
      record({ id: 'preference-1', kind: 'preference', content: 'Keep updates concise.', tags: ['user-understanding', 'playbook:rule'] }),
      record({ id: 'lesson-1', kind: 'task_lesson', content: 'Run focused tests before the full suite.', tags: ['user-understanding', 'playbook:rule'] }),
      record({ id: 'routine-1', kind: 'routine', content: 'Prepare a Friday summary.', tags: ['user-understanding', 'playbook:rule'] }),
    ]);

    expect(playbooks.map((item) => item.id)).toEqual(['communication', 'execution', 'routines']);
    expect(playbooks.every((item) => item.enabled)).toBe(true);
  });

  it('keeps disabled playbook rules active as understanding but out of use', () => {
    const playbooks = buildPersonalPlaybooks([
      record({ tags: ['user-understanding', 'playbook:rule', 'playbook:disabled'] }),
    ]);

    expect(playbooks.find((item) => item.id === 'routines')).toEqual(
      expect.objectContaining({ id: 'routines', enabled: false }),
    );
  });

  it('keeps empty playbooks available for explicit rules', () => {
    expect(buildPersonalPlaybooks([]).map((item) => item.id)).toEqual(['communication', 'execution', 'routines']);
  });

  it('does not activate learned preferences before user approval', () => {
    expect(buildPersonalPlaybooks([record({ kind: 'task_lesson' })]).every((item) => item.rules.length === 0)).toBe(true);
  });

  it('returns the complete version chain for rollback', () => {
    const previous = record({ id: 'rule-v1', status: 'archived', tags: ['user-understanding', 'playbook:rule'] });
    const current = record({
      id: 'rule-v2',
      kind: 'routine',
      content: 'Prepare a Friday summary with evidence.',
      tags: ['user-understanding', 'playbook:rule'],
      supersedesRecordId: previous.id,
      updatedAt: '2026-07-11T00:00:00.000Z',
    });
    const rule = buildPersonalPlaybooks([previous, current]).find((item) => item.id === 'routines')?.rules[0];
    expect(rule?.versions.map((version) => version.id)).toEqual(['rule-v2', 'rule-v1']);
  });
});
