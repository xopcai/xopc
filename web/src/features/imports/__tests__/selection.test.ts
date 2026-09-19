import { describe, expect, it } from 'vitest';

import type { ImportInventory, InventoryItem } from '../import-api';
import { selectionState, toggleItems } from '../selection';

const items: InventoryItem[] = [
  { id: 'skill', kind: 'skill', name: 'skill', description: '', displayPath: '/skill', scope: 'user', status: 'ready', suggested: true },
  { id: 'context', kind: 'context', name: 'context', description: '', displayPath: '/context', scope: 'user', status: 'ready', suggested: false },
  { id: 'blocked', kind: 'skill', name: 'blocked', description: '', displayPath: '/blocked', scope: 'user', status: 'blocked', suggested: false },
];
const inventory: ImportInventory = { id: 'inventory', source: 'codex', createdAt: 0, expiresAt: 1, candidates: items, notices: [], complete: true };

describe('import group selection', () => {
  it('reports checked and indeterminate state using selectable items only', () => {
    expect(selectionState(items, new Set())).toMatchObject({ checked: false, indeterminate: false, availableCount: 2 });
    expect(selectionState(items, new Set(['skill']))).toMatchObject({ checked: false, indeterminate: true, selectedCount: 1 });
    expect(selectionState(items, new Set(['skill', 'context']))).toMatchObject({ checked: true, indeterminate: false, selectedCount: 2 });
  });

  it('selects available items without adding blocked items', () => {
    expect([...toggleItems(inventory, new Set(), items, true)]).toEqual(['skill', 'context']);
  });
});
