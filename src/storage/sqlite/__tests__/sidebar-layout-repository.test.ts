import { describe, expect, it } from 'vitest';

import {
  getSidebarLayout,
  replaceSidebarLayout,
  SidebarLayoutConflictError,
  sortBySidebarLayout,
} from '../sidebar-layout-repository.js';
import { useTestDatabase } from './test-database.js';

describe('sidebar layout repository', () => {
  useTestDatabase();

  it('persists a stable order and rejects stale writers', () => {
    expect(getSidebarLayout('inbox')).toEqual({ containerId: 'inbox', itemIds: [], revision: 0 });

    const saved = replaceSidebarLayout('inbox', ['b', 'a', 'c'], 0);
    expect(saved).toEqual({ containerId: 'inbox', itemIds: ['b', 'a', 'c'], revision: 1 });
    expect(sortBySidebarLayout([{ id: 'a' }, { id: 'new' }, { id: 'b' }], saved, (item) => item.id))
      .toEqual([{ id: 'new' }, { id: 'b' }, { id: 'a' }]);

    expect(() => replaceSidebarLayout('inbox', ['a', 'b'], 0)).toThrow(SidebarLayoutConflictError);
  });
});
