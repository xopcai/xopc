import { describe, it, expect } from 'vitest';

import { mergeDistinctSenderIds } from '../preseed-allow-from.js';

describe('mergeDistinctSenderIds', () => {
  it('appends new ids and dedupes', () => {
    expect(mergeDistinctSenderIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('tolerates non-array existing', () => {
    expect(mergeDistinctSenderIds(undefined, ['ou_1'])).toEqual(['ou_1']);
  });
});
