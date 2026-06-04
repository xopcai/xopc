import { describe, expect, it } from 'vitest';

import type { ToolUseContent } from '@/features/chat/messages/messages.types';

import {
  buildWorkflowFailureContext,
  classifyFailure,
  extractSnapshot,
  formatAgentElapsed,
  agentElapsedMs,
  formatDuration,
  isWorkflowFailureOutcome,
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

  it('treats in-band workflow failed text as failed even when status is done', () => {
    const result = JSON.stringify({
      content: [{ type: 'text', text: 'workflow failed: token budget exhausted' }],
      details: mkSnapshot(),
    });
    expect(resolveCardStatus(mkBlock({ status: 'done', result }))).toBe('failed');
  });
});

describe('isWorkflowFailureOutcome', () => {
  it('detects structured parse errors', () => {
    expect(
      isWorkflowFailureOutcome(
        mkBlock({
          status: 'done',
          result: JSON.stringify({
            content: [{ type: 'text', text: 'workflow: meta.name required' }],
            details: { error: 'meta.name must be snake_case' },
          }),
        }),
      ),
    ).toBe(true);
  });
});

describe('buildWorkflowFailureContext', () => {
  it('collects logs and failed agents into detail lines', () => {
    const snap = mkSnapshot({
      logs: ['workflow failed: VM timeout', 'agent review failed: no model'],
      agents: [
        { id: 1, label: 'review', phase: 'Scan', prompt: 'p', status: 'error', error: 'no model' },
      ],
    });
    const ctx = buildWorkflowFailureContext(
      mkBlock({
        status: 'done',
        result: JSON.stringify({
          content: [{ type: 'text', text: 'workflow failed: VM timeout' }],
          details: snap,
        }),
      }),
    );
    expect(ctx.headline).toBe('VM timeout');
    expect(ctx.detailLines.some((l) => l.includes('VM timeout'))).toBe(true);
    expect(ctx.failedAgents).toHaveLength(1);
    expect(ctx.logs).toHaveLength(2);
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

describe('formatAgentElapsed', () => {
  it('uses durationMs when finished', () => {
    expect(formatAgentElapsed({ id: 1, label: 'x', prompt: '', status: 'done', durationMs: 5000 })).toBe('5s');
  });

  it('computes live elapsed from startedAtMs', () => {
    const now = 10_000;
    const ms = agentElapsedMs(
      { id: 1, label: 'x', prompt: '', status: 'running', startedAtMs: 4000 },
      now,
    );
    expect(ms).toBe(6000);
    expect(formatAgentElapsed({ id: 1, label: 'x', prompt: '', status: 'running', startedAtMs: 4000 }, now)).toBe(
      '6s',
    );
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
