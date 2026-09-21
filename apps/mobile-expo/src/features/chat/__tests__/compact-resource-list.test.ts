import { describe, expect, it } from 'vitest';

import {
  COMPACT_RESOURCE_PREVIEW_COUNT,
  compactResourcePreview,
} from '../compact-resource-list';

describe('compact resource list', () => {
  it('shows at most three resources in the transcript', () => {
    const preview = compactResourcePreview(['a', 'b', 'c', 'd', 'e']);

    expect(COMPACT_RESOURCE_PREVIEW_COUNT).toBe(3);
    expect(preview).toEqual({ visible: ['a', 'b', 'c'], hiddenCount: 2 });
  });

  it('does not report hidden resources when everything fits', () => {
    expect(compactResourcePreview(['a', 'b']))
      .toEqual({ visible: ['a', 'b'], hiddenCount: 0 });
  });
});
