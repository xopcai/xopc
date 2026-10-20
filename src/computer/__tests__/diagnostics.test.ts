import { describe, expect, it } from 'vitest';
import { ComputerSessionDiagnostics, classifyComputerFailure } from '../diagnostics.js';
import { ComputerOperationError } from '../errors.js';
import { computerReportMeasurements } from '../evaluation.js';

describe('private computer session diagnostics', () => {
  it('keeps bounded metadata, deduplicates receipts and never equates unchanged input with task failure', async () => {
    let now = 100;
    const report = new ComputerSessionDiagnostics(() => now);
    await report.measure('model', async () => { now += 7; report.count('modelRequests'); });
    for (let i = 0; i < 20; i++) {
      report.propose(String(i), 'typeText');
      const receipt = { actionId: String(i), dispatch: 'completed', outcome: 'unknown', verification: 'visual' } as const;
      report.record(receipt, { stateDigest: 'same' } as any, { stateDigest: 'same' } as any);
      report.record(receipt);
    }
    report.finish(true); now += 1000;
    expect(report.snapshot()).toMatchObject({ status: 'released', durationMs: 7, phaseMs: { model: 7 }, counters: {
      modelRequests: 1, proposedInputs: 20, completedInputs: 20, unchangedInputs: 20, verifiedConditions: 0,
    } });
    expect(report.snapshot().recentActions).toHaveLength(12);
    expect(report.snapshot().failure).toBeUndefined();
    const copy = report.snapshot(); copy.counters.completedInputs = 0;
    expect(report.snapshot().counters.completedInputs).toBe(20);
  });
  it('records uncertain transport delivery and keeps the primary failure through cleanup', () => {
    const report = new ComputerSessionDiagnostics();
    report.propose('held', 'activate');
    report.fail(new Error('network failed with private credential'), 'dispatch');
    report.fail(new Error('COMPUTER_RELEASE_UNCONFIRMED'), 'release');
    report.finish(false);
    expect(report.snapshot()).toMatchObject({ status: 'release_unconfirmed', counters: { unknownDispatches: 1 },
      failure: { category: 'unknown', phase: 'dispatch', dispatch: 'unknown', errorCode: 'COMPUTER_OPERATION_FAILED' } });
    expect(JSON.stringify(report.snapshot())).not.toMatch(/credential|network|held/);
    expect(computerReportMeasurements(report.snapshot()).failure).toMatchObject({ phase: 'release', dispatch: 'unknown' });
  });
  it('separates claims, verified conditions, stale replans, wait and unknown receipts', () => {
    const report = new ComputerSessionDiagnostics();
    report.count('successClaims'); report.count('takeovers'); report.count('rescueAttempts'); report.count('rescueExhaustions');
    report.propose('discarded', 'click'); report.discard();
    report.propose('wait', 'wait'); report.record({ actionId: 'wait', dispatch: 'completed', outcome: 'unknown', verification: 'none' });
    report.propose('unknown', 'showMenu'); report.record({ actionId: 'unknown', dispatch: 'unknown', outcome: 'unknown', verification: 'none' });
    report.verify({ status: 'satisfied', source: 'accessibility', scope: 'expectation', preexisting: true });
    expect(report.snapshot().counters).toMatchObject({ proposedInputs: 2, completedInputs: 0, unknownDispatches: 1,
      successClaims: 1, takeovers: 1, verifiedConditions: 0, observationChanges: 1 });
    expect(() => computerReportMeasurements(report.snapshot())).toThrow('SESSION_ACTIVE');
    report.finish(true);
    expect(computerReportMeasurements(report.snapshot())).toMatchObject({ rescueAttempts: 1, rescueExhaustions: 1 });
  });
  it.each([
    ['COMPUTER_READ_ONLY', 'permission'], ['COMPUTER_WINDOW_CHANGED', 'target'], ['COMPUTER_UI_UNSTABLE', 'observation'],
    ['COMPUTER_MODEL_HTTP_429', 'model'], ['COMPUTER_NO_PROGRESS', 'no_progress'], ['COMPUTER_ACTION_BUDGET', 'budget'],
    ['COMPUTER_SEMANTIC_ACTION_UNCONFIRMED', 'native'], ['COMPUTER_EVALUATION_TIMEOUT', 'harness'],
    ['COMPUTER_DRIVER_KEY_REFUSED', 'native'], ['COMPUTER_DRIVER_SCROLL_REFUSED', 'native'],
    ['COMPUTER_PRIVATE_SECRET', 'unknown'], ['constructor', 'unknown'],
  ])('classifies %s without copying arbitrary errors', (code, category) => {
    const failure = classifyComputerFailure(new Error(code), 'dispatch');
    expect(failure.category).toBe(category);
    expect(failure.errorCode).toBe(category === 'unknown' ? 'COMPUTER_OPERATION_FAILED' : code);
  });
  it('preserves safe request correlation and the original budget error after an internal abort', () => {
    const id = crypto.randomUUID();
    const failure = classifyComputerFailure(new ComputerOperationError({ errorCode: 'COMPUTER_MODEL_HTTP_400', phase: 'model',
      diagnosticId: id, requestId: id, httpStatus: 400, serviceErrorCode: 'invalid_request' }), 'model');
    expect(failure).toMatchObject({ category: 'model', requestId: id, diagnosticId: id, httpStatus: 400, serviceErrorCode: 'invalid_request' });
    expect(classifyComputerFailure(new Error('COMPUTER_SESSION_BUDGET'), 'observe', undefined, true).category).toBe('budget');
    expect(classifyComputerFailure(new Error('private abort reason'), 'model', undefined, true).category).toBe('cancelled');
  });
});
