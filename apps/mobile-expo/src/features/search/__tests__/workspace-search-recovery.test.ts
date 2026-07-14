import { describe, expect, it } from 'vitest';

import { shouldPreserveWorkspaceSearch } from '../workspace-search-recovery';

describe('workspace search recovery', () => {
  it('keeps the query while a result is opened so it can be resumed after back navigation', () => {
    expect(shouldPreserveWorkspaceSearch('meeting notes')).toBe(true);
  });

  it('does not preserve an empty query', () => {
    expect(shouldPreserveWorkspaceSearch('   ')).toBe(false);
  });
});
