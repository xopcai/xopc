import { describe, expect, it } from 'vitest';
import { ComputerInputTimingSchema } from '@xopcai/computer-control-contract';
import { ComputerInputTimer } from '../native-timing.js';
import { ComputerSessionDiagnostics } from '../diagnostics.js';

describe('native input timing', () => {
  it('measures mutually exclusive stages and leaves RPC internals unattributed', async () => {
    let clock = 0;
    const timer = new ComputerInputTimer(false, () => clock);
    await timer.measure('identityCheckMs', () => { clock += 3; });
    await timer.measure('sdkCallMs', () => { clock += 80; });
    await timer.measure('renderGraceMs', () => { clock += 200; });
    clock += 2;
    expect(ComputerInputTimingSchema.parse(timer.finish(true))).toEqual({
      wallMs: 285, identityCheckMs: 3, actionValidationMs: 0, windowsInputGuardMs: null,
      sdkCallMs: 80, resultValidationMs: 0, renderGraceMs: 200, unattributedMs: 2, sdkCalls: 1, completed: true,
    });
  });
  it('retains failed SDK duration without claiming input completion', async () => {
    let clock = 0;
    const timer = new ComputerInputTimer(true, () => clock);
    await expect(timer.measure('sdkCallMs', () => { clock = 17; throw new Error('refused'); })).rejects.toThrow('refused');
    expect(timer.finish(false)).toMatchObject({ wallMs: 17, sdkCallMs: 17, renderGraceMs: 0, completed: false });
  });
  it('deduplicates receipt timing and bounds retained metadata', () => {
    const diagnostics = new ComputerSessionDiagnostics();
    const timing = { actionId: 'a', endpointRoundTripMs: 5 };
    diagnostics.timing(timing); diagnostics.timing(timing);
    expect(diagnostics.snapshot().timings).toEqual([timing]);
    for (let i = 0; i < 256; i++) diagnostics.timing({ ...timing, actionId: `a${i}` });
    expect(diagnostics.snapshot().timings).toHaveLength(256);
    expect(diagnostics.snapshot().timingsTruncated).toBe(true);
  });
});
