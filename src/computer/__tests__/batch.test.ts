import { describe, expect, it, vi } from 'vitest';
import { executeComputerBatch } from '../batch.js';
import type { ComputerProgramHost } from '../program-runtime.js';

function fixture(satisfied = true) {
  let state = { snapshotId: 'initial', text: 'Initial', elements: [
    { role: 'AXWindow' }, { role: 'AXButton', label: 'Continue', ref: 'old-button' },
    { role: 'AXTextField', label: 'Title', ref: 'old-field', bounds: { x: 0, y: 0, width: 100, height: 20 } },
  ] };
  const host = vi.fn<ComputerProgramHost>(async (method, args: any) => {
    if (method === 'act') {
      state = { ...state, snapshotId: 'after', text: 'Ready', elements: [
        { role: 'AXWindow' }, { role: 'AXTextField', label: 'Title', ref: 'new-field' },
      ] };
      return { ...state, receipt: { actionId: 'receipt', dispatch: 'completed' } };
    }
    if (method === 'resolve') {
      const matches = state.elements.filter(element => element.role === args.role && element.label === args.label);
      if (matches.length !== 1) throw new Error('COMPUTER_ELEMENT_REF_REQUIRED');
      return matches[0];
    }
    if (method === 'observe') return state;
    if (method === 'emitScreenshot') return { imageRef: 'ephemeral' };
    throw new Error('Unexpected host call');
  });
  const options = { signal: new AbortController().signal, remainingInputs: 12,
    state: (id: string) => { if (id !== state.snapshotId) throw new Error('COMPUTER_STALE_OBSERVATION'); return state; },
    verify: vi.fn(() => ({ status: satisfied ? 'satisfied' as const : 'not_met' as const, source: 'accessibility' as const, scope: 'expectation' as const })) };
  return { host, options, run: (steps: unknown[]) => executeComputerBatch({ snapshotId: 'initial', steps }, host, options) };
}

describe('mixed computer batches and checkpoints', () => {
  it('dispatches mixed inputs together and checks an already-ready condition without another capture', async () => {
    const f = fixture();
    const result = await f.run([
      { kind: 'action', action: { kind: 'setValue', text: 'Draft' }, target: { role: 'AXTextField', label: 'Title' } },
      { kind: 'action', action: { kind: 'pressKeys', keys: ['return'] } },
      { kind: 'observe', expect: { kind: 'text', text: 'Ready' } },
    ]);
    expect(result).toMatchObject({ status: 'batch_completed', nextStep: 3, verification: { status: 'satisfied' } });
    expect(f.host.mock.calls.filter(([method]) => method === 'act')).toEqual([
      ['act', { snapshotId: 'initial', action: { kind: 'batch', actions: [
        { kind: 'setValue', ref: 'old-field', text: 'Draft' }, { kind: 'pressKeys', keys: ['return'] },
      ] } }, f.options.signal],
    ]);
    expect(f.host.mock.calls.some(([method]) => method === 'observe')).toBe(false);
  });
  it('resolves later targets again after a satisfied checkpoint', async () => {
    const f = fixture();
    await f.run([
      { kind: 'action', action: { kind: 'activate', ref: 'old-button' } },
      { kind: 'observe', expect: { kind: 'text', text: 'Ready' } },
      { kind: 'action', action: { kind: 'setValue', text: 'New title' }, target: { role: 'AXTextField', label: 'Title' } },
    ]);
    const actions = f.host.mock.calls.filter(([method]) => method === 'act');
    expect(actions).toHaveLength(2);
    expect(actions[1][1]).toMatchObject({ snapshotId: 'after', action: { actions: [{ kind: 'setValue', ref: 'new-field' }] } });
  });
  it('stops before later inputs if a checkpoint condition is unmet', async () => {
    const f = fixture(false);
    const result = await f.run([
      { kind: 'action', action: { kind: 'pressKeys', keys: ['return'] } },
      { kind: 'observe', expect: { kind: 'text', text: 'Ready' }, timeoutMs: 0 },
      { kind: 'action', action: { kind: 'pressKeys', keys: ['return'] } },
    ]);
    expect(result).toMatchObject({ status: 'condition_not_met', nextStep: 1, receipts: [{ dispatch: 'completed' }] });
    expect(f.host.mock.calls.filter(([method]) => method === 'act')).toHaveLength(1);
  });
  it('yields for visual interpretation without executing the remaining segment', async () => {
    const f = fixture();
    const result = await f.run([
      { kind: 'action', action: { kind: 'pressKeys', keys: ['return'] } },
      { kind: 'observe', visual: true },
      { kind: 'action', action: { kind: 'pressKeys', keys: ['return'] } },
    ]);
    expect(result).toMatchObject({ status: 'observation_required', nextStep: 2 });
    expect(f.host).toHaveBeenCalledWith('emitScreenshot', { snapshotId: 'after' }, f.options.signal);
    expect(f.host.mock.calls.filter(([method]) => method === 'act')).toHaveLength(1);
  });
  it('rejects historical refs after a checkpoint instead of reinterpreting them', async () => {
    const f = fixture();
    await expect(f.run([
      { kind: 'action', action: { kind: 'pressKeys', keys: ['return'] } },
      { kind: 'observe', expect: { kind: 'text', text: 'Ready' } },
      { kind: 'action', action: { kind: 'activate', ref: 'old-button' } },
    ])).rejects.toThrow('COMPUTER_ELEMENT_REF_REQUIRED');
    expect(f.host.mock.calls.filter(([method]) => method === 'act')).toHaveLength(1);
  });
  it('checks the complete input budget before the first write', async () => {
    const f = fixture(); f.options.remainingInputs = 1;
    await expect(f.run(Array.from({ length: 2 }, () => ({ kind: 'action', action: { kind: 'pressKeys', keys: ['return'] } })))).rejects.toThrow('COMPUTER_ACTION_BUDGET');
    expect(f.host).not.toHaveBeenCalled();
  });
  it('only polls while a checkpoint is unmet and continues as soon as it is ready', async () => {
    const f = fixture(false);
    f.options.verify.mockReturnValueOnce({ status: 'not_met', source: 'accessibility', scope: 'expectation' })
      .mockReturnValue({ status: 'satisfied', source: 'accessibility', scope: 'expectation' });
    expect(await f.run([{ kind: 'observe', expect: { kind: 'text', text: 'Ready' } }])).toMatchObject({ status: 'batch_completed' });
    expect(f.host.mock.calls.filter(([method]) => method === 'observe')).toHaveLength(1);
  });
});
