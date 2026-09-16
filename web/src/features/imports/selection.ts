import type { ImportInventory, InventoryItem } from './import-api';
export function selectable(item: InventoryItem) {
  return item.status === 'ready' || item.status === 'conflict' || (item.kind === 'project' && item.status === 'existing');
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
