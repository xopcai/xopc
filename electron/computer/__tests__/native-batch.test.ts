import { describe, expect, it } from 'vitest';
import { decodeNativeBatchResult, supportsExactNativeBatch } from '../native-batch.js';

const success = { ok: true, strict_targets: true, total: 2, executed: 2, failed_step: null,
  steps: [{ index: 0, ok: true, dispatch: 'completed' }, { index: 1, ok: true, dispatch: 'completed' }] };
describe('exact native batch protocol', () => {
  it('requires the exact capability, not just run_steps or a version number', () => {
    expect(supportsExactNativeBatch(JSON.stringify({ tools: [{ name: 'run_steps', capabilities: ['input.batch'] }] }))).toBe(false);
    expect(supportsExactNativeBatch(JSON.stringify({ tools: [{ name: 'run_steps', capabilities: ['input.batch.exact.v1'] }] }))).toBe(true);
    expect(supportsExactNativeBatch('invalid')).toBe(false);
  });
  it('decodes a completed batch and preserves a known completed prefix on failure', () => {
    expect(decodeNativeBatchResult(JSON.stringify(success), 2, false)).toEqual({ progress: ['completed', 'completed'] });
    expect(decodeNativeBatchResult(JSON.stringify({ ok: false, strict_targets: true, total: 3, executed: 2, failed_step: 1,
      steps: [{ index: 0, ok: true, dispatch: 'completed' }, { index: 1, ok: false, dispatch: 'unknown' }] }), 3, true))
      .toEqual({ progress: ['completed', 'unknown', 'notStarted'], errorCode: 'COMPUTER_NATIVE_BATCH_FAILED' });
  });
  it('only treats an explicit preflight refusal as entirely unstarted', () => {
    expect(decodeNativeBatchResult(JSON.stringify({ ok: false, code: 'invalid_batch', executed: 0 }), 2, true))
      .toEqual({ progress: ['notStarted', 'notStarted'], errorCode: 'COMPUTER_NATIVE_BATCH_REFUSED' });
    expect(() => decodeNativeBatchResult(JSON.stringify({ ok: false, code: 'invalid_batch', executed: 0,
      steps: [{ index: 0, dispatch: 'completed' }] }), 2, true)).toThrow('INVALID_BATCH_RESULT');
  });
  it.each([
    { ...success, total: 3 }, { ...success, strict_targets: false }, { ...success, failed_step: 1 },
    { ...success, steps: [success.steps[1], success.steps[0]] },
    { ...success, steps: [success.steps[0]] },
  ])('refuses inconsistent responses without inventing a safe-to-retry suffix', response => {
    expect(() => decodeNativeBatchResult(JSON.stringify(response), 2, false)).toThrow('INVALID_BATCH_RESULT');
  });
});
