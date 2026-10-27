import { describe, expect, it } from 'vitest';
import { executeComputerProgram } from '../program-runtime.js';

describe('UI-only QuickJS runtime', () => {
  it('runs sequential UI calls and keeps JSON state without a transcript store', async () => {
    const calls: string[] = [];
    const store = Object.create(null);
    const result = await executeComputerProgram(`
      const state = await ui.observe({});
      const target = await ui.resolve({snapshotId: state.snapshotId, role: 'AXButton', label: 'Test'});
      text(await ui.act({snapshotId: state.snapshotId, action: {kind: 'activate', ref: target.ref}}));
      store('counter', (load('counter') || 0) + 1);
      text(typeof process + '/' + typeof fetch + '/' + typeof require);
    `, async method => { calls.push(method); return method === 'observe' ? { snapshotId: 'one' } : { ref: 'current' }; }, store, new AbortController().signal);
    expect(result.status).toBe('program_completed');
    expect(result.output).toContain('undefined/undefined/undefined');
    expect(calls).toEqual(['observe', 'resolve', 'act']);
    expect(store.counter).toBe(1);
  });
  it('returns a bounded script error so the main model can correct its program', async () => {
    const result = await executeComputerProgram('missingVariable()', async () => ({}), {}, new AbortController().signal);
    expect(result).toMatchObject({ status: 'program_error', errorCode: 'COMPUTER_PROGRAM_FAILED' });
    expect(result.scriptErrorMessage).toContain('missingVariable');
    expect(result.scriptErrorMessage.length).toBeLessThanOrEqual(1000);
  });
  it('rejects parallel UI input before starting a second host operation', async () => {
    let calls = 0;
    const result = await executeComputerProgram(`await Promise.all([ui.observe({}), ui.act({})]);`,
      async (_method, _args, signal) => {
        calls++;
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
        return {};
      }, {}, new AbortController().signal);
    expect(result.status).toBe('program_error');
    expect(calls).toBe(1);
  });
  it('does not let a script catch a native refusal and issue another input', async () => {
    let calls = 0;
    const result = await executeComputerProgram(`try { await ui.act({}); } catch {} await ui.act({});`,
      async () => { calls++; throw new Error('COMPUTER_DRIVER_CLICK_REFUSED'); }, {}, new AbortController().signal);
    expect(result.status).toBe('program_error');
    expect(calls).toBe(1);
  });
  it('interrupts CPU loops in the worker without blocking the Gateway', async () => {
    const result = await executeComputerProgram('while (true) {}', async () => ({}), {}, new AbortController().signal, 100);
    expect(result).toMatchObject({ status: 'program_error', scriptError: 'timeout' });
  });
  it('waits for cancellation of an unawaited host call and reports an incomplete program', async () => {
    let settled = false;
    const result = await executeComputerProgram('ui.observe({});', async (_method, _args, signal) => {
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      settled = true;
      return {};
    }, {}, new AbortController().signal);
    expect(settled).toBe(true);
    expect(result.status).toBe('program_error');
  });
});
