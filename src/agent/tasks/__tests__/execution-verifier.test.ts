import { describe, expect, it } from 'vitest';

import { verifyExecutionCompletion } from '../execution-verifier.js';

describe('verifyExecutionCompletion', () => {
  it('requires verified evidence rather than an observed agent claim', () => {
    const result = verifyExecutionCompletion({
      status: 'succeeded',
      acceptanceCriteria: ['Production health check passes'],
      startedAt: 100,
      evidence: [{
        title: 'Agent says health is good',
        verifies: ['Production health check passes'],
        strength: 'observed',
        observedAt: Date.now(),
      }],
    });

    expect(result.status).toBe('unverified');
  });

  it('matches normalized criterion identity but rejects partial text matches', () => {
    const criterion = 'Production health check passes';
    expect(verifyExecutionCompletion({
      status: 'succeeded',
      acceptanceCriteria: [criterion],
      startedAt: 100,
      evidence: [{
        title: 'Health endpoint result',
        verifies: ['  PRODUCTION   health check passes  '],
        strength: 'verified',
        observedAt: Date.now(),
      }],
    }).status).toBe('passed');

    expect(verifyExecutionCompletion({
      status: 'succeeded',
      acceptanceCriteria: [criterion],
      startedAt: 100,
      evidence: [{
        title: 'Unrelated partial statement',
        verifies: ['health check'],
        strength: 'verified',
        observedAt: Date.now(),
      }],
    }).status).toBe('unverified');
  });

  it('rejects evidence captured before the current run', () => {
    expect(verifyExecutionCompletion({
      status: 'succeeded',
      acceptanceCriteria: ['The deployed version is healthy'],
      startedAt: 2_000,
      evidence: [{
        title: 'Old health check',
        verifies: ['The deployed version is healthy'],
        strength: 'verified',
        observedAt: 1_999,
      }],
    }).status).toBe('unverified');
  });
});
