import { describe, expect, it } from 'vitest';

import type { ToolUseContent } from '@/features/chat/messages/messages.types';

import {
  classifyFailure,
  extractSnapshot,
  formatDuration,
  isWorkflowToolBlock,
  resolveCardStatus,
  rollupPhases,
  severityTone,
} from '../workflow.utils';
import type { WorkflowSnapshot } from '../workflow.types';

function mkBlock(over: Partial<ToolUseContent> = {}): ToolUseContent {
  return {
    type: 'tool_use',
    id: 'id-1',
    name: 'workflow',
    input: {},
    status: 'done',
    ...over,
  };
}

function mkSnapshot(over: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    name: 'audit_repo',
    description: 'audit',
    phases: ['Scan', 'Synthesize'],
    currentPhase: 'Synthesize',
    logs: [],
    agents: [
      { id: 1, label: 'inventory', phase: 'Scan', prompt: 'p1', status: 'done' },
      { id: 2, label: 'merge', phase: 'Synthesize', prompt: 'p2', status: 'running' },
    ],
    agentCount: 2,
    runningCount: 1,
    doneCount: 1,
    errorCount: 0,
    skippedCount: 0,
    ...over,
  };
}

describe('isWorkflowToolBlock', () => {
  it('matches name="workflow"', () => {
    expect(isWorkflowToolBlock(mkBlock({ name: 'workflow' }))).toBe(true);
    expect(isWorkflowToolBlock(mkBlock({ name: 'read_file' }))).toBe(false);
  });
});

describe('resolveCardStatus', () => {
  it('maps running/done/error', () => {
    expect(resolveCardStatus(mkBlock({ status: 'running' }))).toBe('running');
    expect(resolveCardStatus(mkBlock({ status: 'done' }))).toBe('completed');
    expect(resolveCardStatus(mkBlock({ status: 'error' }))).toBe('failed');
  });
});

describe('extractSnapshot', () => {
  it('returns null when result is missing', () => {
    expect(extractSnapshot(mkBlock({ status: 'running', result: undefined }))).toBeNull();
  });

  it('returns null when result does not look like a snapshot', () => {
    const result = JSON.stringify({ content: [{ type: 'text', text: 'hi' }], details: { foo: 1 } });
    expect(extractSnapshot(mkBlock({ result }))).toBeNull();
  });

  it('parses SSE envelope with details', () => {
    const snap = mkSnapshot();
    const result = JSON.stringify({
      content: [{ type: 'text', text: 'done' }],
      details: snap,
    });
    const out = extractSnapshot(mkBlock({ result }));
    expect(out?.name).toBe('audit_repo');
    expect(out?.agents).toHaveLength(2);
  });

  it('reads block.details first while the tool is still running (live tool_update)', () => {
    const snap = mkSnapshot();
    const out = extractSnapshot(mkBlock({ status: 'running', result: undefined, details: snap }));
    expect(out?.name).toBe('audit_repo');
  });

  it('prefers block.result over block.details once tool_end arrives (final state wins)', () => {
    const live = mkSnapshot({ doneCount: 1, agents: [] });
    const final = mkSnapshot({ doneCount: 2, agents: [] });
    const out = extractSnapshot(
      mkBlock({
        status: 'done',
        details: live,
        result: JSON.stringify({ content: [], details: final }),
      }),
    );
    expect(out?.doneCount).toBe(2);
  });
});

describe('classifyFailure', () => {
  it('detects parse / abort / timeout / runtime kinds', () => {
    expect(
      classifyFailure(
        mkBlock({
          status: 'error',
          result: JSON.stringify({ content: [{ type: 'text', text: 'workflow parse error: meta.name must be lowercase snake_case' }] }),
        }),
      ),
    ).toBe('parse_error');

    expect(
      classifyFailure(
        mkBlock({
          status: 'error',
          result: JSON.stringify({ content: [{ type: 'text', text: 'workflow aborted' }] }),
        }),
      ),
    ).toBe('aborted');

    expect(
      classifyFailure(
        mkBlock({
          status: 'error',
          result: JSON.stringify({ content: [{ type: 'text', text: 'workflow timed out after 1800s' }] }),
        }),
      ),
    ).toBe('timeout');

    expect(
      classifyFailure(
        mkBlock({
          status: 'error',
          result: JSON.stringify({ content: [{ type: 'text', text: 'random crash' }] }),
        }),
      ),
    ).toBe('runtime_error');
  });
});

describe('rollupPhases', () => {
  it('groups agents into declared phases in order', () => {
    const snap = mkSnapshot();
    const { phases, unphased } = rollupPhases(snap);
    expect(phases.map((p) => p.title)).toEqual(['Scan', 'Synthesize']);
    expect(phases[0].done).toBe(1);
    expect(phases[1].running).toBe(1);
    expect(unphased).toBeNull();
  });

  it('separates agents with no phase', () => {
    const snap = mkSnapshot({
      phases: [],
      currentPhase: undefined,
      agents: [
        { id: 1, label: 'a', prompt: '', status: 'done' },
        { id: 2, label: 'b', prompt: '', status: 'running' },
      ],
    });
    const { phases, unphased } = rollupPhases(snap);
    expect(phases).toHaveLength(0);
    expect(unphased?.agents).toHaveLength(2);
  });

  it('keeps currentPhase visible even with no agents yet', () => {
    const snap = mkSnapshot({ phases: ['Lead'], currentPhase: 'Lead', agents: [] });
    const { phases } = rollupPhases(snap);
    expect(phases.map((p) => p.title)).toEqual(['Lead']);
    expect(phases[0].agents).toHaveLength(0);
  });

  it('omits empty phases that are not current', () => {
    const snap = mkSnapshot({
      phases: ['Lead', 'Empty'],
      currentPhase: 'Lead',
      agents: [{ id: 1, label: 'x', phase: 'Lead', prompt: '', status: 'done' }],
    });
    const { phases } = rollupPhases(snap);
    expect(phases.map((p) => p.title)).toEqual(['Lead']);
  });
});

describe('formatDuration', () => {
  it('handles ranges', () => {
    expect(formatDuration(900)).toBe('0s');
    expect(formatDuration(12_000)).toBe('12s');
    expect(formatDuration(83_000)).toBe('1m 23s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
    expect(formatDuration(3_600_000)).toBe('1h');
    expect(formatDuration(60_000)).toBe('1m');
  });
});

describe('severityTone', () => {
  it('maps known severities', () => {
    expect(severityTone('high')).toBe('high');
    expect(severityTone('Medium')).toBe('med');
    expect(severityTone('LOW')).toBe('low');
    expect(severityTone('chartreuse')).toBe('neutral');
    expect(severityTone(undefined)).toBe('neutral');
  });
});
