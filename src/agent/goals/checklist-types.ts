export const CHECKLIST_ITEM_PENDING = 'pending' as const;
export const CHECKLIST_ITEM_COMPLETED = 'completed' as const;
export const CHECKLIST_ITEM_IMPOSSIBLE = 'impossible' as const;

export type ChecklistItemStatus =
  | typeof CHECKLIST_ITEM_PENDING
  | typeof CHECKLIST_ITEM_COMPLETED
  | typeof CHECKLIST_ITEM_IMPOSSIBLE;

export const TERMINAL_CHECKLIST_STATUSES: ReadonlySet<ChecklistItemStatus> = new Set([
  CHECKLIST_ITEM_COMPLETED,
  CHECKLIST_ITEM_IMPOSSIBLE,
]);

export type ChecklistItemAddedBy = 'judge' | 'user';

export interface GoalChecklistItem {
  text: string;
  status: ChecklistItemStatus;
  addedBy: ChecklistItemAddedBy;
  addedAt: number;
  completedAt?: number;
  evidence?: string;
}

export function checklistCounts(items: GoalChecklistItem[]): {
  total: number;
  completed: number;
  impossible: number;
  pending: number;
} {
  const total = items.length;
  let completed = 0;
  let impossible = 0;
  for (const it of items) {
    if (it.status === CHECKLIST_ITEM_COMPLETED) completed += 1;
    else if (it.status === CHECKLIST_ITEM_IMPOSSIBLE) impossible += 1;
  }
  return { total, completed, impossible, pending: total - completed - impossible };
}

export function allChecklistTerminal(items: GoalChecklistItem[]): boolean {
  if (!items.length) return false;
  return items.every((it) => TERMINAL_CHECKLIST_STATUSES.has(it.status));
}
