import { describe, expect, it } from 'vitest';

import { parseTurnOutcome } from './turn-outcome.js';

describe('turn outcome contract', () => {
  it('accepts the versioned result model and rejects invalid payloads', () => {
    const outcome = parseTurnOutcome({
      version: 1,
      outcomeId: 'run-1:outcome',
      runId: 'run-1',
      turnId: 'run-1',
      status: 'succeeded',
      deliverables: [],
      changeSet: {
        changeSetId: 'run-1:changes',
        files: [{ path: 'src/store.ts', status: 'modified' }],
        added: 5,
        removed: 2,
        diff: 'diff',
        environment: 'workspace',
      },
      evidence: [],
      createdAt: '2026-09-01T00:00:00.000Z',
    });

    expect(outcome?.changeSet?.files[0]?.path).toBe('src/store.ts');
    expect(parseTurnOutcome({ version: 2 })).toBeNull();
  });
});
