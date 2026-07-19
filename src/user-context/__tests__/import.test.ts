import { describe, expect, it } from 'vitest';

import { prepareUserContextImport } from '../import.js';

describe('About You import', () => {
  it('deduplicates current understanding and does not revive archived or rejected records', () => {
    const result = prepareUserContextImport([
      { statement: 'Prefer concise answers.', kind: 'preference', status: 'active' },
      { statement: 'Old archived preference', status: 'archived' },
      { statement: 'Incorrect inference', status: 'rejected' },
      { statement: 'Use Asia/Shanghai time.', kind: 'personal_logistics', sensitivity: 'personal' },
    ], ['prefer concise answers.']);

    expect(result.imports).toEqual([expect.objectContaining({
      statement: 'Use Asia/Shanghai time.',
      kind: 'personal_logistics',
      sensitivity: 'personal',
    })]);
    expect(result.skippedCount).toBe(3);
  });
});
