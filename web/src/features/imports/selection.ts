import type { ImportInventory, InventoryItem } from './import-api';

export function selectable(item: InventoryItem) {
  return item.kind !== 'connection' && (item.status === 'ready' || item.status === 'conflict' || (item.kind === 'project' && item.status === 'existing'));
}

export function selectionState(items: InventoryItem[], selected: Set<string>) {
  const available = items.filter(selectable);
  const selectedCount = available.filter(item => selected.has(item.id)).length;
  return {
    checked: available.length > 0 && selectedCount === available.length,
    indeterminate: selectedCount > 0 && selectedCount < available.length,
    selectedCount,
    availableCount: available.length,
  };
}

export function toggleItems(inventory: ImportInventory, selected: Set<string>, items: InventoryItem[], checked: boolean) {
  return items.reduce((next, item) => toggleItem(inventory, next, item, checked), new Set(selected));
}

export function toggleItem(inventory: ImportInventory, selected: Set<string>, item: InventoryItem, checked: boolean) {
  const next = new Set(selected);
  if (!selectable(item)) return next;
  if (checked) {
    next.add(item.id);
    if (item.parentId) next.add(item.parentId);
    if (item.kind === 'project') for (const child of inventory.candidates) {
      if (child.parentId === item.id && child.kind === 'skill' && child.suggested && selectable(child)) next.add(child.id);
    }
  } else {
    next.delete(item.id);
    if (item.kind === 'project') for (const child of inventory.candidates) if (child.parentId === item.id) next.delete(child.id);
  }
  return next;
}
