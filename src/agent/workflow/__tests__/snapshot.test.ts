import { describe, expect, it } from 'vitest';

import {
  createWorkflowSnapshot,
  previewValue,
  recomputeCounts,
  renderWorkflowFinalSummary,
  renderWorkflowPanel,
  renderWorkflowText,
} from '../snapshot.js';
import type { WorkflowSnapshot } from '../types.js';

function withAgents(): WorkflowSnapshot {
  const snap = createWorkflowSnapshot({ name: 'demo', description: 'demo workflow' });
  snap.phases.push('Scan', 'Synthesize');
  snap.currentPhase = 'Synthesize';
  snap.agents.push(
    { id: 1, label: 'inventory', phase: 'Scan', prompt: 'p1', status: 'done' },
    { id: 2, label: 'bugs', phase: 'Scan', prompt: 'p2', status: 'done' },
    { id: 3, label: 'merge', phase: 'Synthesize', prompt: 'p3', status: 'running' },
  );
  recomputeCounts(snap);
  return snap;
}

describe('snapshot', () => {
  it('recomputeCounts tallies statuses', () => {
    const snap = withAgents();
    expect(snap.agentCount).toBe(3);
    expect(snap.doneCount).toBe(2);
    expect(snap.runningCount).toBe(1);
    expect(snap.errorCount).toBe(0);
  });

  it('renderWorkflowText shows phases and agents', () => {
    const snap = withAgents();
    const text = renderWorkflowText(snap, false);
    expect(text).toContain('workflow: demo');
    expect(text).toContain('Scan 2/2');
    expect(text).toContain('Synthesize 0/1');
    expect(text).toContain('#3');
    expect(text).toMatch(/running/);
  });

  it('renderWorkflowText marks completed with ✓ in header', () => {
    const snap = createWorkflowSnapshot({ name: 'demo', description: 'd' });
    snap.agents.push({ id: 1, label: 'x', phase: 'P', prompt: '', status: 'done' });
    snap.phases.push('P');
    recomputeCounts(snap);
    const text = renderWorkflowText(snap, true);
    expect(text).toContain('workflow ✓ demo');
  });

  it('renderWorkflowPanel emphasizes active steps and recent results', () => {
    const snap = withAgents();
    snap.agents[2]!.currentStep = 'Read file: src/tui/tui.ts';
    snap.agents[1]!.resultPreview = 'Found command handler';
    const text = renderWorkflowPanel(snap, { status: 'running', nowMs: Date.now() });
    expect(text).toContain('demo running');
    expect(text).toContain('Active');
    expect(text).toContain('Read file: src/tui/tui.ts');
    expect(text).toContain('Recent');
    expect(text).toContain('Found command handler');
  });

  it('renderWorkflowFinalSummary shows status, result, and completed agents', () => {
    const snap = withAgents();
    snap.agents[2]!.status = 'done';
    snap.agents[2]!.resultPreview = 'Merged final answer';
    snap.result = { summary: 'Workflow finished' };
    recomputeCounts(snap);
    const text = renderWorkflowFinalSummary(snap, { status: 'succeeded' });
    expect(text).toContain('demo ✓ completed');
    expect(text).toContain('Result');
    expect(text).toContain('Workflow finished');
    expect(text).toContain('Completed');
    expect(text).toContain('Merged final answer');
  });

  it('previewValue truncates long strings', () => {
    expect(previewValue('a'.repeat(200), 20)).toMatch(/…$/);
    expect(previewValue({ foo: 'bar' })).toContain('foo');
    expect(previewValue(null)).toBe('');
  });
});
