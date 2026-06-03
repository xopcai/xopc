import { describe, expect, it } from 'vitest';

import {
  createWorkflowSnapshot,
  previewValue,
  recomputeCounts,
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

  it('previewValue truncates long strings', () => {
    expect(previewValue('a'.repeat(200), 20)).toMatch(/…$/);
    expect(previewValue({ foo: 'bar' })).toContain('foo');
    expect(previewValue(null)).toBe('');
  });
});
