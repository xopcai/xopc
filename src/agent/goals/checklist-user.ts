import {
  CHECKLIST_ITEM_COMPLETED,
  CHECKLIST_ITEM_IMPOSSIBLE,
  CHECKLIST_ITEM_PENDING,
  type ChecklistItemStatus,
  type GoalChecklistItem,
} from './checklist-types.js';
import {
  mergeCustomDataPatch,
  readPersistentGoal,
  serializePersistentGoal,
  PERSISTENT_GOAL_CUSTOM_KEY,
} from './state.js';

export type ChecklistUserMutationResult =
  | { kind: 'updated'; customData: Record<string, unknown> }
  | { kind: 'noop'; message: string }
  | { kind: 'error'; error: string };

function baseCustom(customData: Record<string, unknown> | undefined): Record<string, unknown> {
  return { ...(customData ?? {}) };
}

export function applyChecklistUserMutation(
  customData: Record<string, unknown> | undefined,
  op:
    | { type: 'add'; text: string }
    | { type: 'remove'; index1Based: number }
    | { type: 'mark'; index1Based: number; status: ChecklistItemStatus }
    | { type: 'reset' },
): ChecklistUserMutationResult {
  const s = readPersistentGoal(customData);
  if (!s || s.status === 'cleared') {
    return { kind: 'error', error: 'No active goal.' };
  }

  if (op.type === 'reset') {
    const next = { ...s, checklist: [], decomposed: false, consecutiveParseFailures: 0 };
    return {
      kind: 'updated',
      customData: mergeCustomDataPatch(baseCustom(customData), {
        [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(next),
      }),
    };
  }

  const list = [...(s.checklist ?? [])];

  if (op.type === 'add') {
    const text = op.text.trim();
    if (!text) return { kind: 'error', error: 'Empty checklist item.' };
    const item: GoalChecklistItem = {
      text,
      status: CHECKLIST_ITEM_PENDING,
      addedBy: 'user',
      addedAt: Date.now(),
    };
    list.push(item);
    const next = { ...s, checklist: list };
    return {
      kind: 'updated',
      customData: mergeCustomDataPatch(baseCustom(customData), {
        [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(next),
      }),
    };
  }

  if (!list.length) {
    return { kind: 'noop', message: 'Checklist is empty.' };
  }

  const idx = op.index1Based - 1;
  if (idx < 0 || idx >= list.length) {
    return { kind: 'error', error: `Index out of range (1–${list.length}).` };
  }

  if (op.type === 'remove') {
    list.splice(idx, 1);
    const next = { ...s, checklist: list };
    return {
      kind: 'updated',
      customData: mergeCustomDataPatch(baseCustom(customData), {
        [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(next),
      }),
    };
  }

  // mark
  const st = op.status;
  if (st !== CHECKLIST_ITEM_PENDING && st !== CHECKLIST_ITEM_COMPLETED && st !== CHECKLIST_ITEM_IMPOSSIBLE) {
    return { kind: 'error', error: 'Invalid status.' };
  }
  const item = { ...list[idx]! };
  item.status = st;
  if (st === CHECKLIST_ITEM_COMPLETED || st === CHECKLIST_ITEM_IMPOSSIBLE) {
    item.completedAt = Date.now();
    if (!item.evidence) item.evidence = 'marked by user';
  } else {
    item.completedAt = undefined;
  }
  list[idx] = item;
  const next = { ...s, checklist: list };
  return {
    kind: 'updated',
    customData: mergeCustomDataPatch(baseCustom(customData), {
      [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(next),
    }),
  };
}
