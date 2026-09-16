import { describe, expect, it } from 'vitest';
import { ComputerTaskState, verifyComputerExpectation } from '../task-state.js';

const obs = { stateDigest: 'same', summary: JSON.stringify({ text: '- [0] AXWindow\n  - AXStaticText = "Saved"', elements: [
  { role: 'AXWindow' }, { role: 'AXTextField', label: '任务', value: '明天开会' }] }) } as any;
const action = { kind: 'click', point: { x: 1, y: 2 }, button: 'left', count: 1 } as const;
const receipt = { dispatch: 'completed', outcome: 'unknown' } as any;
describe('bounded desktop task state', () => {
  it('checks scoped text and exact field values, not arbitrary summary strings', () => {
    expect(verifyComputerExpectation({ kind: 'text', text: 'Saved' }, obs)?.status).toBe('satisfied');
    expect(verifyComputerExpectation({ kind: 'field', label: '任务', value: '明天开会' }, obs)?.status).toBe('satisfied');
    expect(verifyComputerExpectation({ kind: 'field', label: '任务', value: '开会' }, obs)?.status).toBe('not_met');
    expect(verifyComputerExpectation({ kind: 'text', text: 'Saved' }, { summary: 'Saved' } as any)?.status).toBe('unavailable');
    expect(verifyComputerExpectation({ kind: 'text', text: 'Saved' }, { summary: '{"text":"Saved","elements":[]}' } as any)?.status).toBe('unavailable');
  });
  it('stops a third identical no-change input without preventing a changed-state attempt', () => {
    const state = new ComputerTaskState();
    state.record('Click', action, obs, receipt, obs);
    expect(() => state.assertProgress(action, obs)).not.toThrow();
    state.record('Click', action, obs, receipt, obs);
    expect(() => state.assertProgress(action, obs)).toThrow('NO_PROGRESS');
    expect(() => state.assertProgress(action, { ...obs, stateDigest: 'changed' })).not.toThrow();
  });
  it('requires native selected state, not the presence of a navigation label', () => {
    const observation = (elements: any[]) => ({ summary: JSON.stringify({ text: 'Memories', elements: [{ role: 'AXWindow' }, ...elements] }) } as any);
    const condition = { kind: 'selected', label: 'Memories' } as const;
    expect(verifyComputerExpectation(condition, observation([{ label: 'Memories' }]))?.status).toBe('unavailable');
    expect(verifyComputerExpectation(condition, observation([{ label: 'Memories', selected: false }]))?.status).toBe('not_met');
    expect(verifyComputerExpectation(condition, observation([{ label: 'Memories', selected: true }]))?.status).toBe('satisfied');
    expect(verifyComputerExpectation(condition, observation([{ label: 'Memories', selected: true }, { label: 'Memories', selected: false }]))?.status).toBe('unavailable');
  });
  it('does not claim exact field evidence from a clipped tree or an unverified web AX write', () => {
    const field = { role: 'AXTextField', label: 'Message', value: 'hello' };
    const condition = { kind: 'field', label: 'Message', value: 'hello' } as const;
    for (const data of [{ truncated: true, elements: [{ role: 'AXWindow' }, field] },
      { elements: [{ role: 'AXWindow' }, { ...field, in_web_content: true }] }]) {
      expect(verifyComputerExpectation(condition, { summary: JSON.stringify(data) } as any)?.status).toBe('unavailable');
    }
  });
  it('bounds history and clears it; unknown dispatch never becomes a completed step', () => {
    const state = new ComputerTaskState();
    for (let i = 0; i < 10; i++) state.record('x'.repeat(5000), action, obs, receipt, obs);
    expect(state.history).toHaveLength(6); expect(state.history[0].goal).toHaveLength(1000);
    state.clear(); state.record('Unknown', action, obs, { ...receipt, dispatch: 'unknown' }, obs);
    expect(state.history).toHaveLength(0);
  });
});
